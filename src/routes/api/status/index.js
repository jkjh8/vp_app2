import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import pStatus from '../../../pStatus.js'
import { logger } from '../../../logger/index.js'
import { dbStatus } from '../../../db/index.js'
import { getLogoPath } from '../../../api/files/folders.js'
import { updateStatusFromDb } from '../../../api/status/index.js'
import {
  setPlaylistImageTimeout,
  setLogoFile,
  showLogo,
  setLogoSize,
} from '../../api/player/index.js'

const router = express.Router()

const uploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, getLogoPath())
    },
    filename: (req, file, cb) => {
      cb(null, decodeURIComponent(file.fieldname))
    },
  }),
})

router.get('/', async (req, res) => {
  try {
    res.json(await updateStatusFromDb())
  } catch (error) {
    logger.error(`Error updating status: ${error.message}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

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

router.get('/image_time/:time', async (req, res) => {
  try {
    res.status(200).json({
      result: true,
      message: await setPlaylistImageTimeout(Number(req.params.time)),
      pStatus,
    })
  } catch (error) {
    logger.error(`Error setting image time: ${error.message}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// logo functions
router.get('/logo', async (req, res) => {
  try {
    res.status(200).json(await fs.promises.readdir(getLogoPath()))
  } catch (error) {
    logger.error(`Error getting logo: ${error.message}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.post('/logo', uploader.any(), async (req, res) => {
  try {
    const files = req.files
    res.status(200).json({
      result: true,
      message: 'Logo uploaded successfully',
      files,
    })
  } catch (error) {
    logger.error(`Error uploading logo: ${error.message}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.get('/logo/img/:filename', (req, res) => {
  try {
    const { filename } = req.params
    const filePath = path.join(getLogoPath(), decodeURIComponent(filename))
    res.sendFile(filePath)
  } catch (error) {
    logger.error(`Error getting logo image: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.delete('/logo/:filename', async (req, res) => {
  const { filename } = req.params
  const filePath = path.join(getLogoPath(), decodeURIComponent(filename))
  // 파일을 지울때 pStatus.logo.file == filename 이면 pStatus.logo.file = ''
  if (pStatus.logo.file === decodeURIComponent(filename)) {
    pStatus.logo.file = ''
    //db에서도 삭제
    await dbStatus.update({ type: 'logo' }, { $set: { file: '' } })
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      logger.error(`Error deleting logo file: ${err}`)
      return res.status(500).json({ error: 'Internal Server Error' })
    }
    res.json({ message: 'Logo file deleted successfully' })
  })
})

router.get('/logo/sel/:filename', async (req, res) => {
  try {
    res.status(200).json({
      result: true,
      message: await setLogoFile(decodeURIComponent(req.params.filename)),
      pStatus,
    })
  } catch (error) {
    logger.error(`Error selecting logo: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.get('/logo/show/:show', async (req, res) => {
  try {
    res.status(200).json({
      result: true,
      message: await showLogo(req.params.show === 'true'),
      pStatus,
    })
  } catch (error) {
    logger.error(`Error showing logo: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.put('/logo/size', async (req, res) => {
  try {
    res.status(200).json({
      result: true,
      message: await setLogoSize(req.body.size),
      pStatus,
    })
  } catch (error) {
    logger.error(`Error setting logo size: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

export default router
