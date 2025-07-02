import net from 'net'
import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { handleMessage } from '../api/terminal/index.js'

let tcpServer = null
let tcpClients = []

function startTcpServer(port = pStatus.tcpPort) {
  tcpServer = net.createServer((socket) => {
    logger.info(
      `TCP client connected: ${socket.remoteAddress}:${socket.remotePort}`,
    )
    tcpClients.push(socket)
    socket.write('Welcome to the TCP server!\n')

    socket.on('data', (data) => {
      logger.info(`TCP data received: ${data}`)
      handleMessage(data.toString())
      // 여기에 데이터 처리 로직 추가
    })

    socket.on('end', () => {
      logger.info('TCP client disconnected')
      tcpClients = tcpClients.filter((c) => c !== socket)
    })

    socket.on('error', (err) => {
      logger.error('TCP client error:', err)
      tcpClients = tcpClients.filter((c) => c !== socket)
    })
  })

  tcpServer.listen(port, () => {
    logger.info(`TCP server listening on port ${port}`)
  })
}

function broadcastTcpMessage(message) {
  tcpClients.forEach((client) => {
    client.write(message + '\n')
  })
}

function broadcastTcpJson(json) {
  const message = JSON.stringify(json)
  tcpClients.forEach((client) => {
    client.write(message + '\n')
  })
}

export { startTcpServer, broadcastTcpMessage, broadcastTcpJson }
