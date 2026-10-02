// 멀티 윈도우(v3) 출력 창 설정 관리.
// 사용자 정의 창 목록(pStatus.windows)을 dbStatus에 영속하고, 생성/삭제/재배치를 플레이어에
// create_window/destroy_window/set_display로 반영한다. 창 0(주 창)은 플레이어가 자동 생성하므로
// 여기서는 설정만 저장하고 명령은 보내지 않는다.

import { dbStatus, dbPlaylists } from '../../db/index.js'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { playerSend } from '../../player/index.js'
import { ioClient } from '../../web/index.js'
import { getSource, toEngineSource } from './sources.js'

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
  await dbStatus.update(
    { type: 'activePreset' },
    { $set: { value: next } },
    { upsert: true },
  )
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

// 물리 모니터 고정 식별(재부팅해도 불변) — 플레이어 displays의 key(+폴백 serial). monitorIndex는
// 순번이라 늦게 켜지는 모니터/배치 변경 시 밀린다 → 창 배치는 key 기준, index는 표시/폴백용.
// 키 없는 창(구 설정·주 모니터(-1))은 index 그대로.
const displayByIndex = (idx) =>
  (pStatus.displays || []).find((d) => d.index === idx)
const monitorFields = (cfg, monitorIndex) => {
  if (monitorIndex === -1)
    return { monitorKey: null, monitorSerial: null, monitorName: null }
  if (cfg.monitorKey) {
    return {
      monitorKey: String(cfg.monitorKey),
      monitorSerial: cfg.monitorSerial ? String(cfg.monitorSerial) : null,
      monitorName: cfg.monitorName ? String(cfg.monitorName) : null,
    }
  }
  const d = displayByIndex(monitorIndex)
  return {
    monitorKey: d?.key || null,
    monitorSerial: d?.serial || null,
    monitorName: d?.name || null,
  }
}

const normalize = (cfg = {}, id) => {
  const monitorIndex = Number.isInteger(cfg.monitorIndex)
    ? cfg.monitorIndex
    : defaultMonitorIndex()
  return {
    id,
    name: cfg.name || `Window ${id}`,
    monitorIndex,
    ...monitorFields(cfg, monitorIndex),
    x: Number.isFinite(cfg.x) ? cfg.x : 0,
    y: Number.isFinite(cfg.y) ? cfg.y : 0,
    width: Number.isFinite(cfg.width) ? cfg.width : 0,
    height: Number.isFinite(cfg.height) ? cfg.height : 0,
    aspectMode: cfg.aspectMode || 'letterbox',
    backgroundColor: cfg.backgroundColor || '#000000',
    zOrder: Number.isInteger(cfg.zOrder) ? cfg.zOrder : 0, // 겹칠 때 쌓임 순서 (클수록 앞)
    // 창에 귀속된 라이브 입력 소스 id (dbSources) — 있으면 지속 레이어. 프리셋 스냅샷에 함께 담김.
    sourceId: cfg.sourceId ? String(cfg.sourceId) : null,
    // 오디오 전용 창(화면 송출 없음) — 플레이어가 Win32 창/비디오 그래프 없이 오디오만 재생.
    audioOnly: cfg.audioOnly === true,
    // 창 전용 오디오 출력 디바이스 (audioDevices의 deviceId). null = 전역 디바이스 따름.
    audioDevice: cfg.audioDevice ? String(cfg.audioDevice) : null,
    // 창 오디오 전체 뮤트 (클립/라이브 입력/창 귀속 오디오). 재생 중 즉시 토글 가능.
    muted: cfg.muted === true,
  }
}

// 창 설정 → 플레이어 create_window 명령 (창 생성 경로 전부 이 함수 사용: 설정/프리셋/재기동/장면).
const createWindowCommand = (win) => ({
  command: 'create_window',
  window_id: win.id,
  monitor_index: win.monitorIndex ?? -1,
  x: win.x ?? 0,
  y: win.y ?? 0,
  width: win.width ?? 0,
  height: win.height ?? 0,
  aspect_mode: win.aspectMode ?? 'letterbox',
  z_order: win.zOrder ?? 0,
  ...monitorKeyArgs(win),
  ...(win.audioOnly ? { audio_only: true } : {}),
  ...(win.audioDevice ? { audio_device: win.audioDevice } : {}),
  ...(win.muted ? { muted: true } : {}),
})

// 고정 모니터 식별 인자 (있을 때만) — 플레이어는 key 우선, 미연결이면 창을 숨긴 채 대기.
function monitorKeyArgs(win) {
  if (!win.monitorKey && !win.monitorSerial) return {}
  return {
    monitor_key: win.monitorKey || '',
    monitor_serial: win.monitorSerial || '',
  }
}

// 창에 귀속된 라이브 소스를 플레이어에 적용(set_window_source) 또는 해제(clear_window_source).
// 플레이어 미지원(live_source 미표시) 시 무해(호스트가 명령을 보내도 됨 — 게이트는 복원 경로에만).
const applyWindowSource = async (win) => {
  if (!win) return
  if (win.sourceId) {
    const src = await getSource(win.sourceId)
    if (src)
      playerSend({
        command: 'set_window_source',
        window_id: win.id,
        source: toEngineSource(src),
      })
    else playerSend({ command: 'clear_window_source', window_id: win.id })
  } else {
    playerSend({ command: 'clear_window_source', window_id: win.id })
  }
}

// 소스 편집 시 그 소스를 귀속한 모든 창을 라이브 재적용.
const reapplySource = async (sourceId) => {
  for (const w of pStatus.windows || [])
    if (w.sourceId === sourceId) await applyWindowSource(w)
}

// 소스 삭제 시 그 소스를 귀속한 창의 귀속을 해제(+영속) + 플레이어 clear.
const detachSource = async (sourceId) => {
  let changed = false
  for (const w of pStatus.windows || []) {
    if (w.sourceId === sourceId) {
      w.sourceId = null
      changed = true
      playerSend({ command: 'clear_window_source', window_id: w.id })
    }
  }
  if (changed) await persistWindows()
}

const listWindows = () => ({
  windows: pStatus.windows || [],
  playerWindows: pStatus.playerWindows || [],
})

// 전역 배경색(설정 화면) — 모든 출력 창에 적용하고 각 창의 backgroundColor도 갱신(영속)한다.
// setBackground(api/player)이 window_id 없이 보내면 플레이어는 기본 창 하나에만 칠하므로, 여기서
// 창별로 명령을 보내야 멀티 윈도우 전체가 바뀌고 재시작(창 복원) 후에도 유지된다.
// 창이 하나도 없으면 플레이어 기본 창에 전역 명령만 보낸다(무해).
const applyBackgroundToAll = async (color) => {
  const wins = pStatus.windows || []
  if (!wins.length) {
    playerSend({ command: 'background_color', color })
    return
  }
  for (const w of wins) {
    w.backgroundColor = color
    playerSend({ command: 'background_color', window_id: w.id, color })
  }
  await persistWindows()
}

const createWindow = async (cfg = {}) => {
  const id = Number.isInteger(cfg.id) ? cfg.id : nextWindowId()
  const win = normalize(cfg, id)
  pStatus.windows = [
    ...(pStatus.windows || []).filter((w) => w.id !== id),
    win,
  ].sort((a, b) => a.id - b.id)
  await persistWindows()
  // 주 창 개념 폐지 — 모든 창은 명시 생성. id는 1부터.
  playerSend(createWindowCommand(win))
  if (win.backgroundColor)
    playerSend({
      command: 'background_color',
      window_id: id,
      color: win.backgroundColor,
    })
  playerSend({ command: 'get_windows' })
  if (win.sourceId) await applyWindowSource(win) // 라이브 소스 귀속 시 지속 레이어 부착
  await setActivePreset(null) // 직접 편집 → 현재 배치가 프리셋과 어긋남
  logger.info(`Window config created: ${id} (${win.name})`)
  return win
}

const updateWindow = async (id, patch = {}) => {
  id = Number(id)
  const idx = (pStatus.windows || []).findIndex((w) => w.id === id)
  if (idx < 0) return null
  const prev = pStatus.windows[idx]
  // 모니터를 index로만 바꾼 요청(터미널/구 UI)이면 이전 key를 버리고 새 index에서 key를 다시 딴다.
  const merged = { ...prev, ...patch }
  if (
    'monitorIndex' in patch &&
    !('monitorKey' in patch) &&
    patch.monitorIndex !== prev.monitorIndex
  ) {
    merged.monitorKey = null
    merged.monitorSerial = null
    merged.monitorName = null
  }
  const win = normalize(merged, id)
  pStatus.windows[idx] = win
  await persistWindows()
  // 오디오 전용 전환은 창 종류(Win32 창/비디오 그래프 유무)가, 오디오 디바이스 변경은 창의 출력
  // 버스가 바뀌므로 플레이어 창을 재생성한다. (재생 중 내용은 끊김 — 편집 동작이므로 허용.)
  // 라이브 소스는 재부착. 뮤트는 create_window에 실려 유지된다.
  if (
    win.audioOnly !== prev.audioOnly ||
    (win.audioDevice || null) !== (prev.audioDevice || null)
  ) {
    playerSend({ command: 'destroy_window', window_id: id })
    playerSend(createWindowCommand(win))
    if (win.backgroundColor)
      playerSend({
        command: 'background_color',
        window_id: id,
        color: win.backgroundColor,
      })
    playerSend({ command: 'get_windows' })
    if (win.sourceId) await applyWindowSource(win)
    await setActivePreset(null)
    return win
  }
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
    ...monitorKeyArgs(win),
  })
  if (patch.backgroundColor)
    playerSend({
      command: 'background_color',
      window_id: id,
      color: win.backgroundColor,
    })
  if ('muted' in patch && win.muted !== !!prev.muted)
    playerSend({ command: 'set_window_mute', window_id: id, muted: win.muted })
  if ('sourceId' in patch) await applyWindowSource(win) // 라이브 소스 귀속 변경(설정/해제) 반영
  await setActivePreset(null) // 직접 편집 → 현재 배치가 프리셋과 어긋남
  return win
}

const deleteWindow = async (id) => {
  id = Number(id)
  pStatus.windows = (pStatus.windows || []).filter((w) => w.id !== id)
  await persistWindows()
  // 창별 반복 설정도 정리 (좀비 방지) — 있으면 삭제·영속·emit
  if (pStatus.windowRepeat && id in pStatus.windowRepeat) {
    const rest = { ...pStatus.windowRepeat }
    delete rest[id]
    pStatus.windowRepeat = rest
    await dbStatus.update(
      { type: 'windowRepeat' },
      { $set: { value: rest } },
      { upsert: true },
    )
    ioClient.emit('pStatus', { windowRepeat: rest })
  }
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
          const kept = t.clips.filter(
            (c) => (Number.isInteger(c.window) ? c.window : 0) !== id,
          )
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

// 창 오디오 전체 뮤트 (운영 동작 — 배치 편집이 아니므로 활성 프리셋 표시는 유지). 영속 + 즉시 적용.
const setWindowMute = async (id, muted) => {
  id = Number(id)
  const win = (pStatus.windows || []).find((w) => w.id === id)
  if (!win) return null
  win.muted = muted === true
  await persistWindows()
  playerSend({ command: 'set_window_mute', window_id: id, muted: win.muted })
  logger.info(`Window ${id} audio ${win.muted ? 'muted' : 'unmuted'}`)
  return win
}

// 출력 채널별 오디오 지연(ms) 설정 — 영속 + 플레이어 적용
const setChannelDelays = async (delays) => {
  const arr = (Array.isArray(delays) ? delays : []).map((d) =>
    Math.max(0, Number(d) || 0),
  )
  pStatus.channelDelays = arr
  await dbStatus.update(
    { type: 'channelDelays' },
    { $set: { value: arr } },
    { upsert: true },
  )
  playerSend({ command: 'set_channel_delays', delays: arr })
  ioClient.emit('pStatus', { channelDelays: arr })
  return arr
}

const setPreloadConfig = async ({ lookahead, maxDecks } = {}) => {
  if (Number.isInteger(lookahead)) pStatus.preloadLookahead = lookahead
  if (Number.isInteger(maxDecks)) pStatus.preloadMaxDecks = maxDecks
  await dbStatus.update(
    { type: 'preload' },
    {
      $set: {
        value: {
          lookahead: pStatus.preloadLookahead,
          maxDecks: pStatus.preloadMaxDecks,
        },
      },
    },
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
  return {
    lookahead: pStatus.preloadLookahead,
    maxDecks: pStatus.preloadMaxDecks,
  }
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
  pStatus.windowPresets = (pStatus.windowPresets || []).filter(
    (p) => p.id !== Number(id),
  )
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
    playerSend(createWindowCommand(win))
    if (win.backgroundColor)
      playerSend({
        command: 'background_color',
        window_id: win.id,
        color: win.backgroundColor,
      })
  }
  playerSend({ command: 'get_windows' })
  // 프리셋 스냅샷에 담긴 창별 라이브 소스 귀속을 재부착 (배치+소스가 함께 전환됨)
  for (const win of next) if (win.sourceId) await applyWindowSource(win)
  await setActivePreset(preset.id) // 적용 = 현재 배치가 이 프리셋
  logger.info(
    `Window preset applied: ${preset.id} (${preset.name}) — ${next.length} windows`,
  )
  return preset
}

// 플레이어 displays 수신 시: (1) 키 없는 구 설정 창에 현재 index의 모니터 key를 채워 고정(1회 마이그레이션),
// (2) 키 있는 창은 현재 index/이름을 갱신(UI 표시용 — 배치 자체는 플레이어가 key로 해석).
// 키의 모니터가 지금 없으면 index는 건드리지 않는다(연결 시 플레이어가 자동 복귀).
const syncWindowMonitors = async () => {
  const displays = pStatus.displays || []
  if (!displays.length) return
  let changed = false
  const fix = (w) => {
    if (!w || w.monitorIndex === -1 || !Number.isInteger(w.monitorIndex)) return
    if (!w.monitorKey) {
      const d = displays.find((x) => x.index === w.monitorIndex)
      if (!d?.key) return
      Object.assign(w, {
        monitorKey: d.key,
        monitorSerial: d.serial || null,
        monitorName: d.name || null,
      })
      changed = true
      return
    }
    const d =
      displays.find((x) => x.key === w.monitorKey) ||
      (w.monitorSerial &&
      displays.filter((x) => x.serial === w.monitorSerial).length === 1
        ? displays.find((x) => x.serial === w.monitorSerial)
        : null)
    if (
      d &&
      (d.index !== w.monitorIndex || (d.name && d.name !== w.monitorName))
    ) {
      w.monitorIndex = d.index
      if (d.name) w.monitorName = d.name
      changed = true
    }
  }
  for (const w of pStatus.windows || []) fix(w)
  if (changed) {
    await persistWindows()
    logger.info('Window monitors synced to stable monitor keys')
  }
}

export {
  setWindowMute,
  syncWindowMonitors,
  createWindowCommand,
  listWindows,
  applyBackgroundToAll,
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
  applyWindowSource,
  reapplySource,
  detachSource,
}
