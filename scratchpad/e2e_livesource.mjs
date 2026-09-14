// 라이브 입력 소스(RTP) 호스트 E2E — 호스트 부팅 → 창 → 소스 생성 → 창 귀속 → set_window_source
// → sourceStates playing → 프리셋 저장/재적용(귀속 유지·재부착) → 소스 삭제(귀속 해제·키 삭제).
// 사용법: node scratchpad/e2e_livesource.mjs
// 전제: Release vplayer.exe (live_source capability), 시스템 GStreamer(x264enc), 데스크톱 세션.

import { spawn, execSync } from 'child_process'

const PORT = 3210
const BASE = `http://127.0.0.1:${PORT}/api`
const RTP_PORT = 5008
const log = (...a) => console.log('[e2e]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jraw = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const j = async (r) => jraw(r)
const status = async () => { const o = await jraw(await fetch(`${BASE}/status`)); return o.pStatus || o }
const post = (p, b) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })
const put = (p, b) => fetch(`${BASE}${p}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })
const del = (p) => fetch(`${BASE}${p}`, { method: 'DELETE' })

const gstBin = 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin'
const env = {
  ...process.env,
  NODE_ENV: 'development',
  VP_WEB_PORT: String(PORT),
  PATH: gstBin + ';' + process.env.PATH,
}
if (!env.VP_PLAYER_EXE) env.VP_PLAYER_EXE = 'C:\\Users\\kjh\\Desktop\\DEV\\vp_player\\build\\Release\\vplayer.exe'

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); log(`  [${ok ? 'OK' : 'XX'}] ${name}${extra ? ' — ' + extra : ''}`) }

const host = spawn('node', ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (d) => process.stdout.write(`[host] ${d}`))
host.stderr.on('data', (d) => process.stderr.write(`[host-err] ${d}`))

let sender = null
function startSender() {
  sender = spawn(`${gstBin}\\gst-launch-1.0.exe`,
    ['-q', 'videotestsrc', 'is-live=true', '!', 'video/x-raw,width=640,height=480,framerate=30/1',
     '!', 'x264enc', 'tune=zerolatency', 'key-int-max=15', '!', 'rtph264pay', 'config-interval=1',
     'pt=96', '!', 'udpsink', 'host=127.0.0.1', `port=${RTP_PORT}`],
    { env, stdio: ['ignore', 'ignore', 'pipe'] })
  sender.stderr.on('data', (d) => process.stderr.write(`[sender] ${d}`))
}

async function waitFeature(timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { const s = await status(); if (Array.isArray(s.playerFeatures) && s.playerFeatures.includes('live_source')) return s } catch { /* not up */ }
    await sleep(500)
  }
  return null
}
async function waitState(wid, want, timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = await status()
    const st = s.sourceStates?.[wid]?.state
    if (st === want) return true
    await sleep(400)
  }
  return false
}
async function waitGone(wid, timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = await status()
    if (!s.sourceStates || s.sourceStates[wid] == null) return true
    await sleep(400)
  }
  return false
}

let srcId = null
let W = null
let presetId = null

async function run() {
  log('호스트 기동 대기 (live_source capability)...')
  const s = await waitFeature(30000)
  if (!s) throw new Error('live_source feature not available within 30s')
  check('capabilities live_source', true, s.playerFeatures.join(','))

  startSender()
  await sleep(1200)

  // 창 확보
  let winList = await j(await fetch(`${BASE}/player/windows`))
  let wins = (winList.windows || []).map((w) => w.id)
  if (!wins.length) {
    const r = await j(await post('/player/windows', { name: 'E2E Live Win' }))
    W = r.window?.id
    await sleep(500)
  } else {
    W = wins[0]
  }
  check('창 확보', W != null, `W=${W}`)

  // 소스 생성 (RTP H264)
  const created = await j(await post('/sources', {
    name: 'E2E RTP', kind: 'rtp',
    rtp: { port: RTP_PORT, encoding_name: 'H264', payload: 96, clock_rate: 90000, media: 'video' },
    latency_ms: 100, has_audio: false,
  }))
  srcId = created?.id
  check('소스 생성(POST /sources)', !!srcId, `id=${srcId}`)

  // 창 귀속 → set_window_source
  await put(`/player/windows/${W}`, { sourceId: srcId })
  const bound = await j(await fetch(`${BASE}/player/windows`))
  const boundOk = (bound.windows || []).some((w) => w.id === W && w.sourceId === srcId)
  check('창 귀속(sourceId 저장)', boundOk)

  // 재생 상태 도달
  const playing = await waitState(W, 'playing', 12000)
  check('sourceStates playing 도달', playing)

  // 프리셋 저장 → 재적용 (destroy+create) → 귀속 유지 + 재부착
  const pr = await j(await post('/player/presets', { name: 'E2E Live Preset' }))
  presetId = pr.preset?.id
  check('프리셋 저장', presetId != null, `id=${presetId}`)
  await post(`/player/presets/${presetId}/apply`)
  await sleep(1500)
  const afterApply = await j(await fetch(`${BASE}/player/windows`))
  const stillBound = (afterApply.windows || []).some((w) => w.id === W && w.sourceId === srcId)
  check('프리셋 적용 후 귀속 유지', stillBound)
  const replaying = await waitState(W, 'playing', 12000)
  check('프리셋 적용 후 재생 재개', replaying)

  // 소스 삭제 → 귀속 해제 + sourceStates 키 삭제
  await del(`/sources/${srcId}`)
  const detached = await j(await fetch(`${BASE}/player/windows`))
  const isDetached = !(detached.windows || []).some((w) => w.id === W && w.sourceId === srcId)
  check('삭제 후 창 귀속 해제', isDetached)
  const gone = await waitGone(W, 6000)
  check('삭제 후 sourceStates 키 삭제', gone)
  srcId = null
}

async function cleanup() {
  try { if (srcId) await del(`/sources/${srcId}`) } catch { /* */ }
  try { if (presetId != null) await del(`/player/presets/${presetId}`) } catch { /* */ }
  try { if (sender) execSync(`taskkill /PID ${sender.pid} /T /F`, { stdio: 'ignore' }) } catch { /* */ }
  try { execSync(`taskkill /PID ${host.pid} /T /F`, { stdio: 'ignore' }) } catch { /* */ }
}

run()
  .then(() => { const pass = results.every((r) => r.ok); log(`\n=== RESULT: ${pass ? 'PASS' : 'FAIL'} (${results.filter((r) => r.ok).length}/${results.length}) ===`); return cleanup().then(() => process.exit(pass ? 0 : 1)) })
  .catch(async (e) => { log('ERROR:', e.message); await cleanup(); process.exit(1) })
