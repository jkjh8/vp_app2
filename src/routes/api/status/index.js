import express from 'express'
import pStatus from '../../../pStatus.js'
import { logger } from '../../../logger/index.js'
import { dbStatus } from '../../../db/index.js'
import { updateStatusFromDb } from '../../../api/status/index.js'
import { asyncHandler } from '../../../utils/errorHandler.js'

const router = express.Router()

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // updateStatusFromDb()는 pStatus를 갱신만 하고 반환값이 없음(기존엔 빈 바디 응답 버그)
    await updateStatusFromDb()
    res.json({ pStatus })
  }),
)

router.post('/update', async (req, res) => {
  try {
    const { key, value } = req.body
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' })
    }

    pStatus[key] = value
    await dbStatus.update({ type: key }, { $set: { value } }, { upsert: true })
    logger.info(`Status updated: ${key} = ${value}`)
    res
      .status(200)
      .json({ result: true, message: `Status updated: ${key} = ${value}` })
  } catch (error) {
    logger.error(`Error updating status: ${error.message}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

export default router
