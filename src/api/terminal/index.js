import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import {
  play,
  stop,
  playId,
  setNext,
  setPrevious,
  playFoundFile,
  setAudioDevice,
  setPlaylistImageTimeout,
  updateTime,
  pause,
  setFullscreen,
  setRepeat,
} from '../player/index.js'
import { playlistPlay } from '../playlists/index.js'
import { dbFiles } from '../../db/index.js'

const parseSimpleCommand = (data) => {
  // 간단한 command,value 형태 파싱
  const parts = data.trim().split(',')
  if (parts.length >= 1) {
    return {
      command: parts[0].trim(),
      value: parts.length > 1 ? parts[1].trim() : null,
    }
  }
  return null
}

// helper to parse integers when possible
const parseIntOrValue = (v) => {
  if (v === null || v === undefined) return v
  const n = parseInt(v)
  return Number.isNaN(n) ? v : n
}

// normalize message from either JSON or simple command format
const normalizeMessage = (data) => {
  try {
    const msg = JSON.parse(data)
    if (!msg || !msg.command) throw new Error('Invalid JSON')
    // normalize command name for consistent handling
    msg.command = String(msg.command).toLowerCase()
    if (msg.command === 'repeat') msg.command = 'setrepeat'
    msg._isJson = true
    return msg
  } catch (e) {
    // not JSON -> try simple parser
    const msg = parseSimpleCommand(data)
    if (!msg || !msg.command) return null

    // normalize aliases
    const low = msg.command.toLowerCase()
    if (low === 'setrepeat' || low === 'set_repeat' || low === 'repeat')
      msg.command = 'setrepeat'
    if (low === 'get_repeat' || low === 'getrepeat') msg.command = 'getrepeat'

    // map simple value into appropriate properties without side effects
    if (msg.value) {
      switch (msg.command.toLowerCase()) {
        case 'setrepeat':
        case 'repeat':
          // support both aliases; set mode from simple value
          msg.mode = msg.value ? msg.value : null
          break
        case 'playfile':
          msg.file = msg.value
          break
        case 'playid':
          msg.id = parseIntOrValue(msg.value)
          break
        case 'updatetime':
          msg.time = parseIntOrValue(msg.value)
          break
        case 'imagetime':
          msg.time = parseIntOrValue(msg.value)
          break
        case 'playlistplay': {
          const parts = msg.value.split(',')
          msg.id = parseIntOrValue(parts[0])
          msg.track = parts.length > 1 ? parseIntOrValue(parts[1]) : 0
          break
        }
        case 'setaudiodevice':
          msg.device = msg.value
          break
        default:
          // leave as-is; many commands have no mapped value
          break
      }
    }
    return msg
  }
}

const handleMessage = async (data) => {
  logger.info(`Received message: ${data}`)
  try {
    let result = null
    let message = null

    // parse/normalize incoming message (JSON or simple)
    message = normalizeMessage(data)
    if (!message || !message.command) {
      throw new Error('Invalid message format')
    }

    let command = message.command
    console.log(`Command: ${command}`)
    command = command.toLowerCase()
    switch (command) {
      case 'play':
        play()
        break
      case 'pause':
        pause()
        break
      case 'stop':
        stop()
        break
      case 'playfile':
        playFoundFile(message.file)
        break
      case 'playid':
        await playId(message.id)
        break
      case 'next':
        await setNext()
        break
      case 'prev':
        setPrevious()
        break
      case 'updatetime':
        if (message.time) {
          updateTime(message.time)
        }
        break
      case 'fullscreen':
        setFullscreen()
        break
      case 'setrepeat':
        // check allowed modes based on playlistMode and validate requested mode
        const allowedModes =
          pStatus.playlistMode === false
            ? ['none', 'all']
            : ['none', 'all', 'repeat_one']
        if (message.mode) {
          if (!allowedModes.includes(message.mode)) {
            result = { error: 'invalid_mode', allowedModes }
          } else {
            const modeResult = await setRepeat(message.mode)
            result = { repeat: modeResult }
          }
        } else {
          // no mode specified -> toggle to next
          const modeResult = await setRepeat()
          result = { repeat: modeResult }
        }
        break
      case 'getrepeat':
        // return current repeat mode and allowed modes
        const allowed =
          pStatus.playlistMode === false
            ? ['none', 'all']
            : ['none', 'all', 'repeat_one']
        result = { repeat: pStatus.repeat, allowedModes: allowed }
        break
      case 'getaudiodevices':
        result = { devices: pStatus.audioDevices }
        break
      case 'getaudiodevice':
        result = { device: pStatus.audioDevice }
        break
      case 'setaudiodevice':
        if (message.device) {
          await setAudioDevice(message.device)
          result = { device: pStatus.audioDevice }
        }
        break
      case 'imagetime':
        if (message.time) {
          await setPlaylistImageTimeout(message.time)
          result = { imageTime: pStatus.imageTime }
        }
        break
      case 'playlistplay':
        if (message.id) {
          playlistPlay(message.id, message.track || 0)
        }
        break
      case 'getfiles':
        result = { files: await dbFiles.find() }
        break
      case 'getplaylists':
        result = { playlists: await dbPlaylists.find() }
        break
      case 'getplaylist':
        if (message.id) {
          result = {
            playlist: await dbPlaylists.findOne({ playlistId: message.id }),
          }
        }
        break
    }
    return result
  } catch (error) {
    logger.error(`Error processing message: ${data}`, error)
  }
}

export { handleMessage }
