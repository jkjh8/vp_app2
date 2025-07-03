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

const handleMessage = async (data) => {
  logger.info(`Received message: ${data}`)
  try {
    let result = null
    const message = JSON.parse(data)
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
