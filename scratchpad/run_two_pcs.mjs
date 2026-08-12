// 단일 PC에서 마스터+슬레이브 2 인스턴스를 띄우는 대화형 런처 (멀티 PC 동기 시연/테스트용).
//
// 사용 (vp_app2 폴더에서):
//   node scratchpad/run_two_pcs.mjs           # 빈 격리 인스턴스 (디스커버리/콘솔/오차패널 테스트)
//   node scratchpad/run_two_pcs.mjs --seed    # 실제 라이브러리를 복사 + 미디어 공유 → 기존 플레이리스트로
//                                             #   즉시 미러 동기 재생까지 시연 (읽기 위주, 실데이터 비변경)
//
// 뜨면 브라우저에서:
//   마스터 = http://localhost:3210  (좌측 메뉴에 "마스터 → 플레이어" 노출 — 여기서 슬레이브 확인/쇼/오차)
//   슬레이브 = http://localhost:3211
// 역할(master/slave)은 자동 설정됩니다. 종료 = 이 터미널에서 Ctrl+C.

import { spawn, execSync } from 'child_process'
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs'
import path from 'path'
import process from 'process'

const SEED = process.argv.includes('--seed')
const ROOT = path.resolve(process.cwd())
const GST_ROOT =
  process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 || 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\'
const GST_BIN = path.join(GST_ROOT, 'bin')
const PLAYER_EXE = path.resolve(ROOT, '../vp_player/build/Release/vplayer.exe')
const PLUGIN_PATH = path.resolve(ROOT, '../vp_player/build/Release')
const TMP = path.resolve(ROOT, 'scratchpad/two_pcs')
const REAL_APPDATA = process.env.APPDATA
const REAL_HOME = process.env.USERPROFILE

if (!existsSync(PLAYER_EXE)) {
  console.error('vplayer.exe not found:', PLAYER_EXE)
  process.exit(2)
}
rmSync(TMP, { recursive: true, force: true })

const mkInst = (name, port) => {
  const appdata = path.join(TMP, name, 'appdata')
  mkdirSync(appdata, { recursive: true })
  let home
  if (SEED) {
    // 실제 DB 스냅샷 복사 (플레이리스트/파일 레지스트리) + 미디어는 실제 홈 공유(재생=읽기)
    const src = path.join(REAL_APPDATA, 'db')
    if (existsSync(src)) cpSync(src, path.join(appdata, 'db'), { recursive: true })
    home = REAL_HOME
  } else {
    home = path.join(TMP, name, 'home')
    mkdirSync(home, { recursive: true })
  }
  return { name, port, appdata, home }
}
const A = mkInst('master', 3210)
const B = mkInst('slave', 3211)

const children = []
const startBackend = (inst) => {
  const env = {
    ...process.env,
    APPDATA: inst.appdata,
    USERPROFILE: inst.home,
    HOME: inst.home,
    VP_WEB_PORT: String(inst.port),
    NODE_ENV: 'development',
    VP_PLAYER_EXE: PLAYER_EXE,
    GST_PLUGIN_PATH: PLUGIN_PATH,
    PATH: GST_BIN + path.delimiter + process.env.PATH,
  }
  const c = spawn(process.execPath, ['src/main.js'], { cwd: ROOT, env })
  const tag = `[${inst.name}]`
  c.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`))
  c.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  c.on('exit', (code) => console.log(`${tag} exited code=${code}`))
  children.push(c)
  return c
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitWeb = async (inst, timeoutMs = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${inst.port}/api/player/sync`)
      if (r.ok) return
    } catch {
      /* not up */
    }
    await sleep(500)
  }
  throw new Error(`${inst.name} web not up`)
}
const setRole = (inst, role) =>
  fetch(`http://127.0.0.1:${inst.port}/api/player/sync`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, domain: 0 }),
  })

const cleanup = () => {
  for (const c of children) {
    try {
      execSync(`taskkill /PID ${c.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      /* gone */
    }
  }
}
process.on('SIGINT', () => {
  console.log('\nstopping...')
  cleanup()
  process.exit(0)
})

console.log(`== launching master(3210) + slave(3211) ${SEED ? '[seeded from real library]' : '[empty isolated]'} ==`)
startBackend(A)
startBackend(B)
await waitWeb(A)
await waitWeb(B)
console.log('web servers up; waiting for players to connect...')
await sleep(9000)
await setRole(A, 'master')
await setRole(B, 'slave')

console.log('\n────────────────────────────────────────────────────────')
console.log(' MASTER : http://localhost:3210   (menu: 마스터 → 플레이어)')
console.log(' SLAVE  : http://localhost:3211')
console.log(SEED
  ? ' 미러 쇼로 기존 플레이리스트 선택 → ▶ 쇼 재생 → 두 창 동기 + 오차 패널 확인'
  : ' 마스터 콘솔에서 슬레이브 발견 확인 + 오차 진단 패널(측정) 확인')
console.log(' 종료: Ctrl+C')
console.log('────────────────────────────────────────────────────────\n')
