import express from 'express'
import {
  playId,
  play,
  stop,
  pause,
  setFullscreen,
  setBackground,
  getAudioDevices,
  setAudioDevice,
  getDisplays,
  setDisplay,
  setRepeat,
  setNext,
  setPrevious,
} from '../../../api/player/index.js'
import {
  listWindows,
  createWindow,
  updateWindow,
  deleteWindow,
  setPreloadConfig,
  setChannelDelays,
} from '../../../api/player/windows.js'
import { configureSync } from '../../../api/player/peerSync.js'
import pStatus from '../../../pStatus.js'
import { logger } from '../../../logger/index.js'

const router = express.Router()

// id가 없을 때는 그냥 플레이, id가 있으면 db에서 검색해서 파일위치와 함께 전송
router.get('/play_id/:id', async (req, res) => {
  try {
    const result = await playId(Number(req.params.id))
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while playing media:', error)
    res.status(500).json({ error: 'Failed to play media' })
  }
})

router.get('/play/:id', async (req, res) => {
  try {
    const result = await play(Number(req.params.id))
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while playing media:', error)
    res.status(500).json({ error: 'Failed to play media' })
  }
})

router.get('/stop', (req, res) => {
  try {
    const result = stop()
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while stopping media:', error)
    res.status(500).json({ error: 'Failed to stop media' })
  }
})

router.get('/pause/:id', async (req, res) => {
  try {
    const result = await pause(Number(req.params.id))
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while pausing media:', error)
    res.status(500).json({ error: 'Failed to pause media' })
  }
})

router.get('/fullscreen/:value', async (req, res) => {
  try {
    const value = req.params.value.toLowerCase()
    if (value !== 'true' && value !== 'false') {
      return res.status(400).json({ error: 'Invalid value for fullscreen' })
    }
    const result = await setFullscreen(value === 'true')
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting fullscreen mode:', error)
    res.status(500).json({ error: 'Failed to set fullscreen mode' })
  }
})

router.post('/background', async (req, res) => {
  try {
    const result = await setBackground(req.body.color)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting background color:', error)
    res.status(500).json({ error: 'Failed to set background color' })
  }
})

router.put('/setaudiodevice', async (req, res) => {
  try {
    const result = await setAudioDevice(req.body.deviceId)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting audio device:', error)
    res.status(500).json({ error: 'Failed to set audio device' })
  }
})

router.get('/repeat', async (req, res) => {
  try {
    const mode = await setRepeat()
    res.status(200).json({ message: `Repeat mode set to: ${mode}`, mode })
  } catch (error) {
    logger.error('Error occurred while setting repeat mode:', error)
    res.status(500).json({ error: 'Failed to set repeat mode' })
  }
})

router.get('/next', async (req, res) => {
  try {
    const result = await setNext()
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting next track:', error)
    res.status(500).json({ error: 'Failed to set next track' })
  }
})

router.get('/prev', async (req, res) => {
  try {
    const result = await setPrevious()
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting previous track:', error)
    res.status(500).json({ error: 'Failed to set previous track' })
  }
})

router.get('/audio_devices', (req, res) => {
  try {
    const result = getAudioDevices()
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while fetching audio devices:', error)
    res.status(500).json({ error: 'Failed to fetch audio devices' })
  }
})

router.get('/displays', (req, res) => {
  try {
    const result = getDisplays()
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while fetching displays:', error)
    res.status(500).json({ error: 'Failed to fetch displays' })
  }
})

router.put('/display', async (req, res) => {
  try {
    const result = await setDisplay(req.body)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting display:', error)
    res.status(500).json({ error: 'Failed to set display' })
  }
})

// --- 멀티 윈도우(v3) 출력 창 설정 -------------------------------------------
router.get('/windows', (req, res) => {
  res.status(200).json(listWindows())
})

router.post('/windows', async (req, res) => {
  try {
    const win = await createWindow(req.body || {})
    res.status(200).json({ window: win })
  } catch (error) {
    logger.error('Error creating window:', error)
    res.status(500).json({ error: 'Failed to create window' })
  }
})

router.put('/windows/:id', async (req, res) => {
  try {
    const win = await updateWindow(req.params.id, req.body || {})
    if (!win) return res.status(404).json({ error: 'window not found' })
    res.status(200).json({ window: win })
  } catch (error) {
    logger.error('Error updating window:', error)
    res.status(500).json({ error: 'Failed to update window' })
  }
})

router.delete('/windows/:id', async (req, res) => {
  try {
    await deleteWindow(req.params.id)
    res.status(200).json({ ok: true })
  } catch (error) {
    logger.error('Error deleting window:', error)
    res.status(500).json({ error: 'Failed to delete window' })
  }
})

router.put('/preload', async (req, res) => {
  try {
    const result = await setPreloadConfig(req.body || {})
    res.status(200).json(result)
  } catch (error) {
    logger.error('Error setting preload config:', error)
    res.status(500).json({ error: 'Failed to set preload config' })
  }
})

// 출력 채널별 오디오 지연(ms)
router.put('/channel_delays', async (req, res) => {
  try {
    const result = await setChannelDelays(req.body?.delays || [])
    res.status(200).json({ delays: result })
  } catch (error) {
    logger.error('Error setting channel delays:', error)
    res.status(500).json({ error: 'Failed to set channel delays' })
  }
})

// --- 멀티 PC 클럭 동기(v3 Phase 5) --------------------------------------------
router.get('/sync', (req, res) => {
  res.status(200).json(pStatus.sync)
})

router.put('/sync', async (req, res) => {
  try {
    const result = await configureSync(req.body || {})
    res.status(200).json(result)
  } catch (error) {
    logger.error('Error configuring sync:', error)
    res.status(500).json({ error: 'Failed to configure sync' })
  }
})

export default router
