// 멀티 PC 동기 — 단일 머신 2 인스턴스 플럼빙 + 플레이어 간 클럭 오차(diag) 확인.
//
// master(3210) + slave(3211)를 격리된 APPDATA/USERPROFILE로 띄우고(각자 vplayer 스폰),
// 역할 설정 → 자동 디스커버리 → 리버스 프록시 → PTP 상태 → /fleet/diag 오프셋을 출력한다.
//
// 주의: 동일 머신 2 인스턴스는 같은 시스템 클럭을 공유 → 오프셋 ≈ 0 (플럼빙 검증).
//       실제 PTP 잔차는 2 PC(동일 L2, UDP 319/320 개방)에서만 의미가 있다.
//       gst_ptp 헬퍼가 319/320을 단독 점유하면 2번째 플레이어는 synced=false일 수 있다(단일머신 한계).
//
// 실행: (vp_app2 cwd) node scratchpad/e2e_fleet.mjs

import { spawn, execSync } from 'child_process'
import { mkdirSync, rmSync, createWriteStream, readFileSync, existsSync } from 'fs'
import path from 'path'
import process from 'process'

const ROOT = path.resolve(process.cwd())
const GST_ROOT =
  process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 || 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\'
const GST_BIN = path.join(GST_ROOT, 'bin')
// TEST_PLAYER_EXE로 번들(dist) 플레이어를 지정하면 그 플레이어를 쓰고, 시스템 GStreamer를 PATH에
// 넣지 않는다(자체 동봉 검증 — 시스템 헬퍼로 인한 위양성 방지).
const PLAYER_EXE = process.env.TEST_PLAYER_EXE || path.resolve(ROOT, '../vp_player/build/Release/vplayer.exe')
const IS_BUNDLE = !!process.env.TEST_PLAYER_EXE
const PLUGIN_PATH = path.resolve(ROOT, '../vp_player/build/Release')
const TMP = path.resolve(ROOT, 'scratchpad/fleet_test')

if (!existsSync(PLAYER_EXE)) {
  console.error('vplayer.exe not found:', PLAYER_EXE)
  process.exit(2)
}
rmSync(TMP, { recursive: true, force: true })

const mkInst = (name, port) => {
  const appdata = path.join(TMP, name, 'appdata')
  const home = path.join(TMP, name, 'home')
  mkdirSync(appdata, { recursive: true })
  mkdirSync(home, { recursive: true })
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
    PATH: (IS_BUNDLE ? '' : GST_BIN + path.delimiter) + process.env.PATH,
  }
  const out = createWriteStream(path.join(TMP, inst.name + '.log'))
  const c = spawn(process.execPath, ['src/main.js'], { cwd: ROOT, env })
  c.stdout.pipe(out)
  c.stderr.pipe(out)
  c.on('exit', (code) => console.log(`[${inst.name}] backend exited code=${code}`))
  children.push(c)
  inst.proc = c
  return c
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const base = (inst) => `http://127.0.0.1:${inst.port}`
const jget = async (url) => {
  const r = await fetch(url)
  return { status: r.status, body: await r.json().catch(() => null) }
}
const jreq = async (url, method, body) => {
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const waitWeb = async (inst, timeoutMs = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(base(inst) + '/api/player/sync')
      if (r.ok) return true
    } catch {
      /* not up */
    }
    await sleep(500)
  }
  throw new Error(`${inst.name} web not up in ${timeoutMs}ms`)
}

const cleanup = () => {
  for (const c of children) {
    try {
      execSync(`taskkill /PID ${c.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
  }
}
process.on('SIGINT', () => {
  cleanup()
  process.exit(1)
})

let failed = false
const check = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + msg)
  if (!cond) failed = true
}
const tailLog = (inst, n = 12) => {
  try {
    const lines = readFileSync(path.join(TMP, inst.name + '.log'), 'utf8').trim().split('\n')
    return lines.slice(-n).join('\n')
  } catch {
    return '(no log)'
  }
}

const main = async () => {
  console.log('== starting 2 instances (master:3210, slave:3211) ==')
  startBackend(A)
  startBackend(B)
  await waitWeb(A)
  await waitWeb(B)
  console.log('both web servers up; waiting for players to spawn + connect...')
  await sleep(9000)

  const DOMAIN = Number(process.env.TEST_DOMAIN || 0)
  const CLOCK = process.env.TEST_CLOCK || 'ptp' // 'ptp' | 'netclock'
  console.log(`== set roles (clock=${CLOCK} domain ${DOMAIN}) ==`)
  if (CLOCK === 'netclock') {
    await jreq(base(A) + '/api/player/sync', 'PUT', { role: 'master', clockMode: 'netclock', netClockPort: 15004 })
    await jreq(base(B) + '/api/player/sync', 'PUT', { role: 'slave', clockMode: 'netclock', netMasterIp: '127.0.0.1', netClockPort: 15004 })
  } else {
    await jreq(base(A) + '/api/player/sync', 'PUT', { role: 'master', clockMode: 'ptp', domain: DOMAIN })
    await jreq(base(B) + '/api/player/sync', 'PUT', { role: 'slave', clockMode: 'ptp', domain: DOMAIN })
  }
  console.log('roles set; waiting for discovery + PTP sync...')
  await sleep(8000)

  // 1) 디스커버리
  const players = await jget(base(A) + '/api/fleet/players')
  console.log('discovered:', JSON.stringify(players.body))
  const slave = (players.body || []).find((p) => p.restPort === B.port)
  check(!!slave, 'master auto-discovered the slave')
  check(!!slave && slave.online, 'slave reported online')

  // 2) 리버스 프록시
  if (slave) {
    const prox = await jget(base(A) + `/api/fleet/players/${slave.id}/api/player/sync`)
    check(
      prox.status === 200 && prox.body?.role === 'slave',
      'proxy GET slave /player/sync → role=slave',
    )
  }

  // 3) PTP 상태
  const aSync = await jget(base(A) + '/api/player/sync')
  const bSync = await jget(base(B) + '/api/player/sync')
  console.log('master ptp:', JSON.stringify(aSync.body?.ptp))
  console.log('slave  ptp:', JSON.stringify(bSync.body?.ptp))

  // 4) 오차 진단 (핵심 — 플레이어 간 클럭 오프셋)
  const diag = await jget(base(A) + '/api/fleet/diag')
  console.log('== DIAG: offset between players ==')
  console.log(JSON.stringify(diag.body, null, 2))
  check(diag.status === 200 && Array.isArray(diag.body?.players), 'diag endpoint returns players')
  const slaveRow = (diag.body?.players || []).find((p) => !p.self)
  if (slaveRow && slaveRow.offsetNs != null) {
    const ms = (slaveRow.offsetNs / 1e6).toFixed(3)
    console.log(`>>> slave offset vs master ≈ ${slaveRow.offsetNs} ns (${ms} ms), rtt=${slaveRow.rttMs} ms, synced=${slaveRow.synced}`)
  } else {
    console.log('>>> offset N/A (players not PTP-synced on single machine — expected; needs 2 PCs)')
  }

  // 5) 쇼 저장
  const show = await jreq(base(A) + '/api/fleet/show', 'POST', { mode: 'mirror', domain: 0, leadMs: 1000 })
  check(show.status === 200 && show.body?.mode === 'mirror', 'show saved (mirror)')

  console.log('\n---- master log tail ----\n' + tailLog(A))
  console.log('\n---- slave log tail ----\n' + tailLog(B))
}

main()
  .catch((e) => {
    console.error('HARNESS ERROR:', e)
    failed = true
  })
  .finally(async () => {
    await sleep(500)
    cleanup()
    await sleep(1500)
    console.log(failed ? '\n=== SOME CHECKS FAILED ===' : '\n=== ALL CHECKS PASSED ===')
    process.exit(failed ? 1 : 0)
  })
