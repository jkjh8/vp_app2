import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { ioClient } from '../web/index.js'

const parsePlayerStatus = (data) => {
  try {
    const { command, value } = JSON.parse(data)
    logger.info(`Received command: ${command}, value: ${value}`)
    switch (command) {
      case 'fullscreen':
        pStatus.fullscreen = value
        logger.info(`Fullscreen mode set to: ${value}`)
        ioClient.emit('pStatus', { fullscreen: value })
        return `Fullscreen mode set to: ${value}`
    }
  } catch (error) {
    logger.error('Error parsing player status:', error)
    throw new Error('Failed to parse player status')
  }
}

export default parsePlayerStatus
