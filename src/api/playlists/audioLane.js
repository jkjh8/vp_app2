import { randomUUID } from 'crypto'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbPlaylists, dbFiles } from '../../db/index.js'
import { playerSend } from '../../player/index.js'
import { ioClient } from '../../web/index.js'

// 병행 오디오 레인 — 플레이리스트 문서의 audioLane[] 항목을 플레이어의 독립 오디오
// 트랙(audio_track_*, PROTOCOL.md §5.1)으로 기동/정지/동기화한다.
//
// 정책 (플랜 §4):
// - 레인은 플레이리스트 재생 시작과 함께 기동, Stop과 함께 정지
// - 같은 플레이리스트 내 트랙 점프(next/prev/직접 재생)에는 무중단 (laneOwner 가드)
// - 루프는 플레이어 측 (호스트 재트리거는 갭 + end_reached 디덥과 충돌)
// - 구버전 플레이어(capabilities에 audio_track 없음)에는 아무것도 보내지 않음

// 현재 레인을 소유한 플레이리스트의 playlistId (null = 레인 미기동)
let laneOwnerPlaylistId = null

const laneSupported = () =>
  Array.isArray(pStatus.playerFeatures) && pStatus.playerFeatures.includes('audio_track')

const emitAudioTracks = () => {
  ioClient.emit('pStatus', { audioTracks: pStatus.audioTracks })
}

// 레인 항목 하나를 플레이어 오디오 트랙으로 기동 (track_id = itemId)
const startItem = async (item) => {
  const file = await dbFiles.findOne({ uuid: item.uuid })
  if (!file) {
    logger.warn(`audioLane: file not found for item ${item.itemId}: ${item.uuid}`)
    return
  }
  playerSend({
    command: 'audio_track_play',
    track_id: item.itemId,
    file,
    volume: item.volume ?? 100,
    channel_map: Array.isArray(item.channel_map) ? item.channel_map : undefined,
    loop: item.loop !== false,
  })
  pStatus.audioTracks[item.itemId] = {
    itemId: item.itemId,
    uuid: item.uuid,
    filename: file.filename,
    volume: item.volume ?? 100,
    loop: item.loop !== false,
    channel_map: Array.isArray(item.channel_map) ? item.channel_map : null,
    time: 0,
    duration: 0,
    position: 0,
    is_playing: false,
    state: 'starting',
  }
}

// 플레이리스트 재생 시작 시 호출 — 같은 플레이리스트면 무중단(no-op), 다르면 재기동
const ensureAudioLane = async (playlist) => {
  if (!playlist) return
  if (laneOwnerPlaylistId === playlist.playlistId) return // 트랙 점프 — BGM 유지
  stopAudioLane()
  if (!laneSupported()) {
    if ((playlist.audioLane || []).length > 0) {
      logger.warn('audioLane: player does not support audio_track — lane skipped')
    }
    return
  }
  laneOwnerPlaylistId = playlist.playlistId
  const lane = (playlist.audioLane || []).filter((it) => it.enabled !== false)
  for (const item of lane) {
    await startItem(item)
  }
  if (lane.length > 0) {
    logger.info(`audioLane: started ${lane.length} track(s) for playlist ${playlist.playlistId}`)
    emitAudioTracks()
  }
}

const stopAudioLane = () => {
  laneOwnerPlaylistId = null
  const ids = Object.keys(pStatus.audioTracks || {})
  if (ids.length === 0) return
  for (const id of ids) {
    playerSend({ command: 'audio_track_stop', track_id: id })
  }
  pStatus.audioTracks = {}
  emitAudioTracks()
  logger.info(`audioLane: stopped ${ids.length} track(s)`)
}

// pause/resume: 플레이어의 audio_track_pause는 토글 — 현재 상태 기준으로 골라 보낸다
const pauseAudioLane = () => {
  for (const [id, t] of Object.entries(pStatus.audioTracks || {})) {
    if (t.is_playing) playerSend({ command: 'audio_track_pause', track_id: id })
  }
}

const resumeAudioLane = () => {
  for (const [id, t] of Object.entries(pStatus.audioTracks || {})) {
    if (!t.is_playing && t.state === 'paused') {
      playerSend({ command: 'audio_track_pause', track_id: id })
    }
  }
}

// 재생 중 레인 편집 반영 — 제거=stop, 추가=play, 볼륨/맵=라이브 갱신, 루프 변경=교체
const syncAudioLane = async (playlist) => {
  if (!laneSupported()) return
  if (laneOwnerPlaylistId !== playlist.playlistId) return // 이 플레이리스트가 재생 중 아님
  const desired = new Map(
    (playlist.audioLane || [])
      .filter((it) => it.enabled !== false)
      .map((it) => [it.itemId, it]),
  )
  const running = pStatus.audioTracks || {}

  for (const id of Object.keys(running)) {
    if (!desired.has(id)) {
      playerSend({ command: 'audio_track_stop', track_id: id })
      delete running[id]
    }
  }
  for (const [id, item] of desired) {
    const cur = running[id]
    if (!cur) {
      await startItem(item)
      continue
    }
    if ((item.loop !== false) !== cur.loop) {
      // 플레이어의 loop는 audio_track_play 시점 고정 — 교체 재생으로 반영
      await startItem(item)
      continue
    }
    if ((item.volume ?? 100) !== cur.volume) {
      playerSend({ command: 'audio_track_set_volume', track_id: id, volume: item.volume ?? 100 })
      cur.volume = item.volume ?? 100
    }
    const newMap = Array.isArray(item.channel_map) ? item.channel_map : null
    if (JSON.stringify(newMap) !== JSON.stringify(cur.channel_map)) {
      playerSend({ command: 'audio_track_set_channel_map', track_id: id, map: newMap || [] })
      cur.channel_map = newMap
    }
  }
  emitAudioTracks()
}

// 레인 배열 전체 교체 저장 (PUT /playlist/audio_lane) — itemId 부여/정규화 후 $set,
// 해당 플레이리스트가 재생 중이면 라이브 동기화까지
const setAudioLane = async (id, audioLane) => {
  try {
    if (!id || !Array.isArray(audioLane)) {
      logger.error('Invalid parameters for setting audio lane')
      return null
    }
    const normalized = audioLane
      .filter((it) => it && it.uuid)
      .map((it) => ({
        itemId: it.itemId || `al-${randomUUID()}`,
        uuid: it.uuid,
        enabled: it.enabled !== false,
        loop: it.loop !== false,
        volume: Math.max(0, Math.min(100, Number(it.volume ?? 100))),
        channel_map: Array.isArray(it.channel_map) ? it.channel_map : null,
        fade_in_ms: it.fade_in_ms ?? 0,
        fade_out_ms: it.fade_out_ms ?? 0,
      }))
    const r = await dbPlaylists.update({ _id: id }, { $set: { audioLane: normalized } })

    const playlist = await dbPlaylists.findOne({ _id: id })
    if (playlist) {
      if (pStatus.playlist?._id === id) {
        pStatus.playlist = { ...pStatus.playlist, audioLane: normalized }
        ioClient.emit('pStatus', { playlist: pStatus.playlist })
      }
      await syncAudioLane(playlist)
    }
    return r
  } catch (error) {
    logger.error(`Error setting audio lane: ${error}`)
    return null
  }
}

// 레인 항목 볼륨 단일 갱신 (UI 슬라이더용) — 문서 + 라이브 동시 적용
const setLaneItemVolume = async (id, itemId, volume) => {
  try {
    const playlist = await dbPlaylists.findOne({ _id: id })
    const item = playlist?.audioLane?.find((it) => it.itemId === itemId)
    if (!item) {
      logger.error(`audioLane: item not found: ${itemId}`)
      return null
    }
    item.volume = Math.max(0, Math.min(100, Number(volume)))
    const r = await dbPlaylists.update(
      { _id: id },
      { $set: { audioLane: playlist.audioLane } },
    )
    if (pStatus.audioTracks?.[itemId]) {
      playerSend({ command: 'audio_track_set_volume', track_id: itemId, volume: item.volume })
      pStatus.audioTracks[itemId].volume = item.volume
      emitAudioTracks()
    }
    if (pStatus.playlist?._id === id) {
      pStatus.playlist = { ...pStatus.playlist, audioLane: playlist.audioLane }
      ioClient.emit('pStatus', { playlist: pStatus.playlist })
    }
    return r
  } catch (error) {
    logger.error(`Error setting lane item volume: ${error}`)
    return null
  }
}

export {
  ensureAudioLane,
  stopAudioLane,
  pauseAudioLane,
  resumeAudioLane,
  syncAudioLane,
  setAudioLane,
  setLaneItemVolume,
}
