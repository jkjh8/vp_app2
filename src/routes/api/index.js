import express from 'express'
import filesRouter from './files/index.js'
import foldersRouter from './folders/index.js'
import playerRouter from './player/index.js'
import statusRouter from './status/index.js'
import playlistRouter from './playlist/index.js'
import timelineRouter from './timeline/index.js'
import fleetRouter from './fleet/index.js'
import sourcesRouter from './sources/index.js'
import systemRouter from './system/index.js'

const router = express.Router()
router.use('/files', filesRouter)
router.use('/folders', foldersRouter)
router.use('/player', playerRouter)
router.use('/status', statusRouter)
router.use('/playlist', playlistRouter)
router.use('/timeline', timelineRouter)
router.use('/fleet', fleetRouter) // 멀티 PC 마스터 콘솔 (디스커버리/프록시/쇼)
router.use('/sources', sourcesRouter) // 라이브 입력 소스(RTP/RTSP/SRT) 정의
router.use('/system', systemRouter) // 앱 수준 설정 (시작 시 자동 실행 등)

export default router
