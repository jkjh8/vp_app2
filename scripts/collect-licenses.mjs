// npm 의존성 라이센스 텍스트 수집기.
// node_modules 를 순회하며 각 패키지의 name/version/license 와 LICENSE 원문을 모아
// 하나의 텍스트로 반환한다. build-node.mjs 가 배포 번들 생성 시 호출한다.
//
// 단독 실행도 가능: node scripts/collect-licenses.mjs [projectRoot] > out.txt

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LICENSE_FILE_RE = /^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)(\..*)?$/i

function readLicenseText(pkgDir) {
  try {
    for (const f of readdirSync(pkgDir)) {
      if (LICENSE_FILE_RE.test(f)) {
        const fp = path.join(pkgDir, f)
        if (statSync(fp).isFile()) return readFileSync(fp, 'utf8')
      }
    }
  } catch {
    /* 접근 불가 폴더는 무시 */
  }
  return null
}

// node_modules 하위 패키지 루트 경로를 순회 (@scope, 중첩 node_modules 포함)
function* walkPackages(nmDir) {
  if (!existsSync(nmDir)) return
  let entries
  try {
    entries = readdirSync(nmDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    if (name === '.bin' || name === '.cache' || name.startsWith('.')) continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (name.startsWith('@')) {
      const scopeDir = path.join(nmDir, name)
      let subs
      try {
        subs = readdirSync(scopeDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const sub of subs) {
        if (!sub.isDirectory() && !sub.isSymbolicLink()) continue
        const pkgDir = path.join(scopeDir, sub.name)
        yield pkgDir
        yield* walkPackages(path.join(pkgDir, 'node_modules'))
      }
    } else {
      const pkgDir = path.join(nmDir, name)
      yield pkgDir
      yield* walkPackages(path.join(pkgDir, 'node_modules'))
    }
  }
}

function licenseField(pj) {
  if (typeof pj.license === 'string') return pj.license
  if (pj.license && typeof pj.license === 'object' && pj.license.type) return pj.license.type
  if (Array.isArray(pj.licenses)) return pj.licenses.map((l) => l.type || l).join(' OR ')
  return 'UNKNOWN'
}

// projectRoot/node_modules 를 수집해 { text, count, missing } 반환
export function collectNpmLicenses(projectRoot, label) {
  const nm = path.join(projectRoot, 'node_modules')
  const seen = new Set()
  const chunks = []
  let count = 0
  let missing = 0
  const dirs = [...walkPackages(nm)].sort()
  for (const pkgDir of dirs) {
    const pjPath = path.join(pkgDir, 'package.json')
    if (!existsSync(pjPath)) continue
    let pj
    try {
      pj = JSON.parse(readFileSync(pjPath, 'utf8'))
    } catch {
      continue
    }
    if (!pj.name || !pj.version) continue
    const key = `${pj.name}@${pj.version}`
    if (seen.has(key)) continue
    seen.add(key)
    count++
    const lic = licenseField(pj)
    const text = readLicenseText(pkgDir)
    if (!text) missing++
    const bar = '='.repeat(78)
    chunks.push(
      `\n${bar}\n${key}  —  ${lic}\n${bar}\n` +
        (text ? text.trim() : `(별도 LICENSE 파일 없음; package.json license 필드: ${lic})`) +
        '\n',
    )
  }
  const header =
    `THIRD-PARTY npm LICENSES — ${label}\n` +
    `총 ${count}개 패키지 (LICENSE 파일 미포함 ${missing}개는 package.json 필드로 표기).\n` +
    `이 파일은 빌드 시 node_modules 에서 자동 생성됩니다 (scripts/collect-licenses.mjs).\n` +
    `주의: 빌드 도구(devDependencies)도 포함될 수 있으며, 이는 안전 측면의 과포함입니다.\n`
  return { text: header + chunks.join(''), count, missing }
}

// 단독 실행 지원
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { text, count, missing } = collectNpmLicenses(root, path.basename(root))
  process.stderr.write(`collected ${count} packages (${missing} without LICENSE file)\n`)
  process.stdout.write(text)
}
