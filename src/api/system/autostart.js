// Windows 시작(로그온) 시 자동 실행 — 관리자 권한 없이 동작하도록 "사용자별 레지스트리 Run 키"를 쓴다.
//
// 배경: 예전엔 작업 스케줄러 "VP App"(/RL HIGHEST) 작업을 토글했으나, 이 작업의 생성/삭제엔
//   관리자 권한이 필요해 일반 사용자가 셋업 페이지에서 켤 수 없었다. 이 앱은 모든 데이터를
//   %APPDATA%(사용자별)에 저장하고 런타임에 승격 권한이 필요 없으므로, HKCU\...\Run 값으로
//   로그온 시 자동 실행을 등록하면 관리자 권한 없이 켜고 끌 수 있다.
//
// 규약:
//  - 사용자 의도(enabled)는 dbStatus('autoStart')에 영속 → 부팅 시 updateStatusFromDb가 복원.
//  - OS 등록은 HKCU\Software\Microsoft\Windows\CurrentVersion\Run 값(VP App) 생성/삭제로
//    멱등 처리 (관리자 권한 불필요, 로케일 출력 파싱 의존 없음).
//  - 과거 설치본이 만든 작업 스케줄러 "VP App" 작업이 남아 있으면 중복 실행을 막기 위해
//    가능하면(승격 상태) 제거한다. 삭제엔 관리자 권한이 필요할 수 있어 실패는 무시(경고 로그).
//    설령 중복 등록돼도 단일 인스턴스 보호(:3000 바인드)가 두 번째 실행을 즉시 종료시킨다.

import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { app } from '../../runtime.js'
import pStatus from '../../pStatus.js'
import { dbStatus } from '../../db/index.js'
import { logger } from '../../logger/index.js'
import { ioClient } from '../../web/index.js'

const TASK_NAME = 'VP App' // 레거시 작업 스케줄러 정리용
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_VALUE = 'VP App'
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

// --- 사용자별 레지스트리 Run 키 (관리자 권한 불필요) ---
// execFile은 셸을 거치지 않으므로 launchCommand 안의 따옴표가 그대로 REG_SZ 데이터로 저장된다.
const addRunKey = () =>
  run('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', launchCommand(), '/f'])

const deleteRunKey = () => run('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'])

const runKeyExists = async () => {
  try {
    await run('reg', ['query', RUN_KEY, '/v', RUN_VALUE])
    return true
  } catch {
    return false
  }
}

// --- 레거시 작업 스케줄러 정리용 (조회는 관리자 권한 불필요, 삭제는 필요할 수 있음) ---
const deleteTask = () => run('schtasks', ['/Delete', '/F', '/TN', TASK_NAME])

const taskExists = async () => {
  try {
    await run('schtasks', ['/Query', '/TN', TASK_NAME])
    return true
  } catch {
    return false
  }
}

// 남은 레거시 작업 스케줄러 항목을 최선노력으로 제거해 Run 키와의 중복 실행을 막는다.
// 삭제엔 관리자 권한이 필요할 수 있어 실패는 삼키고 경고만 남긴다.
const cleanupLegacyTask = async () => {
  try {
    if (await taskExists()) {
      await deleteTask()
      logger.info(`Removed legacy autostart scheduled task (${TASK_NAME})`)
    }
  } catch (e) {
    logger.warn(`Legacy autostart task cleanup skipped (needs admin?): ${e.stderr || e.message}`)
  }
}

// pStatus/db 갱신 + SPA 통지 (OS 반영과 분리)
const persist = async (enabled) => {
  pStatus.autoStart = enabled
  await dbStatus.update({ type: 'autoStart' }, { $set: { value: enabled } }, { upsert: true })
  ioClient.emit('pStatus', { autoStart: enabled })
}

// 현재 자동실행 설정 조회 — enabled는 사용자 의도(영속값), registered는 실제 OS 등록 유무(진단용).
const getAutostart = async () => ({
  enabled: !!pStatus.autoStart,
  registered: isWindows ? (await runKeyExists()) || (await taskExists()) : false,
  supported: isWindows,
  method: 'registry',
  taskName: RUN_VALUE,
})

// 자동실행 설정. Windows에서만 OS 등록을 반영하고, 그 외 플랫폼은 의도만 저장(무해).
const setAutostart = async (enabled) => {
  const value = !!enabled
  if (!isWindows) {
    await persist(value)
    return { enabled: value, supported: false, taskName: RUN_VALUE }
  }
  if (value) {
    await addRunKey() // 실패(매우 드묾) 시 throw → 호출부가 정직히 에러 표시
  } else {
    try {
      await deleteRunKey()
    } catch (e) {
      // 이미 없는 값 삭제는 성공으로 간주
      logger.warn(`Autostart run-key delete ignored: ${e.stderr || e.message}`)
    }
  }
  await cleanupLegacyTask() // 켜든 끄든 레거시 작업은 정리 (Run 키가 단일 소스)
  await persist(value)
  logger.info(`Autostart ${value ? 'enabled' : 'disabled'} (HKCU Run: ${RUN_VALUE})`)
  return { enabled: value, supported: true, taskName: RUN_VALUE }
}

export { getAutostart, setAutostart }
