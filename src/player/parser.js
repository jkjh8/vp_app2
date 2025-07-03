import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { ioClient } from '../web/index.js'
import { playerSend } from './index.js'
import { dbStatus } from '../db/index.js'
import { playFile, play, stop } from '../api/player/index.js'
import { app } from 'electron'
import { broadcastTcpJson } from '../tcp/index.js'

function handleReady() {
  pStatus.ready = true
  logger.info('Player is ready')
  ioClient.emit('pStatus', { ready: true })

  // Prepare commands to send
  const commands = [
    { command: 'setBackgroundColor', color: pStatus.backgroundColor },
    pStatus.fullscreen && { command: 'setFullscreen', value: true },
    { command: 'getAudioDevices' },
    pStatus.audioDevice && {
      command: 'setAudioDevice',
      deviceId: pStatus.audioDevice,
    },
    pStatus.playlistMode && {
      command: 'setPlaylistMode',
      value: pStatus.playlistMode,
    },
    { command: 'setPlaylistImageTime', time: pStatus.imageTime },
    { command: 'setLogo', file: pStatus.logoFile, size: pStatus.logoSize },
    { command: 'showLogo', show: pStatus.logoShow },
  ].filter(Boolean)

  // Send commands and log as needed
  for (const cmd of commands) {
    playerSend(cmd)
    if (cmd.command === 'setFullscreen') logger.info('Fullscreen mode enabled')
    if (cmd.command === 'setAudioDevice')
      logger.info(`Audio device set to: ${pStatus.audioDevice}`)
    if (cmd.command === 'setPlaylistMode')
      logger.info(`Playlist mode set to: ${pStatus.playlistMode}`)
  }
}

function handleEndReached() {
  const repeat = pStatus.repeat
  const playlistMode = pStatus.playlistMode

  if (repeat === 'none') {
    if (playlistMode) {
      if (pStatus.playlist.tracks.length > pStatus.trackId + 1) {
        pStatus.trackId += 1
        playFile(pStatus.playlist.tracks[pStatus.trackId])
        broadcastTcpJson({ command: 'next', track: pStatus.trackId })
      } else {
        stop()
        broadcastTcpJson({ command: 'endReached' })
      }
    } else {
      stop()
      broadcastTcpJson({ command: 'endReached' })
    }
  } else if (repeat === 'all') {
    if (playlistMode) {
      if (pStatus.playlist.tracks.length > pStatus.trackId + 1) {
        pStatus.trackId += 1
      } else {
        pStatus.trackId = 0
      }
      playFile(pStatus.playlist.tracks[pStatus.trackId])
      broadcastTcpJson({ command: 'next', track: pStatus.trackId })
    } else {
      stop()
      play()
    }
  } else if (repeat === 'repeat_one') {
    stop()
    play()
  } else {
    stop()
    broadcastTcpJson({ command: 'endReached' })
  }
}

const parsePlayerStatus = async (data) => {
  try {
    // 여러 JSON 메시지가 한 번에 들어올 수 있으므로 줄 단위로 분리
    const messages = data.toString().split('\n').filter(Boolean)
    for (const msg of messages) {
      const { command, value } = JSON.parse(msg)
      switch (command) {
        case 'ready':
          handleReady()
          break
        case 'playlistImageTime':
          pStatus.imageTime = value
          await dbStatus.update(
            { type: 'imageTime' },
            { $set: { value } },
            { upsert: true },
          )
          ioClient.emit('pStatus', { imageTime: value })
          broadcastTcpJson({ command: 'imagetime', time: value })
          logger.debug(`Image time set to: ${value}`)
          break
        case 'fullscreen':
          pStatus.fullscreen = value
          logger.info(`Fullscreen mode set to: ${value}`)
          await dbStatus.update(
            { type: 'fullscreen' },
            { $set: { value } },
            { upsert: true },
          )
          ioClient.emit('pStatus', { fullscreen: value })
          broadcastTcpJson({ command: 'fullscreen', value })
          break
        case 'status':
        case 'mediaPlayerStatus':
          pStatus.player = { ...pStatus.player, ...value }
          ioClient.emit('pStatus', { player: pStatus.player })
          break
        case 'audioDevices':
          pStatus.audioDevices = value
          ioClient.emit('pStatus', { audioDevices: value })
          broadcastTcpJson({ command: 'audioDevices', devices: value })
          break
        case 'endReached':
          handleEndReached()
          break
        case 'closed':
          app.exit(0)
          break
        default:
          logger.warn(`Unknown command received: ${command}`)
          break
      }
    }
  } catch (error) {
    logger.error('Error parsing player status:', error)
    throw new Error('Failed to parse player status')
  }
}

export default parsePlayerStatus
