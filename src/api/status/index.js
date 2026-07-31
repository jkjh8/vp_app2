import { dbStatus } from '../../db/index.js'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'

const updateStatusFromDb = async () => {
  const st = await dbStatus.find({})
  for (const status of st) {
    // ??: 값이 비어있는 DB 레코드가 기본값을 undefined로 덮어쓰지 않게 함
    // (예: backgroundColor undefined → 플레이어에 color 없는 background_color 명령 발신 버그)
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
      case 'logoFile':
        pStatus.logoFile = status.file ?? pStatus.logoFile
        break
      case 'logoSize':
        pStatus.logoSize = status.value ?? pStatus.logoSize
        break
      case 'logoShow':
        pStatus.logoShow = status.value ?? pStatus.logoShow
        break
      case 'startOnPlay':
        pStatus.startOnPlay = status.value ?? pStatus.startOnPlay
        break
      case 'startOnPlaylistId':
        pStatus.startOnPlaylistId = status.playlistId ?? pStatus.startOnPlaylistId
        break
      case 'tcpPort':
        pStatus.tcpPort = status.value ?? pStatus.tcpPort
        break
      case 'imageTime':
        pStatus.imageTime = status.value ?? pStatus.imageTime
        break
      case 'display':
        pStatus.display = { ...pStatus.display, ...(status.value ?? {}) }
        break
      case 'windows':
        // 멀티 윈도우(v3) 사용자 정의 출력 창 목록
        pStatus.windows = Array.isArray(status.value) ? status.value : pStatus.windows
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
        // 멀티 PC 동기 설정 (role/domain/peers/multicast/lead)
        if (status.value && typeof status.value === 'object') {
          pStatus.sync = { ...pStatus.sync, ...status.value, ptp: pStatus.sync.ptp }
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
      default:
        logger.warn(`Unknown status type: ${status.type}`)
    }
  }
}

export { updateStatusFromDb }
