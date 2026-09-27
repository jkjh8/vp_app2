// 앱 버전/빌드 ID. 배포 번들은 scripts/build-node.mjs가 esbuild define으로 주입하고,
// 개발 실행(node src/main.js)은 package.json 버전 + 'dev'로 폴백한다.
// BUILD_ID는 빌드마다 고유 — 웹 업데이트 헬퍼가 "새 번들이 실제로 떴는지" 판정하는 기준.
/* global __VP_APP_VERSION__, __VP_BUILD_ID__ */
import fs from 'fs'
import path from 'path'

const devVersion = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

export const APP_VERSION =
  typeof __VP_APP_VERSION__ !== 'undefined' ? __VP_APP_VERSION__ : devVersion()
export const BUILD_ID = typeof __VP_BUILD_ID__ !== 'undefined' ? __VP_BUILD_ID__ : 'dev'
