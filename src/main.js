import { app, onShutdown } from './runtime.js'
import { initLogger, logger } from './logger/index.js'
import { initDb } from './db/index.js'
import { updateStatusFromDb, cleanupLegacyStatus } from './api/status/index.js'
import { initWebServer } from './web/index.js'
import { setupFFmpeg } from './api/files/index.js'
import {
  existsMediaPath,
  existsTmpPath,
} from './api/files/folders.js'
import { startTcpServer } from './tcp/index.js'
import { startPlayer, stopPlayer } from './player/index.js'
import { initSync } from './api/player/peerSync.js'
import { initDiscovery } from './api/player/discovery.js'

// 종료 시 플레이어 프로세스 정리 (Electron 생명주기 대체)
onShutdown(() => stopPlayer())
process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())

// 중복 실행 방지
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    initLogger()
    logger.debug('Logger initialized')
    existsMediaPath()
    existsTmpPath()
    logger.debug('Media and tmp paths checked or created')
    initDb()
    logger.debug('Database initialized')
    await cleanupLegacyStatus() // 폐기된 로고 status 레코드/폴더 1회 정리 (updateStatusFromDb 경고 방지)
    await updateStatusFromDb()
    logger.debug('Status updated from database')
    initSync() // 멀티 PC 동기 설정 복원 (role!=standalone이면 트리거 소켓 구성)
    setupFFmpeg()
    initWebServer()
    // 자동 디스커버리 (ioClient/DB 준비된 뒤) — slave 광고 / master 수집
    initDiscovery().catch((e) => logger.warn(`initDiscovery failed: ${e.message}`))

    // TCP 서버는 선택적으로 시작 (실패해도 앱 계속 실행)
    try {
      startTcpServer()
    } catch (error) {
      logger.error('Failed to start TCP server:', error)
      logger.info(
        'Application will continue without TCP terminal functionality',
      )
    }

    startPlayer()
  })
}
