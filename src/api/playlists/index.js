import { randomUUID } from 'crypto'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbPlaylists, dbFiles, dbStatus } from '../../db/index.js'
import { playerSend, isPlayerConnected } from '../../player/index.js'
import { ioClient } from '../../web/index.js'
import { playFile } from '../player/index.js'
import {
  syncTrackAudios,
  setDeckAudioLive,
  stopAllTrackAudios,
  startAudios,
  stopAudios,
} from './trackAudio.js'

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
        delay_ms: Number.isFinite(a.delay_ms) ? a.delay_ms : 0, // 오디오 트랙별 시작 지연
      }
    }),
  )
  return results.filter(Boolean)
}

// 클립 1개(창별 동영상) 하이드레이션 — 파일 문서 + 영속 오버라이드 병합.
const hydrateClip = async (clip) => {
  if (!clip?.uuid) return null
  const file = await dbFiles.findOne({ uuid: clip.uuid })
  if (!file) {
    logger.warn(`File not found for clip uuid: ${clip.uuid}`)
    return null
  }
  return {
    ...file,
    time: clip.time || 0,
    volume: clip.volume ?? 100, // 레거시 마스터
    channel_map: Array.isArray(clip.channel_map) ? clip.channel_map : null,
    muted: clip.muted ?? false,
    embedded_streams: Array.isArray(clip.embedded_streams) ? clip.embedded_streams : null,
    fade_in_ms: clip.fade_in_ms ?? 0,
    fade_out_ms: clip.fade_out_ms ?? 0,
    // 멀티 윈도우(v3): 이 클립이 표시될 창 id (장면 내 슬롯)
    window: Number.isInteger(clip.window) ? clip.window : 0,
    // 클립별 시작 지연(ms) — 프리롤 완료 후 delay_ms 대기했다 표시
    delay_ms: Number.isFinite(clip.delay_ms) ? clip.delay_ms : 0,
    // 추가 오디오는 장면 단위로 분리(아래 getTrackWithFileInfo) — 클립에는 없음
  }
}

// 레거시 플랫 트랙({uuid,window,...})을 장면(1클립) 형태로 승격
const toSceneShape = (track) => {
  if (Array.isArray(track?.clips)) return track
  return { ...track, clips: track?.uuid ? [track] : [] }
}

// 플레이리스트 트랙 = 장면(scene). 각 장면은 창별 클립 묶음(clips[]).
// 반환: [{ clips: [hydratedClip...] }] (레거시 플랫 트랙은 1클립 장면으로 승격).
const getTrackWithFileInfo = async (tracks) => {
  if (!tracks || !Array.isArray(tracks)) {
    logger.error('Invalid tracks data')
    return []
  }
  const results = await Promise.all(
    tracks.map(async (raw) => {
      try {
        const scene = toSceneShape(raw)
        const clips = (await Promise.all(scene.clips.map(hydrateClip))).filter(Boolean)
        // 장면 단위 추가 오디오 (레거시: 클립에 있던 audios 승격)
        const audiosRaw = Array.isArray(scene.audios)
          ? scene.audios
          : scene.clips.flatMap((c) => (Array.isArray(c.audios) ? c.audios : []))
        const audios = await hydrateTrackAudios(audiosRaw)
        return { ...scene, clips, audios }
      } catch (error) {
        logger.error(`Error hydrating scene:`, error)
        return null
      }
    }),
  )
  return results.filter((item) => item !== null && item !== undefined && item.clips.length > 0)
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
        // 레거시 트랙 리스트 전송 (장면 모드에선 미사용 — 큰 metadata 블롭 전송 방지)
        if (!multiWin())
          playerSend({ command: 'set_tracks', tracks: pStatus.playlist.tracks })
        ioClient.emit('pStatus', { playlist: pStatus.playlist })
        // 다음 트랙 미리 로드
        await preloadNextTrack()
        triggerPreloadOnEdit(pStatus.playlist?.playlistId) // 편집 → 풀 재프리로드 (디바운스)
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
        // 레거시 트랙 리스트 전송 (장면 모드에선 미사용 — 큰 metadata 블롭 전송 방지)
        if (!multiWin())
          playerSend({ command: 'set_tracks', tracks: pStatus.playlist.tracks })
        ioClient.emit('pStatus', { playlist: pStatus.playlist })
        // 다음 트랙 미리 로드
        await preloadNextTrack()
        triggerPreloadOnEdit(pStatus.playlist?.playlistId) // 편집 → 풀 재프리로드 (디바운스)
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
    // 다른 플레이리스트로 전환 → 이전 프리로드 배지/상태 제거 (혼동 방지)
    if (pStatus.preloadedPlaylistId && pStatus.preloadedPlaylistId !== playlistId) {
      clearPreloadState()
    }
    pStatus.playlist = playlist || {}
    pStatus.trackId = 0
    ioClient.emit('pStatus', { playlist: pStatus.playlist, trackId: 0 })
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

// 전역 작업 모드 토글 ('scene' | 'window') — UI 에디터/목록/신규 기본 타입 결정. 영속 + emit.
// (실제 재생 분기는 로드된 플레이리스트의 mode 필드를 따른다.)
const setPlaybackMode = async (mode) => {
  const m = mode === 'window' ? 'window' : 'scene'
  pStatus.playbackMode = m
  try {
    await dbStatus.update({ type: 'playbackMode' }, { $set: { value: m } }, { upsert: true })
  } catch (e) {
    logger.error(`Failed to persist playbackMode: ${e}`)
  }
  ioClient.emit('pStatus', { playbackMode: m })
  return m
}

// 장면 tracks → 윈도우 평면 항목: 각 장면의 각 클립을 단일 창 항목으로. 장면 audios는 첫 클립에만
// 실어 중복 재생을 막는다 (장면 audios = 장면 공유 → 평면화 시 한 항목에만).
const sceneTracksToWindowItems = (tracks) => {
  const items = []
  for (const t of tracks || []) {
    const clips = Array.isArray(t.clips) ? t.clips : t.uuid ? [t] : []
    const audios = Array.isArray(t.audios) ? t.audios : []
    clips.forEach((c, i) => {
      items.push({
        window: Number.isInteger(c.window) ? c.window : 0,
        uuid: c.uuid,
        time: c.time || 0,
        delay_ms: Number.isFinite(c.delay_ms) ? c.delay_ms : 0,
        volume: c.volume ?? 100,
        muted: c.muted === true,
        channel_map: Array.isArray(c.channel_map) ? c.channel_map : null,
        embedded_streams: Array.isArray(c.embedded_streams) ? c.embedded_streams : null,
        audios: i === 0 ? audios : [],
      })
    })
  }
  return items
}

// 윈도우 평면 항목 → 장면 tracks: 각 항목을 1클립 장면으로 (audios는 장면 단위로 이동).
const windowItemsToScenes = (tracks) =>
  (tracks || []).map((t) => {
    if (Array.isArray(t.clips)) return t // 이미 장면 형태
    const { audios, ...clip } = t
    return { clips: [clip], audios: Array.isArray(audios) ? audios : [] }
  })

// 플레이리스트 1개의 타입을 즉시 전환 — tracks를 대상 모드 형태로 변환 후 mode와 함께 저장.
// 현재 로드/재생 중인 플레이리스트면 정지 후 새 모드로 pStatus 갱신 (모드 혼용 방지).
const switchPlaylistMode = async (id, mode) => {
  const m = mode === 'window' ? 'window' : 'scene'
  const pl = await dbPlaylists.findOne({ _id: id })
  if (!pl) return null
  const cur = pl.mode === 'window' ? 'window' : 'scene'
  let tracks = pl.tracks || []
  if (cur !== m) {
    tracks = m === 'window' ? sceneTracksToWindowItems(tracks) : windowItemsToScenes(tracks)
  }
  await dbPlaylists.update({ _id: id }, { $set: { mode: m, tracks } })

  // 현재 로드된 플레이리스트면 재생 정지 + pStatus 갱신 (진행 중 모드 전환의 레이스 방지)
  if (pStatus.playlist?._id === id) {
    if (pStatus.playlistMode) {
      playerSend({ command: 'stop_all' })
      resetScenes()
      stopAllTrackAudios()
    }
    pStatus.playlist = { ...pl, mode: m, tracks: await getTrackWithFileInfo(tracks) }
    ioClient.emit('pStatus', { playlist: pStatus.playlist })
  }
  return { mode: m }
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
      // 레거시 트랙 리스트 전송 (장면 모드에선 미사용)
      if (!multiWin())
        playerSend({ command: 'set_tracks', tracks: pStatus.playlist.tracks })
      ioClient.emit('pStatus', { playlist: pStatus.playlist })
      // 다음 트랙이 변경되었으면 다시 로드
      if (idx === pStatus.trackId + 1) {
        logger.info('Next track image time updated, reloading')
        await preloadNextTrack()
        triggerPreloadOnEdit(pStatus.playlist?.playlistId) // 편집 → 풀 재프리로드 (디바운스)
      }
    }

    return r
  } catch (error) {
    logger.error(`Error editing image time for playlist: ${error}`)
    return null
  }
}

// 트랙(장면) 영속 필드 부분 갱신 화이트리스트. 장면 = clips[](영상) + audios[](추가 오디오, 장면단위).
const TRACK_PATCH_KEYS = ['clips', 'audios']

// 채널별 [{out,volume,muted,name,delay_ms}] 정규화. name=UI 라벨(선택), delay_ms=출력 채널 지연(ms).
const normalizeChannels = (channels) =>
  (Array.isArray(channels) ? channels : []).map((c) => ({
    out: Number.isInteger(c?.out) ? c.out : -1,
    volume: Math.max(0, Math.min(100, Number(c?.volume ?? 100))),
    muted: c?.muted === true,
    name: typeof c?.name === 'string' ? c.name : '',
    delay_ms: Number.isFinite(c?.delay_ms) ? Math.max(0, c.delay_ms) : 0,
  }))

// 추가 오디오 항목 정규화 — id 부여(없으면), 필드 클램프. 하이드레이션 필드는 버린다.
const normalizeAudios = (audios) =>
  (Array.isArray(audios) ? audios : [])
    .filter((a) => a && a.uuid)
    .map((a) => ({
      id: a.id || `aud-${randomUUID()}`,
      uuid: a.uuid,
      volume: Math.max(0, Math.min(100, Number(a.volume ?? 100))),
      channel_map: Array.isArray(a.channel_map) ? a.channel_map : null,
      channels: Array.isArray(a.channels) ? normalizeChannels(a.channels) : null,
      muted: a.muted === true,
      loop: a.loop === true,
      delay_ms: Number.isFinite(a.delay_ms) ? Math.max(0, a.delay_ms) : 0,
    }))

// 클립 1개(창별 동영상) 영속 정규화 — 파일 문서 필드는 버리고 영속 필드만.
const normalizeClip = (clip) => ({
  window: Number.isInteger(clip?.window) ? clip.window : 0,
  uuid: clip?.uuid,
  time: clip?.time || 0,
  delay_ms: Number.isFinite(clip?.delay_ms) ? Math.max(0, clip.delay_ms) : 0,
  volume: Math.max(0, Math.min(100, Number(clip?.volume ?? 100))),
  channel_map: Array.isArray(clip?.channel_map) ? clip.channel_map : null,
  muted: clip?.muted === true,
  embedded_streams: Array.isArray(clip?.embedded_streams)
    ? clip.embedded_streams.map((s) => ({
        index: Number.isInteger(s?.index) ? s.index : 0,
        volume: Math.max(0, Math.min(100, Number(s?.volume ?? 100))),
        muted: s?.muted === true,
        channels: normalizeChannels(s?.channels),
      }))
    : null,
  // 추가 오디오는 장면 단위(audios[])로 분리 — 클립에는 저장하지 않음
})

const normalizeClips = (clips) =>
  (Array.isArray(clips) ? clips : []).filter((c) => c && c.uuid).map(normalizeClip)

// 장면(트랙) 부분 갱신 — clips[] 정규화 저장. 재생 중인 장면이면 재-하이드레이션 후 UI 갱신
// (라이브 볼륨/라우팅은 UI가 드래그 중 setDeckAudioLive/setTrackAudioLive로 이미 반영,
//  여기선 영속 + 추가/삭제 오디오 재동기화).
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
    // 레거시 플랫 트랙이면 장면 형태로 승격 후 편집
    const scene = Array.isArray(playlist.tracks[idx].clips)
      ? playlist.tracks[idx]
      : { clips: playlist.tracks[idx].uuid ? [playlist.tracks[idx]] : [] }
    if ('clips' in patch) scene.clips = normalizeClips(patch.clips)
    if ('audios' in patch) scene.audios = normalizeAudios(patch.audios) // 장면 단위 추가 오디오
    playlist.tracks[idx] = scene

    const r = await dbPlaylists.update({ _id: id }, { $set: { tracks: playlist.tracks } })

    if (pStatus.playlistMode && pStatus.playlist?._id === id) {
      pStatus.playlist = { ...playlist, tracks: await getTrackWithFileInfo(playlist.tracks) }
      ioClient.emit('pStatus', { playlist: pStatus.playlist })
      // 현재 장면의 오디오 스택 변경이면 재동기화 (추가/삭제 오디오 반영) + 채널 지연 라이브 적용
      if (idx === pStatus.trackId) {
        syncTrackAudios(pStatus.trackId, true)
        applySceneChannelDelays(pStatus.playlist.tracks?.[idx])
      }
      // 편집 → 풀 재프리로드 (디바운스, 현재 열린 플레이리스트만)
      triggerPreloadOnEdit(pStatus.playlist?.playlistId)
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

// 플레이어가 동기 배치 재생(play_synced 배리어)을 지원하는지. 지원 시 창별 명령 대신 배치 1개를
// 보내면 플레이어가 전 창을 프리롤 완료 후 동일 start_at으로 동시 스왑(락스텝)한다.
const playSyncedSupported = () => multiWin() && Array.isArray(pStatus.playerFeatures) &&
  pStatus.playerFeatures.includes('play_synced')

// 로컬 동기 리드타임(ms). 프리롤은 플레이어 배리어가 선결하므로 스왑/링크 여유만 필요.
const LOCAL_SYNC_LEAD_MS = 150

const channelDelaySupported = () =>
  Array.isArray(pStatus.playerFeatures) && pStatus.playerFeatures.includes('channel_delay')

// 장면의 채널별 지연(ms)을 출력 채널 지연 배열로 집계해 플레이어에 적용 (set_channel_delays 재사용).
// 각 오디오 채널 행의 out(출력 채널) 위치에 delay_ms를 매핑, 같은 출력에 여러 소스면 최대값.
// 전역 설정 폐지 → 지연은 재생 중인 장면의 채널 설정을 따른다.
const applySceneChannelDelays = (scene) => {
  if (!channelDelaySupported()) return
  const delays = []
  const put = (channels) => {
    for (const ch of channels || []) {
      const out = Number.isInteger(ch?.out) ? ch.out : -1
      const d = Number.isFinite(ch?.delay_ms) ? Math.max(0, ch.delay_ms) : 0
      if (out < 0) continue
      delays[out] = Math.max(delays[out] || 0, d)
    }
  }
  for (const c of scene?.clips || []) put(c.embedded_streams?.[0]?.channels)
  for (const a of scene?.audios || []) put(a.channels)
  for (let i = 0; i < delays.length; i++) if (!Number.isFinite(delays[i])) delays[i] = 0
  playerSend({ command: 'set_channel_delays', delays })
}

// ── 장면(Scene) 모델 ──
// 트랙 = 장면. 각 장면은 창별 클립 묶음(clips[]). 장면 재생 = 창들 동시 재생.
// 장면 전환 = 현재 장면의 모든 창 클립이 끝나면(가장 긴 것 기준) 전 창 함께 다음 장면으로.
const sceneClips = (scene) => (Array.isArray(scene?.clips) ? scene.clips : [])
const clipWin = (clip) => (Number.isInteger(clip?.window) ? clip.window : 0)

// 전체 장면에서 참조된 창 id 집합 (create_window 대상)
const windowsInScenes = (scenes) => {
  const s = new Set()
  for (const sc of scenes || []) for (const c of sceneClips(sc)) s.add(clipWin(c))
  return [...s]
}
// 창 W가 등장하는 장면 순서대로의 클립 목록 [{sceneIdx, clip}] (창별 프리롤/다음클립 계산)
const windowClipSequence = (scenes, W) => {
  const seq = []
  ;(scenes || []).forEach((sc, sceneIdx) => {
    const clip = sceneClips(sc).find((c) => clipWin(c) === W)
    if (clip) seq.push({ sceneIdx, clip })
  })
  return seq
}

// 플레이어 전송용 슬림 file — 플레이어가 쓰는 필드만. 하이드레이션의 거대한 metadata/thumbnail
// 블롭을 통째로 보내면 루프백 TCP가 back-pressure로 멈춰(정지/피드백 불가) 재생이 안 멈추는
// 버그가 있었다. 반드시 최소 필드만 전송한다.
const toPlayerFile = (clip) => {
  const t = resolveImageTime(clip)
  return {
    path: clip.path,
    uuid: clip.uuid,
    is_image: clip.is_image,
    mimetype: clip.mimetype,
    time: t !== undefined ? t : clip.time || 0,
    delay_ms: Number.isFinite(clip.delay_ms) ? clip.delay_ms : 0,
    in_ms: clip.in_ms,
    volume: clip.volume,
    channel_map: Array.isArray(clip.channel_map) ? clip.channel_map : null,
    muted: clip.muted,
    embedded_streams: Array.isArray(clip.embedded_streams) ? clip.embedded_streams : null,
    audios: (clip.audios || []).map((a) => ({
      id: a.id,
      uuid: a.uuid,
      path: a.path,
      volume: a.volume,
      channel_map: Array.isArray(a.channel_map) ? a.channel_map : null,
      channels: Array.isArray(a.channels) ? a.channels : null,
      muted: a.muted,
      loop: a.loop,
      delay_ms: Number.isFinite(a.delay_ms) ? a.delay_ms : 0,
    })),
  }
}
const fileForPlayer = (clip) => toPlayerFile(clip)

// 장면 재생 상태 (모듈 로컬)
let currentSceneIdx = 0
let sceneEndedWins = new Set()

// 창별 프리롤 진척 캐시 (preload_status 피드백 누적) — windowId → {expected, prerolled}
const preloadCache = {}

// 프리롤 상태 피드백 수신 → pStatus.preloadStatus/preloadReady 갱신 (UI 배지). parser에서 호출.
const onPreloadStatus = (data) => {
  if (!data || data.window_id == null) return
  const W = data.window_id
  if (data.event === 'cleared') delete preloadCache[W]
  else preloadCache[W] = { expected: data.expected || 0, prerolled: data.prerolled || 0 }

  const preloadStatus = {}
  for (const [w, v] of Object.entries(preloadCache)) {
    preloadStatus[w] = {
      expected: v.expected,
      prerolled: v.prerolled,
      ready: v.expected > 0 && v.prerolled >= v.expected,
    }
  }
  // 활성 창(프리롤 대상이 있는 창) 전부 준비되면 로딩 완료.
  const active = Object.values(preloadStatus).filter((v) => v.expected > 0)
  pStatus.preloadStatus = preloadStatus
  pStatus.preloadReady = active.length > 0 && active.every((v) => v.ready)
  ioClient.emit('pStatus', { preloadStatus, preloadReady: pStatus.preloadReady })
}

// 프리로드 상태 전체 초기화 (정지/플레이리스트 전환 시 배지 제거)
const clearPreloadState = () => {
  for (const k of Object.keys(preloadCache)) delete preloadCache[k]
  pStatus.preloadedPlaylistId = null
  pStatus.preloadStatus = {}
  pStatus.preloadReady = false
  ioClient.emit('pStatus', {
    preloadedPlaylistId: null,
    preloadStatus: {},
    preloadReady: false,
  })
}

// 편집 → 프리로드 (디바운스). 현재 열린/활성 플레이리스트를 수정하면 풀을 (재)프리롤해 무지연·동기
// 재생을 준비하고, 낙관적으로 "로딩중" 배지를 켠다. 임의의 다른 플레이리스트는 대상 아님(메모리 보호).
const preloadDebounce = new Map() // playlistId -> timer
const triggerPreloadOnEdit = (playlistId) => {
  if (!multiWin() || !playlistId) return
  if (pStatus.playlist?.playlistId !== playlistId) return // 현재 열린 플레이리스트만
  pStatus.preloadedPlaylistId = playlistId
  pStatus.preloadReady = false
  ioClient.emit('pStatus', { preloadedPlaylistId: playlistId, preloadReady: false })
  clearTimeout(preloadDebounce.get(playlistId))
  preloadDebounce.set(
    playlistId,
    setTimeout(async () => {
      preloadDebounce.delete(playlistId)
      if (pStatus.playlist?.playlistId !== playlistId) return // 그 사이 전환됨
      if (!pStatus.playlistMode) await setPlaylistMode(true)
      preloadScenes(pStatus.trackId || 0)
    }, 500),
  )
}

// 정지 시 장면 컨트롤러 상태 + 창 상태 초기화 (전 창 동시 정지 반영)
const resetScenes = () => {
  currentSceneIdx = 0
  sceneEndedWins = new Set()
  pStatus.windowStates = {}
  clearPreloadState()
  if (channelDelaySupported()) playerSend({ command: 'set_channel_delays', delays: [] }) // 지연 해제
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
}

// 설정된(pStatus.windows) 창 id 집합 — 재생/생성 대상의 권위. 미설정 창 id(구 플레이리스트의
// 잔존 클립 등)는 전체화면 검정 창으로 자동 생성되지 않도록 무시한다.
const configuredWindowIds = () => new Set((pStatus.windows || []).map((w) => w.id))

// 설정된 창 중 아직 플레이어에 없는 것만 create_window (미설정 창은 생성하지 않음)
const ensureWindows = (windowIds) => {
  const existing = new Set((pStatus.playerWindows || []).map((w) => w.window_id))
  for (const W of windowIds) {
    if (existing.has(W)) continue
    const cfg = (pStatus.windows || []).find((w) => w.id === W)
    if (!cfg) continue // 미설정 창은 생성하지 않음 (전체화면 검정 창 방지)
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

// 장면 1개 재생 — 전 창의 클립을 동시에 재생(+각 창 다음 클립 프리로드). startAt(ns)이 주어지면
// 공유 러닝타임에 정렬(멀티 PC 락스텝). 이 장면에 클립 없는 창은 배경(정지).
const playScene = (sceneIdx, startAt = null) => {
  const scenes = pStatus.playlist.tracks || []
  const scene = scenes[sceneIdx]
  if (!scene) return
  currentSceneIdx = sceneIdx
  sceneEndedWins = new Set()

  // 설정된 창의 클립만 재생 — 미설정 창(구 플레이리스트 잔존 클립 등)은 무시(검정 전체화면 방지)
  const known = configuredWindowIds()
  const clipsHere = sceneClips(scene).filter((c) => known.has(clipWin(c)))
  const activeWins = new Set(clipsHere.map(clipWin))
  // 이 장면에 클립 없는(전체에서 쓰인) 창은 배경 처리
  for (const W of windowsInScenes(scenes)) {
    if (!activeWins.has(W)) playerSend({ command: 'stop', window_id: W })
  }

  pStatus.windowStates = {}
  const clipSpecs = []
  for (const clip of clipsHere) {
    const W = clipWin(clip)
    const seq = windowClipSequence(scenes, W)
    const pos = seq.findIndex((e) => e.sceneIdx === sceneIdx)
    let nextEntry = seq[pos + 1] || null
    if (!nextEntry && pStatus.repeat === 'all') nextEntry = seq[0] || null
    clipSpecs.push({
      window_id: W,
      track_idx: sceneIdx,
      current: fileForPlayer(clip),
      next: nextEntry ? fileForPlayer(nextEntry.clip) : null,
      current_time: resolveImageTime(clip),
      next_time: nextEntry ? resolveImageTime(nextEntry.clip) : undefined,
    })
    pStatus.windowStates[W] = {
      sceneIndex: sceneIdx,
      trackId: sceneIdx,
      uuid: clip.uuid,
      filename: clip.filename,
      activePlayerId: 0,
      player: { time: 0, duration: 0, position: 0, is_playing: true, event: 'playing' },
    }
  }

  // 동기 배치 전송: play_synced 지원 시 전 창을 하나의 배리어로 묶어 플레이어가 프리롤 완료 후
  // 동일 start_at으로 동시 스왑(로컬 락스텝). startAt이 명시되면(멀티 PC master) 그 값을 쓰고,
  // 없으면 플레이어가 로컬 러닝타임+lead로 계산. 미지원 플레이어는 창별 명령으로 폴백.
  if (playSyncedSupported() && clipSpecs.length) {
    const cmd = {
      command: 'play_synced',
      scene_idx: sceneIdx,
      lead_ms: LOCAL_SYNC_LEAD_MS,
      timeout_ms: 1500,
      clips: clipSpecs,
    }
    if (startAt != null) cmd.start_at = startAt
    playerSend(cmd)
  } else {
    for (const c of clipSpecs) {
      const cur = startAt != null ? { ...c.current, start_at: startAt } : c.current
      playerSend({
        command: 'play_current_and_load_next',
        window_id: c.window_id,
        track_idx: c.track_idx,
        current: cur,
        next: c.next,
        current_time: c.current_time,
        next_time: c.next_time,
      })
    }
  }

  // 하위호환 단일 필드 + 장면 오디오 스택 동기화 (전 클립 audios 합침). 주 창 개념 폐지 →
  // 대표 표시는 장면의 첫 클립.
  pStatus.trackId = sceneIdx
  pStatus.file = clipsHere[0] || {}
  syncTrackAudios(sceneIdx, true)
  applySceneChannelDelays(scene) // 이 장면의 채널별 출력 지연 적용
  ioClient.emit('pStatus', {
    playlist: pStatus.playlist,
    windowStates: pStatus.windowStates,
    trackId: pStatus.trackId,
    file: pStatus.file,
  })
  logger.info(`Scene ${sceneIdx} play: ${clipsHere.length} clips [win ${[...activeWins].join(',')}]`)
}

// 프리롤만 수행(재생 안 함): 프리롤 설정 + 창 생성 + 창별 전 클립 프리롤.
// 재생 없이 전 트랙을 메모리에 올려두는 "플레이리스트 로딩". current_index 기준으로 채운다.
const preloadScenes = (sceneIdx = 0) => {
  const scenes = pStatus.playlist.tracks || []
  // 설정된 창만 대상 (미설정 창 참조 클립 제외 — preload 에러 방지)
  const known = configuredWindowIds()
  const windowIds = windowsInScenes(scenes).filter((w) => known.has(w))

  const lookahead = Number.isInteger(pStatus.preloadLookahead) ? pStatus.preloadLookahead : 2
  const maxDecks = Number.isInteger(pStatus.preloadMaxDecks) ? pStatus.preloadMaxDecks : 8
  playerSend({ command: 'set_preload_config', lookahead, max_decks: maxDecks })
  ensureWindows(windowIds)

  for (const W of windowIds) {
    const seq = windowClipSequence(scenes, W)
    const files = seq.map((e) => fileForPlayer(e.clip))
    let curIdx = seq.findIndex((e) => e.sceneIdx === sceneIdx)
    if (curIdx < 0) curIdx = 0
    playerSend({ command: 'preload_playlist', window_id: W, current_index: curIdx, tracks: files })
  }
  return windowIds.length
}

// 재생 없이 플레이리스트를 로드+프리롤 (로딩 버튼). 이후 재생은 즉시 승격되어 무지연.
const preloadPlaylistOnly = async (playlistId) => {
  if (!isPlayerConnected()) return null
  const playlist = await getPlaylist(playlistId)
  if (!playlist) return null
  pStatus.playlist = playlist
  await setPlaylistMode(true)
  preloadScenes(0)
  pStatus.preloadedPlaylistId = playlistId
  ioClient.emit('pStatus', { playlist: pStatus.playlist, preloadedPlaylistId: playlistId })
  logger.info(`Preloaded playlist ${playlistId} (${(playlist.tracks || []).length} scenes)`)
  return `Preloaded ${playlistId}`
}

// 장면 재생 시작. 빠른 시작을 위해 현재 장면(+다음)만 즉시 빌드하고, 전 트랙 풀 프리롤은
// 하지 않는다(그건 "로딩" 버튼 몫). 이미 로딩(프리로드)된 상태면 풀에서 즉시 승격돼 무지연.
// (예전엔 재생 시 전 트랙 풀을 동시에 프리롤해 현재 클립 프리롤이 경쟁 → 시작이 수십 초 지연.)
const startScenes = (sceneIdx, startAt = null) => {
  const scenes = pStatus.playlist.tracks || []
  const known = configuredWindowIds()
  const windowIds = windowsInScenes(scenes).filter((w) => known.has(w))
  const lookahead = Number.isInteger(pStatus.preloadLookahead) ? pStatus.preloadLookahead : 2
  const maxDecks = Number.isInteger(pStatus.preloadMaxDecks) ? pStatus.preloadMaxDecks : 8
  playerSend({ command: 'set_preload_config', lookahead, max_decks: maxDecks })
  ensureWindows(windowIds)
  playScene(sceneIdx, startAt) // 현재+다음만 빌드 → 즉시 시작 (풀 있으면 승격)
}

// 장면 전환 — 현재 장면의 모든 활성 창이 끝났을 때 호출 (동기 전환)
const advanceScene = (startAt = null) => {
  const scenes = pStatus.playlist.tracks || []
  const repeat = pStatus.repeat

  if (repeat === 'repeat_one') {
    triggerOrPlayScene(currentSceneIdx, startAt)
    return
  }
  let next = currentSceneIdx + 1
  if (next >= scenes.length) {
    if (repeat === 'all') {
      next = 0
    } else {
      playerSend({ command: 'stop_all' })
      stopAllTrackAudios()
      pStatus.windowStates = {}
      pStatus.trackId = 0
      ioClient.emit('pStatus', { windowStates: pStatus.windowStates, trackId: 0 })
      return
    }
  }
  triggerOrPlayScene(next, startAt)
}

// master면 공유 start_at 계산 후 전 PC 트리거, 아니면 로컬 재생
const triggerOrPlayScene = (sceneIdx, startAt = null) => {
  if (pStatus.sync?.role === 'master' && startAt == null) {
    import('../player/peerSync.js').then(({ computeStartAt, triggerSyncPlay }) => {
      const at = computeStartAt()
      const baseTime = Number(pStatus.sync.ptp?.base_time)
      playScene(sceneIdx, at)
      triggerSyncPlay(pStatus.playlist.playlistId, sceneIdx, at, baseTime)
    })
  } else {
    playScene(sceneIdx, startAt)
  }
}

// 창별 end_reached 수신 — 현재 장면의 모든 활성 창이 끝나면 다음 장면으로 (가장 긴 클립 기준).
// 먼저 끝난 창은 마지막 프레임을 유지(정지화면). slave는 자체 전환하지 않고 master 트리거를 따른다.
const onSceneWindowEnd = (data) => {
  if (pStatus.sync?.role === 'slave') return // slave는 master 멀티캐스트 트리거로만 전환
  const scenes = pStatus.playlist?.tracks || []
  const scene = scenes[currentSceneIdx]
  if (!scene) return
  const W = data.window_id ?? 0
  const endedScene = data.playlist_track_index
  if (typeof endedScene === 'number' && endedScene !== currentSceneIdx) return // 지연/구 이벤트 방어
  // 실제 재생된 창(설정된 창의 클립)만 종료 판정에 포함 — 미설정 창(0/3 등)은 재생 안 됐으니
  // end_reached가 오지 않아, 포함하면 장면이 영원히 안 넘어가 멈춘다.
  const known = configuredWindowIds()
  const activeWins = new Set(sceneClips(scene).map(clipWin).filter((w) => known.has(w)))
  if (!activeWins.has(W)) return
  sceneEndedWins.add(W)
  if (sceneEndedWins.size < activeWins.size) return // 아직 재생 중인 창 대기 (끝난 창=마지막 프레임)
  advanceScene()
}

// ---------------------------------------------------------------------------
// 윈도우 모드 (playlist.mode === 'window') — 창별 독립 재생/정지
//
// 장면 모드가 전 창을 락스텝으로 묶는 것과 달리, 윈도우 모드는 각 창이 자기만의 항목 시퀀스를
// 독립적으로 재생·정지한다. 창별 end_reached에 그 창 커서만 전진하고(advanceWindowOnEnd),
// 전역 repeat 설정을 창별로 적용한다. play_synced(락스텝)는 쓰지 않는다.
//
// 데이터: 윈도우 모드 플레이리스트는 tracks를 "단일 창 항목의 평면 배열"로 저장하지만, 하이드레이션
// 후엔 각 항목이 1클립 장면({clips:[clip], audios:[...]})이 된다. windowItemSequence가 창별로
// 순서를 유지해 시퀀스를 뽑는다(장면 모드의 다클립 장면도 안전하게 처리).
// ---------------------------------------------------------------------------

// 창 W의 항목 시퀀스 [{ seqIdx, clip, audios }] — 창별 독립 재생 목록.
const windowItemSequence = (scenes, W) => {
  const seq = []
  ;(scenes || []).forEach((sc) => {
    const clip = sceneClips(sc).find((c) => clipWin(c) === W)
    if (clip) seq.push({ clip, audios: Array.isArray(sc.audios) ? sc.audios : [] })
  })
  return seq.map((e, seqIdx) => ({ ...e, seqIdx }))
}

// 현재 재생 중인 전 창 항목의 채널 지연을 집계해 적용 (오디오 버스는 전역 공유 → 창들의 합집합).
const applyWindowChannelDelays = () => {
  const scenes = pStatus.playlist.tracks || []
  const clips = []
  const audios = []
  for (const [W, st] of Object.entries(pStatus.windowStates || {})) {
    const seq = windowItemSequence(scenes, Number(W))
    const item = seq[st.seqIndex]
    if (!item) continue
    clips.push(item.clip)
    for (const a of item.audios || []) audios.push(a)
  }
  applySceneChannelDelays({ clips, audios })
}

// 창 항목 1개 재생 (+ 그 항목 추가 오디오 기동, 이전 오디오 정지). windowStates[W] 갱신.
const playWindowItem = (W, seq, start) => {
  const files = seq.map((e) => fileForPlayer(e.clip))
  playerSend({ command: 'preload_playlist', window_id: W, current_index: start, tracks: files })
  playerSend({
    command: 'play_current_and_load_next',
    window_id: W,
    track_idx: start,
    current: files[start],
    next: files[start + 1] || null,
    current_time: resolveImageTime(seq[start].clip),
    next_time: files[start + 1] ? resolveImageTime(seq[start + 1].clip) : undefined,
  })
  const prev = pStatus.windowStates[W]
  if (prev) stopAudios(prev.audioIds)
  const audioIds = startAudios(seq[start].audios)
  pStatus.windowStates[W] = {
    seqIndex: start,
    trackId: start,
    uuid: seq[start].clip.uuid,
    filename: seq[start].clip.filename,
    activePlayerId: 0,
    audioIds,
    player: { time: 0, duration: 0, position: 0, is_playing: true, event: 'playing' },
  }
}

// 윈도우 모드 재생 시작 — 설정된 전 창을 각자 첫 항목부터 동시에 (그러나 독립적으로) 시작.
const startWindowPlaylist = () => {
  const scenes = pStatus.playlist.tracks || []
  const known = configuredWindowIds()
  const windowIds = windowsInScenes(scenes).filter((w) => known.has(w))
  const lookahead = Number.isInteger(pStatus.preloadLookahead) ? pStatus.preloadLookahead : 2
  const maxDecks = Number.isInteger(pStatus.preloadMaxDecks) ? pStatus.preloadMaxDecks : 8
  playerSend({ command: 'set_preload_config', lookahead, max_decks: maxDecks })
  ensureWindows(windowIds)

  pStatus.windowStates = {}
  for (const W of windowIds) {
    const seq = windowItemSequence(scenes, W)
    if (!seq.length) continue
    playWindowItem(W, seq, 0)
  }
  // 하위호환 단일 필드 (대표 = 첫 활성 창의 첫 항목)
  const w0 = windowIds.find((W) => pStatus.windowStates[W])
  if (w0 != null) {
    pStatus.trackId = 0
    pStatus.file = windowItemSequence(scenes, w0)[0]?.clip || {}
  }
  applyWindowChannelDelays()
  ioClient.emit('pStatus', {
    playlist: pStatus.playlist,
    windowStates: pStatus.windowStates,
    trackId: pStatus.trackId,
    file: pStatus.file,
  })
  logger.info(`Window playlist play: ${windowIds.length} windows [${windowIds.join(',')}]`)
}

// 창별 end_reached — 해당 창 커서만 전진 (전역 repeat를 창별 적용). slave는 자체 전환 안 함.
const advanceWindowOnEnd = (data) => {
  if (pStatus.sync?.role === 'slave') return
  const W = data.window_id ?? 0
  if (!configuredWindowIds().has(W)) return
  // 활성(재생 중) 창만 전진 — 전역/창별 정지로 windowStates[W]가 지워졌으면 뒤늦게 도착한
  // end_reached는 무시(정지 후 repeat=all이 재생을 되살리는 레이스 방지).
  if (!pStatus.windowStates[W]) return
  const scenes = pStatus.playlist?.tracks || []
  const seq = windowItemSequence(scenes, W)
  if (!seq.length) return
  const st = pStatus.windowStates[W]
  const endedSeq =
    typeof data.playlist_track_index === 'number'
      ? data.playlist_track_index
      : st?.seqIndex ?? 0
  const repeat = pStatus.repeat
  const isLast = endedSeq >= seq.length - 1
  const files = seq.map((e) => fileForPlayer(e.clip))

  if (repeat === 'repeat_one') {
    playerSend({ command: 'stop', window_id: W })
    playerSend({
      command: 'play_current_and_load_next',
      window_id: W,
      track_idx: endedSeq,
      current: files[endedSeq],
      next: files[endedSeq + 1] || null,
      current_time: resolveImageTime(seq[endedSeq].clip),
      next_time: files[endedSeq + 1] ? resolveImageTime(seq[endedSeq + 1].clip) : undefined,
    })
    updateWindowAfterAdvance(W, seq, endedSeq)
  } else if (!isLast) {
    playerSend({ command: 'next', window_id: W })
    updateWindowAfterAdvance(W, seq, endedSeq + 1)
  } else if (repeat === 'all') {
    playerSend({
      command: 'play_current_and_load_next',
      window_id: W,
      track_idx: 0,
      current: files[0],
      next: files[1] || null,
      current_time: resolveImageTime(seq[0].clip),
      next_time: files[1] ? resolveImageTime(seq[1].clip) : undefined,
    })
    updateWindowAfterAdvance(W, seq, 0)
  } else {
    // none → 이 창만 정지 (마지막 프레임 유지). 다른 창은 계속.
    playerSend({ command: 'stop', window_id: W })
    if (st) stopAudios(st.audioIds)
    delete pStatus.windowStates[W]
    applyWindowChannelDelays()
    ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
  }
}

// advance 후 windowStates[W] 갱신 + 항목 오디오 전환 (이전 정지·새 기동)
const updateWindowAfterAdvance = (W, seq, newSeqIdx) => {
  const idx = Math.min(Math.max(0, newSeqIdx), seq.length - 1)
  const st = pStatus.windowStates[W] || { activePlayerId: 0, audioIds: [], player: {} }
  stopAudios(st.audioIds)
  st.audioIds = startAudios(seq[idx].audios)
  st.seqIndex = idx
  st.trackId = idx
  st.uuid = seq[idx].clip.uuid
  st.filename = seq[idx].clip.filename
  pStatus.windowStates[W] = st
  applyWindowChannelDelays()
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
}

// 단일 창 (재)재생 (창별 재생 버튼). index = 창 시퀀스 내 시작 위치.
const playWindow = (windowId, index = 0) => {
  const W = Number(windowId)
  if (!configuredWindowIds().has(W)) return null
  const scenes = pStatus.playlist.tracks || []
  const seq = windowItemSequence(scenes, W)
  if (!seq.length) return null
  const lookahead = Number.isInteger(pStatus.preloadLookahead) ? pStatus.preloadLookahead : 2
  const maxDecks = Number.isInteger(pStatus.preloadMaxDecks) ? pStatus.preloadMaxDecks : 8
  playerSend({ command: 'set_preload_config', lookahead, max_decks: maxDecks })
  ensureWindows([W])
  let start = Number(index)
  if (!Number.isInteger(start) || start < 0 || start >= seq.length) start = 0
  playWindowItem(W, seq, start)
  applyWindowChannelDelays()
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
  logger.info(`Window ${W} play @${start}`)
  return `play window ${W} @${start}`
}

// 창별 재생 REST 진입점 — 필요 시 플레이리스트를 로드/모드 세팅 후 그 창만 재생.
const playWindowInPlaylist = async (playlistId, windowId, index = 0) => {
  if (!isPlayerConnected()) return null
  if (!multiWin()) return null
  if (
    playlistId != null &&
    (Object.keys(pStatus.playlist).length === 0 ||
      pStatus.playlist.playlistId !== Number(playlistId))
  ) {
    const playlist = await getPlaylist(Number(playlistId))
    if (!playlist) return null
    pStatus.playlist = playlist
    await setPlaylistMode(true)
    ioClient.emit('pStatus', { playlist: pStatus.playlist })
  } else if (!pStatus.playlistMode) {
    await setPlaylistMode(true)
  }
  return playWindow(windowId, index)
}

// 단일 창 정지 (창별 정지 버튼) — 그 창만 stop + windowStates 키 삭제 + 그 창 오디오 정지.
// stop_all/resetScenes 호출 금지 (다른 창까지 죽는다).
const stopWindow = (windowId) => {
  const W = Number(windowId)
  playerSend({ command: 'stop', window_id: W })
  const st = pStatus.windowStates[W]
  if (st) stopAudios(st.audioIds)
  delete pStatus.windowStates[W]
  applyWindowChannelDelays()
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
  logger.info(`Window ${W} stop`)
  return `stop window ${W}`
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
  startScenes(trackIdx, startAt)
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

    // 윈도우 모드 — 각 창이 자기 목록을 독립 재생 (멀티 윈도우 플레이어 필수).
    if (multiWin() && pStatus.playlist.mode === 'window') {
      startWindowPlaylist()
      return `Playing window playlist ${playlistId}`
    }

    // 장면(Scene) 재생 — 트랙=장면(창별 클립 묶음). 멀티 윈도우 플레이어 필수.
    if (multiWin()) {
      // 멀티 PC master: 공유 start_at 계산 후 로컬+전 slave 동시 트리거 (락스텝)
      if (pStatus.sync?.role === 'master') {
        const { computeStartAt, triggerSyncPlay } = await import('../player/peerSync.js')
        const startAt = computeStartAt()
        const baseTime = Number(pStatus.sync.ptp?.base_time)
        startScenes(Number(trackIdx), startAt)
        triggerSyncPlay(playlistId, Number(trackIdx), startAt, baseTime)
        return `Playing playlist ${playlistId} (multi-PC master) @${startAt}`
      }
      startScenes(Number(trackIdx))
      return `Playing playlist ${playlistId} (scenes) from scene ${trackIdx}`
    }

    // 폴백(구버전 플레이어 — multi_window 미지원): 장면의 첫 클립만 주 창에서 재생
    const scene0 = tracks[Number(trackIdx)]
    const currentTrack = sceneClips(scene0)[0]
    const nextTrack = sceneClips(tracks[Number(trackIdx) + 1])[0] || null

    if (!currentTrack) {
      logger.error('Current scene has no clip')
      return null
    }

    // 현재 재생 파일 설정
    pStatus.file = currentTrack
    ioClient.emit('pStatus', {
      playlist: pStatus.playlist,
      file: pStatus.file,
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

// 다음 트랙만 미리 로드 (플레이리스트 업데이트 시) — 장면 모드에선 프리롤 풀이 담당하므로 no-op
const preloadNextTrack = async () => {
  try {
    if (multiWin()) return null // 장면 모드: preload_playlist 풀이 처리
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
  // 멀티 윈도우/장면(v3)
  multiWin,
  resolveImageTime,
  ensureWindows,
  startScenes,
  playScene,
  onSceneWindowEnd,
  resetScenes,
  preloadPlaylistOnly,
  onPreloadStatus,
  // 윈도우 모드 (창별 독립 재생/정지)
  setPlaybackMode,
  switchPlaylistMode,
  startWindowPlaylist,
  advanceWindowOnEnd,
  playWindow,
  playWindowInPlaylist,
  stopWindow,
  // 멀티 PC(v3 Phase 5)
  startMultiWindowSynced,
}
