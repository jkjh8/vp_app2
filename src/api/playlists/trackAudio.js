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
  const hasChannels = Array.isArray(audio.channels) && audio.channels.length > 0
  playerSend({
    command: 'audio_track_play',
    track_id: audio.id,
    file: { path: audio.path, uuid: audio.uuid },
    volume: audio.volume ?? 100, // 마스터
    // 채널별 우선(channels), 없으면 레거시 channel_map
    channels: hasChannels ? audio.channels : undefined,
    channel_map: !hasChannels && Array.isArray(audio.channel_map) ? audio.channel_map : undefined,
    loop: audio.loop === true,
    muted: audio.muted === true, // 마스터
    delay_ms: Number.isFinite(audio.delay_ms) ? audio.delay_ms : 0, // 오디오 트랙별 시작 지연
  })
  pStatus.audioTracks[audio.id] = {
    id: audio.id,
    uuid: audio.uuid,
    filename: audio.filename,
    volume: audio.volume ?? 100,
    muted: audio.muted === true,
    loop: audio.loop === true,
    channel_map: Array.isArray(audio.channel_map) ? audio.channel_map : null,
    channels: hasChannels ? audio.channels : null,
    time: 0,
    duration: 0,
    position: 0,
    is_playing: false,
    state: 'starting',
  }
}

// 트랙 전환/편집 시 호출.
//  · 다른 트랙으로 전환: 현재 오디오 전부 정지 후 새 트랙 audios[] 전체 기동.
//  · 같은 트랙 편집(force): diff — 추가/삭제/루프변경만 재시작, 볼륨/뮤트/맵은 라이브
//    (편집마다 전체 재시작하면 재생 중 오디오가 끊기므로).
const syncTrackAudios = (trackIdx, force = false) => {
  if (!force && trackIdx === currentAudioTrackIdx) return
  const track = (pStatus.playlist?.tracks || [])[trackIdx]
  // 장면 모델: 추가 오디오는 장면 단위(track.audios). 레거시(클립 audios)도 폴백 합산.
  const clips = Array.isArray(track?.clips) ? track.clips : track ? [track] : []
  const sceneAudios = Array.isArray(track?.audios)
    ? track.audios
    : clips.flatMap((c) => c?.audios || [])
  const desired = sceneAudios.filter((a) => a && a.path)

  // 트랙 전환 = 전체 교체
  if (trackIdx !== currentAudioTrackIdx) {
    stopAllTrackAudios() // currentAudioTrackIdx = -1
    currentAudioTrackIdx = trackIdx
    if (!laneSupported()) return
    for (const a of desired) startAudio(a)
    if (desired.length) {
      logger.info(`trackAudio: started ${desired.length} audio(s) for track ${trackIdx}`)
      emit()
    }
    return
  }

  // 같은 트랙 편집 = diff 라이브
  if (!laneSupported()) return
  const desiredById = new Map(desired.map((a) => [a.id, a]))
  // 삭제된 항목 정지
  for (const id of Object.keys(pStatus.audioTracks)) {
    if (!desiredById.has(id)) {
      playerSend({ command: 'audio_track_stop', track_id: id })
      delete pStatus.audioTracks[id]
    }
  }
  // 추가/변경
  for (const a of desired) {
    const cur = pStatus.audioTracks[a.id]
    if (!cur) {
      startAudio(a) // 신규
      continue
    }
    // 루프 변경은 플레이어 loop가 play 시점 고정이라 재시작 필요
    if ((a.loop === true) !== cur.loop) {
      playerSend({ command: 'audio_track_stop', track_id: a.id })
      delete pStatus.audioTracks[a.id]
      startAudio(a)
      continue
    }
    // 볼륨/뮤트 라이브 (실효 볼륨 = muted ? 0 : volume)
    const nextVol = a.volume ?? 100
    const nextMuted = a.muted === true
    if (nextVol !== cur.volume || nextMuted !== cur.muted) {
      playerSend({
        command: 'audio_track_set_volume',
        track_id: a.id,
        volume: nextMuted ? 0 : nextVol,
      })
      cur.volume = nextVol
      cur.muted = nextMuted
    }
    // 채널 라우팅 라이브 — 채널별(channels) 우선, 없으면 레거시 channel_map
    const nextChannels = Array.isArray(a.channels) ? a.channels : null
    if (nextChannels) {
      if (JSON.stringify(nextChannels) !== JSON.stringify(cur.channels)) {
        playerSend({ command: 'audio_track_set_channel_map', track_id: a.id, map: nextChannels })
        cur.channels = nextChannels
      }
    } else {
      const nextMap = Array.isArray(a.channel_map) ? a.channel_map : null
      if (JSON.stringify(nextMap) !== JSON.stringify(cur.channel_map)) {
        playerSend({ command: 'audio_track_set_channel_map', track_id: a.id, map: nextMap || [] })
        cur.channel_map = nextMap
      }
    }
  }
  emit()
}

// 활성 덱(임베디드 오디오)의 라우팅/볼륨/뮤트 라이브 변경. live_routing capability 필요.
// streams(채널별 스트림>채널) 우선, 없으면 레거시 {channel_map,volume,muted}.
// window_id: 멀티윈도우에서 대상 창의 덱 지정(§6.2). 미지정이면 기본 창.
const setDeckAudioLive = ({ window_id, streams, channel_map, volume, muted } = {}) => {
  if (!Array.isArray(pStatus.playerFeatures) || !pStatus.playerFeatures.includes('live_routing')) {
    return false
  }
  const cmd = { command: 'set_deck_audio' }
  if (Number.isInteger(window_id)) cmd.window_id = window_id
  if (Array.isArray(streams)) cmd.streams = streams
  if (channel_map !== undefined) cmd.channel_map = channel_map || []
  if (volume !== undefined) cmd.volume = volume
  if (muted !== undefined) cmd.muted = muted
  playerSend(cmd)
  return true
}

// ── 윈도우 모드: 창 항목별 추가 오디오 ──
// 장면 모드의 syncTrackAudios(단일 전역 커서)와 달리, 윈도우 모드는 창마다 자기 항목의 추가
// 오디오를 동시에 독립 재생한다. 아래 두 헬퍼는 "특정 오디오 리스트"를 id 기준으로 기동/정지한다
// (오디오 id는 영속·고유 = aud-<uuid> 라 창 간 충돌 없음). 창 컨트롤러가 항목 전환 시 이전 항목의
// audioIds를 stopAudios, 새 항목을 startAudios 한다.
const startAudios = (audios) => {
  const ids = []
  if (!laneSupported()) return ids
  for (const a of audios || []) {
    if (!a || !a.path || !a.id) continue
    startAudio(a)
    ids.push(a.id)
  }
  if (ids.length) emit()
  return ids
}

const stopAudios = (ids) => {
  let changed = false
  for (const id of ids || []) {
    if (pStatus.audioTracks[id]) {
      playerSend({ command: 'audio_track_stop', track_id: id })
      delete pStatus.audioTracks[id]
      changed = true
    }
  }
  if (changed) emit()
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

// 특정 창의 추가 오디오만 일시정지/재개 (윈도우 모드 창별 제어). ids = windowStates[W].audioIds.
const pauseAudios = (ids) => {
  for (const id of ids || []) {
    const t = pStatus.audioTracks[id]
    if (t && t.is_playing) playerSend({ command: 'audio_track_pause', track_id: id })
  }
}
const resumeAudios = (ids) => {
  for (const id of ids || []) {
    const t = pStatus.audioTracks[id]
    if (t && !t.is_playing && t.state === 'paused') {
      playerSend({ command: 'audio_track_pause', track_id: id })
    }
  }
}

// 재생 중인 추가 오디오의 볼륨/뮤트/채널 라이브 변경 (슬라이더/토글/채널편집용, 목록 재조회 없이).
// channels(채널별 [{out,volume,muted}])가 있으면 audio_track_set_channel_map으로 라이브 적용 —
// 윈도우 모드는 editPlaylist가 syncTrackAudios를 안 타므로 여기서 직접 적용해야 라이브가 된다.
const setTrackAudioLive = (audioId, { volume, muted, channels } = {}) => {
  const t = pStatus.audioTracks?.[audioId]
  if (!t) return false
  if (Array.isArray(channels)) {
    playerSend({ command: 'audio_track_set_channel_map', track_id: audioId, map: channels })
    t.channels = channels
  }
  if (volume !== undefined) t.volume = volume
  if (muted !== undefined) t.muted = muted
  // 뮤트 = 실효 볼륨 0 (뮤트 해제 시 저장된 볼륨 복원)
  if (volume !== undefined || muted !== undefined) {
    playerSend({
      command: 'audio_track_set_volume',
      track_id: audioId,
      volume: t.muted ? 0 : t.volume,
    })
  }
  emit()
  return true
}

export {
  syncTrackAudios,
  stopAllTrackAudios,
  pauseTrackAudios,
  resumeTrackAudios,
  pauseAudios,
  resumeAudios,
  setTrackAudioLive,
  setDeckAudioLive,
  startAudios,
  stopAudios,
}
