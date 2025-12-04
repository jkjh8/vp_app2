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
import { playlistPlay, getPlaylists, getPlaylist } from '../playlists/index.js'
import db, { dbFiles, dbPlaylists } from '../../db/index.js'

// 파일 정보 간소화 함수 (ID와 이름만)
const simplifyFileInfo = (file) => {
  if (!file) return null
  return {
    id: file.id,
    name: file.name,
    type: file.type,
  }
}

// 플레이리스트 트랙 정보 간소화 함수
const simplifyTrackInfo = (track) => {
  if (!track) return null
  return {
    uuid: track.uuid,
    amx: track.amx,
    filename: track.filename || track.originalname,
    time: track.time || 0,
    mimetype: track.mimetype,
    duration: track.metadata?.format?.duration,
    size: track.size,
    is_image: track.is_image || false,
  }
}

// 플레이리스트 정보 간소화 함수
const simplifyPlaylistInfo = (playlist) => {
  if (!playlist) return null
  return {
    playlistId: playlist.playlistId,
    name: playlist.name,
    description: playlist.description,
    tracks: playlist.tracks?.map(simplifyTrackInfo) || [],
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  }
}

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

// helper to parse boolean-like strings
const parseBool = (v) => {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return undefined
}

// normalize message from either JSON or simple command format
const normalizeMessage = (data) => {
  try {
    const msg = JSON.parse(data)
    if (!msg || !msg.command) throw new Error('Invalid JSON')
    // normalize command name for consistent handling
    msg.command = String(msg.command).toLowerCase()
    if (msg.command === 'repeat') msg.command = 'setrepeat'
    // if JSON fullscreen provided, normalize value to boolean when possible
    if (msg.command === 'fullscreen' && typeof msg.value !== 'undefined') {
      msg.fullscreen = parseBool(msg.value)
    }
    msg._isJson = true
    return msg
  } catch (e) {
    // not JSON -> try simple parser
    const msg = parseSimpleCommand(data)
    if (!msg || !msg.command) return null

    // normalize aliases
    const low = msg.command.toLowerCase()
    // normalize command name to lowercase for consistent handling
    msg.command = low
    // map common aliases
    if (low === 'setfullscreen' || low === 'full') msg.command = 'fullscreen'
    if (low === 'setrepeat' || low === 'set_repeat' || low === 'repeat')
      msg.command = 'setrepeat'
    if (low === 'get_repeat' || low === 'getrepeat') msg.command = 'getrepeat'

    // map simple value into appropriate properties without side effects
    // note: msg.value may be null if no second part provided
    // special-case repeat mapping from simple value
    if (msg.value) {
      if (msg.command === 'setrepeat') {
        msg.mode = msg.value ? msg.value : null
      }
    }
    switch (msg.command.toLowerCase()) {
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
      case 'getplaylist':
        msg.id = parseIntOrValue(msg.value)
        break
      case 'setaudiodevice':
        msg.device = msg.value
        break
      case 'fullscreen':
        // if no value provided in simple command, leave undefined so caller will toggle
        if (msg.value == null) {
          msg.fullscreen = undefined
        } else {
          msg.fullscreen = parseBool(msg.value)
        }
        break
      default:
        // leave as-is; many commands have no mapped value
        break
    }
    return msg
  }
}

const handleMessage = async (data) => {
  logger.info(`Received message: ${data}`)
  try {
    // parse/normalize incoming message (JSON or simple)
    const message = normalizeMessage(data)
    if (!message || !message.command) {
      throw new Error('Invalid message format')
    }

    const command = message.command.toLowerCase()
    logger.debug(`Processing command: ${command}`)

    let result = null
    switch (command) {
      case 'play':
        play()
        result = {
          command: 'play',
          message: 'Command executed: play',
        }
        break
      case 'pause':
        pause()
        result = {
          command: 'pause',
          message: 'Command executed: pause',
        }
        break
      case 'stop':
        stop()
        result = {
          command: 'stop',
          message: 'Command executed: stop',
        }
        break
      case 'playfile':
        await playFoundFile(message.file)
        result = {
          command: 'playfile',
          message: `Command executed: playfile ${message.file}`,
        }
        break
      case 'playid':
        await playId(message.id)
        result = {
          command: 'playid',
          message: `Command executed: playid ${message.id}`,
        }
        break
      case 'next':
        await setNext()
        result = {
          command: 'next',
          message: 'Moved to next track',
          data: {
            trackId: pStatus.trackId,
            currentTrack: simplifyFileInfo(
              pStatus.playlist.tracks?.[pStatus.trackId],
            ),
            playlistMode: pStatus.playlistMode,
          },
        }
        break
      case 'prev':
        await setPrevious()
        result = {
          command: 'prev',
          message: 'Command executed: prev',
        }
        break
      case 'updatetime':
        if (message.time !== undefined) {
          updateTime(message.time)
          result = {
            command: 'updatetime',
            message: `Time updated to ${message.time}ms`,
            data: {
              time: message.time,
              playerState: pStatus.player,
            },
          }
        } else {
          result = {
            command: 'updatetime',
            message: 'Time parameter required',
            data: { currentTime: pStatus.player.time },
          }
        }
        break
      case 'fullscreen':
        // message.fullscreen may be boolean or undefined.
        // if undefined -> toggle using current pStatus.fullscreen
        let fs =
          typeof message.fullscreen !== 'undefined'
            ? message.fullscreen
            : undefined
        if (typeof fs === 'undefined') fs = !pStatus.fullscreen
        // ensure boolean
        fs = Boolean(fs)
        await setFullscreen(fs)
        result = {
          command: 'fullscreen',
          message: `Fullscreen ${fs ? 'enabled' : 'disabled'}`,
          data: { fullscreen: fs },
        }
        break
      case 'togglefullscreen':
        const newFullscreenState = !pStatus.fullscreen
        await setFullscreen(newFullscreenState)
        result = {
          command: 'togglefullscreen',
          message: `Fullscreen ${newFullscreenState ? 'enabled' : 'disabled'}`,
          data: { fullscreen: newFullscreenState },
        }
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
        if (message.time !== undefined) {
          await setPlaylistImageTimeout(message.time)
          result = {
            command: 'imagetime',
            message: `Image time set to ${message.time} seconds`,
            data: {
              imageTime: pStatus.imageTime,
              previousTime: message.time,
            },
          }
        } else {
          result = {
            command: 'imagetime',
            message: 'Time parameter required',
            data: { currentImageTime: pStatus.imageTime },
          }
        }
        break
      case 'playlistplay':
        if (message.id) {
          playlistPlay(message.id, message.track || 0)
        }
        break
      case 'getfiles':
        const files = await dbFiles.find()
        result = {
          command: 'getfiles',
          message: `Found ${files.length} files`,
          data: { files, count: files.length },
        }
        break
      case 'getplaylists':
        const playlists = await getPlaylists()
        result = {
          command: 'getplaylists',
          message: `Found ${playlists.length} playlists`,
          data: {
            playlists: playlists.map(simplifyPlaylistInfo),
            count: playlists.length,
          },
        }
        break
      case 'getplaylist':
        if (message.id) {
          const playlist = await getPlaylist(message.id)
          result = {
            command: 'getplaylist',
            message: playlist
              ? `Found playlist ${message.id}`
              : `Playlist ${message.id} not found`,
            data: { playlist: simplifyPlaylistInfo(playlist) },
          }
        } else {
          result = {
            command: 'getplaylist',
            message: 'Playlist ID required',
            data: { error: 'MISSING_PARAMETER', parameter: 'id' },
          }
        }
        break
      default:
        result = {
          command: command || 'unknown',
          message: `Unknown command: ${command}`,
          data: {
            error: 'UNKNOWN_COMMAND',
            availableCommands: [
              'play',
              'pause',
              'stop',
              'playid',
              'playfile',
              'next',
              'prev',
              'fullscreen',
              'setrepeat',
              'getrepeat',
              'setaudiodevice',
              'getaudiodevices',
              'getaudiodevice',
              'imagetime',
              'updatetime',
              'playlistplay',
              'getfiles',
              'getplaylists',
              'getplaylist',
            ],
          },
        }
        break
    }
    return result
  } catch (error) {
    logger.error(`Error processing message: ${data}`, error)

    // Return structured error response
    return {
      command: 'error',
      message: `Command execution failed: ${error.message}`,
      data: {
        error: 'EXECUTION_ERROR',
        originalMessage: data,
        errorDetails: error.stack,
      },
    }
  }
}

export { handleMessage }
