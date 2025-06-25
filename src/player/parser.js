import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { ioClient } from '../web/index.js'
import { playerSend } from './index.js'
import { dbStatus } from '../db/index.js'

const parsePlayerStatus = async (data) => {
  try {
    // 여러 JSON 메시지가 한 번에 들어올 수 있으므로 줄 단위로 분리
    const messages = data.toString().split('\n').filter(Boolean)
    for (const msg of messages) {
      const { command, value } = JSON.parse(msg)
      switch (command) {
        case 'ready':
          pStatus.ready = true
          logger.info('Player is ready')
          ioClient.emit('pStatus', { ready: true })
          playerSend({
            command: 'setBackgroundColor',
            color: pStatus.backgroundColor,
          })
          if (pStatus.fullscreen) {
            playerSend({ command: 'setFullscreen', value: true })
            logger.info('Fullscreen mode enabled')
          }
          playerSend({ command: 'getAudioDevices' })
          if (pStatus.audioDevice) {
            playerSend({
              command: 'setAudioDevice',
              deviceId: pStatus.audioDevice,
            })
            logger.info(`Audio device set to: ${pStatus.audioDevice}`)
          }
          if (pStatus.playlistMode) {
            playerSend({
              command: 'setPlaylistMode',
              value: pStatus.playlistMode,
            })
            logger.info(`Playlist mode set to: ${pStatus.playlistMode}`)
          }
          playerSend({
            command: 'setPlaylistImageTime',
            time: pStatus.imageTime,
          })
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
          break
        case 'status':
          pStatus.player = { ...pStatus.player, ...value }
          ioClient.emit('pStatus', { player: pStatus.player })
          break
        case 'audioDevices':
          pStatus.audioDevices = value
          ioClient.emit('pStatus', { audioDevices: value })
          break
      }
    }
  } catch (error) {
    logger.error('Error parsing player status:', error)
    throw new Error('Failed to parse player status')
  }
}

export default parsePlayerStatus
