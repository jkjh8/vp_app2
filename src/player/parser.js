import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { ioClient } from '../web/index.js'
import { playerSend } from './index.js'
import { dbStatus, dbFiles } from '../db/index.js'
import { playFile, play, stop } from '../api/player/index.js'
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

  // 초기 설정 명령 전송
  const commands = [
    { command: 'background_color', color: pStatus.backgroundColor },
    pStatus.fullscreen && { command: 'set_fullscreen', value: true },
    { command: 'get_audio_devices' },
    pStatus.audioDevice && {
      command: 'set_audio_device',
      device_id: pStatus.audioDevice,
    },
    pStatus.playlistMode && {
      command: 'playlist_mode',
      value: pStatus.playlistMode,
    },
    { command: 'image_time', time: pStatus.imageTime },
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

  // 플레이리스트 모드 처리 (호스트가 next 명령)
  const tracks = pStatus.playlist?.tracks || []
  const isLastTrack = data.playlist_track_index >= tracks.length - 1

  switch (repeat) {
    case 'none':
      if (!isLastTrack) {
        logger.info('Moving to next track (none mode)')
        playerSend({ command: 'next' })
        broadcastEvent(EVENTS.TRACK_ENDED, {})
      } else {
        logger.info('Playlist ended (none mode)')
        playerSend({ command: 'stop_all' })
        playerSend({ command: 'set_track_index', index: 0 })
        broadcastEvent(EVENTS.END_REACHED, {})
      }
      break

    case 'all':
      logger.info('Moving to next track (all mode)')
      playerSend({ command: 'next' })
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

  if (data.uuid) {
    const file = await dbFiles.findOne({ uuid: data.uuid })
    if (file) {
      pStatus.file = file
      logger.info(`Media changed to: ${file.filename}`)
      updated = true
    }
  }

  if (typeof data.playlist_track_index === 'number') {
    pStatus.trackId = data.playlist_track_index
    const tracks = pStatus.playlist?.tracks || []
    if (tracks[pStatus.trackId]) {
      pStatus.file = tracks[pStatus.trackId]
      logger.info(`Track index changed to: ${pStatus.trackId}`)
      updated = true
    }
  }

  if (updated) {
    ioClient.emit('pStatus', {
      file: pStatus.file,
      trackId: pStatus.trackId,
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
        pStatus.activePlayerId = msgData.value
        ioClient.emit('pStatus', { activePlayerId: pStatus.activePlayerId })
        logger.debug(`Active player ID: ${pStatus.activePlayerId}`)
        break

      case 'player_data':
        // 플레이어 상태 업데이트 (active player만 반영)
        if (msgData.id === pStatus.activePlayerId || !pStatus.activePlayerId) {
          pStatus.player = {
            ...pStatus.player,
            time: msgData.time || pStatus.player.time,
            duration: msgData.duration || pStatus.player.duration,
            position: msgData.position || pStatus.player.position,
            event: msgData.event || pStatus.player.event,
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
        break

      case 'set_image_time':
        pStatus.imageTime = msgData.value
        await dbStatus.update(
          { type: 'imageTime' },
          { $set: { value: msgData.value } },
          { upsert: true },
        )
        ioClient.emit('pStatus', { imageTime: pStatus.imageTime })
        broadcastEvent(EVENTS.IMAGE_TIME_CHANGED, { time: pStatus.imageTime })
        logger.info(`Image time set to: ${pStatus.imageTime}`)
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
