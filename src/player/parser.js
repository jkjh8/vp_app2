import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { ioClient } from '../web/index.js'
import { playerSend } from './index.js'
import { dbStatus, dbFiles } from '../db/index.js'
import { playFile, play, stop } from '../api/player/index.js'
import { preloadNextTrack } from '../api/playlists/index.js'
import { app } from 'electron'
import { broadcastEvent } from '../tcp/index.js'
import { TCP_EVENTS as EVENTS } from '../utils/tcpResponse.js'

let lastEndReachedEvent = null

// 플레이어 준비 완료 처리
function handleReady() {
  pStatus.ready = true
  logger.info('Player is ready')
  ioClient.emit('pStatus', { ready: true })
  broadcastEvent(EVENTS.PLAYER_READY, {})

  // 초기 설정 명령 전송 (오디오 디바이스는 먼저 조회)
  const commands = [
    { command: 'background_color', color: pStatus.backgroundColor },
    pStatus.fullscreen && { command: 'set_fullscreen', value: true },
    { command: 'get_audio_devices' }, // 디바이스 목록 먼저 조회
    // set_audio_device는 audiodevices 이벤트 받은 후에 호출
    pStatus.playlistMode && {
      command: 'playlist_mode',
      value: pStatus.playlistMode,
    },

    { command: 'logo_file', file: pStatus.logoFile },
    { command: 'logo_size', size: pStatus.logoSize },
    { command: 'show_logo', show: pStatus.logoShow },
  ].filter(Boolean)

  for (const cmd of commands) {
    playerSend(cmd)
  }
  logger.info('Initial player commands sent')
}

// 재생 종료 이벤트 처리 (호스트에서 제어)
function handleEndReached(data) {
  const eventKey = `${data.playlist_track_index}-${data.active_player_id}`
  if (lastEndReachedEvent === eventKey) {
    logger.warn(`Duplicate end_reached event ignored: ${eventKey}`)
    return
  }
  lastEndReachedEvent = eventKey

  logger.info(
    `End reached event - track: ${data.playlist_track_index}, player: ${data.active_player_id}`,
  )

  const repeat = pStatus.repeat
  const playlistMode = pStatus.playlistMode

  if (!playlistMode) {
    // 일반 재생 모드 처리
    if (repeat === 'repeat_one') {
      stop()
      play()
    } else {
      stop()
      broadcastEvent(EVENTS.END_REACHED, {})
    }
    return
  }

  // 플레이리스트 모드 처리 (호스트가 다음 파일 관리)
  const tracks = pStatus.playlist?.tracks || []
  const isLastTrack = data.playlist_track_index >= tracks.length - 1

  switch (repeat) {
    case 'none':
      if (!isLastTrack) {
        logger.info('Moving to next track (none mode)')
        // 이미 로드된 다음 파일로 전환
        playerSend({ command: 'next' })
        // trackId 업데이트
        pStatus.trackId++
        ioClient.emit('pStatus', { trackId: pStatus.trackId })
        // 새로운 다음 파일 미리 로드
        preloadNextTrack()
        broadcastEvent(EVENTS.TRACK_ENDED, {})
      } else {
        logger.info('Playlist ended (none mode)')
        playerSend({ command: 'stop_all' })
        pStatus.trackId = 0
        ioClient.emit('pStatus', { trackId: pStatus.trackId })
        broadcastEvent(EVENTS.END_REACHED, {})
      }
      break

    case 'all':
      logger.info('Moving to next track (all mode)')
      // 이미 로드된 다음 파일로 전환
      playerSend({ command: 'next' })
      // trackId 업데이트 (마지막이면 0으로)
      pStatus.trackId++
      if (pStatus.trackId >= tracks.length) {
        pStatus.trackId = 0
      }
      ioClient.emit('pStatus', { trackId: pStatus.trackId })
      // 새로운 다음 파일 미리 로드
      preloadNextTrack()
      broadcastEvent(EVENTS.TRACK_ENDED, {})
      break

    case 'single':
      logger.info('Single track mode, stopping')
      playerSend({ command: 'stop', idx: data.active_player_id })
      broadcastEvent(EVENTS.END_REACHED, {})
      break

    case 'repeat_one':
      logger.info('Repeat one mode, replaying current track')
      playerSend({ command: 'stop', idx: data.active_player_id })
      playerSend({ command: 'play', idx: data.active_player_id })
      break

    default:
      playerSend({ command: 'stop_all' })
      broadcastEvent(EVENTS.END_REACHED, {})
      break
  }
}

// 미디어 변경 이벤트 처리
async function handleMediaChanged(data) {
  logger.info(`Media changed event: idx=${data.idx}, uuid=${data.uuid}`)

  let updated = false

  // uuid로 실제 재생 중인 파일 정보 조회
  if (data.uuid) {
    const file = await dbFiles.findOne({ uuid: data.uuid })
    if (file) {
      pStatus.file = file
      logger.info(`Media changed to: ${file.filename}`)
      updated = true

      // 플레이리스트 모드이고 playlist_track_index가 있으면 해당 트랙과 일치하는지 확인
      if (
        typeof data.playlist_track_index === 'number' &&
        pStatus.playlistMode
      ) {
        const tracks = pStatus.playlist?.tracks || []
        const trackFromIndex = tracks[data.playlist_track_index]

        // Python이 보낸 트랙 인덱스의 파일과 uuid가 일치하는지 확인
        if (trackFromIndex && trackFromIndex.uuid === data.uuid) {
          // 일치하면 trackId 업데이트 (플레이리스트 직접 재생 시)
          pStatus.trackId = data.playlist_track_index
          logger.info(
            `Track index updated to: ${pStatus.trackId} (from Python)`,
          )
        } else {
          logger.warn(
            `Mismatch: Python track_index=${data.playlist_track_index} uuid=${data.uuid}, but tracks[${data.playlist_track_index}]?.uuid=${trackFromIndex?.uuid}`,
          )
        }
      }
    }
  }

  if (updated) {
    ioClient.emit('pStatus', {
      file: pStatus.file,
      trackId: pStatus.trackId,
    })
    // TCP로 미디어 변경 이벤트 전송
    broadcastEvent(EVENTS.MEDIA_CHANGED, {
      fileId: pStatus.file?.number || null,
      filename: pStatus.file?.filename || null,
      trackId: pStatus.trackId,
      playlistId: pStatus.playlist?.playlistId || null,
    })
  }
}

// 메인 파서 함수
const parsePlayerStatus = async (data) => {
  try {
    const { type, data: msgData } = JSON.parse(data)

    switch (type) {
      case 'info':
        logger.info(`[Player] ${msgData}`)
        // 특별한 info 메시지 처리 (예: ready 이벤트)
        if (typeof msgData === 'string' && msgData.includes('ready')) {
          handleReady()
        }
        break

      case 'warn':
        logger.warn(`[Player] ${msgData}`)
        break

      case 'debug':
        logger.debug(`[Player] ${msgData}`)
        break

      case 'error':
        logger.error(`[Player] ${msgData}`)
        break

      case 'active_player_id':
        // 프로토콜상 data는 정수 (구현체에 따라 {value} 형태 방어)
        pStatus.activePlayerId =
          typeof msgData === 'number' ? msgData : msgData.value
        ioClient.emit('pStatus', { activePlayerId: pStatus.activePlayerId })
        logger.debug(`Active player ID: ${pStatus.activePlayerId}`)
        break

      case 'player_data':
        // 플레이어 상태 업데이트 (active player만 반영)
        if (
          msgData.id === pStatus.activePlayerId ||
          pStatus.activePlayerId == null
        ) {
          pStatus.player = {
            ...pStatus.player,
            // ??: 0(시작 지점 time, 정지 시 duration 등)도 유효한 값으로 반영
            time: msgData.time ?? pStatus.player.time,
            duration: msgData.duration ?? pStatus.player.duration,
            position: msgData.position ?? pStatus.player.position,
            event: msgData.event ?? pStatus.player.event,
            is_playing:
              msgData.is_playing !== undefined
                ? msgData.is_playing
                : pStatus.player.is_playing,
          }
          ioClient.emit('pStatus', { player: pStatus.player })
        }
        break

      case 'media_changed':
        await handleMediaChanged(msgData)
        break

      case 'end_reached':
        handleEndReached(msgData)
        break

      case 'audiodevices':
        pStatus.audioDevices = msgData.devices || []
        ioClient.emit('pStatus', { audioDevices: pStatus.audioDevices })
        broadcastEvent(EVENTS.AUDIO_DEVICES_UPDATED, {
          count: pStatus.audioDevices.length,
        })
        logger.info(
          `Audio devices updated: ${pStatus.audioDevices.length} devices`,
        )

        // 오디오 디바이스 목록을 받은 후 설정된 디바이스 적용
        if (pStatus.audioDevice) {
          logger.info(`Setting audio device to: ${pStatus.audioDevice}`)
          playerSend({
            command: 'set_audio_device',
            device_id: pStatus.audioDevice,
          })
        }
        break

      case 'set_fullscreen':
        pStatus.fullscreen = msgData.value
        await dbStatus.update(
          { type: 'fullscreen' },
          { $set: { value: msgData.value } },
          { upsert: true },
        )
        ioClient.emit('pStatus', { fullscreen: pStatus.fullscreen })
        broadcastEvent(EVENTS.FULLSCREEN_CHANGED, { value: pStatus.fullscreen })
        logger.info(`Fullscreen mode set to: ${pStatus.fullscreen}`)
        break

      case 'set_background':
        pStatus.backgroundColor = msgData.background
        await dbStatus.update(
          { type: 'backgroundColor' },
          { $set: { value: msgData.background } },
          { upsert: true },
        )
        ioClient.emit('pStatus', { backgroundColor: pStatus.backgroundColor })
        logger.info(`Background color set to: ${pStatus.backgroundColor}`)
        break

      case 'track_index':
        pStatus.trackId = msgData.value
        ioClient.emit('pStatus', { trackId: pStatus.trackId })
        logger.debug(`Track index: ${pStatus.trackId}`)
        break

      case 'logo_visibility':
        pStatus.logoShow = msgData.show
        ioClient.emit('pStatus', { logoShow: pStatus.logoShow })
        logger.debug(`Logo visibility: ${pStatus.logoShow}`)
        break

      case 'closed':
        logger.warn('Player window closed, exiting application')
        app.exit(0)
        break

      default:
        logger.warn(`Unknown message type from player: ${type}`)
        break
    }
  } catch (error) {
    logger.error(`Error parsing player message: ${error.message}`)
    logger.debug(`Raw data: ${data}`)
  }
}

export default parsePlayerStatus
