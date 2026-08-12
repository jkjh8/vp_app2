// 멀티 PC 클럭 동기 코디네이터 (v3 Phase 5).
//
// 모델: 1대 master + N대 slave. 전 PC가 PTP(IEEE 1588, 멀티캐스트) 클럭으로 절대 시각을
// 공유하고, master가 base_time과 공유 start_at(러닝타임)을 배포한다. 각 PC 플레이어는 SwapTo
// 시 pad offset을 start_at으로 설정해 같은 시각에 첫 프레임을 표시(락스텝).
//
// 전송로:
//  - PTP        : 플레이어 프로세스가 멀티캐스트로 직접 동기(UDP 319/320).
//  - 디스커버리 : discovery.js (UDP 15003) — 누가 있는지.
//  - 트리거     : 이 모듈이 슬레이브별 UDP 유니캐스트(15002)로 base_time / sync_play 배포.
//                 (레거시 미러 멀티캐스트도 호환 — 슬레이브 소켓이 유니캐스트·멀티캐스트 모두 수신.)
//
// 기본 role=standalone 이면 완전 비활성 — 단독 동작에 영향 없음.
// ⚠️ 2대+PTP 허용 네트워크에서 실검증 대상. 단일 머신에선 플럼빙만 확인 가능.

import dgram from 'dgram'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { playerSend } from '../../player/index.js'
import { dbStatus } from '../../db/index.js'
import { ioClient } from '../../web/index.js'
import { restartDiscovery } from './discovery.js'

let trigSocket = null // 트리거/ptp_base 유니캐스트 송수신 (포트 = sync.multicastPort, 기본 15002)

const emitSync = () => ioClient?.emit?.('pStatus', { sync: pStatus.sync })

// ── 소켓 ──────────────────────────────────────────────────────────────────
// slave : multicastPort 바인드 + 멤버십 → 유니캐스트/멀티캐스트 모두 수신
// master: 송신 전용 (bind 후 TTL 설정)
const setupTrigger = () => {
  if (trigSocket) {
    try {
      trigSocket.close()
    } catch {
      /* noop */
    }
    trigSocket = null
  }
  const { role, multicastAddr, multicastPort } = pStatus.sync
  if (role === 'standalone') return

  trigSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  trigSocket.on('error', (e) => logger.error(`peerSync trigger socket error: ${e.message}`))

  if (role === 'slave') {
    trigSocket.bind(multicastPort, () => {
      try {
        trigSocket.addMembership(multicastAddr)
        logger.info(`peerSync slave listening trigger on :${multicastPort}`)
      } catch (e) {
        logger.warn(`peerSync addMembership failed: ${e.message}`)
      }
    })
    trigSocket.on('message', (buf) => onTrigger(buf))
  } else {
    trigSocket.bind(() => {
      try {
        trigSocket.setMulticastTTL(4)
      } catch {
        /* noop */
      }
    })
  }
}

const sendUnicast = (ip, port, obj) => {
  if (!trigSocket) return
  const buf = Buffer.from(JSON.stringify(obj))
  trigSocket.send(buf, port, ip, (e) => {
    if (e) logger.warn(`peerSync unicast ${ip}:${port} failed: ${e.message}`)
  })
}

// ── slave 수신 ────────────────────────────────────────────────────────────
// ptp_base : master base_time 적용 (재생 전 러닝타임 좌표 정렬)
// sync_play: (필요 시 base 적용 후) start_at 으로 동기 재생
const onTrigger = async (buf) => {
  let msg
  try {
    msg = JSON.parse(buf.toString())
  } catch {
    return
  }
  if (msg.type === 'ptp_base') {
    if (Number.isFinite(msg.base_time)) {
      logger.info(`peerSync ptp_base: base_time=${msg.base_time}`)
      playerSend({ command: 'ptp_base_time', base_time: msg.base_time })
    }
    return
  }
  if (msg.type === 'sync_play') {
    logger.info(`peerSync trigger: playlist=${msg.playlistId} start_at=${msg.start_at}`)
    if (Number.isFinite(msg.base_time)) {
      playerSend({ command: 'ptp_base_time', base_time: msg.base_time })
    }
    const { startMultiWindowSynced } = await import('../playlists/index.js')
    if (typeof startMultiWindowSynced === 'function' && msg.playlistId != null) {
      startMultiWindowSynced(msg.playlistId, msg.trackIdx ?? 0, msg.start_at, msg.advance || 'master')
    }
  }
}

// ── running_time 왕복 (일회성 resolver — parser 의 running_time/ptp_status 피드백이 해소) ──
let rtResolvers = []

// parser 가 running_time 피드백을 받으면 onPtpStatus 를 거쳐 이 함수가 대기 중인 Promise 를 해소
const resolveRunningTime = (rt) => {
  if (!rtResolvers.length || !Number.isFinite(rt)) return
  const rs = rtResolvers
  rtResolvers = []
  for (const r of rs) r(rt)
}

// get_running_time 발신 후 신선한 러닝타임(ns)을 반환. 타임아웃 시 캐시값 폴백.
const awaitRunningTime = (timeoutMs = 300) =>
  new Promise((resolve) => {
    let done = false
    const finish = (val) => {
      if (done) return
      done = true
      resolve(val)
    }
    rtResolvers.push(finish)
    playerSend({ command: 'get_running_time' })
    setTimeout(() => {
      rtResolvers = rtResolvers.filter((r) => r !== finish)
      finish(Number(pStatus.sync.ptp?.running_time))
    }, timeoutMs)
  })

// master: 공유 start_at 계산 (신선한 running_time + leadMs). async.
const computeStartAt = async () => {
  const rt = await awaitRunningTime()
  const base = Number.isFinite(rt) ? rt : 0
  return base + (pStatus.sync.leadMs || 1000) * 1e6 // ms → ns
}

// ── master: PTP / 트리거 배포 ───────────────────────────────────────────────
const enablePtpLocal = (domain) => {
  playerSend({
    command: 'enable_ptp',
    domain: Number.isInteger(domain) ? domain : pStatus.sync.domain,
  })
}

// master: 자기 base_time 을 각 슬레이브에 1회 유니캐스트 → 전 PC 러닝타임 좌표 정렬.
// (재생 트리거와 분리 — 장면 재트리거 때 running_time 이 튀지 않게.)
const distributeBaseTime = (slaveIps = []) => {
  const baseTime = Number(pStatus.sync.ptp?.base_time)
  if (!Number.isFinite(baseTime)) {
    logger.warn('peerSync distributeBaseTime: local base_time 없음 (PTP enabled/synced?)')
    return
  }
  const port = pStatus.sync.multicastPort
  for (const ip of slaveIps) sendUnicast(ip, port, { type: 'ptp_base', base_time: baseTime })
}

// master: 슬레이브별 유니캐스트 sync_play.
// assignments = [{ ip, playlistId, trackIdx, advanceMode }] — 미러=동일 playlistId, 분산=제각각.
// advanceMode 'master'(미러 — master 재트리거 대기) | 'self'(분산 — slave 자체 전환).
const triggerSyncPlay = (assignments = [], startAt) => {
  const port = pStatus.sync.multicastPort
  for (const a of assignments) {
    if (!a?.ip || a.playlistId == null) continue
    sendUnicast(a.ip, port, {
      type: 'sync_play',
      playlistId: a.playlistId,
      trackIdx: a.trackIdx ?? 0,
      start_at: startAt,
      advance: a.advanceMode || 'master',
    })
  }
}

// ── 설정 / 부팅 ─────────────────────────────────────────────────────────────
const CONFIG_KEYS = ['role', 'domain', 'multicastAddr', 'multicastPort', 'leadMs', 'peers']
const persistSyncConfig = async () => {
  const cfg = {}
  for (const k of CONFIG_KEYS) cfg[k] = pStatus.sync[k]
  await dbStatus.update({ type: 'sync' }, { $set: { value: cfg } }, { upsert: true })
}

// 설정 적용 (REST). role/domain/multicast/lead 갱신 + 영속 + 트리거소켓·디스커버리 재구성 + 로컬 PTP.
const configureSync = async (cfg = {}) => {
  const s = pStatus.sync
  if (typeof cfg.role === 'string' && ['standalone', 'slave', 'master'].includes(cfg.role)) {
    s.role = cfg.role
  }
  if (Number.isInteger(cfg.domain)) s.domain = cfg.domain
  if (Array.isArray(cfg.peers)) s.peers = cfg.peers
  if (typeof cfg.multicastAddr === 'string') s.multicastAddr = cfg.multicastAddr
  if (Number.isInteger(cfg.multicastPort)) s.multicastPort = cfg.multicastPort
  if (Number.isInteger(cfg.leadMs)) s.leadMs = cfg.leadMs

  await persistSyncConfig()
  setupTrigger()
  await restartDiscovery()
  if (s.role !== 'standalone') enablePtpLocal(s.domain)
  emitSync()
  logger.info(`peerSync configured: role=${s.role} domain=${s.domain}`)
  return s
}

// 부팅 시 (updateStatusFromDb 이후, initWebServer/플레이어 이전) — 트리거 소켓만.
// PTP enable 은 플레이어 준비 이후(런타임 configureSync / master arm)에 수행.
const initSync = () => {
  if (pStatus.sync.role !== 'standalone') setupTrigger()
}

// parser 가 ptp_status/running_time 수신 시 호출 → pStatus.sync.ptp 갱신 + 대기 Promise 해소
const onPtpStatus = (data) => {
  pStatus.sync.ptp = data || {}
  resolveRunningTime(Number(data?.running_time))
  emitSync()
}

export {
  configureSync,
  initSync,
  onPtpStatus,
  computeStartAt,
  awaitRunningTime,
  triggerSyncPlay,
  distributeBaseTime,
  enablePtpLocal,
}
