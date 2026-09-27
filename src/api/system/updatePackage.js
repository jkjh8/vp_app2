// 소프트웨어 업데이트 패키지(.vpu) 포맷 — 빌드 스크립트(scripts/build-update.mjs)와 서버가 공유.
// Node 내장 모듈만 사용한다(빌드 스크립트가 로거/DB 없이 import 하므로).
//
// 파일 레이아웃:
//   [0..4)   MAGIC 'VPU1'           (AES-GCM AAD로도 사용 → 헤더 변조 감지)
//   [4..16)  IV (12 bytes)
//   [16..32) GCM 인증 태그 (16 bytes) — 암호화 완료 후 패치
//   [32..)   AES-256-GCM( gzip( 평문 아카이브 ) )
//
// 평문 아카이브:
//   u32le 매니페스트 길이 + 매니페스트 JSON
//     { format, product, version, buildId, createdAt, files: [{ path, size, sha256 }] }
//   이후 매니페스트 files 순서대로 각 파일 원본 바이트를 이어붙임 (크기는 매니페스트 기준).
//
// 복호화는 스트리밍이라 GCM 태그 검증은 끝에서야 확정된다 → 반드시 스테이징 폴더에 풀고,
// unpackUpdate가 정상 resolve된 경우에만 설치에 사용한다(실패 시 호출자가 스테이징 삭제).

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { Readable, Writable } from 'stream'
import { pipeline } from 'stream/promises'

export const MAGIC = Buffer.from('VPU1')
export const PRODUCT = 'vp_app2'
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = MAGIC.length + IV_LEN + TAG_LEN
const MAX_MANIFEST = 16 * 1024 * 1024

// 업데이트로 교체하면 안 되는 최상위 항목 — Node 런타임(실행 중 잠김), 업데이트 작업 폴더, Inno 언인스톨러.
export const isProtectedTopLevel = (name) => {
  const n = name.toLowerCase()
  return n === 'vpapp.exe' || n === '.update' || n.startsWith('unins')
}

// 매니페스트 경로 검증 — 상대경로, '..'/절대경로/드라이브 금지, 보호 항목 금지.
export const assertSafeRelPath = (p) => {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0')) {
    throw new Error(`invalid path in package: ${p}`)
  }
  const parts = p.split('/')
  // Windows 정규화로 다른 경로가 되는 이름(끝 '.'/공백, 예약 문자 ':' 등)도 거부
  if (parts.some((s) => !s || /[.\s]$/.test(s) || /[<>:"|?*]/.test(s))) {
    throw new Error(`invalid path in package: ${p}`)
  }
  if (isProtectedTopLevel(parts[0])) throw new Error(`protected path in package: ${p}`)
}

export const parseKey = (hex) => {
  const key = Buffer.from(String(hex || '').trim(), 'hex')
  if (key.length !== 32) throw new Error('update key must be 32 bytes (64 hex chars)')
  return key
}

const walkFiles = (root, rel = '') => {
  const out = []
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walkFiles(root, r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

const sha256File = async (fp) => {
  const h = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(fp)) h.update(chunk)
  return h.digest('hex')
}

// srcDir의 파일(보호 항목 제외)을 암호화 패키지로 만든다. meta = { version, buildId }.
export const packUpdate = async (srcDir, outFile, keyHex, meta) => {
  const key = parseKey(keyHex)
  const rels = walkFiles(srcDir).filter((r) => !isProtectedTopLevel(r.split('/')[0]))
  const files = []
  for (const r of rels) {
    assertSafeRelPath(r)
    const fp = path.join(srcDir, r)
    files.push({ path: r, size: fs.statSync(fp).size, sha256: await sha256File(fp) })
  }
  const manifest = {
    format: 1,
    product: PRODUCT,
    version: meta.version,
    buildId: meta.buildId,
    createdAt: new Date().toISOString(),
    files,
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32LE(manifestBuf.length)

  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC)

  async function* plaintext() {
    yield lenBuf
    yield manifestBuf
    for (const f of files) {
      for await (const chunk of fs.createReadStream(path.join(srcDir, f.path))) yield chunk
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, Buffer.concat([MAGIC, iv, Buffer.alloc(TAG_LEN)]))
  await pipeline(
    Readable.from(plaintext()),
    zlib.createGzip({ level: 6 }),
    cipher,
    fs.createWriteStream(outFile, { flags: 'a' }),
  )
  const fd = fs.openSync(outFile, 'r+')
  try {
    fs.writeSync(fd, cipher.getAuthTag(), 0, TAG_LEN, MAGIC.length + IV_LEN)
  } finally {
    fs.closeSync(fd)
  }
  return manifest
}

// 평문 아카이브 스트림을 destDir로 풀어내는 싱크. 파일별 크기/sha256 검증.
class Extractor extends Writable {
  constructor(destDir) {
    super()
    this.destDir = destDir
    this.state = 'len' // len → manifest → file → done
    this.need = 4
    this.acc = []
    this.accLen = 0
    this.manifest = null
    this.fileIdx = -1
    this.fd = null
    this.remaining = 0
    this.hash = null
  }

  _take(chunk, off) {
    const n = Math.min(this.need - this.accLen, chunk.length - off)
    this.acc.push(chunk.subarray(off, off + n))
    this.accLen += n
    return n
  }

  _nextFile() {
    const files = this.manifest.files
    for (;;) {
      this.fileIdx++
      if (this.fileIdx >= files.length) {
        this.state = 'done'
        return
      }
      const f = files[this.fileIdx]
      const fp = path.join(this.destDir, ...f.path.split('/'))
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      this.fd = fs.openSync(fp, 'w')
      this.remaining = f.size
      this.hash = crypto.createHash('sha256')
      this.state = 'file'
      if (this.remaining > 0) return
      this._closeFile() // 0바이트 파일 — 바로 닫고 다음
    }
  }

  _closeFile() {
    fs.closeSync(this.fd)
    this.fd = null
    const f = this.manifest.files[this.fileIdx]
    if (this.hash.digest('hex') !== f.sha256) throw new Error(`checksum mismatch: ${f.path}`)
  }

  _consume(chunk) {
    let off = 0
    while (off < chunk.length) {
      if (this.state === 'len' || this.state === 'manifest') {
        off += this._take(chunk, off)
        if (this.accLen < this.need) continue
        const buf = Buffer.concat(this.acc)
        this.acc = []
        this.accLen = 0
        if (this.state === 'len') {
          this.need = buf.readUInt32LE(0)
          if (this.need <= 0 || this.need > MAX_MANIFEST) throw new Error('invalid manifest length')
          this.state = 'manifest'
        } else {
          const m = JSON.parse(buf.toString('utf8'))
          if (m?.format !== 1 || m.product !== PRODUCT || !Array.isArray(m.files)) {
            throw new Error('not a VP App update package')
          }
          for (const f of m.files) {
            assertSafeRelPath(f.path)
            if (!Number.isSafeInteger(f.size) || f.size < 0) throw new Error(`invalid size: ${f.path}`)
          }
          this.manifest = m
          this._nextFile()
        }
      } else if (this.state === 'file') {
        const n = Math.min(this.remaining, chunk.length - off)
        const part = chunk.subarray(off, off + n)
        fs.writeSync(this.fd, part)
        this.hash.update(part)
        this.remaining -= n
        off += n
        if (this.remaining === 0) {
          this._closeFile()
          this._nextFile()
        }
      } else {
        throw new Error('trailing data after archive')
      }
    }
  }

  _write(chunk, enc, cb) {
    try {
      this._consume(chunk)
      cb()
    } catch (e) {
      if (!e.code) e.code = 'BAD_PACKAGE' // fs 오류(e.code=ENOSPC 등)는 그대로
      cb(e)
    }
  }

  _final(cb) {
    cb(
      this.state === 'done'
        ? null
        : Object.assign(new Error('package truncated'), { code: 'BAD_PACKAGE' }),
    )
  }

  _destroy(err, cb) {
    if (this.fd != null) {
      try {
        fs.closeSync(this.fd)
      } catch {
        /* ignore */
      }
      this.fd = null
    }
    cb(err)
  }
}

// 패키지를 복호화해 destDir(비어있어야 함)에 푼다. 성공 시 매니페스트 반환.
// 키 불일치/변조/손상은 전부 예외 (code: 'DECRYPT_FAILED' | 'BAD_PACKAGE').
export const unpackUpdate = async (inFile, destDir, keyHex) => {
  const key = parseKey(keyHex)
  const fd = fs.openSync(inFile, 'r')
  const header = Buffer.alloc(HEADER_LEN)
  try {
    if (fs.readSync(fd, header, 0, HEADER_LEN, 0) !== HEADER_LEN) {
      throw Object.assign(new Error('file too small'), { code: 'BAD_PACKAGE' })
    }
  } finally {
    fs.closeSync(fd)
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw Object.assign(new Error('not a VP App update package (.vpu)'), { code: 'BAD_PACKAGE' })
  }
  const iv = header.subarray(MAGIC.length, MAGIC.length + IV_LEN)
  const tag = header.subarray(MAGIC.length + IV_LEN, HEADER_LEN)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(tag)

  fs.mkdirSync(destDir, { recursive: true })
  const extractor = new Extractor(destDir)
  try {
    await pipeline(
      fs.createReadStream(inFile, { start: HEADER_LEN }),
      decipher,
      zlib.createGunzip(),
      extractor,
    )
  } catch (e) {
    if (e.code === 'BAD_PACKAGE' || /^E[A-Z]+$/.test(e.code || '')) throw e // 구조 오류 / fs 오류(ENOSPC 등)
    // 그 외(zlib 헤더 오류, GCM 태그 불일치) = 잘못된 키 또는 변조·손상
    throw Object.assign(new Error(e.message), { code: 'DECRYPT_FAILED' })
  }
  return extractor.manifest
}
