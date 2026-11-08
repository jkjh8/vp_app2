// 라이브 입력 소스(RTP/RTSP/SRT) REST — 파일과 별개 축. 목록/생성/수정/삭제.
// 창 귀속(sourceId)은 /api/player/windows 가 담당하고, 여기서는 소스 정의만 다룬다.
// 소스 수정/삭제 시 그 소스를 귀속한 창을 라이브 재적용/해제하도록 windows 계층을 조율한다.

import express from 'express'
import {
  listSources,
  getSource,
  createSource,
  updateSource,
  deleteSource,
} from '../../../api/player/sources.js'
import { reapplySource, detachSource } from '../../../api/player/windows.js'
import { logger } from '../../../logger/index.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    res.status(200).json(await listSources())
  } catch (e) {
    logger.error(`sources list: ${e}`)
    res.status(500).json({ error: 'Failed to list sources' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const src = await getSource(req.params.id)
    if (!src) return res.status(404).json({ error: 'not found' })
    res.status(200).json(src)
  } catch (e) {
    logger.error(`sources get: ${e}`)
    res.status(500).json({ error: 'Failed to get source' })
  }
})

router.post('/', async (req, res) => {
  try {
    const src = await createSource(req.body || {})
    res.status(201).json(src)
  } catch (e) {
    logger.error(`sources create: ${e}`)
    res.status(500).json({ error: 'Failed to create source' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const src = await updateSource(req.params.id, req.body || {})
    if (!src) return res.status(404).json({ error: 'not found' })
    await reapplySource(src.id) // 이 소스를 쓰는 창들 라이브 갱신
    res.status(200).json(src)
  } catch (e) {
    logger.error(`sources update: ${e}`)
    res.status(500).json({ error: 'Failed to update source' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await detachSource(req.params.id) // 귀속 창 해제 + clear 발신 (삭제 전)
    await deleteSource(req.params.id)
    res.status(200).json({ ok: true })
  } catch (e) {
    logger.error(`sources delete: ${e}`)
    res.status(500).json({ error: 'Failed to delete source' })
  }
})

export default router
