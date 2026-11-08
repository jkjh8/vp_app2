import express from 'express'
import { logger } from '../../../logger/index.js'
import {
  getFolders,
  createFolder,
  renameFolder,
  deleteFolderRecursive,
} from '../../../api/folders/index.js'

const router = express.Router()

// 폴더 목록(플랫). 클라이언트가 parentId로 트리를 구성한다.
router.get('/', async (req, res) => {
  try {
    const folders = await getFolders()
    res.status(200).json(folders)
  } catch (error) {
    logger.error(`Error fetching folders: ${error}`)
    res.status(500).json({ error: 'Failed to fetch folders' })
  }
})

router.post('/', async (req, res) => {
  try {
    const folder = await createFolder(req.body)
    res.status(201).json(folder)
  } catch (error) {
    logger.error(`Error creating folder: ${error}`)
    res.status(error.status || 500).json({ error: error.message || 'Failed to create folder' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const folder = await renameFolder(req.params.id, req.body.name)
    res.status(200).json(folder)
  } catch (error) {
    logger.error(`Error renaming folder: ${error}`)
    res.status(error.status || 500).json({ error: error.message || 'Failed to rename folder' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteFolderRecursive(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error deleting folder: ${error}`)
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete folder' })
  }
})

export default router
