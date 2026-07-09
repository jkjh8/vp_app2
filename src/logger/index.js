import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import path from 'path'
import { app } from '../runtime.js'
import fs from 'fs'

const { combine, timestamp, printf, colorize } = winston.format
winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  verbose: 'magenta',
  silly: 'cyan',
})

let logger = null
const initLogger = () => {
  // 로그 디렉토리를 사용자 데이터 폴더로 설정
  // Windows: C:\Users\{username}\AppData\Roaming\VP App\logs
  const logDir = app.getPath('logs')

  // 로그 디렉토리가 없으면 생성
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  console.log(`Log directory: ${logDir}`)
  logger = winston.createLogger({
    level: 'debug', // Changed from 'info' to 'debug'
    levels: {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    },
    format: combine(
      timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
      printf(function ({ timestamp, level, message, stack }) {
        return timestamp + ' [' + level + ']: ' + message + ' ' + (stack || '')
      }),
    ),
    transports: [
      new winston.transports.Console({
        format: combine(colorize({ all: true })),
      }),
      new DailyRotateFile({
        filename: path.join(logDir, 'application-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxFiles: 30,
      }),
    ],
  })
  return logger
}

export { initLogger, logger }
export default logger
