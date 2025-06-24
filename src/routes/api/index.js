import express from 'express'
import filesRouter from './files/index.js'
import playerRouter from './player/index.js'

const router = express.Router()
router.use('/files', filesRouter)
router.use('/player', playerRouter)

export default router
