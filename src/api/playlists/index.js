import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { dbPlaylists, dbFiles, dbStatus } from '../../db/index.js'
import { playerSend } from '../../player/index.js'
import { ioClient } from '../../web/index.js'
import { playFile } from '../player/index.js'

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
    return await dbPlaylists.update({ _id: id }, { $set: updateData })
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
    return await dbPlaylists.update(
      { _id: playlistId },
      { $addToSet: { tracks: { $each: tracks } } },
    )
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
    playerSend({ command: 'setPlaylistMode', value: pStatus.playlistMode })

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
    pStatus.playlist = playlist
    ioClient.emit('pStatus', { playlist: pStatus.playlist })
  } catch (error) {
    logger.error(`Error editing image time for playlist: ${error}`)
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
    pStatus.trackId = Number(trackIdx)
    ioClient.emit('pStatus', {
      playlist: pStatus.playlist,
      trackId: pStatus.trackId,
    })
    playFile(pStatus.playlist.tracks[pStatus.trackId])
    return `Playing playlist ${playlistId} from track ${pStatus.trackId}`
  } catch (error) {
    logger.error(`Error playing playlist: ${error}`)
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
  playlistPlay,
}
