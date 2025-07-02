import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import {
  play,
  stop,
  playId,
  setNext,
  setPrevious,
  playFoundFile,
} from '../player/index.js'
import { playlistPlay } from '../playlists/index.js'
import { dbFiles } from '../../db/index.js'

const handleMessage = (data) => {
  const messages = data.split('\n').filter(Boolean)
  for (const msg of messages) {
    logger.info(`Received message: ${msg}`)
    try {
      let [command, ...params] = msg.split(',')
      command = command.trim().toLowerCase()
      switch (command) {
        case 'play':
          play()
          break
        case 'stop':
          stop()
          break
        case 'playfile':
          playFoundFile(params[0])
          break
        case 'playid':
          playId(params[0])
          break
        case 'next':
          setNext()
          break
        case 'prev':
          setPrevious()
          break
      }
    } catch (error) {
      logger.error(`Error processing message: ${msg}`, error)
    }
  }
}

export { handleMessage }
