// 멀티 PC 마스터 콘솔 (v3 Phase 5).
//
//  - GET  /api/fleet/players               → 자동 발견된 플레이어 목록 (pStatus.sync.discovered)
//  - POST /api/fleet/refresh               → 디스커버리 재-probe (즉시 응답 유도)
//  - ALL  /api/fleet/players/:id/api/*      → 슬레이브 REST 리버스 프록시 (파일/플레이리스트 원격 관리)
//  - GET/POST /api/fleet/show              → 쇼(슬레이브→playlist 매핑) 조회/저장
//  - POST /api/fleet/show/play             → PTP arm(동기 대기·base_time 배포) + 공유 start_at 트리거
//  - POST /api/fleet/show/stop             → 전 대상 + 로컬 정지
//
// 원격 관리는 슬레이브의 "기존" REST 표면을 그대로 프록시한다(신규 프로토콜 0개). 전역 express.json이
// JSON 바디를 이미 파싱하므로 파싱된 바디는 재직렬화, multipart(업로드)는 원본 스트림을 파이프한다.

import express from 'express'
import http from 'http'
import pStatus from '../../../pStatus.js'
import { logger } from '../../../logger/index.js'
import { dbStatus } from '../../../db/index.js'
import { ioClient } from '../../../web/index.js'
import { refreshDiscovery } from '../../../api/player/discovery.js'
import { stop } from '../../../api/player/index.js'
import {
  computeStartAt,
  awaitRunningTime,
  triggerSyncPlay,
  distributeBaseTime,
  enablePtpLocal,
} from '../../../api/player/peerSync.js'

const router = express.Router()

const findPlayer = (id) => pStatus.sync.discovered?.[id] || null
const onlineSlaves = () =>
  Object.values(pStatus.sync.discovered || {}).filter(
    (p) => p.online && p.role === 'slave' && p.ip,
  )
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 슬레이브 REST 호출 (JSON, promise) — arm/폴링용
const slaveRest = (player, method, path, body) =>
  new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null
    const req = http.request(
      {
        host: player.ip,
        port: player.restPort || 3000,
        method,
        path,
        headers: {
          'content-type': 'application/json',
          ...(data ? { 'content-length': data.length } : {}),
        },
      },
      (res) => {
        let buf = ''
        res.on('data', (d) => (buf += d))
        res.on('end', () => {
          try {
            resolve(buf ? JSON.parse(buf) : {})
          } catch {
            resolve({ raw: buf })
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(3000, () => req.destroy(new Error('timeout')))
    if (data) req.write(data)
    req.end()
  })

// ── 목록 / 새로고침 ──────────────────────────────────────────────────────────
router.get('/players', (req, res) => {
  res.json(Object.values(pStatus.sync.discovered || {}))
})

router.post('/refresh', (req, res) => {
  refreshDiscovery()
  res.json({ ok: true })
})

// ── 리버스 프록시 : /players/:id/api/*  →  http://<ip>:<restPort>/api/*  ─────────
router.use('/players/:id/api', (req, res) => {
  const player = findPlayer(req.params.id)
  if (!player || !player.ip) return res.status(404).json({ error: 'player not found' })
  const port = player.restPort || 3000
  const targetPath = '/api' + req.url // req.url = 마운트 이후 경로(+쿼리)

  const ct = req.headers['content-type'] || ''
  const isMultipart = ct.includes('multipart/form-data')
  const hasParsedBody =
    !isMultipart &&
    req.body &&
    typeof req.body === 'object' &&
    Object.keys(req.body).length > 0

  const headers = { ...req.headers, host: `${player.ip}:${port}` }
  let bodyBuf = null
  if (hasParsedBody) {
    // 전역 express.json/urlencoded가 스트림을 소비했으므로 재직렬화 (JSON으로 통일)
    bodyBuf = Buffer.from(JSON.stringify(req.body))
    headers['content-type'] = 'application/json'
    headers['content-length'] = Buffer.byteLength(bodyBuf)
  }
  // multipart/raw는 원본 헤더(content-length 포함) 유지하고 스트림 파이프

  const proxyReq = http.request({ host: player.ip, port, method: req.method, path: targetPath, headers }, (proxyRes) => {
    res.status(proxyRes.statusCode || 502)
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (v !== undefined) res.setHeader(k, v)
    }
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (e) => {
    logger.warn(`fleet proxy ${player.ip}${targetPath} failed: ${e.message}`)
    if (!res.headersSent) res.status(502).json({ error: 'proxy failed', detail: e.message })
  })
  if (bodyBuf) proxyReq.end(bodyBuf)
  else req.pipe(proxyReq)
})

// ── 쇼 CRUD ──────────────────────────────────────────────────────────────────
router.get('/show', (req, res) => res.json(pStatus.sync.show))

router.post('/show', async (req, res) => {
  const s = pStatus.sync.show
  const b = req.body || {}
  if (['mirror', 'distributed'].includes(b.mode)) s.mode = b.mode
  if (Number.isInteger(b.domain)) s.domain = b.domain
  if (Number.isInteger(b.leadMs)) s.leadMs = b.leadMs
  if (b.mirrorPlaylistId !== undefined) s.mirrorPlaylistId = b.mirrorPlaylistId
  if (Number.isInteger(b.mirrorTrackIdx)) s.mirrorTrackIdx = b.mirrorTrackIdx
  if (b.assignments && typeof b.assignments === 'object') s.assignments = b.assignments
  try {
    await dbStatus.update({ type: 'show' }, { $set: { type: 'show', value: s } }, { upsert: true })
  } catch (e) {
    logger.warn(`fleet show persist failed: ${e.message}`)
  }
  ioClient?.emit?.('pStatus', { sync: { show: s } })
  res.json(s)
})

// ── PTP arm : 동기 완료 대기(best-effort) → base_time 배포 ─────────────────────
const waitPtpSynced = async (targets, timeoutMs) => {
  const startT = Date.now()
  while (Date.now() - startT < timeoutMs) {
    await awaitRunningTime() // master ptp(synced/base_time/running_time) 갱신
    const masterSynced = !!pStatus.sync.ptp?.synced
    let slavesSynced = true
    if (masterSynced && targets.length) {
      const checks = await Promise.all(
        targets.map((t) =>
          slaveRest(t.player, 'GET', '/api/player/sync')
            .then((s) => !!s?.ptp?.synced)
            .catch(() => false),
        ),
      )
      slavesSynced = checks.every(Boolean)
    }
    if (masterSynced && slavesSynced) return true
    await sleep(300)
  }
  logger.warn('fleet arm: PTP not fully synced within timeout — proceeding best-effort')
  return false
}

const armAndPlayShow = async () => {
  const show = pStatus.sync.show
  const domain = Number.isInteger(show.domain) ? show.domain : pStatus.sync.domain
  const leadMs = Number.isInteger(show.leadMs) ? show.leadMs : pStatus.sync.leadMs
  pStatus.sync.domain = domain
  pStatus.sync.leadMs = leadMs // computeStartAt이 참조

  // 대상 결정
  const targets =
    show.mode === 'distributed'
      ? Object.keys(show.assignments || {})
          .filter((id) => id !== pStatus.sync.playerId)
          .map((id) => ({ id, player: findPlayer(id), asg: show.assignments[id] }))
          .filter((t) => t.player && t.player.online && t.player.ip)
      : onlineSlaves().map((p) => ({
          id: p.id,
          player: p,
          asg: { playlistId: show.mirrorPlaylistId, trackIdx: show.mirrorTrackIdx || 0 },
        }))

  const advanceMode = show.mode === 'distributed' ? 'self' : 'master'

  // 1. PTP 켜기 (master 로컬 + 각 slave)
  enablePtpLocal(domain)
  await Promise.all(
    targets.map((t) =>
      slaveRest(t.player, 'PUT', '/api/player/sync', { role: 'slave', domain }).catch((e) =>
        logger.warn(`arm: slave ${t.player.ip} enable_ptp failed: ${e.message}`),
      ),
    ),
  )

  // 2. 동기 완료 대기 (best-effort)
  await waitPtpSynced(targets, 5000)

  // 3. base_time 1회 배포
  distributeBaseTime(targets.map((t) => t.player.ip))

  // 4. 공유 start_at 계산
  const startAt = await computeStartAt()

  // 5. 슬레이브 트리거
  const assignments = targets
    .filter((t) => t.asg && t.asg.playlistId != null)
    .map((t) => ({
      ip: t.player.ip,
      playlistId: t.asg.playlistId,
      trackIdx: t.asg.trackIdx || 0,
      advanceMode,
    }))
  triggerSyncPlay(assignments, startAt)

  // 6. master 로컬 재생 (있으면)
  const masterAsg =
    show.mode === 'distributed'
      ? show.assignments?.[pStatus.sync.playerId]
      : { playlistId: show.mirrorPlaylistId, trackIdx: show.mirrorTrackIdx || 0 }
  let local = 'none'
  if (masterAsg && masterAsg.playlistId != null) {
    const { startMultiWindowSynced } = await import('../../../api/playlists/index.js')
    await startMultiWindowSynced(masterAsg.playlistId, masterAsg.trackIdx || 0, startAt, advanceMode)
    local = `playlist ${masterAsg.playlistId}`
  }

  return { ok: true, mode: show.mode, startAt, slaves: assignments.length, local }
}

router.post('/show/play', async (req, res) => {
  if (pStatus.sync.role !== 'master') {
    return res.status(400).json({ error: 'not master' })
  }
  try {
    res.json(await armAndPlayShow())
  } catch (e) {
    logger.error(`fleet show/play failed: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// ── 오차 진단 : 플레이어 간 PTP 클럭 오프셋 측정 ─────────────────────────────
// 절대 PTP 시각 = running_time + base_time (동기된 노드는 base_time가 달라도 절대값이 일치).
// 마스터가 자기 절대시각을 slave 왕복 전후로 두 번 재고 중점과 slave 값을 비교 → RTT 보정 오프셋.
// (동일 머신 2 인스턴스는 같은 시스템 클럭 → 오프셋 ≈ 0. 2 PC면 실제 PTP 잔차가 나온다.)
const localAbsSnap = async () => {
  const rt = await awaitRunningTime()
  const p = pStatus.sync.ptp || {}
  const running = Number(rt)
  const base = Number(p.base_time)
  return { running, base, abs: running + base, synced: !!p.synced }
}

router.get('/diag', async (req, res) => {
  const slaves = onlineSlaves()
  const players = []
  const m = await localAbsSnap()
  players.push({
    id: pStatus.sync.playerId,
    name: 'this (master)',
    self: true,
    synced: m.synced,
    running: m.running,
    offsetNs: 0,
    rttMs: 0,
  })
  for (const p of slaves) {
    try {
      const m0 = await localAbsSnap()
      const tS = Date.now()
      const s = await slaveRest(p, 'GET', '/api/player/running_time')
      const tR = Date.now()
      const m1 = await localAbsSnap()
      const sAbs = Number(s.running_time) + Number(s.base_time)
      const mMid = (m0.abs + m1.abs) / 2
      const offsetNs =
        Number.isFinite(sAbs) && Number.isFinite(mMid) ? Math.round(sAbs - mMid) : null
      players.push({
        id: p.id,
        name: p.name,
        self: false,
        synced: !!s.synced,
        running: Number(s.running_time),
        offsetNs,
        rttMs: tR - tS,
      })
    } catch (e) {
      players.push({ id: p.id, name: p.name, self: false, error: e.message })
    }
  }
  res.json({ players, at: Date.now() })
})

router.post('/show/stop', async (req, res) => {
  const slaves = onlineSlaves()
  await Promise.all(
    slaves.map((p) => slaveRest(p, 'POST', '/api/player/stop', {}).catch(() => {})),
  )
  try {
    stop() // master 로컬 전역 정지
  } catch (e) {
    logger.warn(`fleet show/stop local failed: ${e.message}`)
  }
  res.json({ ok: true, stopped: slaves.length })
})

export default router
