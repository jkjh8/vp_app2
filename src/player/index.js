import { spawn } from 'child_process'
import { createConnection } from 'net'
import { logger } from '../logger/index.js'
import { app } from '../runtime.js'
import path from 'path'
import parser from './parser.js'
import pStatus from '../pStatus.js'

let player = null
let socket = null
let playerPort = 1300
let reconnectTimer = null

// 플레이어 엔진 선택: 'native' = C++/GStreamer vplayer.exe, 'python' = 레거시 PySide6
// 프로토콜(루프백 TCP NDJSON + stdout 포트 핸드셰이크)이 동일해 드롭인 교체 가능
const playerEngine = process.env.VP_PLAYER_ENGINE || 'native'

const resolveNativePlayer = () => {
  if (process.env.NODE_ENV === 'development') {
    // 개발: 형제 리포 vp_player의 빌드 산출물 + 시스템 GStreamer bin을 PATH에 주입
    const exe =
      process.env.VP_PLAYER_EXE ||
      path.resolve('../vp_player/build/Debug/vplayer.exe')
    const gstRoot =
      process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ||
      'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64' // MSI 기본 설치 경로 폴백
    return { exe, args: [], extraPath: path.join(gstRoot, 'bin') }
  }
  // 배포: player/vplayer.exe + 동봉된 gst-bundle (vplayer가 스스로 GST_PLUGIN_PATH 설정)
  const appDir = path.dirname(process.resourcesPath || app.getPath('exe'))
  return { exe: path.join(appDir, 'player', 'vplayer.exe'), args: [], extraPath: null }
}

const resolvePythonPlayer = () => {
  if (process.env.NODE_ENV === 'development') {
    return {
      exe: path.resolve('player_python/python-embed/python.exe'),
      args: [path.resolve('player_python/player.py')],
      extraPath: null,
    }
  }
  const appDir = path.dirname(process.resourcesPath || app.getPath('exe'))
  return {
    exe: path.join(appDir, 'player', 'python-embed', 'python.exe'),
    args: [path.join(appDir, 'player', 'player.py')],
    extraPath: null,
  }
}

const startPlayer = () => {
  if (player) {
    logger.warn('Player process is already running.')
    return
  }

  const appPath =
    process.env.NODE_ENV === 'development'
      ? path.resolve('.')
      : path.dirname(process.resourcesPath || app.getPath('exe'))
  const { exe, args, extraPath } =
    playerEngine === 'native' ? resolveNativePlayer() : resolvePythonPlayer()

  logger.info(`Player engine: ${playerEngine}`)
  logger.info(`Player exe: ${exe}`)
  logger.info(`App path: ${appPath}`)

  player = spawn(exe, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      ...(extraPath ? { PATH: `${extraPath};${process.env.PATH}` } : {}),
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

// --- 요청/응답 (probe_media, make_thumbnail 등) ---------------------------------
// 플레이어에 req_id를 붙여 명령을 보내고, 대응하는 *_result 피드백이 오면 resolve.
// 피드백 라우팅은 parser.js가 resolvePlayerResult를 호출해 처리한다.
let reqSeq = 0
const pendingRequests = new Map()

const playerRequest = (command, args = {}, timeoutMs = 30000) => {
  return new Promise((resolve) => {
    if (!socket || socket.destroyed) {
      resolve({ ok: false, error: 'player not connected' })
      return
    }
    const req_id = ++reqSeq
    const timer = setTimeout(() => {
      if (pendingRequests.has(req_id)) {
        pendingRequests.delete(req_id)
        logger.warn(`playerRequest '${command}' timed out (req_id=${req_id})`)
        resolve({ ok: false, error: 'timeout' })
      }
    }, timeoutMs)
    pendingRequests.set(req_id, (data) => {
      clearTimeout(timer)
      resolve(data)
    })
    playerSend({ command, req_id, ...args })
  })
}

// parser.js가 probe_result / thumbnail_result 수신 시 호출
const resolvePlayerResult = (data) => {
  if (!data || data.req_id == null) return
  const cb = pendingRequests.get(data.req_id)
  if (cb) {
    pendingRequests.delete(data.req_id)
    cb(data)
  }
}

export { startPlayer, stopPlayer, playerSend, playerRequest, resolvePlayerResult }
