import { app } from 'electron'
import { initLogger, logger } from './logger/index.js'
import { initDb } from './db/index.js'
import { updateStatusFromDb } from './api/status/index.js'
import { initWebServer } from './web/index.js'
import { setupFFmpeg } from './api/files/index.js'
import {
  existsLogoPath,
  existsMediaPath,
  existsTmpPath,
} from './api/files/folders.js'
import { startTcpServer } from './tcp/index.js'
import { startPlayer } from './player/index.js'

app.whenReady().then(async () => {
  initLogger()
  logger.debug('Logger initialized')
  existsMediaPath()
  existsLogoPath()
  existsTmpPath()
  logger.debug('Media, logo, and tmp paths checked or created')
  initDb()
  logger.debug('Database initialized')
  await updateStatusFromDb()
  logger.debug('Status updated from database')
  setupFFmpeg()
  initWebServer()
  startTcpServer()
  startPlayer()
})
