// 시스템(앱 수준) 설정 REST — 현재는 Windows 시작 시 자동 실행 토글.
// 자동실행 실체(작업 스케줄러)는 api/system/autostart.js가 담당한다.

import express from 'express'
import { getAutostart, setAutostart } from '../../../api/system/autostart.js'
import { logger } from '../../../logger/index.js'

const router = express.Router()

router.get('/autostart', async (req, res) => {
  try {
    res.status(200).json(await getAutostart())
  } catch (e) {
    logger.error(`autostart get: ${e}`)
    res.status(500).json({ error: 'Failed to get autostart' })
  }
})

router.put('/autostart', async (req, res) => {
  try {
    const v = req.body?.value ?? req.body?.enabled
    const on = v === true || v === 'true' || v === '1'
    res.status(200).json(await setAutostart(on))
  } catch (e) {
    logger.error(`autostart set: ${e}`)
    res.status(500).json({ error: 'Failed to set autostart', detail: String(e.stderr || e.message || e) })
  }
})

export default router
