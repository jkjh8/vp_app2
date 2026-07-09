import path from 'path'
import { app, onShutdown } from '../runtime.js'
import { logger } from '../logger/index.js'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import httpLogger from 'morgan'
import { Server } from 'socket.io'
import http from 'http'
import pStatus from '../pStatus.js'

import registerClientNamespace from './clientNamespace.js'
import registerPlayerNamespace from './playerNamespace.js'
import router from '../routes/index.js'

let io = null
let ioClient = null
let ioPlayer = null

const initWebServer = () => {
  const publicPath = path.join(app.getAppPath(), 'public')

  const appWeb = express()
  const port = pStatus.webPort || 3000

  appWeb.use(cors())
  appWeb.use(cookieParser())
  appWeb.use(express.json())
  appWeb.use(express.urlencoded({ extended: true }))
  appWeb.use(httpLogger('dev'))
  appWeb.use(express.static(path.join(publicPath, 'spa')))
  appWeb.use('/', router)
  const server = http.createServer(appWeb)
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  ioClient = io.of('/client')
  ioPlayer = io.of('/player')

  registerClientNamespace(ioClient)
  registerPlayerNamespace(ioPlayer)

  // 포트 점유 = 이미 실행 중 (Electron requestSingleInstanceLock 대체 — 단일 인스턴스 보장)
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} in use — another instance is already running. Exiting.`)
      process.exit(0)
    } else {
      logger.error(`Web server error: ${err.message}`)
      process.exit(1)
    }
  })

  server.listen(port, () => {
    logger.info(`Web server running at http://localhost:${port}`)
  })

  onShutdown(() => new Promise((resolve) => server.close(() => resolve())))
  return { io, ioClient, ioPlayer }
}

export { initWebServer, io, ioClient, ioPlayer }
