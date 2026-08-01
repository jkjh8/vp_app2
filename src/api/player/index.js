import path from 'path'
import { logger } from '../../logger/index.js'
import pStatus from '../../pStatus.js'
import { dbStatus, dbFiles } from '../../db/index.js'
import { getLogoPath } from '../files/folders.js'
import { playerSend, restartPlayer } from '../../player/index.js'
import { io, ioClient } from '../../web/index.js'
import { setPlaylistMode } from '../playlists/index.js'
import {
  stopAllTrackAudios,
  pauseTrackAudios,
  resumeTrackAudios,
} from '../playlists/trackAudio.js'
import {
  timelinePause,
  timelineSeek,
  timelineStop,
} from '../timelines/index.js'
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

  // 타임라인 모드: 플레이어가 클록 소유 — pause 토글로 재개 (timeline_play는 전용 API 경유)
  if (pStatus.timelineMode) {
    timelinePause() // 플레이어 timeline_pause는 토글 → 일시정지 상태면 재개
    return 'Timeline resumed'
  }

  // 덱이 일시정지 상태(로드 유지)면 이어서 재생, 그 외(정지/최초)에는 파일을 다시 로드
  const isPaused = pStatus.player.event === 'paused'

  // 플레이리스트/장면 모드
  if (pStatus.playlistMode) {
    const wins = Object.keys(pStatus.windowStates || {})
    if (isPaused && wins.length) {
      // 장면 모드: 전 창 일괄 재개
      logger.info('Scene mode: resuming all windows')
      wins.forEach((w) => playerSend({ command: 'play', window_id: Number(w) }))
      resumeTrackAudios()
      broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
        fileId: pStatus.file?.number || null,
        filename: pStatus.file?.filename || null,
      })
      return 'Resumed all windows'
    }
    // 정지 상태에서 재생 = 현재 재생 다시 시작. 윈도우 모드는 전 창 각자 목록 시작, 장면 모드는 현재 장면.
    logger.info('Playlist mode: (re)playing current')
    const sceneIdx = Number.isInteger(pStatus.trackId) ? pStatus.trackId : 0
    import('../playlists/index.js')
      .then(({ startScenes, startWindowPlaylist }) => {
        if (pStatus.playlist?.mode === 'window') startWindowPlaylist()
        else startScenes(sceneIdx)
      })
      .catch((e) => logger.error(`play (re)start failed: ${e}`))
    broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
      fileId: pStatus.file?.number || null,
      filename: pStatus.file?.filename || null,
    })
    return 'Playing scene'
  }

  // 일반 모드: 일시정지면 이어서 재생
  if (isPaused) {
    playerSend({ command: 'play', idx: pStatus.activePlayerId || 0 })
    broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
      fileId: pStatus.file?.number || null,
      filename: pStatus.file?.filename || null,
    })
    return 'Resumed'
  }

  // 정지 상태 또는 최초 실행: 마지막 재생했던(또는 선택된) 파일을 다시 로드
  if (!pStatus.file?.path) {
    logger.warn('No file to play')
    return 'No file to play'
  }
  playerSend({ command: 'playid', file: pStatus.file })
  ioClient.emit('pStatus', { file: pStatus.file })
  broadcastEvent(TCP_EVENTS.PLAY_STARTED, {
    fileId: pStatus.file?.number || null,
    filename: pStatus.file?.filename || null,
  })
  return `Playing file: ${pStatus.file.path}`
}

const pause = () => {
  logger.info('Received pause request')
  // 타임라인 모드: timeline_pause 토글 (플레이어가 전 덱/오디오 트랙을 일괄 일시정지/재개)
  if (pStatus.timelineMode) {
    timelinePause()
    return 'Timeline paused/resumed'
  }
  // 플레이어의 pause는 토글 — 레인도 토글 전 덱 상태를 따라 같은 방향으로 움직인다
  const wasPaused = pStatus.player.event === 'paused'
  // 장면 모드: 전 창 일괄 일시정지/재개 (player pause는 창별 토글)
  const wins = Object.keys(pStatus.windowStates || {})
  if (pStatus.playlistMode && wins.length) {
    wins.forEach((w) => playerSend({ command: 'pause', window_id: Number(w) }))
  } else {
    playerSend({ command: 'pause', idx: pStatus.activePlayerId || 0 })
  }
  if (pStatus.playlistMode) {
    if (wasPaused) resumeTrackAudios()
    else pauseTrackAudios()
  }
  broadcastEvent(TCP_EVENTS.PLAY_PAUSED, {
    fileId: pStatus.file?.number || null,
  })
  return 'Player paused'
}

const stop = () => {
  logger.info('Received stop request')
  // 타임라인 모드: 전용 정지 (해체 + 모드 해제 + 위치 초기화)
  if (pStatus.timelineMode) {
    timelineStop()
    broadcastEvent(TCP_EVENTS.PLAY_STOPPED, {})
    return 'Timeline stopped'
  }
  // 플레이리스트/장면 모드: 전 창 동시 정지 + 장면 상태/창 상태 초기화
  if (pStatus.playlistMode) {
    logger.info('Playlist mode: stopping all players')
    playerSend({ command: 'stop_all' })
    // 장면 컨트롤러 + windowStates 초기화 (UI가 전 창 정지를 즉시 반영)
    import('../playlists/index.js')
      .then(({ resetScenes }) => resetScenes())
      .catch(() => {})
  } else {
    playerSend({ command: 'stop', idx: pStatus.activePlayerId || 0 })
  }
  stopAllTrackAudios() // 트랙 종속 오디오도 일괄 정지 (없으면 no-op)
  broadcastEvent(TCP_EVENTS.PLAY_STOPPED, {})
  return 'Player stopped'
}

const updateTime = (time) => {
  // 타임라인 모드: time은 이미 ms (clientNamespace가 초×1000) → timeline_seek(ms)
  if (pStatus.timelineMode) {
    timelineSeek(Math.round(Number(time)))
    return `Timeline seek to: ${time}ms`
  }
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
  playerSend({ command: 'get_audio_devices' })
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
    { $set: { value: deviceId } },
    { upsert: true },
  )
  playerSend({ command: 'set_audio_device', device_id: pStatus.audioDevice })
  ioClient.emit('pStatus', { audioDevice: pStatus.audioDevice })
  return `Audio device set to: ${deviceId}`
}

// 하드웨어 가속 설정 ('auto'|'on'|'off'). 기동 시에만 반영되는 엔진 설정이므로 저장 후
// 플레이어를 재시작해 적용한다 (재생이 잠시 중단됨 — UI가 확인 후 호출).
const setHardwareAcceleration = async (value) => {
  if (!['auto', 'on', 'off'].includes(value)) {
    logger.warn(`Invalid hardwareAcceleration value: ${value}`)
    return 'invalid value'
  }
  logger.info(`Setting hardware acceleration to: ${value}`)
  pStatus.hardwareAcceleration = value
  await dbStatus.update(
    { type: 'hardwareAcceleration' },
    { $set: { value } },
    { upsert: true },
  )
  ioClient.emit('pStatus', { hardwareAcceleration: value })
  await restartPlayer('hardware acceleration change')
  return `Hardware acceleration set to: ${value}`
}

// 전역 마스터 볼륨 (0~100). persist=true면 DB 저장(슬라이더 릴리즈), false면 전송만(드래그).
const setMasterVolume = async (value, persist = true) => {
  const v = Math.max(0, Math.min(100, Number(value)))
  if (!Number.isFinite(v)) return 'invalid value'
  pStatus.masterVolume = v
  playerSend({ command: 'set_master_volume', volume: v })
  if (persist) {
    await dbStatus.update({ type: 'masterVolume' }, { $set: { value: v } }, { upsert: true })
  }
  ioClient.emit('pStatus', { masterVolume: v })
  return `Master volume set to: ${v}`
}

const getDisplays = () => {
  playerSend({ command: 'get_displays' })
  return 'Requesting current display list'
}

const setDisplay = async ({ monitorIndex, x, y, width, height, aspectMode }) => {
  pStatus.display = {
    monitorIndex: monitorIndex ?? -1,
    x: x ?? 0,
    y: y ?? 0,
    width: width ?? 0,
    height: height ?? 0,
    aspectMode: aspectMode ?? 'letterbox',
  }
  await dbStatus.update(
    { type: 'display' },
    { $set: { value: pStatus.display } },
    { upsert: true },
  )
  playerSend({
    command: 'set_display',
    monitor_index: pStatus.display.monitorIndex,
    x: pStatus.display.x,
    y: pStatus.display.y,
    width: pStatus.display.width,
    height: pStatus.display.height,
    aspect_mode: pStatus.display.aspectMode,
  })
  ioClient.emit('pStatus', { display: pStatus.display })
  return 'Display settings updated'
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
  setHardwareAcceleration,
  setMasterVolume,
  getDisplays,
  setDisplay,
  setRepeat,
  setNext,
  setPrevious,
  playFoundFile,
}
