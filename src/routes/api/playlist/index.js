import express from 'express'
import { logger } from '../../../logger/index.js'
import { dbPlaylists, dbStatus } from '../../../db/index.js'
import pStatus from '../../../pStatus.js'
import {
  addPlaylist,
  getPlaylist,
  getPlaylists,
  editPlaylist,
  setTracksToPlaylist,
  playlistPlay,
  setPlaylistMode,
  editImageTime,
  editTrack,
  preloadNextTrack,
  preloadPlaylistOnly,
} from '../../../api/playlists/index.js'
import {
  setTrackAudioLive,
  setDeckAudioLive,
} from '../../../api/playlists/trackAudio.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const playlists = await getPlaylists()
    res.status(200).json(playlists)
  } catch (error) {
    logger.error(`Error occurred while fetching playlists: ${error}`)
    res.status(500).json({ error: 'Failed to fetch playlists' })
  }
})

router.post('/', async (req, res) => {
  try {
    const result = await addPlaylist(req.body)
    logger.info(`Playlist created: ${result}`)
    res.status(201).json(result)
  } catch (error) {
    logger.error(`Error occurred while creating playlist: ${error}`)
    res.status(500).json({ error: 'Failed to create playlist' })
  }
})

router.put('/', async (req, res) => {
  try {
    const result = await editPlaylist(req.body)
    logger.info(`Playlist updated: ${result}`)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while updating playlist: ${error}`)
    res.status(500).json({ error: 'Failed to update playlist' })
  }
})

router.put('/tracks', async (req, res) => {
  try {
    const { id, tracks } = req.body
    if (!id || !tracks) {
      return res
        .status(400)
        .json({ error: 'Playlist ID and tracks are required' })
    }
    const result = await setTracksToPlaylist(id, tracks)
    logger.info(`Playlist tracks updated: ${result}`)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while updating playlist tracks: ${error}`)
    res.status(500).json({ error: 'Failed to update playlist tracks' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!id) {
      return res.status(400).json({ error: 'Playlist ID is required' })
    }
    const result = await dbPlaylists.remove({ _id: id })
    logger.info(`Playlist deleted: ${result}`)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while deleting playlist: ${error}`)
    res.status(500).json({ error: 'Failed to delete playlist' })
  }
})

router.get('/play', async (req, res) => {
  try {
    const { playlistId, trackIndex } = req.query
    const result = await playlistPlay(Number(playlistId), Number(trackIndex))
    if (!result) {
      // playlistPlay는 실패 시 null을 반환 — 이전엔 여기서도 무조건 200을 내려보내
      // 클라이언트가 "재생 성공"으로 착각하는 조용한 실패였다 (플레이어 미연결 등).
      return res
        .status(503)
        .json({
          error:
            'Failed to play playlist (player not connected or playlist unavailable)',
        })
    }
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while playing playlist: ${error}`)
    res.status(500).json({ error: 'Failed to play playlist' })
  }
})

// 플레이리스트 로딩(프리로딩만, 재생 안 함) — 전 트랙을 메모리에 프리롤
router.get('/preload', async (req, res) => {
  try {
    const result = await preloadPlaylistOnly(Number(req.query.playlistId))
    if (!result)
      return res.status(503).json({ error: 'Preload failed (player not connected?)' })
    res.status(200).json({ message: result })
  } catch (error) {
    logger.error(`Error preloading playlist: ${error}`)
    res.status(500).json({ error: 'Failed to preload playlist' })
  }
})

// 플레이리스트 모드 명시적 토글 (UI 스위치). body {value:boolean}
router.put('/mode', async (req, res) => {
  try {
    const { value } = req.body
    const mode = await setPlaylistMode(Boolean(value))
    res.status(200).json({ playlistMode: mode })
  } catch (error) {
    logger.error(`Error occurred while toggling playlist mode: ${error}`)
    res.status(500).json({ error: 'Failed to toggle playlist mode' })
  }
})

// 현재 재생 트랙의 임베디드 오디오 라이브 변경 (볼륨 드래그 등 — 재조회 없이 즉시).
// 영속화는 PUT /track patch. body {channel_map?, volume?, muted?}
router.put('/deck_audio/live', async (req, res) => {
  try {
    const { channel_map, volume, muted } = req.body
    const ok = setDeckAudioLive({ channel_map, volume, muted })
    res.status(200).json({ ok })
  } catch (error) {
    logger.error(`Error occurred while updating deck audio live: ${error}`)
    res.status(500).json({ error: 'Failed to update deck audio' })
  }
})

// 재생 중인 트랙 오디오의 볼륨/뮤트 라이브 변경 (슬라이더/토글 — 목록 재조회 없이 즉시).
// 영속화는 별도로 PUT /track patch.audios 로. body {audioId, volume?, muted?}
router.put('/track_audio/live', async (req, res) => {
  try {
    const { audioId, volume, muted } = req.body
    if (!audioId) {
      return res.status(400).json({ error: 'audioId is required' })
    }
    const ok = setTrackAudioLive(audioId, { volume, muted })
    res.status(200).json({ ok })
  } catch (error) {
    logger.error(`Error occurred while updating track audio live: ${error}`)
    res.status(500).json({ error: 'Failed to update track audio' })
  }
})

// 트랙 부분 갱신 (v2): body {id, idx, patch:{time?,volume?,channel_map?,muted?,audios?,fade_*?}}
router.put('/track', async (req, res) => {
  try {
    const { id, idx, patch } = req.body
    if (!id || idx === undefined || !patch) {
      return res.status(400).json({ error: 'id, idx and patch are required' })
    }
    const result = await editTrack(id, Number(idx), patch)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while updating track: ${error}`)
    res.status(500).json({ error: 'Failed to update track' })
  }
})

router.put('/image_time', async (req, res) => {
  try {
    const { playlistId, idx, time } = req.body
    const result = await editImageTime(playlistId, idx, time)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while updating image time: ${error}`)
    res.status(500).json({ error: 'Failed to update image time' })
  }
})

router.put('/start_on_play', async (req, res) => {
  try {
    let { value } = req.body
    value = value === true || value === 'true' || value === '1'
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'Invalid value for start_on_play' })
    }
    await dbStatus.update(
      { type: 'startOnPlay' },
      { $set: { value } },
      { upsert: true },
    )
    pStatus.startOnPlay = value
    logger.info(`Start on play set to: ${value}`)
    res.status(200).json({ message: `Start on play set to: ${value}`, value })
  } catch (error) {
    logger.error(`Error occurred while updating start_on_play: ${error}`)
    res.status(500).json({ error: 'Failed to update start_on_play' })
  }
})

router.put('/start_on_playlist_id', async (req, res) => {
  try {
    let { playlistId } = req.body
    if (!playlistId) {
      return res.status(400).json({ error: 'Playlist ID is required' })
    }
    playlistId = Number(playlistId)
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' })
    }
    pStatus.startOnPlaylistId = playlistId
    await dbStatus.update(
      { type: 'startOnPlaylistId' },
      { $set: { playlistId } },
      { upsert: true },
    )
    logger.info(`Start on playlist ID set to: ${playlistId}`)
    res.status(200).json({
      message: `Start on playlist ID set to: ${playlistId}`,
      playlistId,
    })
  } catch (error) {
    logger.error(`Error occurred while updating start_on_playlist_id: ${error}`)
    res.status(500).json({ error: 'Failed to update start_on_playlist_id' })
  }
})

export default router
