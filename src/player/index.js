import { spawn } from 'child_process'
import { logger } from '../logger/index.js'
import path from 'path'
import parser from './parser.js'

let player
const startPlayer = () => {
  let playerPath
  if (process.env.NODE_ENV === 'development') {
    // 개발 환경: src/player/lib/player.exe 사용
    playerPath = path.resolve(
      '../player_csharp/player/bin/x64/Release/net8.0-windows',
      'player.exe',
    )
  } else {
    // 빌드(배포) 환경: 실행파일과 같은 위치의 player 폴더 사용
    playerPath = path.join('player', 'player.exe')
  }

  player = spawn(playerPath, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  player.stdout.on('data', (data) => {
    parser(data.toString().trim())
  })
  player.stderr.on('data', (data) => {
    logger.error(`Player stderr: ${data}`)
  })
  player.on('close', (code) => {
    logger.info(`Player process exited with code: ${code}`)
  })
  logger.info(`Player started at: ${playerPath}`)
}

const playerSend = (command) => {
  const message = JSON.stringify(command)
  player.stdin.write(message + '\n', (err) => {
    if (err) {
      logger.error(`Error sending command to player: ${err}`)
    } else {
      logger.info(`Command sent to player: ${message}`)
    }
  })
}

export { startPlayer, playerSend }
