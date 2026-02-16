import net from 'net'
import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { handleMessage } from '../api/terminal/index.js'
import {
  TcpResponse,
  TcpResponseSender,
  TCP_EVENTS,
} from '../utils/tcpResponse.js'

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
      {
        serverId: 'vp_app2',
        version: '0.1.8',
        clientId,
        port: 'simple',
        format: 'comma-separated',
        capabilities: ['player', 'playlist', 'files', 'status'],
      },
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
            )
            responseSender.sendTo(socket, errorResponse)
            continue
          }

          // Parse command from simple format
          const parts = trimmedMessage.split(',')
          const command = parts[0] || 'unknown'

          const result = await handleMessage(trimmedMessage)

          // 이벤트가 아닌 쿼리/설정 명령어만 응답 전송 (중복 방지)
          const queryCommands = [
            'getfiles',
            'getplaylists',
            'getplaylist',
            'getrepeat',
            'getaudiodevices',
            'getaudiodevice',
            'setrepeat',
            'setaudiodevice',
            'updatetime',
            'fullscreen',
            'togglefullscreen',
          ]
          if (queryCommands.includes(command.toLowerCase())) {
            responseSender.respondToCommand(socket, command, result)
          }
        } catch (error) {
          logger.error(
            `Error handling Simple TCP message from ${clientId}:`,
            error,
          )
          responseSender.respondToCommand(socket, 'unknown', null, error)
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
      {
        serverId: 'vp_app2',
        version: '0.1.8',
        clientId,
        port: 'json',
        format: 'json',
        capabilities: ['player', 'playlist', 'files', 'status'],
      },
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
          let command = 'unknown'
          try {
            const parsed = JSON.parse(trimmedMessage)
            command = parsed.command || 'unknown'
          } catch (parseError) {
            const errorResponse = TcpResponse.error(
              'format_error',
              'Invalid JSON format. Simple commands not allowed on JSON TCP port. Use Simple TCP port instead.',
            )
            responseSender.sendTo(socket, errorResponse)
            continue
          }

          const result = await handleMessage(trimmedMessage)

          // 이벤트가 아닌 쿼리/설정 명령어만 응답 전송 (중복 방지)
          const queryCommands = [
            'getfiles',
            'getplaylists',
            'getplaylist',
            'getrepeat',
            'getaudiodevices',
            'getaudiodevice',
            'setrepeat',
            'setaudiodevice',
            'updatetime',
            'fullscreen',
            'togglefullscreen',
          ]
          if (queryCommands.includes(command.toLowerCase())) {
            responseSender.respondToCommand(socket, command, result)
          }
        } catch (error) {
          logger.error(
            `Error handling JSON TCP message from ${clientId}:`,
            error,
          )
          responseSender.respondToCommand(socket, 'unknown', null, error)
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
