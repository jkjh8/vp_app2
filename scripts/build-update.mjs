// 웹 업데이트 패키지 생성: dist-node(build-node.mjs 산출물) → 암호화 .vpu
//
// VPApp.exe(Node 런타임)는 제외 — 실행 중 잠겨 교체 불가, 런타임 변경은 설치 파일로 배포.
// 키는 build-node와 같은 keys/update.key(또는 VP_UPDATE_KEY)를 써야 설치본이 풀 수 있다.
//
// 사용법: npm run build && npm run build:update
// 출력:   installer/Output/VP-App-Update-<version>.vpu

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packUpdate } from '../src/api/system/updatePackage.js'
import { loadUpdateKey } from './update-key.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist-node')
const infoFile = path.join(dist, 'build-info.json')
if (!existsSync(infoFile) || !existsSync(path.join(dist, 'server.cjs'))) {
  console.error('dist-node가 없거나 불완전합니다 — 먼저 npm run build')
  process.exit(1)
}
const info = JSON.parse(readFileSync(infoFile, 'utf8'))
const key = loadUpdateKey(root)
const out = path.join(root, 'installer', 'Output', `VP-App-Update-${info.version}.vpu`)

console.log(`packing ${dist} → ${out} (build ${info.buildId})`)
const t0 = Date.now()
const manifest = await packUpdate(dist, out, key, { version: info.version, buildId: info.buildId })
const mb = (n) => (n / 1048576).toFixed(1)
const raw = manifest.files.reduce((s, f) => s + f.size, 0)
console.log(
  `done: ${manifest.files.length} files, ${mb(raw)} MB → ${mb(statSync(out).size)} MB (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
)
