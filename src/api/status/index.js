import { dbStatus } from '../../db/index.js'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'

const updateStatusFromDb = async () => {
  const st = await dbStatus.find({})
  for (const status of st) {
    switch (status.type) {
      case 'fullscreen':
        pStatus.fullscreen = status.value
        break
      case 'backgroundColor':
        pStatus.backgroundColor = status.value
        break
      case 'audioDevice':
        pStatus.audioDevice = status.value
        break
      case 'logoFile':
        pStatus.logoFile = status.file
        break
      case 'logoSize':
        pStatus.logoSize = status.value
        break
      case 'logoShow':
        pStatus.logoShow = status.value
        break
      case 'imageTime':
        pStatus.imageTime = status.value
        break
      case 'startOnPlay':
        pStatus.startOnPlay = status.value
        break
      case 'startOnPlaylistId':
        pStatus.startOnPlaylistId = status.playlistId
        break
      default:
        logger.warn(`Unknown status type: ${status.type}`)
    }
  }
}

export { updateStatusFromDb }
