import { spawn } from 'child_process'
import { createConnection } from 'net'
import { logger } from '../logger/index.js'
import { app } from 'electron'
import path from 'path'
import parser from './parser.js'
import pStatus from '../pStatus.js'

let player = null
let socket = null
let playerPort = 1300
let reconnectTimer = null

const startPlayer = () => {
  if (player) {
    logger.warn('Python player process is already running.')
    return
  }

  let pythonPath
  let scriptPath
  let appPath

  if (process.env.NODE_ENV === 'development') {
    // 개발 환경: 상대 경로의 venv 사용
    pythonPath = path.resolve(
      '../vp_app2/player_python/.venv/Scripts/python.exe',
    )
    scriptPath = path.resolve('../vp_app2/player_python/player.py')
    appPath = path.resolve('../vp_app2')
  } else {
    // 빌드(배포) 환경: extraFiles는 resources 상위 폴더에 복사됨
    // win-unpacked/resources/ <- process.resourcesPath
    // win-unpacked/player/    <- extraFiles 위치
    const appDir = path.dirname(process.resourcesPath || app.getPath('exe'))
    logger.info(`App directory: ${appDir}`)
    pythonPath = path.join(appDir, 'player', '.venv', 'Scripts', 'python.exe')
    scriptPath = path.join(appDir, 'player', 'player.py')
    appPath = appDir
  }

  logger.info(`Python path: ${pythonPath}`)
  logger.info(`Script path: ${scriptPath}`)
  logger.info(`App path: ${appPath}`)
  logger.info(`Resource path: ${process.resourcesPath}`)

  player = spawn(pythonPath, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      VP_PSTATUS: JSON.stringify(pStatus),
      APP_PATH: appPath,
    },
  })

  // stdout에서 포트 번호 읽기
  player.stdout.on('data', (data) => {
    const output = data.toString().trim()
    if (output) {
      try {
        const lines = output.split('\n')
        for (const line of lines) {
          const json = JSON.parse(line)
          if (json.type === 'port' && json.data && json.data.port) {
            playerPort = json.data.port
            logger.info(`Player TCP port: ${playerPort}`)
            connectToPlayer()
          } else {
            // 다른 메시지들은 parser로 전달
            parser(line)
          }
        }
      } catch (e) {
        logger.warn(`Failed to parse player output: ${output}`)
      }
    }
  })

  player.stderr.on('data', (data) => {
    logger.error(`Player stderr: ${data}`)
  })

  player.on('error', (error) => {
    logger.error(`Failed to start player: ${error.message}`)
  })

  player.on('close', (code) => {
    logger.warn(`Player process exited with code: ${code}`)
    logger.info('Player window closed, shutting down application...')
    player = null
    playerPort = null
    if (socket) {
      socket.destroy()
      socket = null
    }
    // 플레이어가 종료되면 전체 애플리케이션 종료
    app.quit()
  })

  logger.info(`Python player started with PID: ${player.pid}`)
}

const connectToPlayer = () => {
  if (!playerPort) {
    logger.error('Player port not available yet')
    return
  }

  if (socket) {
    logger.warn('Socket already connected')
    return
  }

  socket = createConnection({ host: '127.0.0.1', port: playerPort }, () => {
    logger.info(`Connected to player on port ${playerPort}`)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    // Check for auto-start playlist
    if (pStatus.startOnPlay && pStatus.startOnPlaylistId) {
      logger.info(
        `Auto-starting playlist ${pStatus.startOnPlaylistId} (Boot on Play enabled)`,
      )
      // Import playlistPlay dynamically to avoid circular dependency
      import('../api/playlists/index.js')
        .then(({ playlistPlay }) => {
          setTimeout(() => {
            playlistPlay(pStatus.startOnPlaylistId, 0)
          }, 1000) // 1초 대기 후 실행 (플레이어 초기화 완료 대기)
        })
        .catch((error) => {
          logger.error(`Failed to auto-start playlist: ${error}`)
        })
    }
  })

  let buffer = ''

  socket.on('data', (data) => {
    buffer += data.toString()

    // 줄 단위로 메시지 처리
    while (buffer.includes('\n')) {
      const lineEnd = buffer.indexOf('\n')
      const line = buffer.substring(0, lineEnd).trim()
      buffer = buffer.substring(lineEnd + 1)

      if (line) {
        parser(line)
      }
    }
  })

  socket.on('error', (error) => {
    logger.error(`Socket error: ${error.message}`)
  })

  socket.on('close', () => {
    logger.warn('Socket connection closed')
    socket = null

    // 플레이어가 여전히 실행 중이면 재연결 시도
    if (player && playerPort) {
      reconnectTimer = setTimeout(() => {
        logger.info('Attempting to reconnect to player...')
        connectToPlayer()
      }, 1000)
    }
  })
}

const stopPlayer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (socket) {
    socket.destroy()
    socket = null
  }

  if (!player) {
    logger.warn('Python player process is not running.')
    return
  }

  player.kill()
  player = null
  playerPort = null
  logger.info('Python player process has been terminated.')
}

const playerSend = (command) => {
  if (!socket || socket.destroyed) {
    logger.warn('Socket not connected to player.')
    return
  }

  // Remove undefined values from command
  Object.keys(command).forEach((key) => {
    if (command[key] === undefined) {
      delete command[key]
    }
  })

  const message = JSON.stringify(command) + '\n'

  socket.write(message, (err) => {
    if (err) {
      logger.error(`Error sending command to player: ${err}`)
    } else {
      logger.info(`Command sent to player: ${message.trim()}`)
    }
  })
}

export { startPlayer, stopPlayer, playerSend }
