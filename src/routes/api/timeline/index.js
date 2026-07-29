import express from 'express'
import { logger } from '../../../logger/index.js'
import {
  getTimelines,
  getTimeline,
  createTimeline,
  updateTimeline,
  deleteTimeline,
  timelinePlay,
  timelinePause,
  timelineSeek,
  timelineStop,
} from '../../../api/timelines/index.js'

const router = express.Router()

// --- CRUD -------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    res.status(200).json(await getTimelines())
  } catch (error) {
    logger.error(`Error fetching timelines: ${error}`)
    res.status(500).json({ error: 'Failed to fetch timelines' })
  }
})

router.post('/', async (req, res) => {
  try {
    res.status(201).json(await createTimeline(req.body))
  } catch (error) {
    logger.error(`Error creating timeline: ${error}`)
    res.status(500).json({ error: 'Failed to create timeline' })
  }
})

router.put('/', async (req, res) => {
  try {
    res.status(200).json(await updateTimeline(req.body))
  } catch (error) {
    logger.error(`Error updating timeline: ${error}`)
    res.status(500).json({ error: 'Failed to update timeline' })
  }
})

// --- 트랜스포트 (정적 라우트를 :id 앞에 둔다) --------------------------------
router.get('/play', async (req, res) => {
  try {
    const { timelineId, time } = req.query
    const result = await timelinePlay(timelineId, time !== undefined ? Number(time) : undefined)
    res.status(200).json({ result })
  } catch (error) {
    logger.error(`Error playing timeline: ${error}`)
    res.status(500).json({ error: 'Failed to play timeline' })
  }
})

router.get('/pause', (req, res) => {
  res.status(200).json({ result: timelinePause() })
})

router.get('/stop', async (req, res) => {
  res.status(200).json({ result: await timelineStop() })
})

router.put('/seek', (req, res) => {
  res.status(200).json({ result: timelineSeek(req.body?.time_ms ?? req.body?.time) })
})

// --- 개별 조회/삭제 (동적 :id 는 마지막) ------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const doc = await getTimeline(req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timeline not found' })
    res.status(200).json(doc)
  } catch (error) {
    logger.error(`Error fetching timeline: ${error}`)
    res.status(500).json({ error: 'Failed to fetch timeline' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    res.status(200).json({ result: await deleteTimeline(req.params.id) })
  } catch (error) {
    logger.error(`Error deleting timeline: ${error}`)
    res.status(500).json({ error: 'Failed to delete timeline' })
  }
})

export default router
