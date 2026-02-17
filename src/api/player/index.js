import path from 'path'
import { logger } from '../../logger/index.js'
import pStatus from '../../pStatus.js'
import { dbStatus, dbFiles } from '../../db/index.js'
import { getLogoPath } from '../files/folders.js'
import { playerSend } from '../../player/index.js'
import { io, ioClient } from '../../web/index.js'
import { setPlaylistMode } from '../playlists/index.js'
import { broadcastEvent } from '../../tcp/index.js'
import { TCP_EVENTS } from '../../utils/tcpResponse.js'

const setMedia = async (id) => {
  logger.info(`Setting media with ID: ${id}`)
  // Try to find by id field first, then by number
  let file = await dbFiles.findOne({ id: String(id) })
  if (!file) {
    // If not found by id, try by number (for backward compatibility)
    const numId = Number(id)
    if (!isNaN(numId)) {
      file = await dbFiles.findOne({ number: numId })
    }
  }
  if (!file) {
    throw new Error('File not found')
  }
  setPlaylistMode(false)
  playerSend({ command: 'set_media', file, idx: pStatus.activePlayerId || 0 })
  return `Media set to: ${file.path}`
}

const playId = async (id) => {
  logger.info(`Received play request with ID: ${id}`)
  // Try to find by id field first, then by number
  let file = await dbFiles.findOne({ id: String(id) })
  if (!file) {
    // If not found by id, try by number (for backward compatibility)
    const numId = Number(id)
    if (!isNaN(numId)) {
      file = await dbFiles.findOne({ number: numId })
    }
  }
  if (!file) {
    throw new Error('Player not found')
  }
  pStatus.file = file
  ioClient.emit('pStatus', { file: pStatus.file })
  setPlaylistMode(false)
  playerSend({
    command: 'playid',
    file,
  })
  broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
    fileId: file.number,
    filename: file.filename,
  })
  return `Playing file: ${file.path}`
}

const playFile = async (file) => {
  try {
    playerSend({
      command: 'playid',
      file,
    })
    pStatus.file = file
    ioClient.emit('pStatus', { file: pStatus.file })
    // playlist 모드일때 trackid 추가
    broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
      fileId: file.number,
      filename: file.filename,
      trackId: pStatus.trackId,
    })
    return `Playing file: ${file.path}`
  } catch (error) {
    logger.error(`Error playing file: ${error.message}`)
  }
}

const playFoundFile = async (text) => {
  try {
    const file = await dbFiles.findOne({
      filename: { $regex: text, $options: 'i' },
    })
    if (!file) {
      throw new Error('File not found')
    }
    playFile(file)
  } catch (error) {
    logger.error(`Error playing found file: ${error.message}`)
  }
}

const play = () => {
  logger.info('Received play request without ID')

  // 플레이리스트 모드일 때는 현재 트랙 재생
  if (pStatus.playlistMode) {
    logger.info('Playlist mode: playing current track')
    const tracks = pStatus.playlist.tracks
    if (!tracks || tracks.length === 0) {
      logger.warn('No tracks in playlist')
      return 'No tracks in playlist'
    }

    const currentTrack = tracks[pStatus.trackId] || tracks[0]
    const nextTrack = tracks[pStatus.trackId + 1] || null

    // 이미지 타이머 정보 포함
    const currentTime = currentTrack.is_image
      ? currentTrack.time || 5
      : undefined
    const nextTime = nextTrack?.is_image ? nextTrack.time || 5 : undefined

    playerSend({
      command: 'play_current_and_load_next',
      current: currentTrack,
      next: nextTrack,
      track_idx: pStatus.trackId,
      current_time: currentTime,
      next_time: nextTime,
    })

    pStatus.file = currentTrack
    ioClient.emit('pStatus', { trackId: pStatus.trackId, file: pStatus.file })
    broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
      fileId: currentTrack?.number || null,
      filename: currentTrack?.filename || null,
    })
    return 'Playing playlist track'
  }

  // 일반 모드
  playerSend({ command: 'play', idx: pStatus.activePlayerId || 0 })
  broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
    fileId: pStatus.file?.number || null,
    filename: pStatus.file?.filename || null,
  })
  return 'Playing without ID'
}

const pause = () => {
  logger.info('Received pause request')
  playerSend({ command: 'pause', idx: pStatus.activePlayerId || 0 })
  broadcastEvent(TCP_EVENTS.PLAY_PAUSED, {
    fileId: pStatus.file?.number || null,
  })
  return 'Player paused'
}

const stop = () => {
  logger.info('Received stop request')
  // 플레이리스트 모드일 때는 모든 플레이어 정지
  if (pStatus.playlistMode) {
    logger.info('Playlist mode: stopping all players')
    playerSend({ command: 'stop_all' })
  } else {
    playerSend({ command: 'stop', idx: pStatus.activePlayerId || 0 })
  }
  broadcastEvent(TCP_EVENTS.PLAY_STOPPED, {})
  return 'Player stopped'
}

const updateTime = (time) => {
  playerSend({ command: 'set_time', time, idx: pStatus.activePlayerId || 0 })
  return `Time updated to: ${time}`
}

const setFullscreen = async (value) => {
  value = value !== undefined ? value : pStatus.fullscreen
  playerSend({ command: 'set_fullscreen', value })
  return `Fullscreen mode set`
}

const setLogoFile = async (logo) => {
  const filePath = path.join(getLogoPath(), logo)
  pStatus.logoFile = filePath
  await dbStatus.update(
    { type: 'logoFile' },
    { $set: { file: filePath } },
    { upsert: true },
  )
  playerSend({ command: 'logo_file', file: filePath })
  playerSend({ command: 'logo_size', size: pStatus.logoSize })
  ioClient.emit('pStatus', { logoFile: pStatus.logoFile })
  return `Logo set to: ${logo}`
}

const showLogo = async (show) => {
  pStatus.logoShow = show
  await dbStatus.update(
    { type: 'logoShow' },
    { $set: { value: show } },
    { upsert: true },
  )
  playerSend({ command: 'show_logo', show })
  ioClient.emit('pStatus', { logoShow: pStatus.logoShow })
  return `Logo visibility set to: ${show}`
}

const setLogoSize = async (size) => {
  pStatus.logoSize = size
  await dbStatus.update(
    { type: 'logoSize' },
    { $set: { value: size } },
    { upsert: true },
  )
  playerSend({ command: 'logo_size', size: pStatus.logoSize })
  ioClient.emit('pStatus', { logoSize: pStatus.logoSize })
  return `Logo size set to: ${size}`
}

const setBackground = async (background) => {
  if (!background || typeof background !== 'string') {
    logger.warn('Received invalid background color from Python')
    return
  }
  pStatus.backgroundColor = background
  await dbStatus.update(
    { type: 'backgroundColor' },
    { $set: { value: background } },
    { upsert: true },
  )
  playerSend({ command: 'background_color', color: background })
  ioClient.emit('pStatus', { backgroundColor: pStatus.backgroundColor })
  return `Background set to: ${background}`
}

const getAudioDevices = () => {
  return 'Requesting current audio device'
}

const setAudioDevice = async (deviceId) => {
  if (!deviceId) {
    logger.warn(
      'Received invalid audiodevice message - deviceId is empty or undefined',
    )
    return 'No deviceId provided'
  }
  logger.info(`Setting audio device to: ${deviceId}`)
  pStatus.audioDevice = deviceId
  await dbStatus.update(
    { type: 'audioDevice' },
    { $set: { audioDevice: deviceId } },
    { upsert: true },
  )
  playerSend({ command: 'set_audio_device', device_id: pStatus.audioDevice })
  ioClient.emit('pStatus', { audioDevice: pStatus.audioDevice })
  return `Audio device set to: ${deviceId}`
}

const setRepeat = async (mode = null) => {
  let modes = ['none', 'all', 'repeat_one']
  if (pStatus.playlistMode === false) {
    modes = ['none', 'all']
  }
  if (mode && modes.includes(mode)) {
    pStatus.repeat = mode
  } else {
    const currentIdx = modes.indexOf(pStatus.repeat)
    pStatus.repeat = modes[(currentIdx + 1) % modes.length]
  }
  await dbStatus.update(
    { type: 'repeat' },
    { $set: { value: pStatus.repeat } },
    { upsert: true },
  )
  logger.info(`Repeat mode set to: ${pStatus.repeat}`)
  return pStatus.repeat
}

const setNext = async () => {
  logger.info('Setting next track in playlist')
  if (pStatus.playlistMode) {
    const tracks = pStatus.playlist.tracks
    pStatus.trackId += 1
    if (pStatus.trackId >= tracks.length) {
      pStatus.trackId = 0 // Loop back to the start
    }

    const currentTrack = tracks[pStatus.trackId]
    const nextTrack = tracks[pStatus.trackId + 1] || null

    // 이미지 타이머 정보 포함
    const currentTime = currentTrack.is_image
      ? currentTrack.time || 5
      : undefined
    const nextTime = nextTrack?.is_image ? nextTrack.time || 5 : undefined

    // playFile 대신 직접 playerSend 호출하여 타이머 정보 전달
    playerSend({
      command: 'play_current_and_load_next',
      current: currentTrack,
      next: nextTrack,
      track_idx: pStatus.trackId,
      current_time: currentTime,
      next_time: nextTime,
    })

    pStatus.file = currentTrack
    ioClient.emit('pStatus', { trackId: pStatus.trackId, file: pStatus.file })
    broadcastEvent(TCP_EVENTS.NEXT_TRACK, {
      playlistId: pStatus.playlist.playlistId,
      trackId: pStatus.trackId,
      filename: currentTrack?.filename,
    })
  }
  return 'Next track set'
}

const setPrevious = async () => {
  logger.info('Setting previous track in playlist')
  if (pStatus.playlistMode) {
    if (pStatus.player.time < 5000) {
      if (pStatus.trackId > 0) {
        pStatus.trackId -= 1

        const tracks = pStatus.playlist.tracks
        const currentTrack = tracks[pStatus.trackId]
        const nextTrack = tracks[pStatus.trackId + 1] || null

        // 이미지 타이머 정보 포함
        const currentTime = currentTrack.is_image
          ? currentTrack.time || 5
          : undefined
        const nextTime = nextTrack?.is_image ? nextTrack.time || 5 : undefined

        // playFile 대신 직접 playerSend 호출하여 타이머 정보 전달
        playerSend({
          command: 'play_current_and_load_next',
          current: currentTrack,
          next: nextTrack,
          track_idx: pStatus.trackId,
          current_time: currentTime,
          next_time: nextTime,
        })

        pStatus.file = currentTrack
        ioClient.emit('pStatus', {
          trackId: pStatus.trackId,
          file: pStatus.file,
        })
        broadcastEvent(TCP_EVENTS.PREV_TRACK, {
          playlistId: pStatus.playlist.playlistId,
          trackId: pStatus.trackId,
          filename: currentTrack?.filename,
        })
        return 'Previous track set'
      }
    }
  }
  updateTime(0)
  return 'Previous track set'
}

export {
  setMedia,
  playId,
  playFile,
  play,
  stop,
  pause,
  updateTime,
  setFullscreen,
  setLogoFile,
  showLogo,
  setLogoSize,
  setBackground,
  getAudioDevices,
  setAudioDevice,
  setRepeat,
  setNext,
  setPrevious,
  playFoundFile,
}
