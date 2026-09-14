import { logger } from '../logger/index.js'
import pStatus from '../pStatus.js'

const registerPlayerNamespace = (ioPlayer) => {
  ioPlayer.on('connection', (socket) => {
    logger.debug(`Player connected: ${socket.id}`)
    socket.emit('get_audio_devices')
    socket.emit('set_audio_device', pStatus.audioDevice)
    socket.on('disconnect', () => {
      logger.debug(`Player disconnected: ${socket.id}`)
    })
  })
}

export default registerPlayerNamespace
