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
      if (!af.path) {
        logger.warn(`Audio file has no path, skipping: ${a.uuid}`)
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
  // path 없는 파일(손상/이관 데이터)은 제외 — 플레이어 filesrc가 빈 경로→작업폴더를 열려다 실패한다.
  if (!file.path) {
    logger.warn(`File has no path, skipping clip: ${clip.uuid}`)
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
        return { clips: [], audios: [] } // 실패 시 빈 장면으로 보존 (raw와 1:1 인덱스 정렬 유지)
      }
    }),
  )
  // 빈 장면(clips/audios 없음)도 그대로 보존한다 — "장면 추가"로 만든 빈 트랙이 UI에서 편집 가능해야
  // 하고, 재생 시에만 건너뛰기 때문. raw tracks와 1:1 인덱스가 유지되어야 editTrack(idx) 등이 어긋나지
  // 않는다(예전엔 clips.length>0만 남겨 빈/미해결 장면에서 인덱스가 밀릴 수 있었다).
  return results
}

// 이미지 판정 — is_image 필드 + mimetype 폴백. 구 파일/일부 경로는 is_image가 비어있을 수 있는데,
// 그 경우 resolveImageTime이 undefined→time 0을 내려 플레이어가 이미지 타이머를 안 걸어(SwapTo의
// `image_time_ms > 0` 게이트) 이미지가 다음으로 안 넘어간다. mimetype로도 판정해 항상 타이머가 걸리게 한다.
const isImageFile = (f) =>
  f?.is_image === true ||
  (typeof f?.mimetype === 'string' && f.mimetype.startsWith('image/'))

// 이미지 트랙의 표시 시간(초) 결정.
// - time이 명시적으로(0이 아닌 값) 설정돼 있으면 그 값을 강제 사용.
// - time이 0/미설정이면 붙어있는 추가 오디오의 길이(metadata.format.duration, 초 단위
//   문자열 — vplayer probe_media가 std::to_string(double)로 내려줌)를 사용.
// - 오디오가 없거나 길이를 못 구하면 기존 기본값 5초로 폴백.
const resolveImageTime = (track) => {
  if (!isImageFile(track)) return undefined
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
    // 하이드레이션(uuid→파일 조인으로 path 채움)해서 저장 — raw로 두면 이 플레이리스트를 그대로
    // 재생할 때 clip.path가 비어 플레이어가 잘못된 경로를 열려다 실패한다(playlistPlay가 같은
    // playlistId면 재조회를 건너뛰므로 여기서 하이드레이션이 필수).
    const playlist = await getPlaylist(playlistId)
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

// 트랙(장면) 영속 필드 부분 갱신 화이트리스트. 장면 = clips[](영상) + audios[](추가 오디오, 장면단위) + name(선택).
const TRACK_PATCH_KEYS = ['clips', 'audios', 'name']

// 장면 이름 정규화 — 문자열 트림 + 최대 40자. 빈 문자열이면 '' (이름 없음 = UI에서 "장면 N" 표시).
const normalizeSceneName = (name) =>
  typeof name === 'string' ? name.trim().slice(0, 40) : ''

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
    if ('name' in patch) {
      const nm = normalizeSceneName(patch.name)
      if (nm) scene.name = nm
      else delete scene.name // 빈 이름 → 필드 제거 (기본 "장면 N" 표시로 복귀)
    }
    playlist.tracks[idx] = scene
    // 이름만 바뀐 편집(clips/audios 무변경)은 미디어 파이프라인을 건드릴 필요가 없다 —
    // 재생 중인 장면 이름을 바꿔도 오디오 재동기화/풀 재프리로드로 재생이 튀지 않게 한다.
    const mediaChanged = 'clips' in patch || 'audios' in patch

    const r = await dbPlaylists.update({ _id: id }, { $set: { tracks: playlist.tracks } })

    if (pStatus.playlistMode && pStatus.playlist?._id === id) {
      pStatus.playlist = { ...playlist, tracks: await getTrackWithFileInfo(playlist.tracks) }
      ioClient.emit('pStatus', { playlist: pStatus.playlist }) // 이름 변경도 UI/풋터로 즉시 반영
      if (mediaChanged) {
        // 현재 장면의 오디오 스택 변경이면 재동기화 (추가/삭제 오디오 반영) + 채널 지연 라이브 적용
        if (idx === pStatus.trackId) {
          syncTrackAudios(pStatus.trackId, true)
          applySceneChannelDelays(pStatus.playlist.tracks?.[idx])
        }
        // 편집 → 풀 재프리로드 (디바운스, 현재 열린 플레이리스트만)
        triggerPreloadOnEdit(pStatus.playlist?.playlistId)
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
  for (const c of scene?.clips || []) if (c) put(c.embedded_streams?.[0]?.channels)
  for (const a of scene?.audios || []) if (a) put(a.channels)
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

// ── 빈 장면 스킵 & 오디오 전용 장면 ──────────────────────────────────────────
// 빈 장면 = 재생할 클립도 오디오도 없는 장면("장면 추가"로 만든 미채움 트랙). 재생 시 건너뛴다.
const sceneAudios = (scene) => (Array.isArray(scene?.audios) ? scene.audios : [])
const isEmptyScene = (scene) =>
  sceneClips(scene).filter((c) => c && c.uuid).length === 0 &&
  sceneAudios(scene).filter((a) => a && a.uuid).length === 0
// from(포함)부터 끝까지 첫 번째 재생가능(비어있지 않은) 장면 인덱스. 없으면 -1 (랩 없음).
const nextPlayableScene = (scenes, from) => {
  for (let i = Math.max(0, from); i < (scenes?.length || 0); i++)
    if (!isEmptyScene(scenes[i])) return i
  return -1
}
// from에서 dir(+1/-1) 방향으로 인접한 재생가능 장면(랩 어라운드, 자기 제외). 없으면 -1.
const stepPlayableScene = (scenes, from, dir) => {
  const n = scenes?.length || 0
  for (let k = 1; k <= n; k++) {
    const idx = (((from + dir * k) % n) + n) % n
    if (!isEmptyScene(scenes[idx])) return idx
  }
  return -1
}
// 오디오 전용 장면(영상 없음)의 유지 시간(ms) — 최장 오디오 길이. 루프 오디오가 있거나 길이를 못
// 구하면 null(자동 넘김 없이 유지 — 수동 Next/정지까지). resolveImageTime과 같은 duration 소스.
const audioOnlyHoldMs = (scene) => {
  const audios = sceneAudios(scene).filter((a) => a && a.uuid)
  if (!audios.length || audios.some((a) => a.loop)) return null
  let maxSec = 0
  for (const a of audios) {
    const d = parseFloat(a?.metadata?.format?.duration)
    if (Number.isFinite(d) && d > maxSec) maxSec = d
  }
  return maxSec > 0 ? Math.round(maxSec * 1000) : null
}

// 플레이어 전송용 슬림 file — 플레이어가 쓰는 필드만. 하이드레이션의 거대한 metadata/thumbnail
// 블롭을 통째로 보내면 루프백 TCP가 back-pressure로 멈춰(정지/피드백 불가) 재생이 안 멈추는
// 버그가 있었다. 반드시 최소 필드만 전송한다.
const toPlayerFile = (clip) => {
  const t = resolveImageTime(clip)
  return {
    path: clip.path,
    uuid: clip.uuid,
    is_image: isImageFile(clip), // is_image 누락 파일도 mimetype로 이미지 판정 (타이머 보장)
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

// 오디오 전용 장면(영상 없음)의 다음 장면 전환 타이머 — 영상 end_reached가 없으므로 오디오 길이로
// 넘긴다. 장면 전환/정지 시 반드시 정리(clearSceneAudioTimer)해 유령 전환을 막는다.
let sceneAudioTimer = null
const clearSceneAudioTimer = () => {
  if (sceneAudioTimer) {
    clearTimeout(sceneAudioTimer)
    sceneAudioTimer = null
  }
}

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
  clearSceneAudioTimer() // 오디오 전용 장면 자동 전환 타이머 취소 (정지 후 유령 전환 방지)
  clearAllWindowAudioTimers() // 윈도우 모드 오디오 전용 항목 타이머도 전부 취소
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
  clearSceneAudioTimer() // 이전 오디오 전용 장면 타이머 취소
  // 안전망: 빈 장면이 요청되면(예: 편집으로 비워진 장면) 다음 재생가능 장면으로 건너뛴다.
  // (일반 경로 startScenes/advanceScene은 이미 비어있지 않은 인덱스를 넘기지만, 직접 호출/레이스 대비.)
  if (isEmptyScene(scene)) {
    const nxt = nextPlayableScene(scenes, sceneIdx + 1)
    if (nxt >= 0) return playScene(nxt, startAt)
    logger.warn('playScene: no playable (non-empty) scene — stopping')
    playerSend({ command: 'stop_all' })
    stopAllTrackAudios()
    pStatus.windowStates = {}
    pStatus.trackId = 0
    ioClient.emit('pStatus', { windowStates: {}, trackId: 0 })
    return
  }
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
  // 오디오 전용 장면(영상 클립 없음): 영상 end_reached가 없으므로 오디오 길이만큼 재생 후 다음 장면
  // 으로 넘긴다. slave는 master 멀티캐스트 트리거로만 전환하므로 자체 타이머를 걸지 않는다.
  if (clipsHere.length === 0 && pStatus.sync?.role !== 'slave') {
    const holdMs = audioOnlyHoldMs(scene)
    if (holdMs != null) {
      sceneAudioTimer = setTimeout(() => {
        sceneAudioTimer = null
        // 여전히 이 장면을 재생 중이고 플레이리스트 모드일 때만 전환 (정지/전환 레이스 방지)
        if (pStatus.playlistMode && currentSceneIdx === sceneIdx) advanceScene()
      }, holdMs)
      logger.info(`Scene ${sceneIdx}: audio-only, auto-advance in ${holdMs}ms`)
    } else {
      logger.info(`Scene ${sceneIdx}: audio-only, holding (loop/unknown duration)`)
    }
  }
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

  // 윈도우형: 전체 메모리 프리롤 대신 "다음 트랙만" 로딩(lookahead=1). 창들이 독립 재생이라
  // 락스텝 전체 프리롤이 불필요하고 메모리도 절약. 장면형: 기존 설정 유지(전체 프리롤).
  const isWindowMode = pStatus.playlist?.mode === 'window'
  const lookahead = isWindowMode
    ? 1
    : Number.isInteger(pStatus.preloadLookahead)
      ? pStatus.preloadLookahead
      : 2
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
  const loadKind = playlist.mode === 'window' ? 'window(next-track only)' : 'scene(full)'
  logger.info(
    `Preloaded playlist ${playlistId} [${loadKind}] (${(playlist.tracks || []).length} tracks)`,
  )
  return `Preloaded ${playlistId}`
}

// 장면 재생 시작. 빠른 시작을 위해 현재 장면(+다음)만 즉시 빌드하고, 전 트랙 풀 프리롤은
// 하지 않는다(그건 "로딩" 버튼 몫). 이미 로딩(프리로드)된 상태면 풀에서 즉시 승격돼 무지연.
// (예전엔 재생 시 전 트랙 풀을 동시에 프리롤해 현재 클립 프리롤이 경쟁 → 시작이 수십 초 지연.)
const startScenes = (sceneIdx, startAt = null) => {
  // 시작 장면이 빈 트랙이면 다음 재생가능 장면부터 (앞이 다 비었으면 처음부터 탐색). 하나도 없으면 중단.
  const allScenes = pStatus.playlist.tracks || []
  let sIdx = nextPlayableScene(allScenes, sceneIdx)
  if (sIdx < 0) sIdx = nextPlayableScene(allScenes, 0)
  if (sIdx < 0) {
    logger.warn('startScenes: no playable (non-empty) scene to start')
    return
  }
  sceneIdx = sIdx
  // 프리롤 풀 시퀀스를 먼저 깐다(preload_playlist). 시퀀스가 없으면 플레이어의 FillPool이 no-op이라
  // (player_core: FillPool은 sequence 비어있으면 return) 장면 전환 시 다음 덱을 스탠바이에서
  // 재빌드 → 영상이 튀고(hitch) play_synced 배리어가 즉시 못 터져 창들이 제각각 스왑(동시성 깨짐).
  // 시퀀스를 깔면 전환이 풀 승격(무지연) + 배리어 즉시 발화(전 창 동시 스왑)로 처리되고, 라이브가
  // 될 때마다 FillPool이 다음 장면을 계속 미리 프리롤한다.
  // 이미 로딩(프리로드)된 플레이리스트면 재프리롤하지 않는다(풀 유지 = 로딩 이점·시작속도 보존).
  if (pStatus.preloadedPlaylistId === pStatus.playlist?.playlistId) {
    const known = configuredWindowIds()
    const windowIds = windowsInScenes(pStatus.playlist.tracks || []).filter((w) => known.has(w))
    const lookahead = Number.isInteger(pStatus.preloadLookahead) ? pStatus.preloadLookahead : 2
    const maxDecks = Number.isInteger(pStatus.preloadMaxDecks) ? pStatus.preloadMaxDecks : 8
    playerSend({ command: 'set_preload_config', lookahead, max_decks: maxDecks })
    ensureWindows(windowIds)
  } else {
    preloadScenes(sceneIdx) // set_preload_config + ensureWindows + 창별 preload_playlist(시퀀스+풀)
    pStatus.preloadedPlaylistId = pStatus.playlist?.playlistId ?? null
    ioClient.emit('pStatus', { preloadedPlaylistId: pStatus.preloadedPlaylistId })
  }
  playScene(sceneIdx, startAt) // 풀에 있으면 즉시 승격, 없으면 현재만 빌드해 빠른 시작
}

// 장면 전환 — 현재 장면의 모든 활성 창이 끝났을 때 호출 (동기 전환)
const advanceScene = (startAt = null) => {
  const scenes = pStatus.playlist.tracks || []
  const repeat = pStatus.repeat

  if (repeat === 'repeat_one') {
    triggerOrPlayScene(currentSceneIdx, startAt)
    return
  }
  const stopAll = () => {
    playerSend({ command: 'stop_all' })
    stopAllTrackAudios()
    pStatus.windowStates = {}
    pStatus.trackId = 0
    ioClient.emit('pStatus', { windowStates: pStatus.windowStates, trackId: 0 })
  }
  // 현재 장면 이후의 첫 재생가능(비어있지 않은) 장면으로 — 빈 트랙은 건너뛴다.
  let next = nextPlayableScene(scenes, currentSceneIdx + 1)
  if (next < 0) {
    // 끝까지 재생가능 장면이 없음 → repeat=all이면 처음부터 다시 탐색, 아니면 정지.
    if (repeat === 'all') {
      next = nextPlayableScene(scenes, 0)
      if (next < 0) return stopAll() // 재생가능 장면이 하나도 없음
    } else {
      return stopAll()
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

// 윈도우 항목의 소속 창. 영상 항목은 클립의 window, 오디오 전용 항목(클립 없음)은 항목의 window 필드.
const itemWindow = (sc) => {
  const clip = sceneClips(sc).find((c) => c && c.uuid)
  if (clip && Number.isInteger(clip.window)) return clip.window
  return Number.isInteger(sc?.window) ? sc.window : 0
}
// 오디오 전용 항목 표시용 라벨 (첫 오디오 파일명)
const audioOnlyLabel = (audios) => {
  const a = (audios || []).find((x) => x && x.filename)
  return a ? a.filename : '(오디오)'
}

// 창별 오디오 전용 항목 자동 전환 타이머 (영상 end_reached가 없어 오디오 길이로 넘긴다). W → timeout.
const windowAudioTimers = {}
const clearWindowAudioTimer = (W) => {
  if (windowAudioTimers[W]) {
    clearTimeout(windowAudioTimers[W])
    delete windowAudioTimers[W]
  }
}
const clearAllWindowAudioTimers = () => {
  for (const W of Object.keys(windowAudioTimers)) clearWindowAudioTimer(W)
}

// 재생할 내용이 있는 창 집합 — 영상 클립이 있는 창(windowsInScenes) + 오디오 전용 항목이 속한 창.
// (오디오 전용만 있는 레인도 재생 대상에 포함시키기 위함.)
const windowsWithContent = (scenes) => {
  const s = new Set(windowsInScenes(scenes))
  for (const sc of scenes || []) {
    if (!sceneClips(sc).length && sceneAudios(sc).some((a) => a && a.uuid)) s.add(itemWindow(sc))
  }
  return [...s]
}

// 창 W의 항목 시퀀스 [{ seqIdx, clip, audios }] — 창별 독립 재생 목록.
// 영상 항목(clip 있음)과 오디오 전용 항목(clip=null, audios만)을 순서대로 포함한다.
const windowItemSequence = (scenes, W) => {
  const seq = []
  ;(scenes || []).forEach((sc) => {
    const clip = sceneClips(sc).find((c) => clipWin(c) === W)
    if (clip) {
      seq.push({ clip, audios: Array.isArray(sc.audios) ? sc.audios : [] })
    } else if (
      !sceneClips(sc).length &&
      itemWindow(sc) === W &&
      sceneAudios(sc).some((a) => a && a.uuid)
    ) {
      // 오디오 전용 항목: 이 창 소속이고 재생할 오디오가 있으면 시퀀스에 포함 (영상 없음)
      seq.push({ clip: null, audios: sceneAudios(sc) })
    }
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
    if (item.clip) clips.push(item.clip) // 오디오 전용 항목은 클립 없음(null 제외)
    for (const a of item.audios || []) audios.push(a)
  }
  applySceneChannelDelays({ clips, audios })
}

// 창 항목 1개 재생 (+ 그 항목 추가 오디오 기동, 이전 오디오 정지). windowStates[W] 갱신.
// preload=true면 시퀀스/풀을 (재)설정한다(최초 재생·창 재생 버튼용). 이미 재생 중인 창의 수동
// Next/Prev에서는 preload=false로 호출한다 — 매번 preload_playlist(ClearPool)를 보내면 공유
// 오디오 믹서(amix)에 물린 풀 덱을 해체하면서 새 덱을 빌드하다 레이스로 플레이어가 크래시
// (0xC0000005)했다. 시퀀스는 이미 설정돼 있으므로 play_current_and_load_next만으로 풀에서 승격된다.
const playWindowItem = (W, seq, start, preload = true) => {
  const entry = seq[start]
  if (!entry) return
  clearWindowAudioTimer(W) // 이전 오디오 전용 타이머 취소
  const prev = pStatus.windowStates[W]

  // 오디오 전용 항목 — 영상 없음: 창은 정지(배경) + 오디오만 재생 + 길이 타이머로 다음 항목 전환.
  if (!entry.clip) {
    playerSend({ command: 'stop', window_id: W }) // 이 창 영상 정지(배경색). 풀도 해제됨.
    if (prev) stopAudios(prev.audioIds)
    const audioIds = startAudios(entry.audios)
    pStatus.windowStates[W] = {
      seqIndex: start,
      trackId: start,
      uuid: null,
      filename: audioOnlyLabel(entry.audios),
      audioOnly: true,
      activePlayerId: 0,
      audioIds,
      player: { time: 0, duration: 0, position: 0, is_playing: true, event: 'playing' },
    }
    scheduleWindowAudioAdvance(W, entry, start)
    return
  }

  // 영상 항목 — 풀에는 "영상 파일만" 등록(오디오 전용 항목은 제외해 null 프리롤 방지). 진행은 항상
  // 호스트가 명시(next 명령은 영상→영상에서만) → 풀/시퀀스 인덱스 어긋남 없이 안전.
  const files = seq.map((e) => (e.clip ? fileForPlayer(e.clip) : null))
  if (preload) {
    const poolFiles = files.filter(Boolean)
    let curIdx = poolFiles.findIndex((f) => f.path === files[start].path)
    if (curIdx < 0) curIdx = 0
    playerSend({ command: 'preload_playlist', window_id: W, current_index: curIdx, tracks: poolFiles })
  }
  const nextFile = files[start + 1] || null // 다음이 오디오 전용/끝이면 null (영상 프리로드 없음)
  playerSend({
    command: 'play_current_and_load_next',
    window_id: W,
    track_idx: start,
    current: files[start],
    next: nextFile,
    current_time: resolveImageTime(entry.clip),
    next_time: nextFile ? resolveImageTime(seq[start + 1].clip) : undefined,
  })
  if (prev) stopAudios(prev.audioIds)
  const audioIds = startAudios(entry.audios)
  pStatus.windowStates[W] = {
    seqIndex: start,
    trackId: start,
    uuid: entry.clip.uuid,
    filename: entry.clip.filename,
    activePlayerId: 0,
    audioIds,
    player: { time: 0, duration: 0, position: 0, is_playing: true, event: 'playing' },
  }
}

// 오디오 전용 창 항목의 다음 항목 자동 전환 예약 (오디오 최장 길이 후). slave는 master 트리거만 따름.
const scheduleWindowAudioAdvance = (W, entry, seqIdx) => {
  if (pStatus.sync?.role === 'slave') return
  const holdMs = audioOnlyHoldMs({ audios: entry.audios })
  if (holdMs == null) {
    logger.info(`Window ${W} seq ${seqIdx}: audio-only, holding (loop/unknown duration)`)
    return
  }
  windowAudioTimers[W] = setTimeout(() => {
    delete windowAudioTimers[W]
    const st = pStatus.windowStates[W]
    // 여전히 이 창의 이 오디오 전용 항목을 재생 중일 때만 전환 (정지/전환 레이스 방지)
    if (pStatus.playlistMode && st && st.audioOnly && st.seqIndex === seqIdx) {
      advanceWindowFromEnd(W, seqIdx)
    }
  }, holdMs)
  logger.info(`Window ${W} seq ${seqIdx}: audio-only, auto-advance in ${holdMs}ms`)
}

// 윈도우 모드 재생 시작 — 설정된 전 창을 각자 첫 항목부터 동시에 (그러나 독립적으로) 시작.
const startWindowPlaylist = () => {
  const scenes = pStatus.playlist.tracks || []
  const known = configuredWindowIds()
  const windowIds = windowsWithContent(scenes).filter((w) => known.has(w))
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
  const st = pStatus.windowStates[W]
  if (!st) return
  // 오디오 전용 항목 재생 중이면 영상 end_reached(지난 덱의 지연 이벤트)는 무시 — 전환은 타이머가 담당.
  if (st.audioOnly) return
  const endedSeq =
    typeof data.playlist_track_index === 'number' ? data.playlist_track_index : st.seqIndex ?? 0
  advanceWindowFromEnd(W, endedSeq)
}

// 창 W의 항목 종료(영상 end_reached 또는 오디오 전용 타이머) → 다음 항목으로. endedSeq=끝난 항목.
// 영상→영상은 기존의 부드러운 next(프리로드 standby 승격)를 유지하고, 오디오 전용이 관여하는 전환만
// 명시 재생(playWindowItem)으로 처리한다. slave는 master 멀티캐스트 트리거로만 전환.
const advanceWindowFromEnd = (W, endedSeq) => {
  if (pStatus.sync?.role === 'slave') return
  const scenes = pStatus.playlist?.tracks || []
  const seq = windowItemSequence(scenes, W)
  if (!seq.length) return
  const repeat = pStatus.repeat
  const isLast = endedSeq >= seq.length - 1
  const curWasVideo = !!seq[endedSeq]?.clip
  // 오디오 전용 직후(정지로 풀 해제) 영상 재생이면 풀을 재빌드해야 한다(preload=true).
  const playExplicit = (idx) => {
    const wasAudioOnly = pStatus.windowStates[W]?.audioOnly === true
    playWindowItem(W, seq, idx, wasAudioOnly && !!seq[idx].clip)
  }

  if (repeat === 'repeat_one') {
    if (curWasVideo) playerSend({ command: 'stop', window_id: W })
    playExplicit(endedSeq)
  } else if (!isLast) {
    const nextEntry = seq[endedSeq + 1]
    if (curWasVideo && nextEntry.clip) {
      playerSend({ command: 'next', window_id: W }) // 영상→영상: 프리로드 standby 덱 승격(무지연)
      updateWindowAfterAdvance(W, seq, endedSeq + 1)
    } else {
      playExplicit(endedSeq + 1) // 오디오 전용이 관여 → 명시 재생
    }
  } else if (repeat === 'all') {
    playExplicit(0)
  } else {
    // none → 이 창만 정지 (마지막 프레임 유지). 다른 창은 계속.
    playerSend({ command: 'stop', window_id: W })
    clearWindowAudioTimer(W)
    const st = pStatus.windowStates[W]
    if (st) stopAudios(st.audioIds)
    delete pStatus.windowStates[W]
  }
  applyWindowChannelDelays()
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
}

// advance 후 windowStates[W] 갱신 + 항목 오디오 전환 (이전 정지·새 기동). 영상→영상 next 경로 전용.
const updateWindowAfterAdvance = (W, seq, newSeqIdx) => {
  const idx = Math.min(Math.max(0, newSeqIdx), seq.length - 1)
  clearWindowAudioTimer(W)
  const st = pStatus.windowStates[W] || { activePlayerId: 0, audioIds: [], player: {} }
  stopAudios(st.audioIds)
  st.audioIds = startAudios(seq[idx].audios)
  st.seqIndex = idx
  st.trackId = idx
  st.uuid = seq[idx].clip?.uuid ?? null
  st.filename = seq[idx].clip?.filename ?? audioOnlyLabel(seq[idx].audios)
  st.audioOnly = !seq[idx].clip
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
  // 이미 재생 중인 창이면 시퀀스가 설정돼 있으므로 재프리롤하지 않는다(ClearPool+빌드 레이스 크래시
  // 방지). 정지 상태(시퀀스 미설정)에서 시작할 때만 preload_playlist로 시퀀스를 깐다.
  const wasPlaying = !!pStatus.windowStates[W]
  playWindowItem(W, seq, start, !wasPlaying)
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
  clearWindowAudioTimer(W) // 오디오 전용 자동 전환 타이머 취소 (정지 후 유령 전환 방지)
  playerSend({ command: 'stop', window_id: W })
  const st = pStatus.windowStates[W]
  if (st) stopAudios(st.audioIds)
  delete pStatus.windowStates[W]
  applyWindowChannelDelays()
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
  logger.info(`Window ${W} stop`)
  return `stop window ${W}`
}

// ---------------------------------------------------------------------------
// 수동 Next/Prev (트랜스포트 버튼) — 자동 전환(advanceScene/advanceWindowOnEnd)과 달리 repeat와
// 무관하게 즉시 인접 장면/항목으로 점프. (기존 setNext/setPrevious는 폐기된 플랫 트랙 모델을 써서
// 장면 객체를 파일로 전송 → 씬/윈도우 모드에서 동작 안 함. 여기 컨트롤러로 위임한다.)
// ---------------------------------------------------------------------------

// 씬 모드: 전 창을 인접 장면으로 (락스텝). delta 0 = 현재 장면 재시작. 빈 트랙은 건너뛴다.
const stepScene = (delta) => {
  const scenes = pStatus.playlist?.tracks || []
  if (!scenes.length) return null
  const base = Number.isInteger(currentSceneIdx) ? currentSceneIdx : Number(pStatus.trackId) || 0
  let idx
  if (delta === 0) {
    // 현재 재시작 — 현재가 빈 장면이면(레이스) 다음 재생가능 장면으로.
    idx = isEmptyScene(scenes[base]) ? stepPlayableScene(scenes, base, 1) : base
  } else {
    idx = stepPlayableScene(scenes, base, delta > 0 ? 1 : -1)
  }
  if (idx == null || idx < 0) return null // 재생가능 장면 없음
  playScene(idx)
  logger.info(`Manual step scene → ${idx}`)
  return idx
}

// 윈도우 모드: 선택된 창 1개만 자기 시퀀스의 다음/이전 항목으로 (창별 독립 제어).
// windowId 미지정이면 재생 중인 첫 창으로 폴백. (전 창을 다 넘기지 않는다 — 선택 창만.)
const stepWindow = (delta, windowId) => {
  const scenes = pStatus.playlist?.tracks || []
  let W = windowId != null ? Number(windowId) : null
  if (W == null || !pStatus.windowStates[W]) {
    W = Object.keys(pStatus.windowStates || {}).map(Number)[0]
  }
  if (W == null || !pStatus.windowStates[W]) return null
  const seq = windowItemSequence(scenes, W)
  if (!seq.length) return null
  const cur = pStatus.windowStates[W]?.seqIndex ?? 0
  let idx = cur + delta
  if (idx >= seq.length) idx = 0
  else if (idx < 0) idx = seq.length - 1
  playWindowItem(W, seq, idx, false) // 재프리롤 금지(시퀀스 이미 설정) — ClearPool+빌드 레이스 크래시 방지
  applyWindowChannelDelays()
  ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
  logger.info(`Manual step window ${W} → ${idx}`)
  return `window ${W} @${idx}`
}

// 수동 Next(+1)/Prev(-1)/재시작(0). 씬 모드=전 창 락스텝, 윈도우 모드=선택된 창(windowId)만.
// 멀티윈도우 미지원이면 null(호출부 폴백).
const manualStep = (delta, windowId = null) => {
  if (!pStatus.playlistMode || !multiWin()) return null
  return pStatus.playlist?.mode === 'window' ? stepWindow(delta, windowId) : stepScene(delta)
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
    // 항상 최신 하이드레이션으로 로드 — select(setPlaylist)나 편집으로 pStatus.playlist가 raw이거나
    // stale일 수 있어, 그대로 쓰면 clip.path가 비어 플레이어가 작업폴더를 열려다 preroll이 실패한다.
    // getPlaylist가 uuid→파일 조인으로 path를 채우고 최신 트랙을 반영한다.
    const playlist = await getPlaylist(playlistId)
    if (!playlist) {
      logger.error('Playlist not found for playback')
      return null
    }
    pStatus.playlist = playlist
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

    // 폴백(구버전 플레이어 — multi_window 미지원): 장면의 첫 클립만 주 창에서 재생.
    // 클립 없는 장면(빈 트랙/오디오 전용)은 이 폴백에선 재생할 수 없으므로 건너뛴다.
    const hasClip = (sc) => sceneClips(sc).some((c) => c && c.uuid)
    let tIdx = Number(trackIdx)
    while (tIdx < tracks.length && !hasClip(tracks[tIdx])) tIdx++
    const scene0 = tracks[tIdx]
    const currentTrack = sceneClips(scene0 || {})[0]
    let nIdx = tIdx + 1
    while (nIdx < tracks.length && !hasClip(tracks[nIdx])) nIdx++
    const nextTrack = sceneClips(tracks[nIdx] || {})[0] || null

    if (!currentTrack) {
      logger.error('No playable clip in playlist (legacy fallback)')
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
      track_idx: tIdx,
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

    // 다음 재생가능(비어있지 않은) 트랙 인덱스 계산 — 빈 트랙은 건너뛴다.
    let nextIdx = nextPlayableScene(tracks, pStatus.trackId + 1)
    if (nextIdx < 0) {
      // 끝까지 없음 → repeat=all이면 처음부터 다시 탐색, 아니면 종료.
      if (pStatus.repeat === 'all') nextIdx = nextPlayableScene(tracks, 0)
      if (nextIdx < 0) {
        logger.info('Playlist ended (no playable track)')
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
  // 수동 Next/Prev
  manualStep,
  // 멀티 PC(v3 Phase 5)
  startMultiWindowSynced,
}
