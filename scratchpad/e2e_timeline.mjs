// B2 호스트 타임라인 E2E — 호스트 부팅 → 타임라인 CRUD → 트랜스포트 → 상태 검증.
// 사용법: node scratchpad/e2e_timeline.mjs
// 전제: VP_PLAYER_EXE 환경변수(Release vplayer.exe), dbFiles에 비디오 파일 ≥1 존재.

import { spawn } from 'child_process'

const PORT = 3210
const BASE = `http://127.0.0.1:${PORT}/api`
const log = (...a) => console.log('[e2e]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jraw = async (r) => {
  const t = await r.text()
  try { return JSON.parse(t) } catch { return t }
}
// /api/status는 { pStatus } 로 감싸 반환 → 언래핑
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

let pass = false
const host = spawn('node', ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (d) => process.stdout.write(`[host] ${d}`))
host.stderr.on('data', (d) => process.stderr.write(`[host-err] ${d}`))

async function waitFeature(timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const s = await status()
      if (Array.isArray(s.playerFeatures) && s.playerFeatures.includes('timeline')) return s
    } catch { /* not up yet */ }
    await sleep(500)
  }
  return null
}

async function run() {
  log('호스트 기동 대기 (플레이어 ready + timeline feature)...')
  const s = await waitFeature(30000)
  if (!s) throw new Error('player timeline feature not available within 30s')
  log('features:', s.playerFeatures.join(', '))

  const files = await j(await fetch(`${BASE}/files`))
  const vids = (Array.isArray(files) ? files : []).filter(
    (f) => f.uuid && (f.is_image === false || String(f.mimetype || '').startsWith('video')),
  )
  if (vids.length === 0) throw new Error('dbFiles에 비디오 파일이 없음 — 먼저 파일 업로드 필요')
  const A = vids[0]
  const B = vids[1] || vids[0]
  log(`사용 파일: A=${A.filename}  B=${B.filename}`)

  // 타임라인 생성
  const created = await j(await fetch(`${BASE}/timeline`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Timeline' }),
  }))
  const id = created._id
  log('생성:', id, created.name)

  // 트랙/클립 저장 (V1 order0: A 0-6s, V2 order1: B 3-9s, A1 audio: A 1-7s)
  const tracks = [
    { type: 'video', order: 0, clips: [{ uuid: A.uuid, start_ms: 0, in_ms: 0, out_ms: 6000 }] },
    { type: 'video', order: 1, clips: [{ uuid: B.uuid, start_ms: 3000, in_ms: 0, out_ms: 6000 }] },
    { type: 'audio', order: 0, channel_map: [0, 1], clips: [{ uuid: A.uuid, start_ms: 1000, in_ms: 0, out_ms: 6000 }] },
  ]
  const saved = await j(await fetch(`${BASE}/timeline`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ _id: id, tracks }),
  }))
  log('저장: duration_ms=', saved.duration_ms, ' tracks=', saved.tracks.length)
  if (saved.duration_ms !== 9000) throw new Error(`duration 재계산 오류: ${saved.duration_ms} (기대 9000)`)

  // 재생
  await fetch(`${BASE}/timeline/play?timelineId=${id}&time=0`)
  await sleep(1500)
  let st = await status()
  log('재생 후: timelineMode=', st.timelineMode, ' pos=', JSON.stringify(st.timelinePos))
  if (!st.timelineMode) throw new Error('timelineMode가 true가 아님')
  const t1 = st.timelinePos.time_ms
  await sleep(1500)
  st = await status()
  const t2 = st.timelinePos.time_ms
  log(`위치 진행: ${t1} → ${t2}`)
  if (!(t2 > t1)) throw new Error(`위치가 진행하지 않음 (${t1}→${t2})`)

  // 시크 4000
  await fetch(`${BASE}/timeline/seek`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ time_ms: 4000 }),
  })
  await sleep(1200)
  st = await status()
  log('시크 4000 후 pos=', st.timelinePos.time_ms)
  const seekOk = st.timelinePos.time_ms >= 3500 && st.timelinePos.time_ms <= 6500

  // 일시정지
  await fetch(`${BASE}/timeline/pause`)
  await sleep(600)
  st = await status()
  log('일시정지 후 is_playing=', st.timelinePos.is_playing)
  const pauseOk = st.timelinePos.is_playing === false

  // 정지 → 모드 복귀
  await fetch(`${BASE}/timeline/stop`)
  await sleep(600)
  st = await status()
  log('정지 후 timelineMode=', st.timelineMode)
  const stopOk = st.timelineMode === false

  // 정리
  await fetch(`${BASE}/timeline/${id}`, { method: 'DELETE' })

  pass = seekOk && pauseOk && stopOk
  log(`\n=== RESULT: ${pass ? 'PASS' : 'FAIL'} ===`)
  log(`seek: ${seekOk}, pause: ${pauseOk}, stop: ${stopOk}`)
}

run()
  .catch((e) => { console.error('[e2e] ERROR:', e.message) })
  .finally(async () => {
    await sleep(300)
    try { host.kill() } catch {}
    await sleep(500)
    process.exit(pass ? 0 : 1)
  })
