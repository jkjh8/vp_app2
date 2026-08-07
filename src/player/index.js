import { spawn } from 'child_process'
import { createConnection } from 'net'
import { statSync } from 'fs'
import { logger } from '../logger/index.js'
import { app } from '../runtime.js'
import path from 'path'
import parser from './parser.js'
import pStatus from '../pStatus.js'

let player = null
let socket = null
let playerPort = 1300
let reconnectTimer = null
// 의도적 재시작 플래그 — true인 동안 player 'close'가 app.quit()을 하지 않게 막는다
// (하드웨어 가속 토글 등 기동 시에만 반영되는 설정 변경 시 플레이어만 재기동).
let restarting = false

// 디스플레이 설정(pStatus.display) → vplayer.exe CLI 인자.
// 프로세스 시작 시점에 창 위치가 확정돼야 초기 프레임부터 올바른 모니터에 뜬다
// (연결 후 set_display로 재배치하면 잘못된 위치에 잠깐 보였다가 이동하는 깜빡임 발생).
const buildDisplayArgs = () => {
  const d = pStatus.display
  return [
    `--monitor=${d.monitorIndex}`,
    `--x=${d.x}`,
    `--y=${d.y}`,
    `--width=${d.width}`,
    `--height=${d.height}`,
    `--aspect=${d.aspectMode}`,
  ]
}

const mtimeMs = (p) => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return -1
  }
}

const resolveNativePlayer = () => {
  if (process.env.NODE_ENV === 'development') {
    const gstRoot =
      process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ||
      'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64' // MSI 기본 설치 경로 폴백
    const gstBin = path.join(gstRoot, 'bin')

    // 개발 플레이어 선택 우선순위:
    //  1) VP_PLAYER_EXE — 명시 지정 (시스템 GStreamer 필요 가정)
    //  2) dist 번들(../vp_player/dist/player, 패키징과 동일 = gst 자체 동봉)과
    //     build/Debug(직접 빌드 = 시스템 gst) 중 "더 최근에 빌드된" 쪽 자동 선택.
    //     → 앱 개발자는 최신 dist를, 플레이어 개발자는 갓 빌드한 Debug를 쓰게 되어
    //       구버전이 뜨는 문제를 방지한다.
    if (process.env.VP_PLAYER_EXE) {
      return { exe: process.env.VP_PLAYER_EXE, args: buildDisplayArgs(), extraPath: gstBin }
    }
    const distExe = path.resolve('../vp_player/dist/player/vplayer.exe')
    const debugExe = path.resolve('../vp_player/build/Debug/vplayer.exe')
    const distT = mtimeMs(distExe)
    const debugT = mtimeMs(debugExe)
    // dist가 존재하고 Debug보다 오래되지 않았으면 dist(자체 동봉 → 시스템 gst PATH 불필요)
    if (distT >= 0 && distT >= debugT) {
      return { exe: distExe, args: buildDisplayArgs(), extraPath: null }
    }
    // 그 외(Debug가 더 최신이거나 dist 부재) → build/Debug + 시스템 GStreamer bin 주입
    return { exe: debugExe, args: buildDisplayArgs(), extraPath: gstBin }
  }
  // 배포: player/vplayer.exe + 동봉된 gst-bundle (vplayer가 스스로 GST_PLUGIN_PATH 설정)
  const appDir = path.dirname(process.resourcesPath || app.getPath('exe'))
  return {
    exe: path.join(appDir, 'player', 'vplayer.exe'),
    args: buildDisplayArgs(),
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
  const { exe, args, extraPath } = resolveNativePlayer()

  logger.info(`Player exe: ${exe}`)
  logger.info(`App path: ${appPath}`)

  player = spawn(exe, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      ...(extraPath ? { PATH: `${extraPath};${process.env.PATH}` } : {}),
      APP_PATH: appPath,
      // 하드웨어 가속은 무조건 우선 — 지원 시 GPU(d3d11), 미지원 시 자동 소프트웨어 폴백.
      // 사용자 토글 없음(설정엔 지원 여부만 표시). 플레이어가 d3d11 프로브로 실효값 보고.
      VP_HWACCEL: '1',
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
    // 플레이어의 진짜 오류는 stdout JSON({type:'error'})으로 parser를 타고 온다. stderr는 대부분
    // GLib/GStreamer 자체 진단 노이즈다. 알려진 무해 패턴(비치명적 g_critical/warning)은 debug로
    // 강등해 로그를 깔끔하게 유지하고, 그 외(실제 크래시/스택 등)만 error로 남긴다.
    // 대표 노이즈: 덱 빌드 시 오디오 mix-matrix(converter-config) 적용에서 나오는
    //   gst_structure_set: assertion 'IS_MUTABLE (...)' failed — 재생 무영향(GStreamer가 무시).
    const NOISE =
      /IS_MUTABLE|GStreamer-CRITICAL|GStreamer-WARNING|GLib(-GObject)?-(CRITICAL|WARNING)/
    for (const raw of data.toString().split('\n')) {
      const line = raw.trim()
      if (!line) continue // 빈 줄 무시
      if (NOISE.test(line)) logger.debug(`Player stderr(noise): ${line}`)
      else logger.error(`Player stderr: ${line}`)
    }
  })

  player.on('error', (error) => {
    logger.error(`Failed to start player: ${error.message}`)
  })

  player.on('close', (code) => {
    logger.warn(`Player process exited with code: ${code}`)
    player = null
    playerPort = null
    if (socket) {
      socket.destroy()
      socket = null
    }
    if (restarting) {
      // 의도적 재시작 — 앱을 종료하지 않고 플레이어만 다시 띄운다 (restartPlayer가 respawn).
      logger.info('Player closed for intentional restart — not quitting app.')
      return
    }
    // 플레이어가 종료되면 전체 애플리케이션 종료
    logger.info('Player window closed, shutting down application...')
    app.quit()
  })

  logger.info(`Player started with PID: ${player.pid}`)
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
    logger.warn('Player process is not running.')
    return
  }

  player.kill()
  player = null
  playerPort = null
  logger.info('Player process has been terminated.')
}

// 소켓이 연결돼 실제로 플레이어에 명령을 보낼 수 있는 상태인지 (재생 커맨드 전 사전 확인용)
const isPlayerConnected = () => !!socket && !socket.destroyed

const playerSend = (command) => {
  if (!isPlayerConnected()) {
    logger.warn('Socket not connected to player.')
    return false
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
  return true
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

// 플레이어만 재시작 (앱 유지). 기동 시에만 반영되는 엔진 설정(하드웨어 가속 등) 변경 시 사용.
// stop_all + 장면 상태 정리 후 kill → 잠깐 대기(장치/GL 해제) → 재기동. 재기동된 플레이어의
// capabilities 핸들러가 창/프리롤/마스터볼륨/채널지연을 자동 복원한다.
const restartPlayer = async (reason = '') => {
  logger.info(`Restarting player process (${reason})`)
  restarting = true
  try {
    playerSend({ command: 'stop_all' })
  } catch (e) {
    logger.warn(`restartPlayer stop_all failed: ${e}`)
  }
  try {
    const { resetScenes } = await import('../api/playlists/index.js')
    resetScenes()
  } catch (e) {
    logger.warn(`restartPlayer resetScenes failed: ${e}`)
  }
  stopPlayer()
  await new Promise((r) => setTimeout(r, 400)) // OS가 창/GL/오디오 장치를 해제할 시간
  startPlayer()
  // 새 프로세스의 정상 종료(사용자 창 닫기 등)는 다시 app.quit 되어야 하므로 플래그 해제.
  setTimeout(() => {
    restarting = false
  }, 800)
}

export {
  startPlayer,
  stopPlayer,
  restartPlayer,
  playerSend,
  playerRequest,
  resolvePlayerResult,
  isPlayerConnected,
}
