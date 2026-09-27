// 웹 업데이트 패키지 암호 키 (AES-256, 64 hex) 로드/생성.
// 우선순위: 환경변수 VP_UPDATE_KEY → keys/update.key (gitignore). 없으면 create=true일 때 새로 생성.
//
// 주의: 설치된 앱은 빌드 시점 키로만 패키지를 풀 수 있다. 키 파일을 잃거나 바꾸면 기존 설치본은
// 웹 업데이트를 받을 수 없게 된다(재설치 필요) → keys/update.key는 반드시 별도 백업할 것.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const loadUpdateKey = (root, { create = false } = {}) => {
  if (process.env.VP_UPDATE_KEY) return process.env.VP_UPDATE_KEY.trim()
  const keyFile = path.join(root, 'keys', 'update.key')
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim()
  if (!create) throw new Error(`update key not found: ${keyFile} (or set VP_UPDATE_KEY)`)
  mkdirSync(path.dirname(keyFile), { recursive: true })
  const hex = randomBytes(32).toString('hex')
  writeFileSync(keyFile, hex + '\n')
  console.warn(
    `\n*** 새 업데이트 암호 키 생성: ${keyFile}\n*** 이 키로 빌드한 설치본은 이 키로 만든 패키지만 받습니다 — 반드시 백업하세요.\n`,
  )
  return hex
}
