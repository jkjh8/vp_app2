// 멀티 윈도우(v3) 출력 창 설정 관리.
// 사용자 정의 창 목록(pStatus.windows)을 dbStatus에 영속하고, 생성/삭제/재배치를 플레이어에
// create_window/destroy_window/set_display로 반영한다. 창 0(주 창)은 플레이어가 자동 생성하므로
// 여기서는 설정만 저장하고 명령은 보내지 않는다.

import { dbStatus, dbPlaylists } from '../../db/index.js'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { playerSend } from '../../player/index.js'
import { ioClient } from '../../web/index.js'

const persistWindows = async () => {
  await dbStatus.update(
    { type: 'windows' },
    { $set: { value: pStatus.windows } },
    { upsert: true },
  )
  ioClient.emit('pStatus', { windows: pStatus.windows })
}

const persistPresets = async () => {
  await dbStatus.update(
    { type: 'windowPresets' },
    { $set: { value: pStatus.windowPresets } },
    { upsert: true },
  )
  ioClient.emit('pStatus', { windowPresets: pStatus.windowPresets })
}

const nextPresetId = () => {
  const ids = (pStatus.windowPresets || []).map((p) => p.id)
  return (ids.length ? Math.max(...ids) : 0) + 1
}

// 현재 배치가 어느 프리셋과 일치하는지 표시용. 프리셋 적용/저장/덮어쓰기 시 그 프리셋으로 설정하고,
// 창을 직접 편집(생성/수정/삭제)하면 배치가 어긋나므로 null로 해제한다.
const setActivePreset = async (id) => {
  const next = id == null ? null : Number(id)
  if (pStatus.activePresetId === next) return
  pStatus.activePresetId = next
  await dbStatus.update({ type: 'activePreset' }, { $set: { value: next } }, { upsert: true })
  ioClient.emit('pStatus', { activePresetId: next })
}

const nextWindowId = () => {
  const ids = new Set((pStatus.windows || []).map((w) => w.id))
  let id = 1 // 주 창(0) 개념 폐지 — id는 1부터
  while (ids.has(id)) id++
  return id
}

// 기본 출력 모니터 — 비주(non-primary) 모니터가 있으면 그쪽(제어 화면과 분리), 없으면 주 모니터.
const defaultMonitorIndex = () => {
  const d = pStatus.displays || []
  const sec = d.find((m) => !m.primary)
  return sec ? sec.index : -1
}

const normalize = (cfg = {}, id) => ({
  id,
  name: cfg.name || `Window ${id}`,
  monitorIndex: Number.isInteger(cfg.monitorIndex) ? cfg.monitorIndex : defaultMonitorIndex(),
  x: Number.isFinite(cfg.x) ? cfg.x : 0,
  y: Number.isFinite(cfg.y) ? cfg.y : 0,
  width: Number.isFinite(cfg.width) ? cfg.width : 0,
  height: Number.isFinite(cfg.height) ? cfg.height : 0,
  aspectMode: cfg.aspectMode || 'letterbox',
  backgroundColor: cfg.backgroundColor || '#000000',
  zOrder: Number.isInteger(cfg.zOrder) ? cfg.zOrder : 0, // 겹칠 때 쌓임 순서 (클수록 앞)
})

const listWindows = () => ({
  windows: pStatus.windows || [],
  playerWindows: pStatus.playerWindows || [],
})

const createWindow = async (cfg = {}) => {
  const id = Number.isInteger(cfg.id) ? cfg.id : nextWindowId()
  const win = normalize(cfg, id)
  pStatus.windows = [
    ...(pStatus.windows || []).filter((w) => w.id !== id),
    win,
  ].sort((a, b) => a.id - b.id)
  await persistWindows()
  // 주 창 개념 폐지 — 모든 창은 명시 생성. id는 1부터.
  playerSend({
    command: 'create_window',
    window_id: id,
    monitor_index: win.monitorIndex,
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
    aspect_mode: win.aspectMode,
    z_order: win.zOrder,
  })
  if (win.backgroundColor)
    playerSend({ command: 'background_color', window_id: id, color: win.backgroundColor })
  playerSend({ command: 'get_windows' })
  await setActivePreset(null) // 직접 편집 → 현재 배치가 프리셋과 어긋남
  logger.info(`Window config created: ${id} (${win.name})`)
  return win
}

const updateWindow = async (id, patch = {}) => {
  id = Number(id)
  const idx = (pStatus.windows || []).findIndex((w) => w.id === id)
  if (idx < 0) return null
  const win = normalize({ ...pStatus.windows[idx], ...patch }, id)
  pStatus.windows[idx] = win
  await persistWindows()
  // 라이브 재배치 + 배경 (창 0 포함)
  playerSend({
    command: 'set_display',
    window_id: id,
    monitor_index: win.monitorIndex,
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
    aspect_mode: win.aspectMode,
    z_order: win.zOrder,
  })
  if (patch.backgroundColor)
    playerSend({ command: 'background_color', window_id: id, color: win.backgroundColor })
  await setActivePreset(null) // 직접 편집 → 현재 배치가 프리셋과 어긋남
  return win
}

const deleteWindow = async (id) => {
  id = Number(id)
  pStatus.windows = (pStatus.windows || []).filter((w) => w.id !== id)
  await persistWindows()
  await setActivePreset(null) // 직접 편집 → 현재 배치가 프리셋과 어긋남
  playerSend({ command: 'destroy_window', window_id: id })
  playerSend({ command: 'get_windows' })
  // 데이터 정리: 삭제된 창을 참조하던 클립을 전 플레이리스트에서 제거 (창 수 축소 시 오류 방지).
  // 클립이 모두 빈 장면(트랙)은 제거.
  try {
    const playlists = await dbPlaylists.find({})
    for (const pl of playlists) {
      let changed = false
      const tracks = (pl.tracks || [])
        .map((t) => {
          if (!Array.isArray(t.clips)) return t
          const kept = t.clips.filter((c) => (Number.isInteger(c.window) ? c.window : 0) !== id)
          if (kept.length !== t.clips.length) changed = true
          return { ...t, clips: kept }
        })
        .filter((t) => !Array.isArray(t.clips) || t.clips.length > 0)
      if (changed || tracks.length !== (pl.tracks || []).length) {
        await dbPlaylists.update({ _id: pl._id }, { $set: { tracks } })
      }
    }
  } catch (e) {
    logger.error(`window delete cleanup failed: ${e}`)
  }
  logger.info(`Window config deleted: ${id} (clips referencing it removed)`)
  return true
}

// 출력 채널별 오디오 지연(ms) 설정 — 영속 + 플레이어 적용
const setChannelDelays = async (delays) => {
  const arr = (Array.isArray(delays) ? delays : []).map((d) => Math.max(0, Number(d) || 0))
  pStatus.channelDelays = arr
  await dbStatus.update({ type: 'channelDelays' }, { $set: { value: arr } }, { upsert: true })
  playerSend({ command: 'set_channel_delays', delays: arr })
  ioClient.emit('pStatus', { channelDelays: arr })
  return arr
}

const setPreloadConfig = async ({ lookahead, maxDecks } = {}) => {
  if (Number.isInteger(lookahead)) pStatus.preloadLookahead = lookahead
  if (Number.isInteger(maxDecks)) pStatus.preloadMaxDecks = maxDecks
  await dbStatus.update(
    { type: 'preload' },
    { $set: { value: { lookahead: pStatus.preloadLookahead, maxDecks: pStatus.preloadMaxDecks } } },
    { upsert: true },
  )
  playerSend({
    command: 'set_preload_config',
    lookahead: pStatus.preloadLookahead,
    max_decks: pStatus.preloadMaxDecks,
  })
  ioClient.emit('pStatus', {
    preloadLookahead: pStatus.preloadLookahead,
    preloadMaxDecks: pStatus.preloadMaxDecks,
  })
  return { lookahead: pStatus.preloadLookahead, maxDecks: pStatus.preloadMaxDecks }
}

// --- 화면 구성 프리셋 -------------------------------------------------------
// 프리셋 = 현재 출력 창 배치(windows)의 이름 붙은 스냅샷. 저장/목록/적용/이름변경/삭제.

const listPresets = () => pStatus.windowPresets || []

// 현재 windows 배치를 새 프리셋으로 저장 (깊은 복사 스냅샷).
const savePreset = async (name) => {
  const id = nextPresetId()
  const preset = {
    id,
    name: (name && String(name).trim()) || `Layout ${id}`,
    windows: JSON.parse(JSON.stringify(pStatus.windows || [])),
    createdAt: Date.now(),
  }
  pStatus.windowPresets = [...(pStatus.windowPresets || []), preset]
  await persistPresets()
  await setActivePreset(id) // 방금 저장 = 현재 배치가 이 프리셋과 일치
  logger.info(`Window preset saved: ${id} (${preset.name})`)
  return preset
}

// 기존 프리셋을 현재 배치로 덮어쓰기 (재스냅샷).
const updatePreset = async (id) => {
  const p = (pStatus.windowPresets || []).find((x) => x.id === Number(id))
  if (!p) return null
  p.windows = JSON.parse(JSON.stringify(pStatus.windows || []))
  p.updatedAt = Date.now()
  await persistPresets()
  await setActivePreset(p.id) // 현재 배치로 덮어씀 = 일치
  return p
}

const renamePreset = async (id, name) => {
  const p = (pStatus.windowPresets || []).find((x) => x.id === Number(id))
  if (!p) return null
  const trimmed = String(name || '').trim()
  if (trimmed) p.name = trimmed
  await persistPresets()
  return p
}

const deletePreset = async (id) => {
  pStatus.windowPresets = (pStatus.windowPresets || []).filter((p) => p.id !== Number(id))
  await persistPresets()
  if (pStatus.activePresetId === Number(id)) await setActivePreset(null)
  return true
}

// 프리셋 적용: 현재 창을 전부 파괴하고 프리셋의 창 배치로 재생성.
const applyPreset = async (id) => {
  const preset = (pStatus.windowPresets || []).find((p) => p.id === Number(id))
  if (!preset) return null
  // 1. 현재 창 전부 파괴
  for (const w of pStatus.windows || []) {
    playerSend({ command: 'destroy_window', window_id: w.id })
  }
  // 2. 프리셋 창으로 교체 (정규화, 저장된 id 유지)
  const next = (preset.windows || []).map((w, i) =>
    normalize(w, Number.isInteger(w.id) ? w.id : i + 1),
  )
  pStatus.windows = next
  await persistWindows()
  // 3. 프리셋 창 생성 + 배경/z 적용
  for (const win of next) {
    playerSend({
      command: 'create_window',
      window_id: win.id,
      monitor_index: win.monitorIndex,
      x: win.x,
      y: win.y,
      width: win.width,
      height: win.height,
      aspect_mode: win.aspectMode,
      z_order: win.zOrder,
    })
    if (win.backgroundColor)
      playerSend({ command: 'background_color', window_id: win.id, color: win.backgroundColor })
  }
  playerSend({ command: 'get_windows' })
  await setActivePreset(preset.id) // 적용 = 현재 배치가 이 프리셋
  logger.info(`Window preset applied: ${preset.id} (${preset.name}) — ${next.length} windows`)
  return preset
}

export {
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
}
