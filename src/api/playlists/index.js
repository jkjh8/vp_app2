import { randomUUID } from 'crypto'
import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbPlaylists, dbFiles, dbStatus } from '../../db/index.js'
import { playerSend } from '../../player/index.js'
import { ioClient } from '../../web/index.js'
import { playFile } from '../player/index.js'
import { syncTrackAudios } from './trackAudio.js'

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
        volume: a.volume ?? 100,
        channel_map: Array.isArray(a.channel_map) ? a.channel_map : null,
        muted: a.muted ?? false,
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
            volume: track.volume ?? 100,
            channel_map: Array.isArray(track.channel_map) ? track.channel_map : null,
            muted: track.muted ?? false, // 임베디드 오디오 뮤트
            // 페이드는 Phase C 예약 — 스키마만 확보, 아직 미전송/미적용
            fade_in_ms: track.fade_in_ms ?? 0,
            fade_out_ms: track.fade_out_ms ?? 0,
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
  'fade_in_ms',
  'fade_out_ms',
  'audios',
]

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
        playlist.tracks[idx][key] = key === 'audios' ? normalizeAudios(patch[key]) : patch[key]
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
        // 현재 재생 중인 트랙의 추가 오디오 편집 — 즉시 재동기화 (force)
        syncTrackAudios(idx, true)
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

const playlistPlay = async (playlistId, trackIdx = 0) => {
  try {
    if (!playlistId) {
      logger.error('Playlist ID is required for playback')
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

    // 현재 트랙의 이미지 시간 (없으면 기본값 5초 사용)
    const currentTime = currentTrack.is_image
      ? currentTrack.time || 5
      : undefined
    const nextTime = nextTrack?.is_image ? nextTrack.time || 5 : undefined

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

    // 현재 트랙의 이미지 시간 (없으면 기본값 5초 사용)
    const currentTime = currentTrack.is_image
      ? currentTrack.time || 5
      : undefined
    const nextTime = nextTrack?.is_image ? nextTrack.time || 5 : undefined

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

    // 다음 트랙의 이미지 시간 (없으면 기본값 5초 사용)
    const nextTime = nextTrack.is_image ? nextTrack.time || 5 : undefined

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
}
