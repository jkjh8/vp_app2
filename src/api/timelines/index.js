import { randomUUID } from 'crypto'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbTimelines, dbFiles } from '../../db/index.js'
import { playerSend, isPlayerConnected } from '../../player/index.js'
import { ioClient } from '../../web/index.js'
import { setPlaylistMode } from '../playlists/index.js'

// 타임라인 모드 (PROTOCOL.md §5.2 — Phase B). NLE식 클립 배치, 비디오는 topmost 트랙 1개만
// 출력, 오디오 클립은 트랙별 채널 라우팅으로 재생. 클록은 플레이어가 소유 — 호스트는 저장/
// 하이드레이션 + 트랜스포트 패스스루만 담당한다.

const featureSupported = () =>
  Array.isArray(pStatus.playerFeatures) && pStatus.playerFeatures.includes('timeline')

// 클립 길이 합산으로 duration_ms 재계산 (max clip end)
const computeDuration = (tracks) => {
  let max = 0
  for (const tr of tracks || []) {
    for (const cl of tr.clips || []) {
      const len = (cl.out_ms ?? 0) - (cl.in_ms ?? 0)
      const end = (cl.start_ms ?? 0) + Math.max(0, len)
      if (end > max) max = end
    }
  }
  return max
}

// 저장 트랙/클립 정규화 (host id 부여, 필드 기본값). 마이그레이션 없이 lazy.
const normalizeTracks = (tracks) => {
  if (!Array.isArray(tracks)) return []
  return tracks.map((tr, i) => ({
    trackId: tr.trackId || `tr-${randomUUID()}`,
    type: tr.type === 'audio' ? 'audio' : 'video',
    name: tr.name || (tr.type === 'audio' ? `A${i + 1}` : `V${i + 1}`),
    order: Number.isInteger(tr.order) ? tr.order : i,
    mute: tr.mute ?? false,
    volume: tr.volume ?? 100,
    channel_map: Array.isArray(tr.channel_map) ? tr.channel_map : null,
    clips: (Array.isArray(tr.clips) ? tr.clips : []).map((cl) => ({
      clipId: cl.clipId || `cl-${randomUUID()}`,
      uuid: cl.uuid,
      start_ms: cl.start_ms ?? 0,
      in_ms: cl.in_ms ?? 0,
      out_ms: cl.out_ms ?? 0,
      volume: cl.volume ?? 100,
      fade_in_ms: cl.fade_in_ms ?? 0,
      fade_out_ms: cl.fade_out_ms ?? 0,
    })),
  }))
}

// DB 문서 → 플레이어 set_timeline 페이로드 (클립 uuid를 파일 path로 조인)
const hydrateForPlayer = async (doc) => {
  const tracks = await Promise.all(
    (doc.tracks || []).map(async (tr) => {
      const clips = await Promise.all(
        (tr.clips || []).map(async (cl) => {
          const f = await dbFiles.findOne({ uuid: cl.uuid })
          if (!f) {
            logger.warn(`Timeline clip file not found: ${cl.uuid}`)
            return null
          }
          return {
            clip_id: cl.clipId,
            file: {
              path: f.path,
              uuid: f.uuid,
              mimetype: f.mimetype,
              is_image: f.is_image ?? false,
            },
            start_ms: cl.start_ms ?? 0,
            in_ms: cl.in_ms ?? 0,
            out_ms: cl.out_ms ?? 0,
            volume: cl.volume ?? 100,
            fade_in_ms: cl.fade_in_ms ?? 0,
            fade_out_ms: cl.fade_out_ms ?? 0,
          }
        }),
      )
      return {
        track_id: tr.trackId,
        type: tr.type || 'video',
        order: tr.order ?? 0,
        mute: tr.mute ?? false,
        volume: tr.volume ?? 100,
        channel_map: Array.isArray(tr.channel_map) ? tr.channel_map : null,
        clips: clips.filter(Boolean),
      }
    }),
  )
  const duration = doc.duration_ms || computeDuration(doc.tracks)
  return { timeline_id: String(doc.timelineId ?? doc._id), duration_ms: duration, tracks }
}

// --- CRUD -------------------------------------------------------------------

const getTimelines = async () => {
  try {
    return await dbTimelines.find({}).sort({ timelineId: 1 })
  } catch (error) {
    logger.error(`Error fetching timelines: ${error}`)
    return []
  }
}

const getTimeline = async (id) => {
  try {
    return await dbTimelines.findOne({ _id: id })
  } catch (error) {
    logger.error(`Error fetching timeline ${id}: ${error}`)
    return null
  }
}

const createTimeline = async ({ name, description } = {}) => {
  try {
    const last = await dbTimelines.find({}).sort({ timelineId: -1 }).limit(1)
    const nextId = (last[0]?.timelineId || 0) + 1
    const doc = {
      timelineId: nextId,
      name: name || `Timeline ${nextId}`,
      description: description || '',
      duration_ms: 0,
      tracks: [],
    }
    return await dbTimelines.insert(doc)
  } catch (error) {
    logger.error(`Error creating timeline: ${error}`)
    return null
  }
}

const updateTimeline = async ({ _id, name, description, tracks }) => {
  try {
    if (!_id) {
      logger.error('updateTimeline: _id required')
      return null
    }
    const set = {}
    if (name !== undefined) set.name = name
    if (description !== undefined) set.description = description
    if (tracks !== undefined) {
      const norm = normalizeTracks(tracks)
      set.tracks = norm
      set.duration_ms = computeDuration(norm)
    }
    await dbTimelines.update({ _id }, { $set: set })
    const updated = await dbTimelines.findOne({ _id })
    // 재생 중인 타임라인을 편집하면 플레이어에 다시 로드 (라이브 반영 — 정지 후 재구성)
    if (pStatus.timelineMode && String(pStatus.timeline?._id) === String(_id)) {
      pStatus.timeline = updated
      if (isPlayerConnected() && featureSupported()) {
        const payload = await hydrateForPlayer(updated)
        playerSend({ command: 'set_timeline', ...payload })
      }
      ioClient.emit('pStatus', { timeline: pStatus.timeline })
    }
    return updated
  } catch (error) {
    logger.error(`Error updating timeline: ${error}`)
    return null
  }
}

const deleteTimeline = async (id) => {
  try {
    if (pStatus.timelineMode && String(pStatus.timeline?._id) === String(id)) {
      await timelineStop()
    }
    return await dbTimelines.remove({ _id: id }, {})
  } catch (error) {
    logger.error(`Error deleting timeline ${id}: ${error}`)
    return null
  }
}

// --- 모드 / 트랜스포트 -------------------------------------------------------

// timelineMode/playlistMode 상호배타. 켜는 쪽이 반대 모드를 끈다.
const setTimelineMode = async (mode) => {
  const on = Boolean(mode)
  if (on && pStatus.playlistMode) await setPlaylistMode(false)
  pStatus.timelineMode = on
  ioClient.emit('pStatus', { timelineMode: on })
  return on
}

const timelinePlay = async (id, timeMs) => {
  try {
    if (!isPlayerConnected()) {
      logger.error('Cannot play timeline — player socket not connected')
      return null
    }
    if (!featureSupported()) {
      logger.warn('timeline_play skipped: player lacks "timeline" feature')
      return null
    }
    const doc = await getTimeline(id)
    if (!doc) {
      logger.error(`Timeline not found for playback: ${id}`)
      return null
    }
    await setTimelineMode(true)
    pStatus.timeline = doc
    const payload = await hydrateForPlayer(doc)
    playerSend({ command: 'set_timeline', ...payload })
    const startMs = Number(timeMs) || 0
    playerSend({ command: 'timeline_play', ...(timeMs !== undefined ? { time_ms: startMs } : {}) })
    pStatus.timelinePos = {
      time_ms: startMs,
      duration_ms: payload.duration_ms,
      is_playing: true,
    }
    ioClient.emit('pStatus', { timeline: pStatus.timeline, timelinePos: pStatus.timelinePos })
    logger.info(`Playing timeline ${id} from ${startMs}ms`)
    return `Playing timeline ${id}`
  } catch (error) {
    logger.error(`Error playing timeline: ${error}`)
    return null
  }
}

const timelinePause = () => {
  if (!pStatus.timelineMode) return null
  playerSend({ command: 'timeline_pause' })
  return 'Timeline paused/resumed'
}

const timelineSeek = (timeMs) => {
  if (!pStatus.timelineMode) return null
  playerSend({ command: 'timeline_seek', time_ms: Number(timeMs) || 0 })
  return `Timeline seek to ${timeMs}`
}

const timelineStop = async () => {
  playerSend({ command: 'timeline_stop' })
  await setTimelineMode(false)
  pStatus.timeline = {}
  pStatus.timelinePos = { time_ms: 0, duration_ms: 0, is_playing: false }
  ioClient.emit('pStatus', { timeline: pStatus.timeline, timelinePos: pStatus.timelinePos })
  return 'Timeline stopped'
}

export {
  getTimelines,
  getTimeline,
  createTimeline,
  updateTimeline,
  deleteTimeline,
  setTimelineMode,
  timelinePlay,
  timelinePause,
  timelineSeek,
  timelineStop,
  hydrateForPlayer,
}
