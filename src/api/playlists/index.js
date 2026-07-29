import { randomUUID } from 'crypto'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbPlaylists, dbFiles, dbStatus } from '../../db/index.js'
import { playerSend, isPlayerConnected } from '../../player/index.js'
import { ioClient } from '../../web/index.js'
import { playFile } from '../player/index.js'
import { syncTrackAudios, setDeckAudioLive } from './trackAudio.js'

// 트랙의 추가 오디오 항목들을 파일 정보와 조인 (UI 표시 + 플레이어 전송용 path/metadata)
const hydrateTrackAudios = async (audios) => {
  if (!Array.isArray(audios)) return []
  const results = await Promise.all(
    audios.map(async (a) => {
      if (!a?.uuid) return null
      const af = await dbFiles.findOne({ uuid: a.uuid })
      if (!af) {
        logger.warn(`Audio file not found for track audio: ${a.uuid}`)
        return null
      }
      return {
        id: a.id,
        uuid: a.uuid,
        filename: af.filename,
        path: af.path,
        metadata: af.metadata, // 채널 라우팅 UI에서 소스 채널수 파싱
        volume: a.volume ?? 100, // 마스터
        channel_map: Array.isArray(a.channel_map) ? a.channel_map : null, // 레거시
        channels: Array.isArray(a.channels) ? a.channels : null, // 채널별 [{out,volume,muted}]
        muted: a.muted ?? false, // 마스터
        loop: a.loop ?? false,
      }
    }),
  )
  return results.filter(Boolean)
}

const getTrackWithFileInfo = async (tracks) => {
  if (!tracks || !Array.isArray(tracks)) {
    logger.error('Invalid tracks data')
    return []
  }

  const results = await Promise.all(
    tracks.map(async (track) => {
      try {
        const file = await dbFiles.findOne({ uuid: track.uuid })
        if (file) {
          return {
            ...file,
            time: track.time || 0,
            // v2 라우팅/볼륨 (PROTOCOL.md §5.1) — 구 문서는 필드가 없으므로 기본값
            // 하이드레이션으로 v1 동작 유지. channel_map은 그대로 플레이어까지 실림.
            volume: track.volume ?? 100, // 레거시 마스터
            channel_map: Array.isArray(track.channel_map)
              ? track.channel_map
              : null, // 레거시
            muted: track.muted ?? false, // 레거시 마스터 뮤트
            // 채널별 임베디드 오디오 (스트림>채널). 있으면 플레이어가 channel_map보다 우선.
            // 기본값(스트림/채널 채우기)은 UI가 metadata.streams로 병합 — 여기선 영속값만 통과.
            embedded_streams: Array.isArray(track.embedded_streams)
              ? track.embedded_streams
              : null,
            // 페이드는 Phase C 예약 — 스키마만 확보, 아직 미전송/미적용
            fade_in_ms: track.fade_in_ms ?? 0,
            fade_out_ms: track.fade_out_ms ?? 0,
            // 멀티 윈도우(v3): 이 트랙을 표시할 창 id (기본 0 = 주 창)
            window: Number.isInteger(track.window) ? track.window : 0,
            // 트랙별 시작 지연(ms) — 플레이어가 프리롤 완료 후 delay_ms 대기했다 표시
            delay_ms: Number.isFinite(track.delay_ms) ? track.delay_ms : 0,
            // 트랙 종속 추가 오디오 스택 (임베디드 외 별도 오디오 파일들)
            audios: await hydrateTrackAudios(track.audios),
          }
        }
        logger.warn(`File not found for track uuid: ${track.uuid}`)
        return null
      } catch (error) {
        logger.error(`Error fetching file for track uuid ${track.uuid}:`, error)
        return null
      }
    }),
  )

  // Filter out null/undefined values
  return results.filter((item) => item !== null && item !== undefined)
}

// 이미지 트랙의 표시 시간(초) 결정.
// - time이 명시적으로(0이 아닌 값) 설정돼 있으면 그 값을 강제 사용.
// - time이 0/미설정이면 붙어있는 추가 오디오의 길이(metadata.format.duration, 초 단위
//   문자열 — vplayer probe_media가 std::to_string(double)로 내려줌)를 사용.
// - 오디오가 없거나 길이를 못 구하면 기존 기본값 5초로 폴백.
const resolveImageTime = (track) => {
  if (!track?.is_image) return undefined
  if (track.time) return track.time
  const audios = Array.isArray(track.audios) ? track.audios : []
  for (const a of audios) {
    const dur = parseFloat(a?.metadata?.format?.duration)
    if (Number.isFinite(dur) && dur > 0) return dur
  }
  return 5
}

const getPlaylist = async (playlistId) => {
  try {
    if (!playlistId) {
      logger.error('Playlist ID is required')
      return null
    }

    const playlist = await dbPlaylists.findOne({ playlistId })
    if (!playlist) {
      logger.error('Playlist not found')
      return null
    }
    return { ...playlist, tracks: await getTrackWithFileInfo(playlist.tracks) }
  } catch (error) {
    logger.error('Error fetching playlist:', error)
    return null
  }
}

const getPlaylists = async () => {
  try {
    const playlists = await dbPlaylists.find({})
    return await Promise.all(
      playlists.map(async (playlist) => ({
        ...playlist,
        tracks: await getTrackWithFileInfo(playlist.tracks),
      })),
    )
  } catch (error) {
    logger.error('Error fetching playlists:', error)
    return []
  }
}

const addPlaylist = async (args) => {
  try {
    if (!args.playlistId) {
      logger.error('Playlist ID is required')
      return null
    }
    const newPlaylist = {
      ...args,
      tracks: [],
    }
    await dbPlaylists.insertOne(newPlaylist)
    return newPlaylist
  } catch (error) {
    logger.error(`Error adding playlist: ${error}`)
  }
}

const editPlaylist = async (args) => {
  try {
    const { id, ...updateData } = args
    if (!id) {
      logger.error('Playlist ID is required for editing')
      return null
    }
    const result = await dbPlaylists.update({ _id: id }, { $set: updateData })

    // 현재 재생 중인 플레이리스트가 업데이트되면 Python 플레이어에 업데이트된 트랙 전송
    if (pStatus.playlistMode && pStatus.playlist?._id === id) {
      logger.info('Current playlist edited, sending updated tracks to player')
      // 플레이리스트 정보 다시 가져오기
      const updatedPlaylist = await dbPlaylists.findOne({ _id: id })
      if (updatedPlaylist) {
        pStatus.playlist = {
          ...updatedPlaylist,
          tracks: await getTrackWithFileInfo(updatedPlaylist.tracks),
        }
        // Python 플레이어에 업데이트된 트랙 리스트 전송
        playerSend({
          command: 'set_tracks',
          tracks: pStatus.playlist.tracks,
        })
        ioClient.emit('pStatus', { playlist: pStatus.playlist })
        // 다음 트랙 미리 로드
        await preloadNextTrack()
      }
    }

    return result
  } catch (error) {
    logger.error(`Error editing playlist: ${error}`)
    return null
  }
}

const setTracksToPlaylist = async (playlistId, tracks) => {
  try {
    if (!playlistId || !tracks || !Array.isArray(tracks)) {
      logger.error('Invalid playlist ID or tracks data')
      return null
    }
    const result = await dbPlaylists.update(
      { _id: playlistId },
      { $addToSet: { tracks: { $each: tracks } } },
    )

    // 현재 재생 중인 플레이리스트가 업데이트되면 Python 플레이어에 업데이트된 트랙 전송
    if (pStatus.playlistMode && pStatus.playlist?._id === playlistId) {
      logger.info('Current playlist updated, sending updated tracks to player')
      // 플레이리스트 정보 다시 가져오기
      const updatedPlaylist = await dbPlaylists.findOne({ _id: playlistId })
      if (updatedPlaylist) {
        pStatus.playlist = {
          ...updatedPlaylist,
          tracks: await getTrackWithFileInfo(updatedPlaylist.tracks),
        }
        // Python 플레이어에 업데이트된 트랙 리스트 전송
        playerSend({
          command: 'set_tracks',
          tracks: pStatus.playlist.tracks,
        })
        ioClient.emit('pStatus', { playlist: pStatus.playlist })
        // 다음 트랙 미리 로드
        await preloadNextTrack()
      }
    }

    return result
  } catch (error) {
    logger.error(`Error adding tracks to playlist: ${error}`)
    return null
  }
}

const setPlaylist = async (playlistId) => {
  try {
    if (!playlistId) {
      logger.error('Playlist ID is required')
      return null
    }
    const playlist = await dbPlaylists.findOne({ playlistId })
    if (!playlist) {
      logger.error('Playlist not found')
      return null
    }
    pStatus.playlist = playlist || {}
    ioClient.emit('pStatus', { playlist: pStatus.playlist })
    return playlist
  } catch (error) {
    logger.error(`Error setting playlist: ${error}`)
    return null
  }
}

const setPlaylistTrackIndex = async (idx) => {
  try {
    if (idx === undefined || idx === null) {
      logger.error('Invalid index for playlist track')
      return null
    }
    idx = Number(idx)
    if (isNaN(idx)) {
      logger.error('Index must be a number')
      return null
    }
    pStatus.trackId = idx
    ioClient.emit('pStatus', { trackId: pStatus.trackId })
    return idx
  } catch (error) {
    logger.error(`Error setting playlist track index: ${error}`)
    return null
  }
}

const setPlaylistMode = async (mode) => {
  try {
    pStatus.playlistMode = Boolean(mode)
    playerSend({ command: 'playlist_mode', value: pStatus.playlistMode })

    // If we're turning playlist mode OFF and repeat was 'repeat_one', switch to 'all'
    if (!pStatus.playlistMode && pStatus.repeat === 'repeat_one') {
      pStatus.repeat = 'all'
      try {
        // persist repeat change if dbStatus available
        if (typeof dbStatus !== 'undefined' && dbStatus) {
          await dbStatus.update({ type: 'repeat' }, { mode: pStatus.repeat })
        }
      } catch (dbErr) {
        logger.error(
          'Failed to persist repeat change when disabling playlist mode',
          dbErr,
        )
      }
      ioClient.emit('pStatus', { repeat: pStatus.repeat })
      logger.info(
        `Repeat mode changed to '${pStatus.repeat}' because playlist mode was disabled`,
      )
    }

    ioClient.emit('pStatus', { playlistMode: pStatus.playlistMode })
    return pStatus.playlistMode
  } catch (error) {
    logger.error(`Error setting playlist mode: ${error}`)
    return null
  }
}

const editImageTime = async (playlistId, idx, time) => {
  try {
    if (!playlistId || idx === undefined || time === undefined) {
      logger.error('Invalid parameters for editing image time')
      return null
    }
    const playlist = await dbPlaylists.findOne({ _id: playlistId })
    if (!playlist) {
      logger.error('Playlist not found for editing image time')
      return null
    }
    if (!playlist.tracks || !playlist.tracks[idx]) {
      logger.error('Track not found for editing image time')
      return null
    }
    playlist.tracks[idx].time = time
    const r = await dbPlaylists.update(
      { _id: playlistId },
      { $set: { tracks: playlist.tracks } },
    )

    // 현재 재생 중인 플레이리스트가 업데이트되면 Python 플레이어에 업데이트된 트랙 전송
    if (pStatus.playlistMode && pStatus.playlist?._id === playlistId) {
      pStatus.playlist = {
        ...playlist,
        tracks: await getTrackWithFileInfo(playlist.tracks),
      }
      // Python 플레이어에 업데이트된 트랙 리스트 전송
      playerSend({
        command: 'set_tracks',
        tracks: pStatus.playlist.tracks,
      })
      ioClient.emit('pStatus', { playlist: pStatus.playlist })
      // 다음 트랙이 변경되었으면 다시 로드
      if (idx === pStatus.trackId + 1) {
        logger.info('Next track image time updated, reloading')
        await preloadNextTrack()
      }
    }

    return r
  } catch (error) {
    logger.error(`Error editing image time for playlist: ${error}`)
    return null
  }
}

// 트랙 영속 필드 부분 갱신 화이트리스트 (파일 문서 필드/uuid는 여기로 못 바꾼다)
// muted = 임베디드 오디오 뮤트, audios = 트랙 종속 추가 오디오 스택
const TRACK_PATCH_KEYS = [
  'time',
  'volume',
  'channel_map',
  'muted',
  'embedded_streams', // 채널별 임베디드 오디오 [{index,volume,muted,channels:[{out,volume,muted}]}]
  'fade_in_ms',
  'fade_out_ms',
  'window', // 멀티 윈도우(v3): 표시 창 id
  'delay_ms', // 트랙별 시작 지연(ms)
  'audios',
]

// 채널별 [{out,volume,muted}] 정규화
const normalizeChannels = (channels) =>
  (Array.isArray(channels) ? channels : []).map((c) => ({
    out: Number.isInteger(c?.out) ? c.out : -1,
    volume: Math.max(0, Math.min(100, Number(c?.volume ?? 100))),
    muted: c?.muted === true,
  }))

// 추가 오디오 항목 정규화 — id 부여(없으면), 필드 클램프. UI가 보낸 하이드레이션
// 필드(filename/path/metadata)는 버리고 영속 형태만 저장한다.
const normalizeAudios = (audios) =>
  (Array.isArray(audios) ? audios : [])
    .filter((a) => a && a.uuid)
    .map((a) => ({
      id: a.id || `aud-${randomUUID()}`,
      uuid: a.uuid,
      volume: Math.max(0, Math.min(100, Number(a.volume ?? 100))),
      channel_map: Array.isArray(a.channel_map) ? a.channel_map : null,
      channels: Array.isArray(a.channels)
        ? normalizeChannels(a.channels)
        : null,
      muted: a.muted === true,
      loop: a.loop === true,
    }))

// editImageTime의 일반화 — 시간/볼륨/채널 라우팅/뮤트/추가 오디오/페이드 예약 필드 부분 갱신.
// 덱 channel_map/muted는 다음 로드부터 적용 (PROTOCOL.md §5.1) — 재생 중이면 트랙 리스트
// 재전송 + 프리로드 갱신으로 다음 전환부터 반영. 추가 오디오는 현재 트랙이면 즉시 재동기화.
const editTrack = async (id, idx, patch) => {
  try {
    if (!id || idx === undefined || !patch || typeof patch !== 'object') {
      logger.error('Invalid parameters for editing track')
      return null
    }
    const playlist = await dbPlaylists.findOne({ _id: id })
    if (!playlist?.tracks?.[idx]) {
      logger.error('Track not found for editing')
      return null
    }
    for (const key of TRACK_PATCH_KEYS) {
      if (key in patch) {
        if (key === 'audios')
          playlist.tracks[idx][key] = normalizeAudios(patch[key])
        else if (key === 'embedded_streams') {
          playlist.tracks[idx][key] = (
            Array.isArray(patch[key]) ? patch[key] : []
          ).map((s) => ({
            index: Number.isInteger(s?.index) ? s.index : 0,
            volume: Math.max(0, Math.min(100, Number(s?.volume ?? 100))),
            muted: s?.muted === true,
            channels: normalizeChannels(s?.channels),
          }))
        } else playlist.tracks[idx][key] = patch[key]
      }
    }
    const r = await dbPlaylists.update(
      { _id: id },
      { $set: { tracks: playlist.tracks } },
    )

    // 재생 중인 플레이리스트면 하이드레이션 갱신 + 플레이어 트랙 리스트 재전송
    if (pStatus.playlistMode && pStatus.playlist?._id === id) {
      pStatus.playlist = {
        ...playlist,
        tracks: await getTrackWithFileInfo(playlist.tracks),
      }
      playerSend({
        command: 'set_tracks',
        tracks: pStatus.playlist.tracks,
      })
      ioClient.emit('pStatus', { playlist: pStatus.playlist })
      if (idx === pStatus.trackId) {
        // 현재 재생 중인 트랙 — 임베디드 오디오는 덱 라이브 변경, 추가 오디오는 diff 라이브
        if ('embedded_streams' in patch) {
          // 채널별(스트림>채널) 라이브
          setDeckAudioLive({ streams: playlist.tracks[idx].embedded_streams })
        } else {
          const embedded = {}
          if ('channel_map' in patch) embedded.channel_map = patch.channel_map
          if ('volume' in patch) embedded.volume = patch.volume
          if ('muted' in patch) embedded.muted = patch.muted
          if (Object.keys(embedded).length) setDeckAudioLive(embedded)
        }
        if ('audios' in patch) syncTrackAudios(idx, true)
      } else if (idx === pStatus.trackId + 1) {
        logger.info('Next track settings updated, reloading preload')
        await preloadNextTrack()
      }
    }
    return r
  } catch (error) {
    logger.error(`Error editing track: ${error}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// 멀티 윈도우(v3) 창별 동시 시퀀싱
//
// 플레이리스트 = 트랙 + 트랙별 window 배정. 창마다 자신에게 배정된 트랙을 순서대로
// (창 서브시퀀스) 동시 재생. 창별 독립 커서 = pStatus.windowStates[W].seqIndex.
// 플레이어는 window_id 주소 + 프리롤 풀(preload_playlist)로 창별 무지연 전환한다.
// ---------------------------------------------------------------------------

// 플레이어가 멀티 윈도우/프리롤 풀을 지원하는지 (구버전 폴백 게이트)
const multiWin = () => Array.isArray(pStatus.playerFeatures) &&
  pStatus.playerFeatures.includes('multi_window')

// 트랙을 window별 서브시퀀스로 그룹핑 (재생 순서 유지). Map<W, [{gIdx, track}]>
const groupTracksByWindow = (tracks) => {
  const groups = new Map()
  ;(tracks || []).forEach((track, gIdx) => {
    const W = Number.isInteger(track.window) ? track.window : 0
    if (!groups.has(W)) groups.set(W, [])
    groups.get(W).push({ gIdx, track })
  })
  return groups
}

// 이미지 표시시간 반영한 플레이어 전송용 file (비디오는 원본 그대로)
const fileForPlayer = (track) => {
  const t = resolveImageTime(track)
  return t !== undefined ? { ...track, time: t } : track
}

// 사용 창들이 플레이어에 없으면 pStatus.windows 설정으로 create_window (창 0은 항상 존재)
const ensureWindows = (windowIds) => {
  const existing = new Set((pStatus.playerWindows || []).map((w) => w.window_id))
  for (const W of windowIds) {
    if (W === 0 || existing.has(W)) continue
    const cfg = (pStatus.windows || []).find((w) => w.id === W) || {}
    playerSend({
      command: 'create_window',
      window_id: W,
      monitor_index: cfg.monitorIndex ?? -1,
      x: cfg.x ?? 0,
      y: cfg.y ?? 0,
      width: cfg.width ?? 0,
      height: cfg.height ?? 0,
      aspect_mode: cfg.aspectMode ?? 'letterbox',
    })
    if (cfg.backgroundColor)
      playerSend({ command: 'background_color', window_id: W, color: cfg.backgroundColor })
  }
}

// 멀티 윈도우 재생 시작: 창별 서브시퀀스를 전 트랙 프리롤 후 동시 재생.
// startAt(ns, 멀티 PC 공유 러닝타임)이 주어지면 각 창의 현재 트랙을 그 시각에 동시 표시(락스텝).
const startMultiWindow = (trackIdx, startAt = null) => {
  const tracks = pStatus.playlist.tracks || []
  const groups = groupTracksByWindow(tracks)
  const windowIds = [...groups.keys()]

  const lookahead = Number.isInteger(pStatus.preloadLookahead) ? pStatus.preloadLookahead : 2
  const maxDecks = Number.isInteger(pStatus.preloadMaxDecks) ? pStatus.preloadMaxDecks : 8
  playerSend({ command: 'set_preload_config', lookahead, max_decks: maxDecks })

  ensureWindows(windowIds)

  pStatus.windowStates = {}
  for (const W of windowIds) {
    const seq = groups.get(W)
    const files = seq.map((s) => fileForPlayer(s.track))
    let startSeq = seq.findIndex((s) => s.gIdx === Number(trackIdx))
    if (startSeq < 0) startSeq = 0

    // 전 트랙(이 창의) 프리롤 → 이후 재생/전환 무지연
    playerSend({
      command: 'preload_playlist',
      window_id: W,
      current_index: startSeq,
      tracks: files,
    })
    // 멀티 PC 동기: 현재 트랙에 공유 start_at 주입 (전 창·전 PC 동시 표시)
    const cur =
      startAt != null ? { ...files[startSeq], start_at: startAt } : files[startSeq]
    const nxt = files[startSeq + 1] || null
    playerSend({
      command: 'play_current_and_load_next',
      window_id: W,
      track_idx: startSeq,
      current: cur,
      next: nxt,
      current_time: resolveImageTime(seq[startSeq].track),
      next_time: nxt ? resolveImageTime(seq[startSeq + 1].track) : undefined,
    })
    pStatus.windowStates[W] = {
      seqIndex: startSeq,
      trackId: seq[startSeq].gIdx,
      activePlayerId: 0,
      player: { time: 0, duration: 0, position: 0, is_playing: true, event: 'playing' },
    }
  }

  // 하위호환 단일 필드(창 0 우선) — 기존 UI가 pStatus.trackId/file를 참조
  const w0 = groups.has(0) ? 0 : windowIds[0]
  if (w0 != null) {
    const st = pStatus.windowStates[w0]
    pStatus.trackId = st.trackId
    pStatus.file = groups.get(w0)[st.seqIndex].track
  }
  ioClient.emit('pStatus', {
    playlist: pStatus.playlist,
    windowStates: pStatus.windowStates,
    trackId: pStatus.trackId,
    file: pStatus.file,
  })
  logger.info(
    `Multi-window play: ${windowIds.length} windows [${windowIds.join(',')}], ${tracks.length} tracks`,
  )
}

// 창별 end_reached 처리 (멀티 윈도우) — 해당 창 커서만 전진
const advanceWindowOnEnd = (data) => {
  const W = data.window_id ?? 0
  const endedSeq = data.playlist_track_index
  const tracks = pStatus.playlist?.tracks || []
  const groups = groupTracksByWindow(tracks)
  const seq = groups.get(W)
  if (!seq || seq.length === 0) return

  const repeat = pStatus.repeat
  const isLast = endedSeq >= seq.length - 1
  const st = pStatus.windowStates[W] || { seqIndex: endedSeq, activePlayerId: 0, player: {} }
  const files = () => seq.map((s) => fileForPlayer(s.track))

  if (repeat === 'repeat_one') {
    playerSend({ command: 'stop', window_id: W })
    const f = files()
    playerSend({
      command: 'play_current_and_load_next',
      window_id: W,
      track_idx: endedSeq,
      current: f[endedSeq],
      next: f[endedSeq + 1] || null,
      current_time: resolveImageTime(seq[endedSeq].track),
    })
    st.seqIndex = endedSeq
  } else if (!isLast) {
    playerSend({ command: 'next', window_id: W })
    st.seqIndex = endedSeq + 1
  } else if (repeat === 'all') {
    const f = files()
    playerSend({
      command: 'play_current_and_load_next',
      window_id: W,
      track_idx: 0,
      current: f[0],
      next: f[1] || null,
      current_time: resolveImageTime(seq[0].track),
      next_time: f[1] ? resolveImageTime(seq[1].track) : undefined,
    })
    st.seqIndex = 0
  } else {
    // none/single → 이 창 정지
    playerSend({ command: 'stop', window_id: W })
    st.seqIndex = seq.length
  }

  const clampIdx = Math.min(st.seqIndex, seq.length - 1)
  st.trackId = seq[clampIdx]?.gIdx ?? st.trackId
  pStatus.windowStates[W] = st
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
}

// slave/로컬: 지정 playlist를 로드해 공유 start_at으로 멀티 윈도우 재생 (멀티캐스트 트리거 진입점)
const startMultiWindowSynced = async (playlistId, trackIdx = 0, startAt = null) => {
  if (
    Object.keys(pStatus.playlist).length === 0 ||
    pStatus.playlist.playlistId !== playlistId
  ) {
    const playlist = await getPlaylist(playlistId)
    if (!playlist) return null
    pStatus.playlist = playlist
  }
  await setPlaylistMode(true)
  if (!(pStatus.playlist.tracks || []).length) return null
  startMultiWindow(trackIdx, startAt)
  return `synced play ${playlistId} @${startAt}`
}

const playlistPlay = async (playlistId, trackIdx = 0) => {
  try {
    if (!playlistId) {
      logger.error('Playlist ID is required for playback')
      return null
    }
    if (!isPlayerConnected()) {
      // 소켓 미연결 상태에서 진행하면 pStatus만 "재생 중"으로 갱신되고 실제로는 아무 명령도
      // 전달되지 않는 조용한 실패가 된다 (예: 앱 기동 직후 플레이어 연결 완료 전 클릭).
      logger.error('Cannot play playlist — player socket not connected')
      return null
    }
    if (
      Object.keys(pStatus.playlist).length === 0 ||
      pStatus.playlist.playlistId !== playlistId
    ) {
      const playlist = await getPlaylist(playlistId)
      if (!playlist) {
        logger.error('Playlist not found for playback')
        return null
      }
      pStatus.playlist = playlist
    }
    await setPlaylistMode(true)
    // trackId는 Python에서 update_track_index를 호출하여 설정하므로 여기서는 설정하지 않음
    // pStatus.trackId = Number(trackIdx)

    // 전체 플레이리스트 전송
    const tracks = pStatus.playlist.tracks || []

    if (!tracks || tracks.length === 0) {
      logger.error('Playlist has no tracks')
      return null
    }

    // 멀티 윈도우 지원 플레이어: 창별 동시 시퀀싱 경로 (전 트랙 프리롤 + 창별 재생)
    if (multiWin()) {
      // 멀티 PC master: 공유 start_at 계산 후 로컬+전 slave 동시 트리거 (락스텝)
      if (pStatus.sync?.role === 'master') {
        const { computeStartAt, triggerSyncPlay } = await import('../player/peerSync.js')
        const startAt = computeStartAt()
        const baseTime = Number(pStatus.sync.ptp?.base_time)
        startMultiWindow(trackIdx, startAt)
        triggerSyncPlay(playlistId, trackIdx, startAt, baseTime)
        return `Playing playlist ${playlistId} (multi-PC master) @${startAt}`
      }
      startMultiWindow(trackIdx)
      return `Playing playlist ${playlistId} (multi-window) from track ${trackIdx}`
    }

    const currentTrack = tracks[Number(trackIdx)]
    const nextTrack = tracks[Number(trackIdx) + 1] || null

    if (!currentTrack) {
      logger.error('Current track not found')
      return null
    }

    // 현재 재생 파일 설정
    pStatus.file = currentTrack
    ioClient.emit('pStatus', {
      playlist: pStatus.playlist,
      file: pStatus.file,
    })

    // 전체 트랙 리스트를 플레이어에 전송
    playerSend({
      command: 'set_tracks',
      tracks: tracks,
    })

    // 현재/다음 트랙의 이미지 표시 시간 (time 강제 지정 > 추가 오디오 길이 > 기본 5초)
    const currentTime = resolveImageTime(currentTrack)
    const nextTime = resolveImageTime(nextTrack)

    // 현재 파일 재생 및 다음 파일 미리 로드
    playerSend({
      command: 'play_current_and_load_next',
      current: currentTrack,
      next: nextTrack,
      track_idx: Number(trackIdx),
      current_time: currentTime,
      next_time: nextTime,
    })

    logger.info(
      `Playing playlist ${playlistId} with ${tracks.length} tracks, starting at track ${trackIdx}, next track preloaded: ${!!nextTrack}, current_time: ${currentTime}, next_time: ${nextTime}`,
    )

    // 트랙 종속 오디오는 media_changed 피드백(parser)에서 트랙 확정 후 동기화된다 —
    // 여기서 직접 기동하지 않음 (실제 화면 전환 시점과 일치시키기 위함).

    return `Playing playlist ${playlistId} from track ${trackIdx}`
  } catch (error) {
    logger.error(`Error playing playlist: ${error}`)
    return null
  }
}

// 다음 트랙으로 이동 (end_reached 시 사용)
const playNextTrack = async () => {
  try {
    const tracks = pStatus.playlist?.tracks || []
    if (tracks.length === 0) {
      logger.error('No tracks in playlist')
      return null
    }

    // 다음 트랙 인덱스 계산
    let nextIdx = pStatus.trackId + 1
    if (nextIdx >= tracks.length) {
      // repeat 모드에 따라 처리
      if (pStatus.repeat === 'all') {
        nextIdx = 0 // 처음부터 다시
      } else {
        logger.info('Playlist ended')
        return null
      }
    }

    pStatus.trackId = nextIdx
    const currentTrack = tracks[nextIdx]
    const nextTrack = tracks[nextIdx + 1] || null

    ioClient.emit('pStatus', { trackId: pStatus.trackId })

    // 현재/다음 트랙의 이미지 표시 시간 (time 강제 지정 > 추가 오디오 길이 > 기본 5초)
    const currentTime = resolveImageTime(currentTrack)
    const nextTime = resolveImageTime(nextTrack)

    playerSend({
      command: 'play_current_and_load_next',
      current: currentTrack,
      next: nextTrack,
      track_idx: pStatus.trackId,
      current_time: currentTime,
      next_time: nextTime,
    })

    logger.info(
      `Playing next track ${pStatus.trackId}, next track preloaded: ${!!nextTrack}, current_time: ${currentTime}, next_time: ${nextTime}`,
    )
    return `Playing track ${pStatus.trackId}`
  } catch (error) {
    logger.error(`Error playing next track: ${error}`)
    return null
  }
}

// 다음 트랙만 미리 로드 (플레이리스트 업데이트 시)
const preloadNextTrack = async () => {
  try {
    const tracks = pStatus.playlist?.tracks || []
    if (tracks.length === 0) {
      logger.warn('No tracks in playlist to preload')
      return null
    }

    const nextIdx = pStatus.trackId + 1
    if (nextIdx >= tracks.length) {
      logger.info('No next track to preload (end of playlist)')
      return null
    }

    const nextTrack = tracks[nextIdx]
    if (!nextTrack) {
      logger.warn('Next track not found')
      return null
    }

    // 다음 트랙의 이미지 표시 시간 (time 강제 지정 > 추가 오디오 길이 > 기본 5초)
    const nextTime = resolveImageTime(nextTrack)

    playerSend({
      command: 'preload_next',
      next: nextTrack,
      next_track_idx: nextIdx,
      next_time: nextTime,
    })

    logger.info(
      `Preloaded next track ${nextIdx}: ${nextTrack.filename}, next_time: ${nextTime}`,
    )
    return `Preloaded track ${nextIdx}`
  } catch (error) {
    logger.error(`Error preloading next track: ${error}`)
    return null
  }
}

export {
  getPlaylist,
  getTrackWithFileInfo,
  getPlaylists,
  addPlaylist,
  editPlaylist,
  setTracksToPlaylist,
  setPlaylist,
  setPlaylistTrackIndex,
  setPlaylistMode,
  editImageTime,
  editTrack,
  playlistPlay,
  playNextTrack,
  preloadNextTrack,
  // 멀티 윈도우(v3)
  multiWin,
  groupTracksByWindow,
  resolveImageTime,
  advanceWindowOnEnd,
  ensureWindows,
  // 멀티 PC(v3 Phase 5)
  startMultiWindowSynced,
}
