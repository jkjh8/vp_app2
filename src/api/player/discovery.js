// 멀티 PC 자동 디스커버리 (v3). UDP 멀티캐스트 239.255.42.100:15003.
//
// 모델:
//  - standalone : 완전 비활성 (광고도, probe 응답도 안 함 — 독립 동작).
//  - slave      : ~3s 주기로 자신을 멀티캐스트 광고(announce) + master probe에 유니캐스트 응답.
//  - master     : announce 를 수집해 pStatus.sync.discovered 를 채우고 liveness(online/offline) 추적.
//                 승격/새로고침 시 probe 1발로 즉시 응답 유도.
//
// 재생 트리거/클럭(PTP)은 peerSync.js·플레이어가 담당. 이 모듈은 "누가 있는가"만 다룬다.

import dgram from 'dgram'
import os from 'os'
import { randomUUID } from 'crypto'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbStatus } from '../../db/index.js'
import { ioClient } from '../../web/index.js'

const DISCO_ADDR = '239.255.42.100'
const DISCO_PORT = 15003
const ANNOUNCE_INTERVAL_MS = 3000
const OFFLINE_AFTER_MS = 10000

let sock = null
let announceTimer = null
let pruneTimer = null

// 디스커버리 갱신을 SPA로 발신. discovered 는 통째 교체(오프라인 좀비 방지) — socketio.js 참고.
const emitDiscovered = () =>
  ioClient?.emit?.('pStatus', { sync: { discovered: pStatus.sync.discovered } })

// 라우팅 가능한 IPv4 (announce/넷클럭 접속 주소). 169.254.x(APIPA 링크로컬)는 후순위로 밀어
// 실제 LAN 주소(예: 192.168.x)를 우선 선택 — 멀티 NIC 환경에서 슬레이브가 접속 못 하는 문제 방지.
const primaryIpv4 = () => {
  const ifaces = os.networkInterfaces()
  let apipa = null
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      if (ni.address.startsWith('169.254.')) {
        apipa = apipa || ni.address
        continue
      }
      return ni.address
    }
  }
  return apipa || '127.0.0.1'
}

// 이 PC의 안정적 식별자 확보 (없으면 생성·영속)
const ensurePlayerId = async () => {
  if (pStatus.sync.playerId) return pStatus.sync.playerId
  const id = randomUUID()
  pStatus.sync.playerId = id
  try {
    await dbStatus.update(
      { type: 'playerId' },
      { $set: { type: 'playerId', value: id } },
      { upsert: true },
    )
  } catch (e) {
    logger.warn(`discovery: playerId persist failed: ${e.message}`)
  }
  return id
}

// 현재 재생 상태 요약 (announce 페이로드용)
const playingSummary = () => {
  const pl = pStatus.playlist || {}
  const isPlaying = Object.values(pStatus.windowStates || {}).some(
    (w) => w?.player?.is_playing,
  )
  return {
    playlistId: pl.playlistId ?? null,
    playlistName: pl.name ?? null,
    mode: pl.mode ?? pStatus.playbackMode,
    isPlaying,
  }
}

const buildAnnounce = () => ({
  type: 'announce',
  id: pStatus.sync.playerId,
  name: os.hostname(),
  hostname: os.hostname(),
  ip: primaryIpv4(),
  restPort: pStatus.webPort,
  role: pStatus.sync.role,
  version: process.env.VP_VERSION || '',
  playing: playingSummary(),
  ptp: {
    enabled: !!pStatus.sync.ptp?.enabled,
    synced: !!pStatus.sync.ptp?.synced,
  },
})

const send = (obj, port, addr) => {
  if (!sock) return
  const buf = Buffer.from(JSON.stringify(obj))
  sock.send(buf, port, addr, (e) => {
    if (e) logger.warn(`discovery send ${addr}:${port} failed: ${e.message}`)
  })
}

// slave: 멀티캐스트로 자기 광고
const sendAnnounce = () => send(buildAnnounce(), DISCO_PORT, DISCO_ADDR)
// master: 멀티캐스트 probe (즉시 응답 유도)
const sendProbe = () => send({ type: 'probe', from: pStatus.sync.playerId }, DISCO_PORT, DISCO_ADDR)

// master: announce 수신 → discovered 갱신
const updateDiscovered = (msg, rinfo) => {
  if (!msg.id || msg.id === pStatus.sync.playerId) return
  const prev = pStatus.sync.discovered[msg.id] || {}
  pStatus.sync.discovered[msg.id] = {
    ...prev,
    id: msg.id,
    name: msg.name || msg.hostname || rinfo.address,
    hostname: msg.hostname || '',
    ip: msg.ip || rinfo.address,
    restPort: msg.restPort || 3000,
    role: msg.role || 'slave',
    version: msg.version || '',
    playing: msg.playing || {},
    ptp: msg.ptp || {},
    lastSeen: Date.now(),
    online: true,
  }
  emitDiscovered()
}

// master: 오래 무소식인 슬레이브 offline 강등 (삭제 아님 — 히스토리 유지)
const pruneOffline = () => {
  const now = Date.now()
  let changed = false
  for (const id of Object.keys(pStatus.sync.discovered)) {
    const p = pStatus.sync.discovered[id]
    const stale = now - (p.lastSeen || 0) > OFFLINE_AFTER_MS
    if (p.online && stale) {
      p.online = false
      changed = true
    }
  }
  if (changed) emitDiscovered()
}

const onMessage = (buf, rinfo) => {
  let msg
  try {
    msg = JSON.parse(buf.toString())
  } catch {
    return
  }
  const role = pStatus.sync.role
  if (msg.type === 'probe' && role === 'slave') {
    // 마스터의 probe → 유니캐스트로 즉시 announce
    send(buildAnnounce(), rinfo.port || DISCO_PORT, rinfo.address)
    return
  }
  if (msg.type === 'announce' && role === 'master') {
    updateDiscovered(msg, rinfo)
  }
}

const stopDiscovery = () => {
  if (announceTimer) {
    clearInterval(announceTimer)
    announceTimer = null
  }
  if (pruneTimer) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
  if (sock) {
    try {
      sock.close()
    } catch {
      /* noop */
    }
    sock = null
  }
}

const startDiscovery = async () => {
  stopDiscovery()
  const role = pStatus.sync.role
  if (role === 'standalone') return
  await ensurePlayerId()

  sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  sock.on('error', (e) => logger.error(`discovery socket error: ${e.message}`))
  sock.on('message', (b, rinfo) => onMessage(b, rinfo))
  sock.bind(DISCO_PORT, () => {
    try {
      sock.addMembership(DISCO_ADDR)
      sock.setMulticastTTL(4)
    } catch (e) {
      logger.error(`discovery membership failed: ${e.message}`)
    }
    if (role === 'slave') {
      sendAnnounce()
      announceTimer = setInterval(sendAnnounce, ANNOUNCE_INTERVAL_MS)
    } else if (role === 'master') {
      sendProbe()
      pruneTimer = setInterval(pruneOffline, ANNOUNCE_INTERVAL_MS)
    }
    logger.info(`discovery started (role=${role}) on ${DISCO_ADDR}:${DISCO_PORT}`)
  })
}

// role 전이 시 재구성 (configureSync에서 호출)
const restartDiscovery = () => startDiscovery()

// 부팅 배선 (initWebServer 이후 호출 — ioClient/DB 준비된 뒤)
const initDiscovery = async () => {
  await ensurePlayerId()
  await startDiscovery()
}

// master: 강제 재-probe (UI '새로고침')
const refreshDiscovery = () => {
  if (pStatus.sync.role === 'master' && sock) sendProbe()
}

export { initDiscovery, restartDiscovery, stopDiscovery, refreshDiscovery, ensurePlayerId, primaryIpv4 }
