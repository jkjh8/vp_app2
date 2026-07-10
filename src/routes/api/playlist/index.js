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
  editImageTime,
  editTrack,
  preloadNextTrack,
} from '../../../api/playlists/index.js'
import {
  setAudioLane,
  setLaneItemVolume,
} from '../../../api/playlists/audioLane.js'

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
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while playing playlist: ${error}`)
    res.status(500).json({ error: 'Failed to play playlist' })
  }
})

// 병행 오디오 레인 전체 교체 (v2): body {id, audioLane:[{itemId?,uuid,enabled,loop,volume,channel_map}]}
router.put('/audio_lane', async (req, res) => {
  try {
    const { id, audioLane } = req.body
    if (!id || !Array.isArray(audioLane)) {
      return res.status(400).json({ error: 'id and audioLane array are required' })
    }
    const result = await setAudioLane(id, audioLane)
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while updating audio lane: ${error}`)
    res.status(500).json({ error: 'Failed to update audio lane' })
  }
})

// 레인 항목 볼륨 (문서 + 재생 중이면 라이브 적용): body {id, itemId, volume}
router.put('/audio_lane/volume', async (req, res) => {
  try {
    const { id, itemId, volume } = req.body
    if (!id || !itemId || volume === undefined) {
      return res.status(400).json({ error: 'id, itemId and volume are required' })
    }
    const result = await setLaneItemVolume(id, itemId, Number(volume))
    res.status(200).json(result)
  } catch (error) {
    logger.error(`Error occurred while updating lane volume: ${error}`)
    res.status(500).json({ error: 'Failed to update lane volume' })
  }
})

// 트랙 부분 갱신 (v2): body {id, idx, patch:{time?,volume?,channel_map?,fade_*?}}
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
