import { logger } from '../logger/index.js'
import pStatus from '../pStatus.js'
import { updateTime } from '../api/player/index.js'
const registerClientNamespace = (ioClient) => {
  ioClient.on('connection', (socket) => {
    logger.debug(`Client connected: ${socket.id}`)
    socket.emit('pStatus', pStatus)

    socket.on('disconnect', () => {
      logger.debug(`Client disconnected: ${socket.id}`)
    })

    // Handle client messages here
    socket.on('event', (msg) => {
      switch (msg.type) {
        case 'time':
          // windowId 지정 시 그 창만 시크(윈도우 모드), 미지정이면 기본 창/활성 덱.
          updateTime(msg.value * 1000, msg.windowId)
          break
      }
      logger.debug(`Client message: ${msg}`)
    })
  })
}

export default registerClientNamespace
