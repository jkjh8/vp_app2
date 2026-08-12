import express from 'express'
import {
  play,
  stop,
  pause,
  setFullscreen,
  setBackground,
  getAudioDevices,
  setAudioDevice,
  setHardwareAcceleration,
  setMasterVolume,
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
  listPresets,
  savePreset,
  updatePreset,
  renamePreset,
  deletePreset,
  applyPreset,
} from '../../../api/player/windows.js'
import { configureSync, awaitRunningTime } from '../../../api/player/peerSync.js'
import pStatus from '../../../pStatus.js'
import { logger } from '../../../logger/index.js'

const router = express.Router()

// 단일 파일 직접 재생(playid) REST는 폐지 — 플레이어 출력은 플레이리스트(장면/윈도우)로만 구동하고
// Files는 브라우저 미리보기(/api/files/raw)만 제공한다. (TCP 외부제어 playid는 레거시로 유지.)
// windowId(쿼리) 지정 + 윈도우 모드면 그 창만 제어, 아니면 전 창(:id는 레거시 activePlayerId, 미사용)
router.get('/play/:id', async (req, res) => {
  try {
    const wid = req.query.windowId != null ? Number(req.query.windowId) : null
    const result = await play(wid)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while playing media:', error)
    res.status(500).json({ error: 'Failed to play media' })
  }
})

// windowId 지정 = 그 창만 정지 / 미지정 = 전체 정지(Stop All)
router.get('/stop', (req, res) => {
  try {
    const wid = req.query.windowId != null ? Number(req.query.windowId) : null
    const result = stop(wid)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while stopping media:', error)
    res.status(500).json({ error: 'Failed to stop media' })
  }
})

router.get('/pause/:id', async (req, res) => {
  try {
    const wid = req.query.windowId != null ? Number(req.query.windowId) : null
    const result = await pause(wid)
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

// 하드웨어 가속 ('auto'|'on'|'off') — 저장 후 플레이어 재시작으로 적용
router.put('/hwaccel', async (req, res) => {
  try {
    const result = await setHardwareAcceleration(req.body.value)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting hardware acceleration:', error)
    res.status(500).json({ error: 'Failed to set hardware acceleration' })
  }
})

// 전역 마스터 볼륨 — 슬라이더 릴리즈(저장)
router.put('/master_volume', async (req, res) => {
  try {
    const result = await setMasterVolume(req.body.value, true)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting master volume:', error)
    res.status(500).json({ error: 'Failed to set master volume' })
  }
})

// 전역 마스터 볼륨 — 드래그(전송만, 저장 안 함)
router.put('/master_volume/live', async (req, res) => {
  try {
    const result = await setMasterVolume(req.body.value, false)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting master volume (live):', error)
    res.status(500).json({ error: 'Failed to set master volume' })
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
    // 윈도우 모드: 선택된 창만 넘기도록 windowId 전달 (미지정=씬 전 창 / 윈도우 첫 창 폴백)
    const wid = req.query.windowId != null ? Number(req.query.windowId) : null
    const result = await setNext(wid)
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error('Error occurred while setting next track:', error)
    res.status(500).json({ error: 'Failed to set next track' })
  }
})

router.get('/prev', async (req, res) => {
  try {
    const wid = req.query.windowId != null ? Number(req.query.windowId) : null
    const result = await setPrevious(wid)
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

// --- 화면 구성 프리셋 -------------------------------------------------------
router.get('/presets', (req, res) => {
  res.status(200).json({ presets: listPresets() })
})

router.post('/presets', async (req, res) => {
  try {
    const preset = await savePreset(req.body?.name)
    res.status(200).json({ preset })
  } catch (error) {
    logger.error('Error saving preset:', error)
    res.status(500).json({ error: 'Failed to save preset' })
  }
})

router.post('/presets/:id/apply', async (req, res) => {
  try {
    const preset = await applyPreset(req.params.id)
    if (!preset) return res.status(404).json({ error: 'preset not found' })
    res.status(200).json({ preset })
  } catch (error) {
    logger.error('Error applying preset:', error)
    res.status(500).json({ error: 'Failed to apply preset' })
  }
})

// 현재 배치를 기존 프리셋에 덮어쓰기
router.put('/presets/:id', async (req, res) => {
  try {
    const preset =
      req.body?.name !== undefined
        ? await renamePreset(req.params.id, req.body.name)
        : await updatePreset(req.params.id)
    if (!preset) return res.status(404).json({ error: 'preset not found' })
    res.status(200).json({ preset })
  } catch (error) {
    logger.error('Error updating preset:', error)
    res.status(500).json({ error: 'Failed to update preset' })
  }
})

router.delete('/presets/:id', async (req, res) => {
  try {
    await deletePreset(req.params.id)
    res.status(200).json({ ok: true })
  } catch (error) {
    logger.error('Error deleting preset:', error)
    res.status(500).json({ error: 'Failed to delete preset' })
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

// 신선한 공유 러닝타임 스냅샷 (마스터 콘솔 오차 진단이 왕복 측정에 사용).
// get_running_time 왕복으로 플레이어의 현재 PTP running_time/base_time을 갱신해 반환한다.
router.get('/running_time', async (req, res) => {
  try {
    const rt = await awaitRunningTime()
    const p = pStatus.sync.ptp || {}
    res.status(200).json({
      running_time: Number(rt),
      base_time: Number(p.base_time),
      synced: !!p.synced,
      enabled: !!p.enabled,
      at: Date.now(),
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
