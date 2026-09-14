// Windows 시작 시 자동 실행 — 설치기(installer/vpapp.iss)가 만드는 작업 스케줄러 "VP App"
// 작업을 런타임에서 토글한다. 이 앱은 Electron이 아니라 일반 Node 서비스이므로 openAtLogin이
// 없고, 대신 schtasks(작업 스케줄러)로 로그온 시 자동 실행을 등록/해제한다.
//
// 규약:
//  - 사용자 의도(enabled)는 dbStatus('autoStart')에 영속 → 부팅 시 updateStatusFromDb가 복원.
//  - OS 작업은 그 의도를 반영(활성=Create /F, 비활성=Delete /F) — 상태 파싱 대신 생성/삭제로
//    멱등하게 처리해 로케일(한글/영문) 출력 파싱 의존을 없앤다.
//  - /RL HIGHEST 는 등록에 관리자 권한이 필요. 설치본은 HIGHEST 작업으로 기동되어 이미 승격
//    상태라 자기 작업을 관리할 수 있고, 개발(일반 node)에서는 실패할 수 있어 그 경우 정직히 에러.

import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { app } from '../../runtime.js'
import pStatus from '../../pStatus.js'
import { dbStatus } from '../../db/index.js'
import { logger } from '../../logger/index.js'
import { ioClient } from '../../web/index.js'

const TASK_NAME = 'VP App'
const isWindows = process.platform === 'win32'

const run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = String(stdout || '')
        err.stderr = String(stderr || '')
        reject(err)
      } else {
        resolve(String(stdout || ''))
      }
    })
  })

// 자동실행이 실행할 명령. 설치본은 콘솔 숨김 런처(vpapp-launch.vbs), 없으면 현재 실행 파일 + 진입점.
const launchCommand = () => {
  const root = app.getAppPath()
  const vbs = path.join(root, 'vpapp-launch.vbs')
  if (fs.existsSync(vbs)) return `wscript.exe "${vbs}"`
  // 폴백: 프로덕션 번들(server.cjs) 또는 개발 진입점(src/main.js)
  const cjs = path.join(root, 'server.cjs')
  const entry = fs.existsSync(cjs) ? cjs : path.join(root, 'src', 'main.js')
  return `"${process.execPath}" "${entry}"`
}

const createTask = () =>
  run('schtasks', [
    '/Create', '/F',
    '/TN', TASK_NAME,
    '/SC', 'ONLOGON',
    '/RL', 'HIGHEST',
    '/TR', launchCommand(),
  ])

const deleteTask = () => run('schtasks', ['/Delete', '/F', '/TN', TASK_NAME])

const taskExists = async () => {
  try {
    await run('schtasks', ['/Query', '/TN', TASK_NAME])
    return true
  } catch {
    return false
  }
}

// pStatus/db 갱신 + SPA 통지 (OS 반영과 분리)
const persist = async (enabled) => {
  pStatus.autoStart = enabled
  await dbStatus.update({ type: 'autoStart' }, { $set: { value: enabled } }, { upsert: true })
  ioClient.emit('pStatus', { autoStart: enabled })
}

// 현재 자동실행 설정 조회 — enabled는 사용자 의도(영속값), taskExists는 실제 OS 작업 유무(진단용).
const getAutostart = async () => ({
  enabled: !!pStatus.autoStart,
  taskExists: isWindows ? await taskExists() : false,
  supported: isWindows,
  taskName: TASK_NAME,
})

// 자동실행 설정. Windows에서만 OS 작업을 반영하고, 그 외 플랫폼은 의도만 저장(무해).
const setAutostart = async (enabled) => {
  const value = !!enabled
  if (!isWindows) {
    await persist(value)
    return { enabled: value, supported: false, taskName: TASK_NAME }
  }
  if (value) {
    await createTask() // 실패(권한 없음 등) 시 throw → 호출부가 정직히 에러 표시
  } else {
    try {
      await deleteTask()
    } catch (e) {
      // 이미 없는 작업 삭제는 성공으로 간주 (설치 시 미등록 등)
      logger.warn(`Autostart task delete ignored: ${e.stderr || e.message}`)
    }
  }
  await persist(value)
  logger.info(`Autostart ${value ? 'enabled' : 'disabled'} (task: ${TASK_NAME})`)
  return { enabled: value, supported: true, taskName: TASK_NAME }
}

export { getAutostart, setAutostart }
