import express from 'express'
import path from 'path'
import { app } from 'electron'
import { logger } from '../logger/index.js'
import apiRouter from './api/index.js'

const router = express.Router()
router.get('/', (req, res) => {
  try {
    const publicPath = path.join(app.getAppPath(), 'public')
    res.sendFile(path.join(publicPath, 'spa', 'index.html'))
  } catch (error) {
    logger.error(`Error in root route: ${error.message}`)
    res.status(500).send('Internal Server Error')
  }
})

router.use('/api', apiRouter)

export default router
