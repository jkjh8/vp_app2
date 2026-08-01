// 윈도우 모드 플레이리스트 E2E — 호스트 부팅 → 창 2개 → 윈도우형 플레이리스트 → 창별 독립
// 재생/정지 검증 + 전역 모드 토글 + 상단 메모리 필드.
// 사용법: node scratchpad/e2e_window.mjs
// 전제: Release vplayer.exe, dbFiles에 파일 ≥3 (이미지가 있으면 advance까지 검증).

import { spawn } from 'child_process'

const PORT = 3210
const BASE = `http://127.0.0.1:${PORT}/api`
const log = (...a) => console.log('[e2e]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jraw = async (r) => {
  const t = await r.text()
  try { return JSON.parse(t) } catch { return t }
}
const j = async (r) => jraw(r)
const status = async () => { const o = await jraw(await fetch(`${BASE}/status`)); return o.pStatus || o }

const gstBin = 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin'
const env = {
  ...process.env,
  NODE_ENV: 'development',
  VP_WEB_PORT: String(PORT),
  PATH: gstBin + ';' + process.env.PATH,
}
if (!env.VP_PLAYER_EXE) {
  env.VP_PLAYER_EXE = 'C:\\Users\\kjh\\Desktop\\DEV\\vp_player\\build\\Release\\vplayer.exe'
}

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); log(`  [${ok ? 'OK' : 'XX'}] ${name}${extra ? ' — ' + extra : ''}`) }

let pass = false
const host = spawn('node', ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (d) => process.stdout.write(`[host] ${d}`))
host.stderr.on('data', (d) => process.stderr.write(`[host-err] ${d}`))

async function waitFeature(timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const s = await status()
      if (Array.isArray(s.playerFeatures) && s.playerFeatures.includes('multi_window')) return s
    } catch { /* not up yet */ }
    await sleep(500)
  }
  return null
}

const createdWindows = []
const createdPlaylists = []

async function run() {
  log('호스트 기동 대기 (플레이어 ready + multi_window)...')
  const s = await waitFeature(30000)
  if (!s) throw new Error('multi_window feature not available within 30s')
  log('features:', s.playerFeatures.join(', '))

  // 파일 확보 (이미지 우선 = advance 빠르게 검증 가능)
  const files = await j(await fetch(`${BASE}/files`))
  const all = Array.isArray(files) ? files.filter((f) => f.uuid) : []
  const images = all.filter((f) => f.is_image === true || String(f.mimetype || '').startsWith('image'))
  const useImages = images.length >= 3
  const pool = useImages ? images : all
  if (pool.length < 3) throw new Error(`파일 부족 (필요 ≥3, 있음 ${pool.length})`)
  log(`파일 소스: ${useImages ? '이미지' : '혼합'} (${pool.length}개) — advance 검증=${useImages}`)
  const pick = (i) => pool[i % pool.length]

  // 창 2개 확보
  let winList = await j(await fetch(`${BASE}/player/windows`))
  let wins = (winList.windows || []).map((w) => w.id)
  while (wins.length < 2) {
    const r = await j(await fetch(`${BASE}/player/windows`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `E2E Win ${wins.length + 1}` }),
    }))
    if (r.window?.id != null) createdWindows.push(r.window.id)
    await sleep(400)
    winList = await j(await fetch(`${BASE}/player/windows`))
    wins = (winList.windows || []).map((w) => w.id)
  }
  const [W1, W2] = wins
  log(`창: W1=${W1}, W2=${W2}`)
  await sleep(500) // 창 생성 반영

  // 윈도우형 플레이리스트 생성
  const pid = 900 + Math.floor((Date.now() % 90))
  const pl = await j(await fetch(`${BASE}/playlist`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playlistId: pid, name: 'E2E Window PL', mode: 'window' }),
  }))
  check('윈도우형 플레이리스트 생성 (mode=window)', pl.mode === 'window', `id=${pid}`)
  // POST 응답엔 _id가 없을 수 있음 → 목록에서 playlistId로 _id 조회 (UI도 getPlaylists로 재조회)
  await sleep(200)
  let listed = await j(await fetch(`${BASE}/playlist`))
  const _id = (Array.isArray(listed) ? listed : []).find((p) => p.playlistId === pid)?._id
  if (!_id) throw new Error('생성한 플레이리스트 _id 조회 실패')
  createdPlaylists.push(_id)

  // 창별 항목 (평면 tracks). W1: A,B / W2: C,D,E. 이미지면 time=1s (빠른 advance)
  const t = useImages ? 1 : 0
  const tracks = [
    { window: W1, uuid: pick(0).uuid, time: t },
    { window: W1, uuid: pick(1).uuid, time: t },
    { window: W2, uuid: pick(2).uuid, time: t },
    { window: W2, uuid: pick(3).uuid, time: t },
    { window: W2, uuid: pick(4).uuid, time: t },
  ]
  await fetch(`${BASE}/playlist`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: _id, tracks, mode: 'window' }),
  })

  // 하이드레이션 확인 (GET /playlist)
  const full = await j(await fetch(`${BASE}/playlist`))
  const mine = (Array.isArray(full) ? full : []).find((p) => p._id === _id)
  check('플레이리스트 tracks 하이드레이션', (mine?.tracks || []).length === 5, `tracks=${(mine?.tracks || []).length}`)

  // repeat=all (창별 루프 검증용) — 현재 값 확인 후 필요 시 순환
  for (let i = 0; i < 3; i++) {
    const r = await j(await fetch(`${BASE}/player/repeat`))
    if (r.mode === 'all') break
  }

  // ── 전체 재생 (두 창 독립 시작) ──
  await fetch(`${BASE}/playlist/play?playlistId=${pid}&trackIndex=0`)
  await sleep(1500)
  let st = await status()
  const ws = st.windowStates || {}
  check('두 창 동시 재생 (windowStates 2개)', !!ws[W1] && !!ws[W2], `keys=${Object.keys(ws).join(',')}`)
  check('창별 seqIndex 존재', ws[W1]?.seqIndex != null && ws[W2]?.seqIndex != null,
    `W1.seq=${ws[W1]?.seqIndex} W2.seq=${ws[W2]?.seqIndex}`)

  // ── 창별 독립 advance (이미지일 때만; time=1s → ~3.5s 후 W2는 여러 번 진행) ──
  if (useImages) {
    await sleep(3500)
    st = await status()
    const ws2 = st.windowStates || {}
    // repeat=all이면 두 창 모두 계속 재생 중(키 존재). seqIndex는 창별로 독립 순환.
    check('advance 후 두 창 계속 재생', !!ws2[W1] && !!ws2[W2],
      `W1.seq=${ws2[W1]?.seqIndex} W2.seq=${ws2[W2]?.seqIndex}`)
  }

  // ── 창별 정지 (W1만 정지, W2는 계속) ──
  await fetch(`${BASE}/playlist/window/stop?windowId=${W1}`)
  await sleep(800)
  st = await status()
  const wsA = st.windowStates || {}
  check('W1만 정지 (windowStates에서 W1 제거)', !wsA[W1] && !!wsA[W2], `keys=${Object.keys(wsA).join(',')}`)

  // ── 창별 재생 (W1만 다시 재생, W2 무영향) ──
  await fetch(`${BASE}/playlist/window/play?playlistId=${pid}&windowId=${W1}&index=0`)
  await sleep(1000)
  st = await status()
  const wsB = st.windowStates || {}
  check('W1만 재생 재개 (W2 유지)', !!wsB[W1] && !!wsB[W2], `keys=${Object.keys(wsB).join(',')}`)

  // ── 전역 정지 (전 창) ──
  await fetch(`${BASE}/player/stop`)
  await sleep(800)
  st = await status()
  check('전역 정지 (windowStates 비움)', Object.keys(st.windowStates || {}).length === 0)

  // ── 전역 모드 토글 영속 ──
  await fetch(`${BASE}/playlist/playbackmode`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'window' }),
  })
  await sleep(300)
  st = await status()
  check('playbackMode 토글 (window)', st.playbackMode === 'window')
  await fetch(`${BASE}/playlist/playbackmode`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'scene' }),
  })

  // ── 메모리 상태 (상단 배지 데이터) ──
  await sleep(300)
  st = await status()
  const mem = st.memory || {}
  check('memory.sys_avail_bytes 존재 (상단 배지 데이터)', Number.isFinite(mem.sys_avail_bytes),
    `avail=${mem.sys_avail_bytes} total=${mem.sys_total_bytes}`)

  pass = results.every((r) => r.ok)
  log(`\n=== RESULT: ${pass ? 'PASS' : 'FAIL'} (${results.filter((r) => r.ok).length}/${results.length}) ===`)
}

run()
  .catch((e) => { console.error('[e2e] ERROR:', e.stack || e.message) })
  .finally(async () => {
    // 정리: 테스트 플레이리스트/창 삭제
    try { await fetch(`${BASE}/player/stop`) } catch {}
    for (const id of createdPlaylists) { try { await fetch(`${BASE}/playlist/${id}`, { method: 'DELETE' }) } catch {} }
    for (const wid of createdWindows) { try { await fetch(`${BASE}/player/windows/${wid}`, { method: 'DELETE' }) } catch {} }
    await sleep(500)
    try { host.kill() } catch {}
    await sleep(600)
    process.exit(pass ? 0 : 1)
  })
