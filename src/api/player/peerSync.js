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

// ── master: 클럭 / 트리거 배포 ───────────────────────────────────────────────
const enablePtpLocal = (domain) => {
  playerSend({
    command: 'enable_ptp',
    domain: Number.isInteger(domain) ? domain : pStatus.sync.domain,
  })
}

// 소프트웨어 넷클럭 활성화 (role 'master'=시간 제공 / 'slave'=원격 동기).
const enableNetClockLocal = (role, address, port) => {
  playerSend({
    command: 'enable_net_clock',
    role: role === 'master' ? 'master' : 'slave',
    address: address || '',
    port: Number.isInteger(port) ? port : pStatus.sync.netClockPort || 15004,
  })
}

// 이 PC의 로컬 플레이어에 "설정된 클럭"을 활성화. clockMode: 'ptp'|'netclock'|'auto'(→우선 PTP).
// netclock slave인데 master IP 미설정이면 스킵(arm이 IP 주입 후 재호출).
const enableClockLocal = (role = pStatus.sync.role) => {
  const s = pStatus.sync
  const mode = s.clockMode || 'auto'
  if (mode === 'netclock') {
    if (role === 'master') enableNetClockLocal('master', '', s.netClockPort)
    else if (s.netMasterIp) enableNetClockLocal('slave', s.netMasterIp, s.netClockPort)
    // else: master arm이 netMasterIp를 주입한 뒤 다시 호출
  } else {
    enablePtpLocal(s.domain) // ptp 또는 auto(우선 PTP — 미동기 시 fleet arm이 넷클럭으로 폴백)
  }
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
const CONFIG_KEYS = [
  'role',
  'domain',
  'multicastAddr',
  'multicastPort',
  'leadMs',
  'peers',
  'clockMode',
  'netClockPort',
  'netMasterIp',
]
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
  if (['auto', 'ptp', 'netclock'].includes(cfg.clockMode)) s.clockMode = cfg.clockMode
  if (Number.isInteger(cfg.netClockPort)) s.netClockPort = cfg.netClockPort
  if (typeof cfg.netMasterIp === 'string') s.netMasterIp = cfg.netMasterIp

  await persistSyncConfig()
  setupTrigger()
  await restartDiscovery()
  // 설정 변경 시 헬스 모니터 재시작(폴백 결정도 리셋). standalone이면 중지.
  stopClockHealth()
  if (s.role !== 'standalone') {
    enableClockLocal(s.role)
    startClockHealth()
  }
  emitSync()
  logger.info(`peerSync configured: role=${s.role} clock=${s.clockMode} domain=${s.domain}`)
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

// ── PTP/클럭 주기 헬스체크 (자가복구) ────────────────────────────────────────
// 무인 사이니지 특성상, 부팅 시 한 번 enable 만으로는 PTP 락 실패·클럭 드롭을 방치하게 된다.
// 5초마다 현재 클럭 상태(pStatus.sync.ptp.synced)를 점검해 미동기면 자동 복구한다:
//   1) 동일 모드로 재-enable (락 재시도)
//   2) clockMode='auto' 인데 PTP 가 연속 실패하면 넷클럭으로 폴백(fellBack) — 이후 넷클럭 유지
// 매 틱 get_running_time 을 보내 다음 틱용 최신 상태를 받아온다(→ SPA 인디케이터도 5초 갱신).
const HEALTH_INTERVAL_MS = 5000
const PTP_FAIL_FALLBACK = 3 // auto 모드에서 PTP 미동기 연속 N틱(≈15s) → 넷클럭 폴백
let healthTimer = null
let unsyncedTicks = 0
let fellBack = false // auto 모드에서 넷클럭으로 폴백했는지 (재무장/재설정 시 리셋)

const hasClockFeature = () =>
  (pStatus.playerFeatures || []).some((f) => f === 'ptp_sync' || f === 'net_clock')

// 미동기 복구 시도. 폴백(또는 netclock 고정)이면 넷클럭으로, 아니면 PTP 재시도(+auto 폴백 판정).
const recoverClock = () => {
  const s = pStatus.sync
  const useNet = s.clockMode === 'netclock' || fellBack
  if (useNet) {
    if (s.role === 'master') enableNetClockLocal('master', '', s.netClockPort)
    else if (s.netMasterIp) enableNetClockLocal('slave', s.netMasterIp, s.netClockPort)
    else enablePtpLocal(s.domain) // 넷클럭 slave인데 master IP 미확보 → 임시 PTP 재시도
    return
  }
  enablePtpLocal(s.domain) // 동일 모드(PTP/auto) 재시도
  if ((s.clockMode || 'auto') === 'auto' && unsyncedTicks >= PTP_FAIL_FALLBACK) {
    fellBack = true
    logger.warn(`clock health: PTP unsynced ${unsyncedTicks} ticks — falling back to net clock`)
    if (s.role === 'master') enableNetClockLocal('master', '', s.netClockPort)
    else if (s.netMasterIp) enableNetClockLocal('slave', s.netMasterIp, s.netClockPort)
  }
}

const clockHealthTick = () => {
  const s = pStatus.sync
  if (!s || s.role === 'standalone' || !hasClockFeature()) return
  const ptp = s.ptp || {}
  if (ptp.synced) {
    if (unsyncedTicks > 0) logger.info(`clock health: re-synced (mode=${ptp.mode || '?'})`)
    unsyncedTicks = 0
  } else {
    unsyncedTicks++
    logger.warn(
      `clock health: unsynced (mode=${ptp.mode || '?'}, enabled=${!!ptp.enabled}, streak=${unsyncedTicks}) — recovering`,
    )
    recoverClock()
  }
  playerSend({ command: 'get_running_time' }) // 다음 틱용 최신 상태 요청 (onPtpStatus로 갱신)
}

const startClockHealth = () => {
  if (healthTimer || pStatus.sync.role === 'standalone') return
  unsyncedTicks = 0
  fellBack = false
  healthTimer = setInterval(clockHealthTick, HEALTH_INTERVAL_MS)
  logger.info(`peerSync clock health monitor started (interval ${HEALTH_INTERVAL_MS}ms)`)
}

const stopClockHealth = () => {
  if (!healthTimer) return
  clearInterval(healthTimer)
  healthTimer = null
  logger.info('peerSync clock health monitor stopped')
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
  enableNetClockLocal,
  enableClockLocal,
  startClockHealth,
  stopClockHealth,
}
