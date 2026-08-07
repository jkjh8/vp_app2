import net from 'net'
import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { handleMessage } from '../api/terminal/index.js'
import { commandNames } from '../api/terminal/commands.js'
import {
  TcpResponse,
  TcpResponseSender,
  TCP_EVENTS,
  PROTOCOL_VERSION,
  APP_VERSION,
} from '../utils/tcpResponse.js'

// 접속 환영 메시지 payload (버전 + 기능협상). format = 'simple' | 'json'.
function welcomeData(clientId, format) {
  return {
    serverId: 'vp_app2',
    appVersion: APP_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    clientId,
    port: format,
    format: format === 'simple' ? 'comma-separated' : 'json',
    features: pStatus.playerFeatures || [], // 플레이어 capabilities (multi_window/timeline/…)
    commands: commandNames, // 지원하는 정규 명령 목록
  }
}

let simpleTcpServer = null
let jsonTcpServer = null
let tcpClients = []
let responseSender = null

function startSimpleTcpServer(port = pStatus.tcpSimplePort) {
  if (simpleTcpServer) {
    logger.warn('Simple TCP server is already running')
    return
  }

  // Initialize response sender if not already created
  if (!responseSender) {
    responseSender = new TcpResponseSender(tcpClients)
  }

  simpleTcpServer = net.createServer((socket) => {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`
    logger.info(`Simple TCP client connected: ${clientId}`)

    tcpClients.push(socket)
    responseSender = new TcpResponseSender(tcpClients)

    // Send welcome message
    const welcomeResponse = TcpResponse.success(
      'connect',
      'Connected to VP Server (Simple Command Port)',
      welcomeData(clientId, 'simple'),
    )
    responseSender.sendTo(socket, welcomeResponse)

    socket.on('data', async (data) => {
      const messages = data.toString().split('\n')
      for (let message of messages) {
        const trimmedMessage = message.trim()
        if (!trimmedMessage) continue

        try {
          logger.info(
            `Simple TCP message received from ${clientId}: ${trimmedMessage}`,
          )

          // Validate: reject JSON format on simple port
          if (
            trimmedMessage.startsWith('{') ||
            trimmedMessage.startsWith('[')
          ) {
            const errorResponse = TcpResponse.error(
              'format_error',
              'JSON format not allowed on Simple TCP port. Use JSON TCP port instead.',
              'FORMAT_ERROR',
            )
            responseSender.sendTo(socket, errorResponse)
            continue
          }

          // dispatcher가 표준 TcpResponse(성공/에러)를 반환 — 모든 명령에 응답.
          const response = await handleMessage(trimmedMessage)
          responseSender.sendTo(socket, response)
        } catch (error) {
          logger.error(
            `Error handling Simple TCP message from ${clientId}:`,
            error,
          )
          responseSender.sendTo(
            socket,
            TcpResponse.error('unknown', error, 'EXECUTION_ERROR'),
          )
        }
      }
    })

    socket.on('end', () => {
      logger.info(`Simple TCP client disconnected: ${clientId}`)
      tcpClients = tcpClients.filter((c) => c !== socket)
      responseSender = new TcpResponseSender(tcpClients)
    })

    socket.on('error', (err) => {
      logger.error(`Simple TCP client error (${clientId}):`, err)
      tcpClients = tcpClients.filter((c) => c !== socket)
      responseSender = new TcpResponseSender(tcpClients)
    })
  })

  simpleTcpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Simple TCP port ${port} is already in use. Trying alternative port...`,
      )
      const altPort = port + 1
      logger.info(`Attempting to start Simple TCP server on port ${altPort}`)
      pStatus.tcpSimplePort = altPort
      simpleTcpServer = null
      setTimeout(() => startSimpleTcpServer(altPort), 1000)
    } else if (err.code === 'EACCES') {
      logger.error(
        `Permission denied for Simple TCP port ${port}. Simple TCP server disabled.`,
      )
      logger.info(
        'Application will continue without Simple TCP server functionality.',
      )
      simpleTcpServer = null
    } else {
      logger.error(`Simple TCP server error:`, err)
      simpleTcpServer = null
    }
  })

  simpleTcpServer.listen(port, '0.0.0.0', () => {
    logger.info(`Simple TCP server listening on port ${port}`)
  })
}

function startJsonTcpServer(port = pStatus.tcpJsonPort) {
  if (jsonTcpServer) {
    logger.warn('JSON TCP server is already running')
    return
  }

  // Initialize response sender if not already created
  if (!responseSender) {
    responseSender = new TcpResponseSender(tcpClients)
  }

  jsonTcpServer = net.createServer((socket) => {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`
    logger.info(`JSON TCP client connected: ${clientId}`)

    tcpClients.push(socket)
    responseSender = new TcpResponseSender(tcpClients)

    // Send welcome message
    const welcomeResponse = TcpResponse.success(
      'connect',
      'Connected to VP Server (JSON Command Port)',
      welcomeData(clientId, 'json'),
    )
    responseSender.sendTo(socket, welcomeResponse)

    socket.on('data', async (data) => {
      const messages = data.toString().split('\n')
      for (let message of messages) {
        const trimmedMessage = message.trim()
        if (!trimmedMessage) continue

        try {
          logger.info(
            `JSON TCP message received from ${clientId}: ${trimmedMessage}`,
          )

          // Validate: must be JSON format on JSON port
          try {
            JSON.parse(trimmedMessage)
          } catch (parseError) {
            const errorResponse = TcpResponse.error(
              'format_error',
              'Invalid JSON format. Simple commands not allowed on JSON TCP port. Use Simple TCP port instead.',
              'FORMAT_ERROR',
            )
            responseSender.sendTo(socket, errorResponse)
            continue
          }

          // dispatcher가 표준 TcpResponse(성공/에러)를 반환 — 모든 명령에 응답.
          const response = await handleMessage(trimmedMessage)
          responseSender.sendTo(socket, response)
        } catch (error) {
          logger.error(
            `Error handling JSON TCP message from ${clientId}:`,
            error,
          )
          responseSender.sendTo(
            socket,
            TcpResponse.error('unknown', error, 'EXECUTION_ERROR'),
          )
        }
      }
    })

    socket.on('end', () => {
      logger.info(`JSON TCP client disconnected: ${clientId}`)
      tcpClients = tcpClients.filter((c) => c !== socket)
      responseSender = new TcpResponseSender(tcpClients)
    })

    socket.on('error', (err) => {
      logger.error(`JSON TCP client error (${clientId}):`, err)
      tcpClients = tcpClients.filter((c) => c !== socket)
      responseSender = new TcpResponseSender(tcpClients)
    })
  })

  jsonTcpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `JSON TCP port ${port} is already in use. Trying alternative port...`,
      )
      const altPort = port + 1
      logger.info(`Attempting to start JSON TCP server on port ${altPort}`)
      pStatus.tcpJsonPort = altPort
      jsonTcpServer = null
      setTimeout(() => startJsonTcpServer(altPort), 1000)
    } else if (err.code === 'EACCES') {
      logger.error(
        `Permission denied for JSON TCP port ${port}. JSON TCP server disabled.`,
      )
      logger.info(
        'Application will continue without JSON TCP server functionality.',
      )
      jsonTcpServer = null
    } else {
      logger.error(`JSON TCP server error:`, err)
      jsonTcpServer = null
    }
  })

  jsonTcpServer.listen(port, '0.0.0.0', () => {
    logger.info(`JSON TCP server listening on port ${port}`)
  })
}

// Legacy compatibility: start both servers
function startTcpServer(
  simplePort = pStatus.tcpSimplePort,
  jsonPort = pStatus.tcpJsonPort,
) {
  startSimpleTcpServer(simplePort)
  startJsonTcpServer(jsonPort)
}

// Enhanced broadcast functions
function broadcastEvent(eventType, data = {}) {
  if (responseSender) {
    responseSender.broadcastEvent(eventType, data)
  }
}

function broadcastResponse(response) {
  if (responseSender) {
    responseSender.broadcast(response)
  }
}

// Get current response sender for external use
function getResponseSender() {
  return responseSender
}

export {
  startTcpServer,
  startSimpleTcpServer,
  startJsonTcpServer,
  broadcastEvent,
  broadcastResponse,
  getResponseSender,
  TCP_EVENTS,
}
