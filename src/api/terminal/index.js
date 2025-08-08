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

const handleMessage = async (data) => {
  logger.info(`Received message: ${data}`)
  try {
    let result = null
    let message = null

    // JSON 파싱 시도
    try {
      message = JSON.parse(data)
      if (!message || !message.command) {
        throw new Error('Invalid JSON message format')
      }
    } catch (jsonError) {
      // JSON이 아니면 간단한 command,value 형태로 파싱
      logger.info('JSON parsing failed, trying simple command format')
      message = parseSimpleCommand(data)
      if (!message || !message.command) {
        throw new Error('Invalid message format')
      }
      // 간단한 형태에서는 value를 적절한 속성으로 매핑
      if (message.value) {
        switch (message.command.toLowerCase()) {
          case 'playfile':
            message.file = message.value
            break
          case 'playid':
            message.id = parseInt(message.value)
            break
          case 'updatetime':
            if (message.time) {
              updateTime(message.time)
            }
            break
          case 'imagetime':
            if (message.time) {
              await setPlaylistImageTimeout(message.time)
              result = { imageTime: pStatus.imageTime }
            }
            break
          case 'fullscreen':
            setFullscreen()
            break
          case 'play':
            play()
            break
          case 'next':
            setNext()
            break
          case 'prev':
            setPrevious()
            break
          case 'stop':
            stop()
            break
          case 'playlistplay':
            const playlistParts = message.value.split(',')
            message.id = parseInt(playlistParts[0])
            message.track =
              playlistParts.length > 1 ? parseInt(playlistParts[1]) : 0
            break
        }
      }
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
