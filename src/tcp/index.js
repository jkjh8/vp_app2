import net from 'net'
import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { handleMessage } from '../api/terminal/index.js'
import {
  TcpResponse,
  TcpResponseSender,
  TCP_EVENTS,
} from '../utils/tcpResponse.js'

let tcpServer = null
let tcpClients = []
let responseSender = null

function startTcpServer(port = pStatus.tcpPort) {
  if (tcpServer) {
    logger.warn('TCP server is already running')
    return
  }

  // Initialize response sender
  responseSender = new TcpResponseSender(tcpClients)

  tcpServer = net.createServer((socket) => {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`
    logger.info(`TCP client connected: ${clientId}`)

    tcpClients.push(socket)
    responseSender = new TcpResponseSender(tcpClients) // Update sender with new client list

    // Send welcome message
    const welcomeResponse = TcpResponse.success(
      'connect',
      'Connected to VP Server',
      {
        serverId: 'vp_app2',
        version: '0.1.8',
        clientId,
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
            `TCP message received from ${clientId}: ${trimmedMessage}`,
          )

          // Parse command from message
          let command = 'unknown'
          try {
            const parsed = JSON.parse(trimmedMessage)
            command = parsed.command || 'unknown'
          } catch {
            // If not JSON, try to extract command from simple format
            const parts = trimmedMessage.split(',')
            command = parts[0] || 'unknown'
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
            'imagetime',
            'updatetime',
            'fullscreen',
            'togglefullscreen',
          ]
          if (queryCommands.includes(command.toLowerCase())) {
            responseSender.respondToCommand(socket, command, result)
          }
        } catch (error) {
          logger.error(`Error handling TCP message from ${clientId}:`, error)
          responseSender.respondToCommand(socket, 'unknown', null, error)
        }
      }
    })

    socket.on('end', () => {
      logger.info(`TCP client disconnected: ${clientId}`)
      tcpClients = tcpClients.filter((c) => c !== socket)
      responseSender = new TcpResponseSender(tcpClients) // Update sender
    })

    socket.on('error', (err) => {
      logger.error(`TCP client error (${clientId}):`, err)
      tcpClients = tcpClients.filter((c) => c !== socket)
      responseSender = new TcpResponseSender(tcpClients) // Update sender
    })
  })

  tcpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`TCP port ${port} is already in use. Trying alternative port...`)
      // 다른 포트로 재시도 (원래 포트 + 1)
      const altPort = port + 1
      logger.info(`Attempting to start TCP server on port ${altPort}`)
      pStatus.tcpPort = altPort
      tcpServer = null
      setTimeout(() => startTcpServer(altPort), 1000)
    } else if (err.code === 'EACCES') {
      logger.error(`Permission denied for TCP port ${port}. TCP server disabled.`)
      logger.info('Application will continue without TCP server functionality.')
      tcpServer = null
    } else {
      logger.error(`TCP server error:`, err)
      tcpServer = null
    }
  })

  tcpServer.listen(port, '0.0.0.0', () => {
    logger.info(`TCP server listening on port ${port}`)
  })
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
  broadcastEvent,
  broadcastResponse,
  getResponseSender,
  TCP_EVENTS,
}
