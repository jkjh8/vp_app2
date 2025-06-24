import { logger } from '../logger/index.js'
import pStatus from '../pStatus.js'

const registerClientNamespace = (ioClient) => {
  ioClient.on('connection', (socket) => {
    logger.debug(`Client connected: ${socket.id}`)
    socket.emit('pStatus', pStatus)
    socket.on('disconnect', () => {
      logger.debug(`Client disconnected: ${socket.id}`)
    })

    // Handle client messages here
    socket.on('event', (msg) => {
      logger.debug(`Client message: ${msg}`)
    })
  })
}

export default registerClientNamespace
