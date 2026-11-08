// 웹 업데이트 적용 헬퍼 — 서버(src/api/system/update.js)가 {app}\.update\ 로 복사한 뒤
// VPApp.exe(node)로 분리(detached) 실행한다. 서버와 번들되지 않는 독립 CJS (Node 내장 모듈만).
//
// 순서:
//  1. 기존 서버 프로세스 종료 대기 → 설치 폴더 player\ 에서 남은 프로세스(gst-ptp-helper 등) 정리
//  2. 교체 대상 최상위 항목마다: {app}\X → backup\X, staging\X → {app}\X   (같은 볼륨이라 rename)
//  3. 새 서버 기동 → /api/system/update/status 의 buildId가 새 번들과 일치하면 성공
//  4. 실패(교체 오류/기동 실패/시간 초과) 시 새 서버 트리 종료 → backup 복원 → 기존 버전 재기동
//  결과는 result.json에 기록 — 재기동된 서버가 읽어 UI에 표시한다.
//
// 사용: VPApp.exe updater-helper.cjs <job.json>

const fs = require('fs')
const path = require('path')
const http = require('http')
const { spawn, execFileSync } = require('child_process')

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const HEALTH_TIMEOUT_MS = 90000
const LOCK_RETRY_MS = 20000

const log = (msg) => {
  try {
    fs.appendFileSync(job.logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* ignore */
  }
}

const writeResult = (state, extra = {}) => {
  const r = {
    id: job.applyId,
    state, // applying | success | rolled_back | failed
    fromVersion: job.fromVersion,
    toVersion: job.toVersion,
    at: new Date().toISOString(),
    ...extra,
  }
  fs.writeFileSync(job.resultFile, JSON.stringify(r, null, 2))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// 설치 폴더 player\ 아래 실행 파일로 돌고 있는 프로세스 강제 종료 (서버 종료 후 잔존분 — 파일 잠금 해제)
const killPlayerLeftovers = () => {
  const dir = path.join(job.appRoot, 'player').replace(/'/g, "''")
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${dir}\\', 'OrdinalIgnoreCase') } | Stop-Process -Force`,
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 15000 },
    )
  } catch (e) {
    log(`killPlayerLeftovers: ${e.message}`)
  }
}

// 파일 잠금(백신 검사, 늦게 닫히는 핸들)에 대비해 재시도하는 rename
const renameRetry = async (from, to) => {
  const until = Date.now() + LOCK_RETRY_MS
  for (;;) {
    try {
      fs.renameSync(from, to)
      return
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code) || Date.now() > until) throw e
      await sleep(500)
    }
  }
}

const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })

// 서버 기동 — vpapp-launch.vbs와 동일 조건(VP_APP_ROOT, cwd, 숨김). pid 추적을 위해 직접 spawn.
const launchServer = () => {
  const child = spawn(job.execPath, [path.join(job.appRoot, 'server.cjs')], {
    cwd: job.appRoot,
    env: { ...process.env, VP_APP_ROOT: job.appRoot },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return child
}

const getStatus = () =>
  new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: job.port, path: '/api/system/update/status', timeout: 3000 },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })

// 새 서버가 buildId로 응답할 때까지 대기. 프로세스가 먼저 죽으면 즉시 실패.
const waitHealthy = async (child, buildId) => {
  let exited = null
  child.on('exit', (code) => (exited = code ?? -1))
  const until = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < until) {
    if (exited != null) return `new server exited (code ${exited})`
    const s = await getStatus()
    if (s && s.buildId === buildId) return null
    await sleep(1000)
  }
  return 'new server did not respond in time'
}

const killTree = (pid) => {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch {
    /* 이미 종료 */
  }
}

const main = async () => {
  log(`=== apply ${job.applyId}: ${job.fromVersion} -> ${job.toVersion} ===`)
  writeResult('applying')

  // 1. 기존 서버 종료 대기 (최대 30초)
  const until = Date.now() + 30000
  while (alive(job.pid) && Date.now() < until) await sleep(300)
  if (alive(job.pid)) {
    log(`old server ${job.pid} still alive — force kill`)
    killTree(job.pid)
    await sleep(1000)
  }
  killPlayerLeftovers()

  // 2. 교체
  rmrf(job.backupDir)
  fs.mkdirSync(job.backupDir, { recursive: true })
  const moved = [] // { name, hadOld }
  let err = null
  try {
    for (const name of job.entries) {
      const cur = path.join(job.appRoot, name)
      const hadOld = fs.existsSync(cur)
      if (hadOld) await renameRetry(cur, path.join(job.backupDir, name))
      moved.push({ name, hadOld, installed: false })
      await renameRetry(path.join(job.stagingDir, name), cur)
      moved[moved.length - 1].installed = true
      log(`replaced ${name}`)
    }
  } catch (e) {
    err = `replace failed: ${e.message}`
  }

  // 3. 새 버전 기동 + 확인
  if (!err) {
    const child = launchServer()
    log(`new server pid ${child.pid}`)
    err = await waitHealthy(child, job.expectedBuildId)
    if (!err) {
      rmrf(job.stagingDir)
      writeResult('success')
      log('success')
      return
    }
    log(`health check failed: ${err}`)
    killTree(child.pid)
    await sleep(1500)
    killPlayerLeftovers()
  } else {
    log(err)
  }

  // 4. 롤백
  try {
    for (const m of moved.reverse()) {
      const cur = path.join(job.appRoot, m.name)
      if (m.installed) rmrf(cur)
      if (m.hadOld) await renameRetry(path.join(job.backupDir, m.name), cur)
    }
    rmrf(job.stagingDir)
    writeResult('rolled_back', { error: err })
    log('rolled back')
  } catch (e) {
    writeResult('failed', { error: `${err}; rollback failed: ${e.message}` })
    log(`rollback failed: ${e.message}`)
  }
  launchServer()
}

main().catch((e) => {
  log(`fatal: ${e.stack || e.message}`)
  try {
    writeResult('failed', { error: e.message })
  } catch {
    /* ignore */
  }
  try {
    launchServer()
  } catch {
    /* ignore */
  }
})
