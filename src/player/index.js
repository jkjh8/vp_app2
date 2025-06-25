import { spawn } from 'child_process'
import { app } from 'electron'
import { logger } from '../logger/index.js'
import path from 'path'
import pStatus from '../pStatus.js'
import parser from './parser.js'

let player
const startPlayer = () => {
  // C:\Users\kjh\Desktop\DEV\player\player\bin\Release\net8.0-windows
  const playerPath = path.resolve(
    '../player/player/bin/Release/net8.0-windows',
    'player.exe',
  )
  player = spawn(playerPath, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  player.stdout.on('data', (data) => {
    logger.info(`Player stdout: ${data}`)
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
