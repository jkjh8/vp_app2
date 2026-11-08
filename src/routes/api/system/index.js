// 시스템(앱 수준) REST — Windows 시작 시 자동 실행 토글, 웹 소프트웨어 업데이트.
// 자동실행 실체(HKCU Run 키, 관리자 권한 불필요)는 api/system/autostart.js,
// 업데이트(암호화 패키지 검증·교체)는 api/system/update.js가 담당한다.

import express from 'express'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { getAutostart, setAutostart } from '../../../api/system/autostart.js'
import {
  getUpdateStatus,
  stageUpdate,
  applyUpdate,
  cancelUpdate,
  uploadTmpPath,
} from '../../../api/system/update.js'
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

// --- 소프트웨어 업데이트 ---
const updateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.dirname(uploadTmpPath())
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir))
    },
    filename: (req, file, cb) => cb(null, path.basename(uploadTmpPath())),
  }),
})

// 오류 코드 → HTTP 상태 (UI는 code로 안내 문구를 고른다)
const UPDATE_ERROR_STATUS = {
  BUSY: 409,
  NOT_STAGED: 409,
  NOT_PACKAGED: 400,
  NO_WRITE_PERMISSION: 403,
  BAD_PACKAGE: 400,
  DECRYPT_FAILED: 400,
}
const sendUpdateError = (res, e) =>
  res
    .status(UPDATE_ERROR_STATUS[e.code] || 500)
    .json({ error: e.message, code: e.code || 'ERROR' })

router.get('/update/status', (req, res) => {
  res.status(200).json(getUpdateStatus())
})

// 패키지 업로드 + 복호화·검증 (적용은 별도 /update/apply — UI 확인 후)
router.post('/update/upload', updateUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required', code: 'NO_FILE' })
  try {
    res.status(200).json({ staged: await stageUpdate(req.file.path), current: getUpdateStatus().version })
  } catch (e) {
    sendUpdateError(res, e)
  }
})

router.post('/update/apply', (req, res) => {
  try {
    res.status(202).json(applyUpdate())
  } catch (e) {
    logger.error(`update apply: ${e.message}`)
    sendUpdateError(res, e)
  }
})

router.delete('/update', (req, res) => {
  try {
    cancelUpdate()
    res.status(200).json({ result: true })
  } catch (e) {
    sendUpdateError(res, e)
  }
})

export default router
