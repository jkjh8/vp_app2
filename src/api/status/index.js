import path from 'path'
import fs from 'fs'
import { dbStatus } from '../../db/index.js'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { getMediaPath } from '../files/folders.js'

// 기능 삭제로 더 이상 읽지 않는 폐기 status 레코드 (이후 다른 키가 폐기되면 여기에 추가).
// 남겨두면 updateStatusFromDb의 default 케이스가 매 부팅 "Unknown status type" 경고를 낸다.
const OBSOLETE_STATUS_TYPES = ['logoFile', 'logoShow', 'logoSize']

// 부팅 시 1회 정리: 폐기 status 레코드 삭제 + 미참조 로고 폴더(~/media/logo) 제거 (best-effort).
const cleanupLegacyStatus = async () => {
  try {
    const removed = await dbStatus.remove(
      { type: { $in: OBSOLETE_STATUS_TYPES } },
      { multi: true },
    )
    if (removed) logger.info(`Removed ${removed} obsolete status records (${OBSOLETE_STATUS_TYPES.join(', ')})`)
  } catch (e) {
    logger.warn(`cleanupLegacyStatus (db) failed: ${e.message}`)
  }
  try {
    const logoDir = path.join(getMediaPath(), 'logo')
    if (fs.existsSync(logoDir)) {
      fs.rmSync(logoDir, { recursive: true, force: true })
      logger.info(`Removed obsolete logo folder: ${logoDir}`)
    }
  } catch (e) {
    logger.warn(`cleanupLegacyStatus (folder) failed: ${e.message}`)
  }
}

// 포트는 서버가 이미 바인딩한 뒤 바뀌면 안 되므로 부팅 시 첫 로드에서만 적용한다
// (GET /api/status 가 매번 이 함수를 다시 호출함). 변경값은 다음 실행부터 반영.
let portsApplied = false
const validPort = (v) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

const updateStatusFromDb = async () => {
  const st = await dbStatus.find({})
  const applyPorts = !portsApplied
  portsApplied = true
  for (const status of st) {
    // ??: 값이 비어있는 DB 레코드가 기본값을 undefined로 덮어쓰지 않게 함
    // (예: backgroundColor undefined → color 없는 background_color 명령이 발신됨)
    switch (status.type) {
      case 'fullscreen':
        pStatus.fullscreen = status.value ?? pStatus.fullscreen
        break
      case 'backgroundColor':
        pStatus.backgroundColor = status.value ?? pStatus.backgroundColor
        break
      case 'audioDevice':
        // status.audioDevice: 과거 버전이 잘못된 필드명으로 저장한 레코드 호환용
        pStatus.audioDevice =
          status.value ?? status.audioDevice ?? pStatus.audioDevice
        break
      case 'startOnPlay':
        pStatus.startOnPlay = status.value ?? pStatus.startOnPlay
        break
      case 'startOnPlaylistId':
        pStatus.startOnPlaylistId = status.playlistId ?? pStatus.startOnPlaylistId
        break
      case 'autoStart':
        // Windows 시작 시 자동 실행 (HKCU Run 키) 사용자 의도
        pStatus.autoStart = status.value ?? pStatus.autoStart
        break
      case 'tcpPort':
        pStatus.tcpPort = status.value ?? pStatus.tcpPort
        break
      case 'webPort':
        // VP_WEB_PORT 환경변수가 있으면 그쪽이 우선
        if (applyPorts && !process.env.VP_WEB_PORT && validPort(status.value)) {
          pStatus.webPort = validPort(status.value)
        }
        break
      case 'tcpSimplePort':
      case 'tcpJsonPort':
        if (applyPorts && validPort(status.value)) pStatus[status.type] = validPort(status.value)
        break
      case 'imageTime':
        pStatus.imageTime = status.value ?? pStatus.imageTime
        break
      case 'display':
        pStatus.display = { ...pStatus.display, ...(status.value ?? {}) }
        break
      case 'windows':
        // 멀티 윈도우 사용자 정의 출력 창 목록
        pStatus.windows = Array.isArray(status.value) ? status.value : pStatus.windows
        break
      case 'windowPresets':
        // 화면 구성 프리셋 목록
        pStatus.windowPresets = Array.isArray(status.value) ? status.value : pStatus.windowPresets
        break
      case 'activePreset':
        // 현재 배치와 일치하는 프리셋 id
        pStatus.activePresetId = Number.isInteger(status.value) ? status.value : pStatus.activePresetId
        break
      case 'preload':
        // 프리롤 설정 (lookahead/max_decks)
        if (status.value && typeof status.value === 'object') {
          if (Number.isInteger(status.value.lookahead))
            pStatus.preloadLookahead = status.value.lookahead
          if (Number.isInteger(status.value.maxDecks))
            pStatus.preloadMaxDecks = status.value.maxDecks
        }
        break
      case 'sync':
        // 멀티 PC 동기 설정 (role/domain/multicast/lead). ptp/discovered/show/playerId는 런타임·별도 케이스가 소유.
        if (status.value && typeof status.value === 'object') {
          pStatus.sync = {
            ...pStatus.sync,
            ...status.value,
            ptp: pStatus.sync.ptp,
            discovered: {}, // 런타임 전용 — 부팅 시 항상 빈 목록
            show: pStatus.sync.show,
            playerId: pStatus.sync.playerId,
          }
        }
        break
      case 'playerId':
        // 이 PC의 안정적 식별자 (디스커버리 announce 키). discovery.js가 없으면 생성·영속.
        if (typeof status.value === 'string' && status.value) {
          pStatus.sync.playerId = status.value
        }
        break
      case 'show':
        // (master) 쇼 매핑 { mode, domain, leadMs, assignments }
        if (status.value && typeof status.value === 'object') {
          pStatus.sync.show = { ...pStatus.sync.show, ...status.value }
        }
        break
      case 'channelDelays':
        pStatus.channelDelays = Array.isArray(status.value) ? status.value : pStatus.channelDelays
        break
      case 'hardwareAcceleration':
        pStatus.hardwareAcceleration = status.value ?? pStatus.hardwareAcceleration
        break
      case 'masterVolume':
        pStatus.masterVolume = Number.isFinite(status.value) ? status.value : pStatus.masterVolume
        break
      case 'playbackMode':
        // 전역 작업 모드 'scene' | 'window'
        pStatus.playbackMode =
          status.value === 'window' || status.value === 'scene' ? status.value : pStatus.playbackMode
        break
      case 'repeat':
        // 전역 반복 모드 'none' | 'all' | 'repeat_one'
        if (['none', 'all', 'repeat_one'].includes(status.value)) pStatus.repeat = status.value
        break
      case 'windowRepeat':
        // 창별 반복 모드 { [windowId]: 'none'|'all'|'repeat_one' } (윈도우 모드 전용)
        if (status.value && typeof status.value === 'object' && !Array.isArray(status.value))
          pStatus.windowRepeat = status.value
        break
      default:
        logger.warn(`Unknown status type: ${status.type}`)
    }
  }
}

export { updateStatusFromDb, cleanupLegacyStatus }
