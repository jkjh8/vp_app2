// Electron 'app' 대체 심 (Phase 2: Electron 제거 → 일반 Node.js 서비스).
//
// 기존 8개 파일이 쓰던 app API만 최소 재현한다. import 출처만 'electron' → 이 파일로
// 바꾸면 되도록 동일한 { app } 형태로 export.
//
// 경로 규약 (Electron Windows 관례와 일치시켜 기존 설치본 데이터 승계):
//   appData  = %APPDATA%              (NeDB db가 %APPDATA%\db 에 있음 — 반드시 동일)
//   userData = %APPDATA%\vp_app2      (tmp 등 임시 — 경로 변경 무해)
//   logs     = %APPDATA%\vp_app2\logs
//   home     = %USERPROFILE%          (미디어가 ~/media)
//   temp     = %TEMP%
//   exe      = 현재 실행 파일 (node.exe 또는 개발 시 node)
//
// 앱 루트(getAppPath): 프로덕션은 VP_APP_ROOT 환경변수(설치 폴더), 개발은 cwd(프로젝트 루트).

import path from 'path'
import process from 'process'

const APP_DIR_NAME = 'vp_app2'

const env = (name, fallback) => process.env[name] || fallback

const appData = env('APPDATA', path.join(env('USERPROFILE', 'C:\\'), 'AppData', 'Roaming'))
const userData = path.join(appData, APP_DIR_NAME)

const PATHS = {
  appData,
  userData,
  logs: path.join(userData, 'logs'),
  home: env('USERPROFILE', env('HOME', 'C:\\')),
  temp: env('TEMP', env('TMP', path.join(userData, 'tmp'))),
  exe: process.execPath,
  desktop: path.join(env('USERPROFILE', 'C:\\'), 'Desktop'),
  documents: path.join(env('USERPROFILE', 'C:\\'), 'Documents'),
}

let shuttingDown = false
const shutdownHooks = []

// graceful shutdown 훅 등록 (서버/플레이어 정리용). main에서 등록.
export const onShutdown = (fn) => shutdownHooks.push(fn)

const doQuit = (code = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  Promise.allSettled(shutdownHooks.map((fn) => Promise.resolve().then(fn))).finally(() => {
    process.exit(code)
  })
  // 훅이 매달리면 강제 종료
  setTimeout(() => process.exit(code), 3000).unref()
}

export const app = {
  // 단일 인스턴스: :3000 바인드가 실질적 락 (EADDRINUSE → initWebServer가 종료 처리).
  // 여기서는 항상 true를 반환하고 포트 충돌은 웹 서버 계층이 감지한다.
  requestSingleInstanceLock: () => true,
  whenReady: () => Promise.resolve(),
  on: () => app, // Electron 이벤트 훅 no-op (현재 미사용)
  quit: () => doQuit(0),
  exit: (code = 0) => doQuit(code),
  getPath: (name) => {
    const p = PATHS[name]
    if (!p) throw new Error(`runtime.getPath: unknown path '${name}'`)
    return p
  },
  getAppPath: () => env('VP_APP_ROOT', process.cwd()),
  getName: () => APP_DIR_NAME,
  getVersion: () => env('npm_package_version', '0.0.0'),
  isReady: () => true,
}

export default { app, onShutdown }
