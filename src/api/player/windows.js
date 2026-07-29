// 멀티 윈도우(v3) 출력 창 설정 관리.
// 사용자 정의 창 목록(pStatus.windows)을 dbStatus에 영속하고, 생성/삭제/재배치를 플레이어에
// create_window/destroy_window/set_display로 반영한다. 창 0(주 창)은 플레이어가 자동 생성하므로
// 여기서는 설정만 저장하고 명령은 보내지 않는다.

import { dbStatus } from '../../db/index.js'
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

const nextWindowId = () => {
  const ids = new Set((pStatus.windows || []).map((w) => w.id))
  let id = 1
  while (ids.has(id)) id++
  return id
}

const normalize = (cfg = {}, id) => ({
  id,
  name: cfg.name || `Window ${id}`,
  monitorIndex: Number.isInteger(cfg.monitorIndex) ? cfg.monitorIndex : -1,
  x: Number.isFinite(cfg.x) ? cfg.x : 0,
  y: Number.isFinite(cfg.y) ? cfg.y : 0,
  width: Number.isFinite(cfg.width) ? cfg.width : 0,
  height: Number.isFinite(cfg.height) ? cfg.height : 0,
  aspectMode: cfg.aspectMode || 'letterbox',
  backgroundColor: cfg.backgroundColor || '#000000',
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
  if (id !== 0) {
    playerSend({
      command: 'create_window',
      window_id: id,
      monitor_index: win.monitorIndex,
      x: win.x,
      y: win.y,
      width: win.width,
      height: win.height,
      aspect_mode: win.aspectMode,
    })
    if (win.backgroundColor)
      playerSend({ command: 'background_color', window_id: id, color: win.backgroundColor })
    playerSend({ command: 'get_windows' })
  }
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
  })
  if (patch.backgroundColor)
    playerSend({ command: 'background_color', window_id: id, color: win.backgroundColor })
  return win
}

const deleteWindow = async (id) => {
  id = Number(id)
  pStatus.windows = (pStatus.windows || []).filter((w) => w.id !== id)
  await persistWindows()
  if (id !== 0) {
    playerSend({ command: 'destroy_window', window_id: id })
    playerSend({ command: 'get_windows' })
  }
  logger.info(`Window config deleted: ${id}`)
  return true
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

export { listWindows, createWindow, updateWindow, deleteWindow, setPreloadConfig }
