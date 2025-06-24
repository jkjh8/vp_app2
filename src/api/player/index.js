import path from 'path'
import { logger } from '../../logger/index.js'
import pStatus from '../../pStatus.js'
import { dbStatus, dbFiles } from '../../db/index.js'
import { getLogoPath } from '../files/folders.js'
import { broadcastTcpJson } from '../../tcp/index.js'
// import { setPlaylistMode } from '../playlists/index.js'
// import { sendPlayerCommand, sendMessageToClient } from '../index.js'
// import { broadcastTcpMessage } from '../../tcp/index.js'

const setMedia = async (id) => {
  logger.info(`Setting media with ID: ${id}`)
  const file = await dbFiles.findOne({ number: Number(id) })
  if (!file) {
    throw new Error('File not found')
  }
  // sendPlayerCommand('set_media', { file })
  // setPlaylistMode(false)
  // broadcastTcpMessage(`set,${id},${file.filename}`)
  broadcastTcpJson({ command: 'mediaSet', file: file.path })
  return `Media set to: ${file.path}`
}

const playId = async (id) => {
  logger.info(`Received play request with ID: ${id}`)
  const file = await dbFiles.findOne({ number: Number(id) })
  if (!file) {
    throw new Error('Player not found')
  }
  // sendPlayerCommand('playId', { file })
  // setPlaylistMode(false)
  // broadcastTcpMessage(`playId,${id},${file.filename}`)
  broadcastTcpJson({ command: 'playId', file: file.path })
  return `Playing file: ${file.path}`
}

const play_file = async (file) => {
  logger.info(`Received play_file request with file: ${file}`)
  const foundFile = await dbFiles.findOne({
    filename: { $regex: file, $options: 'i' },
  })
  if (!foundFile) {
    throw new Error('File not found')
  }
  // sendPlayerCommand('playId', { file: foundFile })
  // setPlaylistMode(false)
  // broadcastTcpMessage(`playId,${foundFile.number},${foundFile.filename}`)
  return `Playing file: ${foundFile.path}`
}

const play = (idx) => {
  logger.info('Received play request without ID')
  // sendPlayerCommand('play', { idx })
  broadcastTcpJson({ command: 'play', idx })
  return 'Playing without ID'
}

const pause = (idx) => {
  logger.info('Received pause request')
  // sendPlayerCommand('pause', { idx })
  broadcastTcpJson({ command: 'pause', idx })
  return 'Player paused'
}

const stop = () => {
  logger.info('Received stop request')
  // sendPlayerCommand('stop_all', {})
  // broadcastTcpMessage('stop')
  broadcastTcpJson({ command: 'stop' })
  return 'Player stopped'
}

const updateTime = (time, idx) => {
  // sendPlayerCommand('set_time', { time, idx })
  // broadcastTcpMessage(`set_time,${time}`)
  return `Time updated to: ${time} for player ${idx}`
}

const setFullscreen = async (value) => {
  // sendPlayerCommand('set_fullscreen', { value })
  // broadcastTcpMessage(`set_fullscreen,${value}`)
  broadcastTcpJson({ command: 'setFullscreen' })
  return `Fullscreen mode set to: ${value}`
}

const setLogo = async (logo) => {
  const filePath = path.join(getLogoPath(), logo)

  pStatus.logo.file = filePath
  pStatus.logo.name = logo
  await dbStatus.update({ type: 'logo' }, { file: filePath, name: logo })
  // sendMessageToClient('pStatus', {
  //   logo: pStatus.logo,
  // })
  // sendPlayerCommand('logo_file', { file: filePath })
  logger.info(`Setting logo to: ${logo} at path: ${filePath}`)
  return `Logo set to: ${logo}`
}

const showLogo = async (show) => {
  pStatus.logo.show = show
  await dbStatus.update({ type: 'logo' }, { show })
  // sendMessageToClient('pStatus', { logo: pStatus.logo })
  // sendPlayerCommand('show_logo', { show })
  return `Logo visibility set to: ${show}`
}

const setLogoSize = async (size) => {
  logger.info(`Setting logo size to: ${size}`)
  pStatus.logo.size = size
  await dbStatus.update({ type: 'logo' }, { size })
  // sendMessageToClient('pStatus', {
  //   logo: pStatus.logo,
  // })
  // sendPlayerCommand('logo_size', {
  //   size,
  // })
  return `Logo size set to: ${size}`
}

const setBackground = async (background) => {
  if (!background || typeof background !== 'string') {
    logger.warn('Received invalid background color from Python')
    return
  }
  pStatus.background = background
  await dbStatus.update({ type: 'background' }, { value: background })
  // sendMessageToClient('pStatus', {
  //   background: pStatus.background,
  // })
  // sendPlayerCommand('background_color', { color: background })
  return `Background set to: ${background}`
}

const getAudioDevices = () => {
  // sendPlayerCommand('get_audio_devices', {})
  return 'Requesting current audio device'
}

const setAudioDevice = async (deviceId) => {
  if (!deviceId) {
    logger.warn('Received invalid audiodevice message from Python')
    return
  }
  pStatus.device.audiodevice = deviceId
  await dbStatus.update({ type: 'audiodevice' }, { audiodevice: deviceId })
  // sendMessageToClient('pStatus', {
  //   device: pStatus.device,
  // })
  // sendPlayerCommand('set_audio_device', { device: deviceId })
  logger.info(`Setting audio device to: ${deviceId}`)
  return `Audio device set to: ${deviceId}`
}

const setImageTime = async (time) => {
  logger.info(`Setting image time to: ${time}`)
  // sendPlayerCommand('image_time', { time })
  await dbStatus.update({ type: 'image_time' }, { time })
  // sendMessageToClient('pStatus', {
  //   imageTime: time,
  // })
  return `Image time set to: ${time}`
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
  await dbStatus.update({ type: 'repeat' }, { mode: pStatus.repeat })
  logger.info(`Repeat mode set to: ${pStatus.repeat}`)
  // sendMessageToClient('pStatus', {
  //   repeat: pStatus.repeat,
  // })
  return pStatus.repeat
}

const setNext = async () => {
  logger.info('Setting next track in playlist')
  // sendPlayerCommand('next', {})
  return 'Next track set'
}

const setPrevious = async () => {
  logger.info('Setting previous track in playlist')
  // sendPlayerCommand('previous', {})
  // 재생시간이 5초 미만이면 playlistTrackIndex를 -1

  return 'Previous track set'
}

export {
  // sendPlayerCommand,
  setMedia,
  playId,
  play_file,
  play,
  stop,
  pause,
  updateTime,
  setFullscreen,
  setLogo,
  showLogo,
  setLogoSize,
  setBackground,
  getAudioDevices,
  setAudioDevice,
  setImageTime,
  setRepeat,
  setNext,
  setPrevious,
}
