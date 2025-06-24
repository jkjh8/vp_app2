import express from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { logger } from '../../../logger/index.js'
import { dbFiles } from '../../../db/index.js'
import {
  postProcessFiles,
  resetAllMediaFiles,
} from '../../../api/files/index.js'
import { getTmpPath, getMediaPath } from '../../../api/files/folders.js'

const router = express.Router()

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, getTmpPath())
    },
    filename: (req, file, cb) => {
      cb(null, decodeURIComponent(file.fieldname))
    },
  }),
})

router.get('/', async (req, res) => {
  try {
    const files = await dbFiles.find({})
    res.json(files)
  } catch (error) {
    logger.error(`Error fetching files: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.post('/', upload.any(), async (req, res) => {
  try {
    const files = req.files
    await postProcessFiles(files)
    return res
      .status(200)
      .json({ message: 'Files processed successfully', files })
  } catch (error) {
    logger.error(`Error processing files: ${error}`)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 섬네일 파일을 요청하면 보내주기
router.get('/thumbnail/:uuid', async (req, res) => {
  const { uuid } = req.params
  try {
    const file = await dbFiles.findOne({ uuid })
    res.sendFile(file.thumbnail)
  } catch (error) {
    logger.error(`Error fetching thumbnail: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 파일 삭제
router.delete('/:uuid', async (req, res) => {
  const { uuid } = req.params
  try {
    const file = await dbFiles.findOne({ uuid })
    // Delete the uuid folder from the filesystem
    const fileDir = path.join(getMediaPath(), uuid)
    fs.rmdirSync(fileDir, { recursive: true, force: true }) // This will delete the directory and its contents
    // Delete the file record from the database
    await dbFiles.remove({ uuid })
    res.status(200).json({ message: 'File deleted successfully' })
  } catch (error) {
    logger.error(`Error deleting file: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 파일 다운로드
router.get('/download/:uuid', async (req, res) => {
  const { uuid } = req.params
  try {
    const file = await dbFiles.findOne({ uuid })
    const filePath = path.join(getMediaPath(), uuid, file.filename)
    res.download(filePath)
  } catch (error) {
    logger.error(`Error fetching file for download: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

router.get('/reset_all', async (req, res) => {
  try {
    // 모든 파일의 reserved 상태를 false로 변경
    await resetAllMediaFiles()
    res.status(200).json({ message: 'All media files reset successfully' })
  } catch (error) {
    logger.error(`Error resetting all media files: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

export default router
