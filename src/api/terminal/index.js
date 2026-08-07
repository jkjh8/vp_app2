// 외부제어 TCP 명령 dispatcher (재설계 v2).
// 입력(JSON 또는 simple `cmd,v1,v2`)을 정규화 → 레지스트리(commands.js) 조회 → 파라미터 매핑
// → 핸들러 실행 → 표준 TcpResponse 반환. tcp/index.js가 이 응답을 그대로 클라이언트에 전송한다.
// (예전의 하드코딩 queryCommands 응답 게이팅 제거 — 모든 명령이 응답한다.)
import { logger } from '../../logger/index.js'
import { TcpResponse } from '../../utils/tcpResponse.js'
import { commandLookup } from './commands.js'

// ── 파라미터 코어션 ─────────────────────────────────────────
const parseBool = (v) => {
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return undefined
}

const coerce = (type, v) => {
  if (v === undefined || v === null || v === '') return undefined
  switch (type) {
    case 'number': {
      const n = Number(v)
      return Number.isNaN(n) ? undefined : n
    }
    case 'boolean':
      return parseBool(v)
    case 'string':
      return String(v)
    case 'raw':
    default:
      return v
  }
}

// simple 포트: 위치(순서)로 매핑. 'number[]'는 남은 값 전부.
const mapPositional = (params, values) => {
  const out = {}
  let vi = 0
  for (const p of params) {
    if (p.type === 'number[]') {
      out[p.name] = values.slice(vi).map(Number).filter((n) => !Number.isNaN(n))
      vi = values.length
      continue
    }
    const c = coerce(p.type, values[vi])
    vi += 1
    if (c !== undefined) out[p.name] = c
  }
  return out
}

// JSON 포트: 이름으로 매핑 (레거시 필드명은 jsonAliases로 흡수).
const mapNamed = (params, obj) => {
  const out = {}
  for (const p of params) {
    let raw = obj[p.name]
    if (raw === undefined && p.jsonAliases) {
      for (const a of p.jsonAliases) {
        if (obj[a] !== undefined) {
          raw = obj[a]
          break
        }
      }
    }
    if (p.type === 'number[]') {
      if (Array.isArray(raw)) out[p.name] = raw.map(Number).filter((n) => !Number.isNaN(n))
      continue
    }
    const c = coerce(p.type, raw)
    if (c !== undefined) out[p.name] = c
  }
  return out
}

// 입력 문자열 → { commandName, params } (JSON/simple 공용). 실패 시 null.
const normalizeMessage = (data) => {
  const trimmed = String(data).trim()
  // JSON 우선 시도
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      return { error: { code: 'INVALID_JSON', message: 'Invalid JSON format' } }
    }
    if (!obj || !obj.command) return { error: { code: 'INVALID_MESSAGE', message: 'Missing "command"' } }
    const commandName = String(obj.command).toLowerCase()
    const def = commandLookup.get(commandName)
    if (!def) return { commandName, def: null }
    return { commandName, def, params: mapNamed(def.params || [], obj) }
  }
  // simple: cmd,v1,v2,...
  const parts = trimmed.split(',')
  const commandName = (parts[0] || '').trim().toLowerCase()
  if (!commandName) return { error: { code: 'INVALID_MESSAGE', message: 'Empty command' } }
  const def = commandLookup.get(commandName)
  if (!def) return { commandName, def: null }
  const values = parts.slice(1).map((s) => s.trim())
  return { commandName, def, params: mapPositional(def.params || [], values) }
}

// 핸들러 반환값 → TcpResponse.success 데이터/메시지로 정규화
const toResponse = (def, hr) => {
  if (typeof hr === 'string') return TcpResponse.success(def.name, hr, {})
  if (hr && typeof hr === 'object' && ('message' in hr || 'data' in hr)) {
    return TcpResponse.success(def.name, hr.message || null, hr.data || {})
  }
  return TcpResponse.success(def.name, null, hr || {})
}

/**
 * 메시지 처리 — 항상 TcpResponse(성공/에러)를 반환한다.
 */
const handleMessage = async (data) => {
  logger.info(`TCP command received: ${data}`)
  const norm = normalizeMessage(data)

  if (norm.error) {
    return TcpResponse.error('unknown', norm.error.message, norm.error.code)
  }
  if (!norm.def) {
    return TcpResponse.error(
      norm.commandName || 'unknown',
      `Unknown command: ${norm.commandName}`,
      'UNKNOWN_COMMAND',
    )
  }

  const { def, params } = norm

  // 필수 파라미터 검증
  for (const p of def.params || []) {
    if (p.required && params[p.name] === undefined) {
      return TcpResponse.error(def.name, `Missing required parameter: ${p.name}`, 'MISSING_PARAMETER')
    }
  }
  // 기본값 적용
  for (const p of def.params || []) {
    if (params[p.name] === undefined && p.default !== undefined) params[p.name] = p.default
  }

  try {
    logger.debug(`Dispatching command: ${def.name}`)
    const hr = await def.handler(params)
    return toResponse(def, hr)
  } catch (error) {
    logger.error(`Command '${def.name}' failed: ${error.message}`)
    return TcpResponse.error(def.name, error, error.code || 'EXECUTION_ERROR')
  }
}

export { handleMessage, normalizeMessage }
