import express from 'express'
import filesRouter from './files/index.js'
import playerRouter from './player/index.js'
import statusRouter from './status/index.js'
import playlistRouter from './playlist/index.js'
import timelineRouter from './timeline/index.js'

const router = express.Router()
router.use('/files', filesRouter)
router.use('/player', playerRouter)
router.use('/status', statusRouter)
router.use('/playlist', playlistRouter)
router.use('/timeline', timelineRouter)

export default router
