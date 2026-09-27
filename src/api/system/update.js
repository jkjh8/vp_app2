// 웹 소프트웨어 업데이트 — 재설치 없이 암호화 패키지(.vpu)로 앱을 교체한다 (Node 런타임 VPApp.exe 제외).
//
// 흐름: 업로드(stageUpdate) → 복호화·검증해 {app}\.update\staging 에 풀기 → 사용자 확인 →
//   적용(applyUpdate): 헬퍼(updater-helper.cjs)를 분리 실행하고 서버 종료 → 헬퍼가 파일 교체·재기동·
//   실패 시 롤백 → 결과(result.json)를 새로 뜬 서버가 getUpdateStatus로 노출.
//
// 전제: 설치 폴더에 사용자 쓰기 권한 (installer [Dirs] users-modify). 없으면 NO_WRITE_PERMISSION.
// 암호 키: 빌드 시 esbuild define(__VP_UPDATE_KEY__)으로 주입. 개발 실행은 VP_UPDATE_KEY 또는 keys/update.key.
/* global __VP_UPDATE_KEY__ */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { app } from '../../runtime.js'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { APP_VERSION, BUILD_ID } from '../../version.js'
import { unpackUpdate, isProtectedTopLevel } from './updatePackage.js'

const appRoot = () => app.getAppPath()
const updateDir = () => path.join(appRoot(), '.update')
const stagingDir = () => path.join(updateDir(), 'staging')
const backupDir = () => path.join(updateDir(), 'backup')
const resultFile = () => path.join(updateDir(), 'result.json')

// 업로드 임시 파일 — 항상 쓰기 가능한 사용자 데이터 폴더
export const uploadTmpPath = () => path.join(app.getPath('userData'), 'update-upload.vpu')

let state = 'idle' // idle | staging | ready | applying
let staged = null // { version, buildId, files, bytes, createdAt }

const updateKey = () => {
  if (typeof __VP_UPDATE_KEY__ !== 'undefined') return __VP_UPDATE_KEY__
  if (process.env.VP_UPDATE_KEY) return process.env.VP_UPDATE_KEY
  try {
    return fs.readFileSync(path.join(appRoot(), 'keys', 'update.key'), 'utf8').trim()
  } catch {
    return null
  }
}

const codedError = (code, message) => Object.assign(new Error(message), { code })

// 배포 번들(server.cjs)로 실행 중일 때만 교체 가능 — 개발 실행(src/main.js)은 교체 대상이 없다.
const isPackaged = () => fs.existsSync(path.join(appRoot(), 'server.cjs'))

const isWritable = () => {
  try {
    fs.mkdirSync(updateDir(), { recursive: true })
    const probe = path.join(updateDir(), `.probe-${process.pid}`)
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

const readResult = () => {
  try {
    return JSON.parse(fs.readFileSync(resultFile(), 'utf8'))
  } catch {
    return null
  }
}

const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })

// 기동 시 1회: 이전 실행에서 남은 스테이징(적용 안 된 업로드) 정리
export const cleanupStaleUpdate = () => {
  try {
    if (fs.existsSync(stagingDir())) rmrf(stagingDir())
    const r = readResult()
    if (r) logger.info(`Last software update: ${r.fromVersion} -> ${r.toVersion} [${r.state}]${r.error ? ` ${r.error}` : ''}`)
  } catch (e) {
    logger.warn(`cleanupStaleUpdate: ${e.message}`)
  }
}

export const getUpdateStatus = () => ({
  version: APP_VERSION,
  buildId: BUILD_ID,
  packaged: isPackaged(),
  writable: isPackaged() ? isWritable() : false,
  state,
  staged,
  lastResult: readResult(),
})

// 업로드된 패키지를 복호화·검증해 스테이징에 푼다. 성공 시 staged 요약 반환.
export const stageUpdate = async (filePath) => {
  try {
    if (state === 'staging' || state === 'applying') throw codedError('BUSY', 'update in progress')
    if (!isPackaged()) throw codedError('NOT_PACKAGED', 'development run — nothing to update')
    if (!isWritable()) {
      throw codedError('NO_WRITE_PERMISSION', `install folder is not writable: ${appRoot()}`)
    }
    const key = updateKey()
    if (!key) throw codedError('NO_KEY', 'update key not configured')

    state = 'staging'
    staged = null
    rmrf(stagingDir())
    let manifest
    try {
      manifest = await unpackUpdate(filePath, stagingDir(), key)
    } catch (e) {
      rmrf(stagingDir())
      throw e
    }
    const entries = [...new Set(manifest.files.map((f) => f.path.split('/')[0]))]
    if (!entries.includes('server.cjs')) {
      rmrf(stagingDir())
      throw codedError('BAD_PACKAGE', 'package has no server.cjs')
    }
    staged = {
      version: manifest.version,
      buildId: manifest.buildId,
      createdAt: manifest.createdAt,
      files: manifest.files.length,
      bytes: manifest.files.reduce((s, f) => s + f.size, 0),
      entries,
    }
    state = 'ready'
    logger.info(
      `Software update staged: ${APP_VERSION} -> ${staged.version} (${staged.files} files, build ${staged.buildId})`,
    )
    return staged
  } catch (e) {
    if (state === 'staging') state = 'idle'
    logger.error(`Software update staging failed [${e.code || 'ERROR'}]: ${e.message}`)
    throw e
  } finally {
    fs.rm(filePath, { force: true }, () => {})
  }
}

export const cancelUpdate = () => {
  if (state === 'applying') throw codedError('BUSY', 'update is being applied')
  rmrf(stagingDir())
  state = 'idle'
  staged = null
  logger.info('Software update cancelled')
}

// 헬퍼 분리 실행 후 서버 종료 예약. 헬퍼가 교체·재기동·롤백을 담당한다.
export const applyUpdate = () => {
  if (state !== 'ready' || !staged) throw codedError('NOT_STAGED', 'no staged update')
  const entries = staged.entries.filter((n) => !isProtectedTopLevel(n))

  const helperSrc = [
    path.join(appRoot(), 'updater-helper.cjs'),
    path.join(appRoot(), 'src', 'api', 'system', 'updater-helper.cjs'),
  ].find((p) => fs.existsSync(p))
  if (!helperSrc) throw codedError('NO_HELPER', 'updater-helper.cjs not found')

  const applyId = crypto.randomUUID()
  const helperPath = path.join(updateDir(), 'updater-helper.cjs')
  const jobPath = path.join(updateDir(), 'job.json')
  fs.copyFileSync(helperSrc, helperPath) // 교체 대상 밖(.update)에서 실행 — 현재 버전의 헬퍼
  fs.writeFileSync(
    jobPath,
    JSON.stringify(
      {
        applyId,
        pid: process.pid,
        appRoot: appRoot(),
        execPath: process.execPath,
        port: pStatus.webPort || 3000,
        stagingDir: stagingDir(),
        backupDir: backupDir(),
        entries,
        expectedBuildId: staged.buildId,
        fromVersion: APP_VERSION,
        toVersion: staged.version,
        resultFile: resultFile(),
        logFile: path.join(updateDir(), 'updater.log'),
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(
    resultFile(),
    JSON.stringify({
      id: applyId,
      state: 'applying',
      fromVersion: APP_VERSION,
      toVersion: staged.version,
      at: new Date().toISOString(),
    }),
  )

  const child = spawn(process.execPath, [helperPath, jobPath], {
    cwd: updateDir(),
    detached: true, // 서버 종료 후에도 생존 (libuv kill-on-close job 제외)
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  state = 'applying'
  logger.info(`Software update applying ${APP_VERSION} -> ${staged.version} (helper pid ${child.pid}) — shutting down`)
  // 응답이 나갈 시간을 준 뒤 종료 (플레이어 정리는 onShutdown 훅)
  setTimeout(() => app.quit(), 800)
  return { applyId, fromVersion: APP_VERSION, toVersion: staged.version }
}
