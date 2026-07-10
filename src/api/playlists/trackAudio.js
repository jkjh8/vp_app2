import pStatus from '../../pStatus.js'
import { logger } from '../../logger/index.js'
import { playerSend } from '../../player/index.js'
import { ioClient } from '../../web/index.js'

// 트랙 종속 오디오 스택 — 각 (비디오) 트랙의 추가 오디오 파일들(track.audios[])을
// 플레이어 독립 오디오 트랙(audio_track_*, PROTOCOL.md §5.1)으로 재생한다.
// 임베디드 오디오는 덱이 담당(track.volume/channel_map/muted가 file 객체로 전달됨).
//
// 트랙 종속: 해당 트랙이 화면에 뜰 때(media_changed) 시작, 다음 트랙 전환 시 정지/교체.
// (Phase A의 전역 병행 오디오 레인과 다름 — 트랙마다 오디오 셋이 통째로 바뀐다.)
// 추가 오디오는 기본 1회 재생(클립), loop=true면 트랙 재생 내내 반복.

// 현재 오디오가 붙어있는 트랙 인덱스 (-1 = 없음). 같은 트랙 media_changed 중복 시
// 오디오 재시작(끊김)을 막는 가드.
let currentAudioTrackIdx = -1

const laneSupported = () =>
  Array.isArray(pStatus.playerFeatures) && pStatus.playerFeatures.includes('audio_track')

const emit = () => ioClient.emit('pStatus', { audioTracks: pStatus.audioTracks })

// 하이드레이션된 audio 항목({id,uuid,filename,path,volume,channel_map,muted,loop}) 하나를 기동
const startAudio = (audio) => {
  playerSend({
    command: 'audio_track_play',
    track_id: audio.id,
    file: { path: audio.path, uuid: audio.uuid },
    volume: audio.volume ?? 100,
    channel_map: Array.isArray(audio.channel_map) ? audio.channel_map : undefined,
    loop: audio.loop === true,
    muted: audio.muted === true,
  })
  pStatus.audioTracks[audio.id] = {
    id: audio.id,
    uuid: audio.uuid,
    filename: audio.filename,
    volume: audio.volume ?? 100,
    muted: audio.muted === true,
    loop: audio.loop === true,
    channel_map: Array.isArray(audio.channel_map) ? audio.channel_map : null,
    time: 0,
    duration: 0,
    position: 0,
    is_playing: false,
    state: 'starting',
  }
}

// 트랙 전환 시 호출(주로 parser의 media_changed) — 현재 트랙 오디오 전부 정지 후
// 새 트랙 audios[] 기동. force=true면 같은 트랙이라도 재동기화(편집 반영용).
const syncTrackAudios = (trackIdx, force = false) => {
  if (!force && trackIdx === currentAudioTrackIdx) return
  stopAllTrackAudios() // currentAudioTrackIdx = -1 로 리셋됨
  currentAudioTrackIdx = trackIdx
  if (!laneSupported()) return
  const track = (pStatus.playlist?.tracks || [])[trackIdx]
  const audios = (track?.audios || []).filter((a) => a && a.path)
  for (const a of audios) startAudio(a)
  if (audios.length) {
    logger.info(`trackAudio: started ${audios.length} audio(s) for track ${trackIdx}`)
    emit()
  }
}

const stopAllTrackAudios = () => {
  currentAudioTrackIdx = -1
  const ids = Object.keys(pStatus.audioTracks || {})
  if (ids.length === 0) return
  for (const id of ids) playerSend({ command: 'audio_track_stop', track_id: id })
  pStatus.audioTracks = {}
  emit()
}

// 플레이어의 audio_track_pause는 토글 — 현재 상태 기준으로 골라 보낸다
const pauseTrackAudios = () => {
  for (const [id, t] of Object.entries(pStatus.audioTracks || {})) {
    if (t.is_playing) playerSend({ command: 'audio_track_pause', track_id: id })
  }
}

const resumeTrackAudios = () => {
  for (const [id, t] of Object.entries(pStatus.audioTracks || {})) {
    if (!t.is_playing && t.state === 'paused') {
      playerSend({ command: 'audio_track_pause', track_id: id })
    }
  }
}

// 재생 중인 트랙 오디오의 볼륨/뮤트 라이브 변경 (슬라이더/토글용, 목록 재조회 없이)
const setTrackAudioLive = (audioId, { volume, muted }) => {
  const t = pStatus.audioTracks?.[audioId]
  if (!t) return false
  if (volume !== undefined) t.volume = volume
  if (muted !== undefined) t.muted = muted
  // 뮤트 = 실효 볼륨 0 (뮤트 해제 시 저장된 볼륨 복원)
  playerSend({
    command: 'audio_track_set_volume',
    track_id: audioId,
    volume: t.muted ? 0 : t.volume,
  })
  emit()
  return true
}

export {
  syncTrackAudios,
  stopAllTrackAudios,
  pauseTrackAudios,
  resumeTrackAudios,
  setTrackAudioLive,
}
