import express from 'express'
import pStatus from '../../../pStatus.js'
import { logger } from '../../../logger/index.js'
import { dbStatus } from '../../../db/index.js'
import { updateStatusFromDb } from '../../../api/status/index.js'
import { asyncHandler } from '../../../utils/errorHandler.js'

const router = express.Router()

const PORT_KEYS = ['webPort', 'tcpSimplePort', 'tcpJsonPort']

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // updateStatusFromDb()는 pStatus를 갱신만 하고 반환값이 없음
    await updateStatusFromDb()
    res.json({ pStatus })
  }),
)

// 이미지 기본 표시 시간(초, 1~60) 설정
router.get(
  '/image_time/:value',
  asyncHandler(async (req, res) => {
    const n = Number(req.params.value)
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      return res.status(400).json({ error: 'Image time must be an integer between 1 and 60' })
    }
    pStatus.imageTime = n
    await dbStatus.update({ type: 'imageTime' }, { $set: { value: n } }, { upsert: true })
    logger.info(`Image time updated: ${n}s`)
    res.json({ pStatus })
  }),
)

router.post('/update', async (req, res) => {
  try {
    const { key, value } = req.body
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' })
    }

    // 포트는 다시 시작해야 적용되므로 실행 중 값(디스커버리·업데이트 헬퍼가 사용)은 바꾸지 않는다
    if (PORT_KEYS.includes(key)) {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return res.status(400).json({ error: 'Port must be an integer between 1 and 65535' })
      }
    } else {
      pStatus[key] = value
    }
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
