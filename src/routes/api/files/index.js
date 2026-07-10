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
    // rmSync(force): 폴더가 이미 없어도 통과 — 디스크/DB가 어긋난 유령 문서도 지울 수 있게.
    // (rmdirSync는 deprecated + 부재 경로에서 throw → DB 문서가 영구히 남는 문제)
    const fileDir = path.join(getMediaPath(), uuid)
    fs.rmSync(fileDir, { recursive: true, force: true })
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

// 파일 ID 중복 검사
router.get('/check-id/:id', async (req, res) => {
  const { id } = req.params
  try {
    // ID가 숫자이거나 문자열일 수 있음
    const existingFile = await dbFiles.findOne({ id: id })
    res.status(200).json({ exists: !!existingFile, id })
  } catch (error) {
    logger.error(`Error checking file ID: ${error}`)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 파일 ID 변경
router.put('/:uuid/id', async (req, res) => {
  const { uuid } = req.params
  const { newId } = req.body

  try {
    if (!newId) {
      return res.status(400).json({ error: 'New ID is required' })
    }

    // ID 형식 검증: 영문, 숫자, 언더스코어, 하이폰 허용
    const idRegex = /^[a-zA-Z0-9_-]+$/
    if (!idRegex.test(newId)) {
      return res.status(400).json({
        error:
          'Invalid ID format. Only alphanumeric characters, underscores, and hyphens are allowed.',
      })
    }

    // 현재 파일 찾기
    const currentFile = await dbFiles.findOne({ uuid })
    if (!currentFile) {
      return res.status(404).json({ error: 'File not found' })
    }

    // 중복 검사
    const existingFile = await dbFiles.findOne({ id: newId })
    if (existingFile && existingFile.uuid !== uuid) {
      return res.status(409).json({ error: 'ID already exists' })
    }

    // ID 업데이트
    await dbFiles.update({ uuid }, { $set: { id: newId } }, {})

    logger.info(
      `File ID updated: ${currentFile.id || currentFile.number} -> ${newId}`,
    )
    res.status(200).json({
      message: 'File ID updated successfully',
      uuid,
      oldId: currentFile.id || currentFile.number,
      newId,
    })
  } catch (error) {
    logger.error(`Error updating file ID: ${error}`)
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
