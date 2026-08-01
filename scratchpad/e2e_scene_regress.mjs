// 장면 모드 회귀 — 공유 경로(handleMediaChanged 가드 등) 변경 후 장면형이 여전히 동작하는지.
// 장면 플레이리스트 재생 → 전 창 동시(windowStates) → 락스텝 유지 → 정지 정리.
import { spawn } from 'child_process'
const PORT = 3210, BASE = `http://127.0.0.1:${PORT}/api`
const log = (...a) => console.log('[reg]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jraw = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const status = async () => { const o = await jraw(await fetch(`${BASE}/status`)); return o.pStatus || o }
const gstBin = 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin'
const env = { ...process.env, NODE_ENV: 'development', VP_WEB_PORT: String(PORT), PATH: gstBin + ';' + process.env.PATH }
if (!env.VP_PLAYER_EXE) env.VP_PLAYER_EXE = 'C:\\Users\\kjh\\Desktop\\DEV\\vp_player\\build\\Release\\vplayer.exe'
const results = []; const check = (n, ok, e = '') => { results.push(ok); log(`  [${ok ? 'OK' : 'XX'}] ${n}${e ? ' — ' + e : ''}`) }
let pass = false
const host = spawn('node', ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', () => {}); host.stderr.on('data', () => {})
const createdPl = []
async function waitF(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const s = await status(); if (s.playerFeatures?.includes('multi_window')) return s } catch {} await sleep(500) } return null }
async function run() {
  const s = await waitF(30000); if (!s) throw new Error('no multi_window')
  const files = await jraw(await fetch(`${BASE}/files`))
  const imgs = (Array.isArray(files) ? files : []).filter((f) => f.uuid && (f.is_image === true || String(f.mimetype || '').startsWith('image')))
  if (imgs.length < 2) throw new Error('이미지 부족')
  let wl = await jraw(await fetch(`${BASE}/player/windows`)); let wins = (wl.windows || []).map((w) => w.id)
  if (wins.length < 2) throw new Error('창 2개 필요 (윈도우 E2E 후 정리됐으면 재생성 필요)')
  const [W1, W2] = wins
  const pid = 800 + (Date.now() % 90)
  await fetch(`${BASE}/playlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playlistId: pid, name: 'REG Scene PL', mode: 'scene' }) })
  await sleep(200)
  const listed = await jraw(await fetch(`${BASE}/playlist`))
  const _id = (Array.isArray(listed) ? listed : []).find((p) => p.playlistId === pid)?._id
  createdPl.push(_id)
  // 장면 트랙: 각 장면 = 두 창 클립 동시 (1s 이미지)
  const tracks = [
    { clips: [{ window: W1, uuid: imgs[0].uuid, time: 1 }, { window: W2, uuid: imgs[1].uuid, time: 1 }], audios: [] },
    { clips: [{ window: W1, uuid: imgs[1 % imgs.length].uuid, time: 1 }, { window: W2, uuid: imgs[2 % imgs.length].uuid, time: 1 }], audios: [] },
  ]
  await fetch(`${BASE}/playlist`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: _id, tracks, mode: 'scene' }) })
  // repeat=all로 고정 (락스텝 지속 검증 — none이면 1s×2장면이 곧 자연 종료돼 정상적으로 정지)
  for (let i = 0; i < 4; i++) { const r = await jraw(await fetch(`${BASE}/player/repeat`)); if (r.mode === 'all') break }
  await fetch(`${BASE}/playlist/play?playlistId=${pid}&trackIndex=0`)
  await sleep(1500)
  let st = await status(); const ws = st.windowStates || {}
  check('장면 재생 → 두 창 동시(windowStates)', !!ws[W1] && !!ws[W2], `keys=${Object.keys(ws).join(',')}`)
  check('장면 인덱스 trackId 존재', Number.isInteger(st.trackId), `trackId=${st.trackId}`)
  await sleep(2500)
  st = await status()
  check('락스텝 진행 후 두 창 유지', !!(st.windowStates || {})[W1] && !!(st.windowStates || {})[W2])
  await fetch(`${BASE}/player/stop`); await sleep(800)
  st = await status()
  check('정지 → windowStates 비움', Object.keys(st.windowStates || {}).length === 0)
  pass = results.every(Boolean)
  log(`\n=== SCENE REGRESSION: ${pass ? 'PASS' : 'FAIL'} (${results.filter(Boolean).length}/${results.length}) ===`)
}
run().catch((e) => console.error('[reg] ERROR', e.message)).finally(async () => {
  try { await fetch(`${BASE}/player/stop`) } catch {}
  for (const id of createdPl) { try { await fetch(`${BASE}/playlist/${id}`, { method: 'DELETE' }) } catch {} }
  await sleep(400); try { host.kill() } catch {}; await sleep(600); process.exit(pass ? 0 : 1)
})
