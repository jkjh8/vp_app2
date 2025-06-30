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
} from '../../../api/playlists/index.js'

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
