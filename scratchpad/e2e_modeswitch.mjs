// 플레이리스트 타입 즉시 전환 E2E — 장면↔윈도우 변환/저장/재생 검증.
import { spawn } from 'child_process'
const PORT = 3210, BASE = `http://127.0.0.1:${PORT}/api`
const log = (...a) => console.log('[sw]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jraw = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const status = async () => { const o = await jraw(await fetch(`${BASE}/status`)); return o.pStatus || o }
const gstBin = 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin'
const env = { ...process.env, NODE_ENV: 'development', VP_WEB_PORT: String(PORT), PATH: gstBin + ';' + process.env.PATH }
if (!env.VP_PLAYER_EXE) env.VP_PLAYER_EXE = 'C:\\Users\\kjh\\Desktop\\DEV\\vp_player\\build\\Release\\vplayer.exe'
const R = []; const check = (n, ok, e = '') => { R.push(ok); log(`  [${ok ? 'OK' : 'XX'}] ${n}${e ? ' — ' + e : ''}`) }
let pass = false
const host = spawn('node', ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', () => {}); host.stderr.on('data', () => {})
const createdPl = []
async function waitF(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const s = await status(); if (s.playerFeatures?.includes('multi_window')) return s } catch {} await sleep(500) } return null }
const getPl = async (id) => { const l = await jraw(await fetch(`${BASE}/playlist`)); return (Array.isArray(l) ? l : []).find((p) => p._id === id) }
async function run() {
  const s = await waitF(30000); if (!s) throw new Error('no multi_window')
  const files = await jraw(await fetch(`${BASE}/files`))
  const imgs = (Array.isArray(files) ? files : []).filter((f) => f.uuid && (f.is_image === true || String(f.mimetype || '').startsWith('image')))
  if (imgs.length < 2) throw new Error('이미지 부족')
  let wl = await jraw(await fetch(`${BASE}/player/windows`)); let wins = (wl.windows || []).map((w) => w.id)
  if (wins.length < 2) throw new Error('창 2개 필요')
  const [W1, W2] = wins
  const pid = 700 + (Date.now() % 90)
  await fetch(`${BASE}/playlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playlistId: pid, name: 'SW PL', mode: 'scene' }) })
  await sleep(200)
  const _id = (await getPl(undefined), (await jraw(await fetch(`${BASE}/playlist`))).find((p) => p.playlistId === pid)?._id)
  createdPl.push(_id)
  // 장면 2개, 각 장면에 두 창 클립
  const tracks = [
    { clips: [{ window: W1, uuid: imgs[0].uuid, time: 1 }, { window: W2, uuid: imgs[1].uuid, time: 1 }], audios: [] },
    { clips: [{ window: W1, uuid: imgs[1 % imgs.length].uuid, time: 1 }, { window: W2, uuid: imgs[0].uuid, time: 1 }], audios: [] },
  ]
  await fetch(`${BASE}/playlist`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: _id, tracks, mode: 'scene' }) })
  let pl = await getPl(_id)
  check('초기 장면형 (2 장면, 각 2클립)', pl.mode === 'scene' && pl.tracks.length === 2 && pl.tracks[0].clips.length === 2)

  // → 윈도우 전환
  await fetch(`${BASE}/playlist/mode_switch`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: _id, mode: 'window' }) })
  await sleep(300)
  pl = await getPl(_id)
  // 4개 평면 항목 (장면2×클립2), 각 항목 1클립(1창)
  const flatOk = pl.mode === 'window' && pl.tracks.length === 4 && pl.tracks.every((t) => (t.clips || []).length === 1)
  const winSet = new Set(pl.tracks.map((t) => t.clips[0].window))
  check('윈도우 전환 (4 평면 항목, 창 W1/W2 분포)', flatOk && winSet.has(W1) && winSet.has(W2), `n=${pl.tracks.length} wins=${[...winSet].join(',')}`)

  // 윈도우 모드로 재생 → 두 창 독립
  await fetch(`${BASE}/playlist/play?playlistId=${pid}&trackIndex=0`)
  await sleep(1500)
  let st = await status()
  check('전환 후 윈도우 재생 (2창 독립)', !!(st.windowStates || {})[W1] && !!(st.windowStates || {})[W2],
    `keys=${Object.keys(st.windowStates || {}).join(',')}`)
  await fetch(`${BASE}/player/stop`); await sleep(500)

  // → 장면 복귀
  await fetch(`${BASE}/playlist/mode_switch`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: _id, mode: 'scene' }) })
  await sleep(300)
  pl = await getPl(_id)
  check('장면 복귀 (4 장면, 각 1클립)', pl.mode === 'scene' && pl.tracks.length === 4 && pl.tracks.every((t) => (t.clips || []).length === 1),
    `n=${pl.tracks.length}`)

  pass = R.every(Boolean)
  log(`\n=== MODE SWITCH: ${pass ? 'PASS' : 'FAIL'} (${R.filter(Boolean).length}/${R.length}) ===`)
}
run().catch((e) => console.error('[sw] ERROR', e.stack || e.message)).finally(async () => {
  try { await fetch(`${BASE}/player/stop`) } catch {}
  for (const id of createdPl) { try { await fetch(`${BASE}/playlist/${id}`, { method: 'DELETE' }) } catch {} }
  await sleep(400); try { host.kill() } catch {}; await sleep(600); process.exit(pass ? 0 : 1)
})
