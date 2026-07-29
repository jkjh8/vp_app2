// 멀티 PC 클럭 동기 코디네이터 (v3 Phase 5).
//
// 모델: 1대 master + N대 slave. 전 PC가 PTP(IEEE 1588, 멀티캐스트) 클럭으로 절대 시각을
// 공유하고, master가 base_time과 공유 start_at(러닝타임)을 배포한다. 각 PC 플레이어는 SwapTo
// 시 pad offset을 start_at으로 설정해 같은 시각에 첫 프레임을 표시(락스텝).
//
// 전송로: PTP는 플레이어 프로세스가 멀티캐스트로 직접 동기(UDP 319/320). 재생 트리거는 이
// 모듈이 멀티캐스트(dgram)로 전 slave 앱에 fan-out + 신뢰성 위해 각 slave의 JSON TCP(15001)로도
// 병행 전송(옵션). 기본 role=standalone일 때는 완전 비활성 — 단독 동작에 영향 없음.
//
// ⚠️ 2대+PTP 허용 네트워크에서 실검증 예정. 단일 머신에서는 구조/설정 경로만 확인됨.

import dgram from 'dgram'
import { createConnection } from 'net'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { playerSend } from '../../player/index.js'
import { dbStatus } from '../../db/index.js'
import { ioClient } from '../../web/index.js'

let mcastSocket = null // 멀티캐스트 송수신 소켓

const emitSync = () => ioClient.emit('pStatus', { sync: pStatus.sync })

// 멀티캐스트 소켓 (재)구성 — master는 송신, slave는 수신(bind + membership)
const setupMulticast = () => {
  if (mcastSocket) {
    try {
      mcastSocket.close()
    } catch {
      /* noop */
    }
    mcastSocket = null
  }
  const { role, multicastAddr, multicastPort } = pStatus.sync
  if (role === 'standalone') return

  mcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  mcastSocket.on('error', (e) => logger.error(`peerSync mcast error: ${e.message}`))

  if (role === 'slave') {
    mcastSocket.bind(multicastPort, () => {
      try {
        mcastSocket.addMembership(multicastAddr)
        logger.info(`peerSync slave listening on ${multicastAddr}:${multicastPort}`)
      } catch (e) {
        logger.error(`peerSync addMembership failed: ${e.message}`)
      }
    })
    mcastSocket.on('message', (buf) => onTrigger(buf))
  } else {
    // master: 송신 전용 (bind 불필요하나 멀티캐스트 TTL 설정 위해 bind)
    mcastSocket.bind(() => {
      try {
        mcastSocket.setMulticastTTL(4)
      } catch {
        /* noop */
      }
    })
  }
}

// slave: 멀티캐스트 트리거 수신 → PTP base_time 적용 후 start_at으로 재생
const onTrigger = async (buf) => {
  let msg
  try {
    msg = JSON.parse(buf.toString())
  } catch {
    return
  }
  if (msg.type !== 'sync_play') return
  logger.info(`peerSync trigger: start_at=${msg.start_at} base_time=${msg.base_time}`)
  if (Number.isFinite(msg.base_time)) {
    playerSend({ command: 'ptp_base_time', base_time: msg.base_time })
  }
  // 동적 import (순환 의존 회피)
  const { startMultiWindowSynced } = await import('../playlists/index.js')
  if (typeof startMultiWindowSynced === 'function' && msg.playlistId != null) {
    startMultiWindowSynced(msg.playlistId, msg.trackIdx ?? 0, msg.start_at)
  }
}

// master: slave 앱들에 신뢰성 TCP(15001)로 명령 1건 전송 (fire-and-forget)
const sendToSlaveTcp = (ip, port, obj) => {
  try {
    const c = createConnection({ host: ip, port }, () => {
      c.write(JSON.stringify(obj) + '\n')
      c.end()
    })
    c.on('error', (e) => logger.warn(`peerSync tcp ${ip}:${port} failed: ${e.message}`))
  } catch (e) {
    logger.warn(`peerSync tcp connect ${ip} failed: ${e.message}`)
  }
}

// master: 공유 start_at 계산 (최근 ptp running_time + leadMs). 신선도 위해 get_running_time 선발신.
const computeStartAt = () => {
  playerSend({ command: 'get_running_time' }) // pStatus.sync.ptp를 갱신 (async)
  const rt = Number(pStatus.sync.ptp?.running_time)
  const base = Number.isFinite(rt) ? rt : 0
  return base + (pStatus.sync.leadMs || 1000) * 1e6 // ms → ns
}

// master: 전 PC 동기 재생 트리거 배포 (멀티캐스트 + slave TCP 병행)
const triggerSyncPlay = (playlistId, trackIdx, startAt, baseTime) => {
  const payload = {
    type: 'sync_play',
    playlistId,
    trackIdx,
    start_at: startAt,
    base_time: baseTime,
  }
  const buf = Buffer.from(JSON.stringify(payload))
  if (mcastSocket && pStatus.sync.role === 'master') {
    mcastSocket.send(buf, pStatus.sync.multicastPort, pStatus.sync.multicastAddr, (e) => {
      if (e) logger.warn(`peerSync mcast send failed: ${e.message}`)
    })
  }
  for (const ip of pStatus.sync.peers || []) {
    sendToSlaveTcp(ip, pStatus.tcpJsonPort || 15001, {
      command: 'sync_play',
      ...payload,
    })
  }
}

// 설정 적용 (REST). role/domain/peers/multicast/lead 갱신 + 영속 + PTP 기동.
const configureSync = async (cfg = {}) => {
  const s = pStatus.sync
  if (typeof cfg.role === 'string') s.role = cfg.role
  if (Number.isInteger(cfg.domain)) s.domain = cfg.domain
  if (Array.isArray(cfg.peers)) s.peers = cfg.peers
  if (typeof cfg.multicastAddr === 'string') s.multicastAddr = cfg.multicastAddr
  if (Number.isInteger(cfg.multicastPort)) s.multicastPort = cfg.multicastPort
  if (Number.isInteger(cfg.leadMs)) s.leadMs = cfg.leadMs

  await dbStatus.update({ type: 'sync' }, { $set: { value: s } }, { upsert: true })

  setupMulticast()
  if (s.role !== 'standalone') {
    playerSend({ command: 'enable_ptp', domain: s.domain })
  }
  emitSync()
  logger.info(`peerSync configured: role=${s.role} domain=${s.domain} peers=${s.peers.length}`)
  return s
}

// 부팅 시 dbStatus에서 복원 (updateStatusFromDb가 pStatus.sync를 채운 후 호출)
const initSync = () => {
  if (pStatus.sync.role !== 'standalone') setupMulticast()
}

// parser가 ptp_status/running_time 수신 시 호출 → pStatus.sync.ptp 갱신
const onPtpStatus = (data) => {
  pStatus.sync.ptp = data || {}
  emitSync()
}

export { configureSync, initSync, onPtpStatus, computeStartAt, triggerSyncPlay }
