// 후속 정리 검증 — (1) deck_audio 라이브가 streams+window_id로 전송되는지, (2) 추가오디오 채널 라이브,
// (3) 제거된 라우트(play_id, playlist/mode) 404, (4) 창별 재생/정지 유지.
import { spawn } from 'child_process'
const PORT = 3210, BASE = `http://127.0.0.1:${PORT}/api`
const log = (...a) => console.log('[cl]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jraw = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const status = async () => { const o = await jraw(await fetch(`${BASE}/status`)); return o.pStatus || o }
const gstBin = 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin'
const env = { ...process.env, NODE_ENV: 'development', VP_WEB_PORT: String(PORT), PATH: gstBin + ';' + process.env.PATH }
if (!env.VP_PLAYER_EXE) env.VP_PLAYER_EXE = 'C:\\Users\\kjh\\Desktop\\DEV\\vp_player\\build\\Release\\vplayer.exe'
const R = []; const check = (n, ok, e = '') => { R.push(ok); log(`  [${ok ? 'OK' : 'XX'}] ${n}${e ? ' — ' + e : ''}`) }
let pass = false
// 호스트 로그를 버퍼링해 명령 전송을 검사
let hostlog = ''
const host = spawn('node', ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (d) => { hostlog += d.toString() })
host.stderr.on('data', (d) => { hostlog += d.toString() })
const createdPl = []
async function waitF(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const s = await status(); if (s.playerFeatures?.includes('multi_window')) return s } catch {} await sleep(500) } return null }
async function run() {
  const s = await waitF(30000); if (!s) throw new Error('no multi_window')
  check('live_routing 기능 존재', s.playerFeatures.includes('live_routing'))

  const files = await jraw(await fetch(`${BASE}/files`))
  const all = (Array.isArray(files) ? files : []).filter((f) => f.uuid)
  const withAudio = all.filter((f) => (f.metadata?.streams || []).some((st) => st.codec_type === 'audio'))
  const src = (withAudio[0] || all[0])
  if (!src) throw new Error('파일 없음')

  let wl = await jraw(await fetch(`${BASE}/player/windows`)); let wins = (wl.windows || []).map((w) => w.id)
  if (wins.length < 2) throw new Error('창 2개 필요')
  const [W1, W2] = wins
  const pid = 600 + (Date.now() % 90)
  await fetch(`${BASE}/playlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playlistId: pid, name: 'CL PL', mode: 'window' }) })
  await sleep(200)
  const _id = (await jraw(await fetch(`${BASE}/playlist`))).find((p) => p.playlistId === pid)?._id
  createdPl.push(_id)
  const tracks = [
    { window: W1, uuid: src.uuid, time: all[0].is_image ? 3 : 0 },
    { window: W2, uuid: (all[1] || src).uuid, time: all[1]?.is_image ? 3 : 0 },
  ]
  await fetch(`${BASE}/playlist`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: _id, tracks, mode: 'window' }) })

  // 재생
  await fetch(`${BASE}/playlist/play?playlistId=${pid}&trackIndex=0`)
  await sleep(1500)
  let st = await status()
  check('창 재생 (2창)', !!(st.windowStates || {})[W1] && !!(st.windowStates || {})[W2])

  // deck_audio 라이브 (streams + window_id 전송 검증)
  hostlog = ''
  await fetch(`${BASE}/playlist/deck_audio/live`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ window_id: W1, streams: [{ index: 0, channels: [{ out: 0, volume: 40, muted: false }] }] }),
  })
  await sleep(400)
  const sentDeck = /"command":"set_deck_audio"[^\n]*"window_id":\s*1[^\n]*"streams"/.test(hostlog) ||
    /"command":"set_deck_audio","window_id":1,"streams"/.test(hostlog)
  check('deck_audio 라이브가 streams+window_id로 전송', sentDeck,
    sentDeck ? '' : '(set_deck_audio 미검출 — 로그: ' + (hostlog.match(/set_deck_audio[^\n]*/)?.[0] || '없음') + ')')

  // 창별 정지/재생 유지
  await fetch(`${BASE}/playlist/window/stop?windowId=${W1}`); await sleep(600)
  st = await status()
  check('창별 정지 유지 (W1 제거)', !(st.windowStates || {})[W1] && !!(st.windowStates || {})[W2])
  await fetch(`${BASE}/playlist/window/play?playlistId=${pid}&windowId=${W1}&index=0`); await sleep(800)
  st = await status()
  check('창별 재생 유지 (W1 복귀)', !!(st.windowStates || {})[W1])
  await fetch(`${BASE}/player/stop`)

  // 제거된 라우트 404
  const r1 = await fetch(`${BASE}/player/play_id/${src.number || 1}`)
  check('제거된 GET /player/play_id → 404', r1.status === 404, `status=${r1.status}`)
  const r2 = await fetch(`${BASE}/playlist/mode`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: true }) })
  check('제거된 PUT /playlist/mode → 404', r2.status === 404, `status=${r2.status}`)

  pass = R.every(Boolean)
  log(`\n=== CLEANUP: ${pass ? 'PASS' : 'FAIL'} (${R.filter(Boolean).length}/${R.length}) ===`)
}
run().catch((e) => console.error('[cl] ERROR', e.stack || e.message)).finally(async () => {
  try { await fetch(`${BASE}/player/stop`) } catch {}
  for (const id of createdPl) { try { await fetch(`${BASE}/playlist/${id}`, { method: 'DELETE' }) } catch {} }
  await sleep(400); try { host.kill() } catch {}; await sleep(600); process.exit(pass ? 0 : 1)
})
