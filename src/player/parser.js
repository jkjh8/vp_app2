import pStatus from '../pStatus.js'
import { logger } from '../logger/index.js'
import { ioClient } from '../web/index.js'
import { playerSend, resolvePlayerResult } from './index.js'
import { dbStatus, dbFiles } from '../db/index.js'
import { playFile, play, stop } from '../api/player/index.js'
import {
  preloadNextTrack,
  multiWin,
  onSceneWindowEnd,
  advanceWindowOnEnd,
} from '../api/playlists/index.js'
import {
  stopAllTrackAudios,
  syncTrackAudios,
} from '../api/playlists/trackAudio.js'
import { app } from '../runtime.js'
import { broadcastEvent } from '../tcp/index.js'
import { TCP_EVENTS as EVENTS } from '../utils/tcpResponse.js'

let lastEndReachedEvent = null
// audio_track_data SPA 발신 스로틀 (트랙당 100ms 틱 × N트랙 홍수 방지)
const audioTrackEmitAt = {}
const AUDIO_TRACK_EMIT_INTERVAL_MS = 300
// windowStates 창별 player 틱 SPA 발신 스로틀 (창 N개 × 매 틱 → 소켓 홍수 방지)
let windowStatesEmitAt = 0
const WINDOW_STATES_EMIT_INTERVAL_MS = 200
function emitWindowStatesThrottled() {
  const now = Date.now()
  if (now - windowStatesEmitAt >= WINDOW_STATES_EMIT_INTERVAL_MS) {
    windowStatesEmitAt = now
    ioClient.emit('pStatus', { windowStates: pStatus.windowStates })
  }
}
// timeline_position SPA 발신 스로틀 (플레이어 250ms 틱을 SPA엔 ~200ms로 통과)
let timelinePosEmitAt = 0
const TIMELINE_POS_EMIT_INTERVAL_MS = 200

// 플레이어 준비 완료 처리
function handleReady() {
  pStatus.ready = true
  logger.info('Player is ready')
  ioClient.emit('pStatus', { ready: true })
  broadcastEvent(EVENTS.PLAYER_READY, {})

  // 초기 설정 명령 전송 (오디오 디바이스는 먼저 조회)
  const commands = [
    { command: 'background_color', color: pStatus.backgroundColor },
    pStatus.fullscreen && { command: 'set_fullscreen', value: true },
    { command: 'get_displays' }, // 현재 감지된 모니터 목록 조회 (CLI 인자로 배치는 이미 완료)
    { command: 'get_audio_devices' }, // 디바이스 목록 먼저 조회
    // set_audio_device는 audiodevices 이벤트 받은 후에 호출
    pStatus.playlistMode && {
      command: 'playlist_mode',
      value: pStatus.playlistMode,
    },

    { command: 'logo_file', file: pStatus.logoFile },
    { command: 'logo_size', size: pStatus.logoSize },
    { command: 'show_logo', show: pStatus.logoShow },
  ].filter(Boolean)

  for (const cmd of commands) {
    playerSend(cmd)
  }
  logger.info('Initial player commands sent')
}

// 재생 종료 이벤트 처리 (호스트에서 제어)
function handleEndReached(data) {
  // 타임라인 모드(Phase B): 덱 EOS는 타임라인 엔진 소관 — 플레이리스트 진행 금지
  if (pStatus.timelineMode) return

  // 멀티 윈도우(v3): dedup 키에 window_id 포함 (창별 독립 진행). 기본 0 = 하위호환.
  const winId = data.window_id ?? 0
  const eventKey = `${winId}-${data.playlist_track_index}-${data.active_player_id}`
  if (lastEndReachedEvent === eventKey) {
    logger.warn(`Duplicate end_reached event ignored: ${eventKey}`)
    return
  }
  lastEndReachedEvent = eventKey

  logger.info(
    `End reached - win: ${winId}, track: ${data.playlist_track_index}, player: ${data.active_player_id}`,
  )

  const repeat = pStatus.repeat
  const playlistMode = pStatus.playlistMode

  // 멀티 윈도우(v3): 창별 end_reached 처리. 윈도우 모드는 창별 독립 전진, 장면 모드는 전 창 동기 전진.
  if (playlistMode && multiWin()) {
    if (pStatus.playlist?.mode === 'window') {
      advanceWindowOnEnd(data)
    } else {
      onSceneWindowEnd(data)
    }
    broadcastEvent(EVENTS.TRACK_ENDED, { window_id: winId })
    return
  }

  if (!playlistMode) {
    // 일반 재생 모드 처리
    if (repeat === 'repeat_one') {
      stop()
      play()
    } else {
      stop()
      broadcastEvent(EVENTS.END_REACHED, {})
    }
    return
  }

  // 플레이리스트 모드 처리 (호스트가 다음 파일 관리)
  const tracks = pStatus.playlist?.tracks || []
  const isLastTrack = data.playlist_track_index >= tracks.length - 1

  switch (repeat) {
    case 'none':
      if (!isLastTrack) {
        logger.info('Moving to next track (none mode)')
        // 이미 로드된 다음 파일로 전환
        playerSend({ command: 'next' })
        // trackId 업데이트
        pStatus.trackId++
        ioClient.emit('pStatus', { trackId: pStatus.trackId })
        // 새로운 다음 파일 미리 로드
        preloadNextTrack()
        broadcastEvent(EVENTS.TRACK_ENDED, {})
      } else {
        logger.info('Playlist ended (none mode)')
        playerSend({ command: 'stop_all' })
        stopAllTrackAudios() // 재생 종료 = 트랙 종속 오디오도 종료
        pStatus.trackId = 0
        ioClient.emit('pStatus', { trackId: pStatus.trackId })
        broadcastEvent(EVENTS.END_REACHED, {})
      }
      break

    case 'all':
      logger.info('Moving to next track (all mode)')
      // 이미 로드된 다음 파일로 전환
      playerSend({ command: 'next' })
      // trackId 업데이트 (마지막이면 0으로)
      pStatus.trackId++
      if (pStatus.trackId >= tracks.length) {
        pStatus.trackId = 0
      }
      ioClient.emit('pStatus', { trackId: pStatus.trackId })
      // 새로운 다음 파일 미리 로드
      preloadNextTrack()
      broadcastEvent(EVENTS.TRACK_ENDED, {})
      break

    case 'repeat_one':
      logger.info('Repeat one mode, replaying current track')
      playerSend({ command: 'stop', idx: data.active_player_id })
      playerSend({ command: 'play', idx: data.active_player_id })
      break

    default:
      playerSend({ command: 'stop_all' })
      broadcastEvent(EVENTS.END_REACHED, {})
      break
  }
}

// 미디어 변경 이벤트 처리
async function handleMediaChanged(data) {
  // 타임라인 모드: 스케줄러가 덱을 위치로 구동하므로 media_changed는 무시
  // (플레이어도 억제하지만 신구 혼용/레이스 방어). §5.2 모드 상호배타.
  if (pStatus.timelineMode) return

  // 장면 모드(v3): 창별 상태 확정 (재생 명령은 playScene이 이미 optimistic 세팅, 여기선 실표시 확인)
  if (pStatus.playlistMode && multiWin()) {
    const W = data.window_id ?? 0
    const sceneIdx =
      typeof data.playlist_track_index === 'number' ? data.playlist_track_index : null
    logger.info(`Media changed: win=${W} scene=${sceneIdx} uuid=${data.uuid}`)
    const file = data.uuid ? await dbFiles.findOne({ uuid: data.uuid }) : null

    // 재생 시작(playScene/playWindowItem)이 windowStates[W]를 미리 생성한다. 항목이 없다는 건
    // 그 창이 정지됐다는 뜻 → 뒤늦게 도착한 media_changed로 정지된 창을 되살리지 않는다.
    if (!pStatus.windowStates[W]) return
    const st = pStatus.windowStates[W]
    if (sceneIdx != null) {
      st.sceneIndex = sceneIdx
      st.trackId = sceneIdx
    }
    if (typeof data.idx === 'number') st.activePlayerId = data.idx
    if (file) {
      st.uuid = file.uuid
      st.filename = file.filename
    }
    // 하위호환 단일 필드 (주 창 개념 폐지 — 마지막 갱신 창 기준, 트랙 오디오는 playScene에서 동기화)
    if (file) pStatus.file = file
    if (sceneIdx != null) pStatus.trackId = sceneIdx
    ioClient.emit('pStatus', {
      windowStates: pStatus.windowStates,
      file: pStatus.file,
      trackId: pStatus.trackId,
    })
    broadcastEvent(EVENTS.MEDIA_CHANGED, {
      fileId: file?.number ?? null,
      filename: file?.filename ?? null,
      trackId: st.trackId,
      windowId: W,
      playlistId: pStatus.playlist?.playlistId ?? null,
    })
    return
  }

  logger.info(`Media changed event: idx=${data.idx}, uuid=${data.uuid}`)

  let updated = false

  // uuid로 실제 재생 중인 파일 정보 조회
  if (data.uuid) {
    const file = await dbFiles.findOne({ uuid: data.uuid })
    if (file) {
      pStatus.file = file
      logger.info(`Media changed to: ${file.filename}`)
      updated = true

      // 플레이리스트 모드이고 playlist_track_index가 있으면 해당 트랙과 일치하는지 확인
      if (
        typeof data.playlist_track_index === 'number' &&
        pStatus.playlistMode
      ) {
        const tracks = pStatus.playlist?.tracks || []
        const trackFromIndex = tracks[data.playlist_track_index]

        // Python이 보낸 트랙 인덱스의 파일과 uuid가 일치하는지 확인
        if (trackFromIndex && trackFromIndex.uuid === data.uuid) {
          // 일치하면 trackId 업데이트 (플레이리스트 직접 재생 시)
          pStatus.trackId = data.playlist_track_index
          logger.info(
            `Track index updated to: ${pStatus.trackId} (from Python)`,
          )
        } else {
          logger.warn(
            `Mismatch: Python track_index=${data.playlist_track_index} uuid=${data.uuid}, but tracks[${data.playlist_track_index}]?.uuid=${trackFromIndex?.uuid}`,
          )
        }
      }
    }
  }

  if (updated) {
    ioClient.emit('pStatus', {
      file: pStatus.file,
      trackId: pStatus.trackId,
    })
    // 트랙 종속 오디오 스택 동기화 — 실제 화면 전환(media_changed) 시점에 현재 트랙의
    // 추가 오디오를 기동/교체 (같은 트랙 중복 media_changed는 syncTrackAudios가 무시)
    if (pStatus.playlistMode) {
      syncTrackAudios(pStatus.trackId)
    }
    // TCP로 미디어 변경 이벤트 전송
    broadcastEvent(EVENTS.MEDIA_CHANGED, {
      fileId: pStatus.file?.number || null,
      filename: pStatus.file?.filename || null,
      trackId: pStatus.trackId,
      playlistId: pStatus.playlist?.playlistId || null,
    })
  }
}

// 메인 파서 함수
const parsePlayerStatus = async (data) => {
  try {
    const { type, data: msgData } = JSON.parse(data)

    switch (type) {
      case 'info':
        logger.info(`[Player] ${msgData}`)
        // 특별한 info 메시지 처리 (예: ready 이벤트)
        if (typeof msgData === 'string' && msgData.includes('ready')) {
          handleReady()
        }
        break

      case 'warn':
        logger.warn(`[Player] ${msgData}`)
        break

      case 'debug':
        logger.debug(`[Player] ${msgData}`)
        break

      case 'error':
        logger.error(`[Player] ${msgData}`)
        break

      case 'active_player_id':
        // 프로토콜상 data는 정수 (구현체에 따라 {value} 형태 방어)
        pStatus.activePlayerId =
          typeof msgData === 'number' ? msgData : msgData.value
        ioClient.emit('pStatus', { activePlayerId: pStatus.activePlayerId })
        logger.debug(`Active player ID: ${pStatus.activePlayerId}`)
        break

      case 'player_data': {
        // 멀티 윈도우(v3): 창별 재생 시간(windowStates[W].player) 갱신. 플레이어는 매 틱 모든 창의
        // player_data를 window_id와 함께 보낸다(player_core.cpp). 이 창별 값으로 UI가 씬 모드는
        // 창들의 최댓값(= 가장 긴 미디어)을, 윈도우 모드는 선택한 창의 시간을 표시한다.
        // (정지/전환으로 windowStates[W]가 지워진 창은 뒤늦은 틱을 무시 — 좀비 방지.)
        const W = msgData.window_id
        if (W != null && pStatus.windowStates && pStatus.windowStates[W]) {
          const wp = pStatus.windowStates[W].player || {}
          pStatus.windowStates[W].player = {
            ...wp,
            time: msgData.time ?? wp.time ?? 0,
            duration: msgData.duration ?? wp.duration ?? 0,
            position: msgData.position ?? wp.position ?? 0,
            event: msgData.event ?? wp.event,
            is_playing:
              msgData.is_playing !== undefined ? msgData.is_playing : wp.is_playing,
          }
          emitWindowStatesThrottled()
        }

        // 하위호환/단일(레거시) 모드: 전역 player (active 덱만 반영)
        if (
          msgData.id === pStatus.activePlayerId ||
          pStatus.activePlayerId == null
        ) {
          pStatus.player = {
            ...pStatus.player,
            // ??: 0(시작 지점 time, 정지 시 duration 등)도 유효한 값으로 반영
            time: msgData.time ?? pStatus.player.time,
            duration: msgData.duration ?? pStatus.player.duration,
            position: msgData.position ?? pStatus.player.position,
            event: msgData.event ?? pStatus.player.event,
            is_playing:
              msgData.is_playing !== undefined
                ? msgData.is_playing
                : pStatus.player.is_playing,
          }
          ioClient.emit('pStatus', { player: pStatus.player })
        }
        break
      }

      case 'media_changed':
        await handleMediaChanged(msgData)
        break

      case 'end_reached':
        handleEndReached(msgData)
        break

      case 'audiodevices':
        pStatus.audioDevices = msgData.devices || []
        ioClient.emit('pStatus', { audioDevices: pStatus.audioDevices })
        broadcastEvent(EVENTS.AUDIO_DEVICES_UPDATED, {
          count: pStatus.audioDevices.length,
        })
        logger.info(
          `Audio devices updated: ${pStatus.audioDevices.length} devices`,
        )

        // 오디오 디바이스 목록을 받은 후 설정된 디바이스 적용
        if (pStatus.audioDevice) {
          logger.info(`Setting audio device to: ${pStatus.audioDevice}`)
          playerSend({
            command: 'set_audio_device',
            device_id: pStatus.audioDevice,
          })
        }
        break

      case 'set_fullscreen':
        // 프로토콜상 data는 bool 원시값 (구현체에 따라 {value} 방어)
        pStatus.fullscreen =
          typeof msgData === 'boolean' ? msgData : msgData.value
        await dbStatus.update(
          { type: 'fullscreen' },
          { $set: { value: pStatus.fullscreen } },
          { upsert: true },
        )
        ioClient.emit('pStatus', { fullscreen: pStatus.fullscreen })
        broadcastEvent(EVENTS.FULLSCREEN_CHANGED, { value: pStatus.fullscreen })
        logger.info(`Fullscreen mode set to: ${pStatus.fullscreen}`)
        break

      case 'displays':
        pStatus.displays = msgData.displays || []
        ioClient.emit('pStatus', { displays: pStatus.displays })
        logger.info(`Displays updated: ${pStatus.displays.length} monitors`)
        break

      case 'set_display':
        // vplayer가 적용한 값을 그대로 echo — pStatus를 실제 반영값으로 동기화
        pStatus.display = {
          ...pStatus.display,
          monitorIndex: msgData.monitor_index ?? pStatus.display.monitorIndex,
          x: msgData.x ?? pStatus.display.x,
          y: msgData.y ?? pStatus.display.y,
          width: msgData.width ?? pStatus.display.width,
          height: msgData.height ?? pStatus.display.height,
          aspectMode: msgData.aspect_mode ?? pStatus.display.aspectMode,
        }
        await dbStatus.update(
          { type: 'display' },
          { $set: { value: pStatus.display } },
          { upsert: true },
        )
        ioClient.emit('pStatus', { display: pStatus.display })
        logger.info(`Display settings applied: ${JSON.stringify(pStatus.display)}`)
        break

      case 'set_background':
        // 프로토콜상 data는 색상 문자열 원시값 (구현체에 따라 {background} 방어)
        pStatus.backgroundColor =
          typeof msgData === 'string' ? msgData : msgData.background
        await dbStatus.update(
          { type: 'backgroundColor' },
          { $set: { value: pStatus.backgroundColor } },
          { upsert: true },
        )
        ioClient.emit('pStatus', { backgroundColor: pStatus.backgroundColor })
        logger.info(`Background color set to: ${pStatus.backgroundColor}`)
        break

      case 'track_index':
        // data는 정수 (구현체에 따라 {value} 방어)
        pStatus.trackId = typeof msgData === 'number' ? msgData : msgData.value
        ioClient.emit('pStatus', { trackId: pStatus.trackId })
        logger.debug(`Track index: ${pStatus.trackId}`)
        break

      case 'logo_visibility':
        // 플레이어가 미디어 타입(비디오/이미지=숨김, 오디오=표시, §2.7)에 따라 자동
        // 계산한 "지금 실제로 보이는지" 값이다. 사용자가 Show Logo 토글로 설정한
        // 선호값(pStatus.logoShow)과는 별개 — 여기서 logoShow를 덮어쓰면 비디오 재생
        // 중 토글을 켜자마자 곧바로 false 피드백에 되밟혀 꺼지는 버그가 된다.
        pStatus.logoVisible = msgData.show
        ioClient.emit('pStatus', { logoVisible: pStatus.logoVisible })
        logger.debug(`Logo visibility: ${pStatus.logoVisible}`)
        break

      // v2 기능 협상 (PROTOCOL.md §5.1) — 신규 명령 송신 게이트
      case 'capabilities':
        pStatus.playerFeatures = msgData?.features || []
        ioClient.emit('pStatus', { playerFeatures: pStatus.playerFeatures })
        logger.info(`Player capabilities: ${pStatus.playerFeatures.join(', ')}`)
        // 멀티 윈도우(v3): 프리롤 설정 + 설정된 출력 창 생성 (capabilities 확정 후)
        if (pStatus.playerFeatures.includes('multi_window')) {
          playerSend({
            command: 'set_preload_config',
            lookahead: pStatus.preloadLookahead,
            max_decks: pStatus.preloadMaxDecks,
          })
          for (const w of pStatus.windows || []) {
            if (!w) continue // 주 창 개념 폐지 — 설정된 모든 창을 생성
            playerSend({
              command: 'create_window',
              window_id: w.id,
              monitor_index: w.monitorIndex ?? -1,
              x: w.x ?? 0,
              y: w.y ?? 0,
              width: w.width ?? 0,
              height: w.height ?? 0,
              aspect_mode: w.aspectMode ?? 'letterbox',
              z_order: w.zOrder ?? 0,
            })
            if (w.backgroundColor)
              playerSend({ command: 'background_color', window_id: w.id, color: w.backgroundColor })
          }
          playerSend({ command: 'get_windows' })
        }
        // 출력 채널 지연은 전역 설정 폐지 → 재생 중인 장면의 채널 설정을 따른다(playScene에서 적용).
        // 전역 마스터 볼륨 복원
        if (pStatus.playerFeatures.includes('master_volume')) {
          playerSend({ command: 'set_master_volume', volume: pStatus.masterVolume })
        }
        // 멀티 PC 동기(v3): slave/master 역할이면 플레이어 준비 시점에 설정된 클럭(PTP/넷클럭)을 켠다.
        // (role 설정/부팅 시점엔 플레이어 미연결이라 명령이 유실될 수 있어 여기서 확정 발신.)
        if (
          pStatus.sync?.role !== 'standalone' &&
          (pStatus.playerFeatures.includes('ptp_sync') ||
            pStatus.playerFeatures.includes('net_clock'))
        ) {
          import('../api/player/peerSync.js').then(({ enableClockLocal }) =>
            enableClockLocal(pStatus.sync.role),
          )
        }
        break

      // HW 가속 실효 상태(v3): 요청(enabled) vs 실효(render/decode). d3d11 프로브 실패 시 요청은
      // on이어도 render=software가 될 수 있어, UI가 "소프트웨어(폴백)"을 구분 표시하도록 반영.
      case 'hwaccel_status':
        pStatus.hardwareAccelEffective =
          msgData?.render === 'software' && msgData?.decode === 'software' ? 'software' : 'hardware'
        ioClient.emit('pStatus', { hardwareAccelEffective: pStatus.hardwareAccelEffective })
        pStatus.hardwareAccelMode = msgData?.mode || null // 'hw_only'|'on'|'off'
        ioClient.emit('pStatus', { hardwareAccelMode: pStatus.hardwareAccelMode })
        logger.info(`Hardware acceleration: ${JSON.stringify(msgData)}`)
        break

      // 재생 실패(v3): HW 전용 모드에서 GPU 미지원 코덱, 파일 열기 실패 등. 창별 path+reason을
      // pStatus.lastPlaybackError(지속 배지)에 저장 + 'playbackError' 이벤트(UI 토스트)로 발신.
      case 'playback_error': {
        const reasonText = {
          codec_unsupported: '코덱 미지원 (하드웨어 디코더 없음)',
          file_error: '파일을 열 수 없음',
          preroll_failed: '재생 준비 실패',
          preroll_timeout: '재생 준비 시간 초과',
        }
        const payload = {
          windowId: typeof msgData?.window_id === 'number' ? msgData.window_id : null,
          path: msgData?.path || '',
          reason: msgData?.reason || 'preroll_failed',
          message: reasonText[msgData?.reason] || '재생 실패',
          at: Date.now(),
        }
        pStatus.lastPlaybackError = payload
        ioClient.emit('pStatus', { lastPlaybackError: payload })
        ioClient.emit('playbackError', payload)
        logger.error(
          `[Player] playback_error: ${payload.reason} "${payload.path}" (win ${payload.windowId})`,
        )
        break
      }

      // 프리로드 상태(v3): 창별 풀 프리롤 진척 — UI "로딩됨/로딩중" 배지용.
      case 'preload_status': {
        const { onPreloadStatus } = await import('../api/playlists/index.js')
        onPreloadStatus(msgData)
        break
      }

      // 멀티 윈도우(v3): 창 목록 피드백 (get_windows / create_window / destroy_window 응답).
      // 플레이어가 실제 보유한 창 목록 — SPA로 통째 전달.
      case 'windows':
        pStatus.playerWindows = msgData?.windows || []
        ioClient.emit('pStatus', { playerWindows: pStatus.playerWindows })
        logger.info(`Player windows: ${pStatus.playerWindows.length}`)
        break

      // 메모리 상태(v3): 전 트랙 프리롤 압박 가시화 — 플레이어 RSS + 시스템 가용/총 + 엔진 통계.
      // 1초 주기 → 그대로 pStatus.memory 교체 후 SPA 발신 (UI 인디케이터).
      case 'memory_status':
        pStatus.memory = msgData || {}
        ioClient.emit('pStatus', { memory: pStatus.memory })
        break

      // 멀티 PC 클럭 동기(v3 Phase 5): enable_ptp/enable_net_clock/ptp_base_time/get_running_time 응답.
      case 'ptp_status':
      case 'net_clock_status':
      case 'running_time': {
        const { onPtpStatus } = await import('../api/player/peerSync.js')
        onPtpStatus(msgData)
        break
      }

      // 독립 오디오 트랙 상태 틱 (v2) — pStatus.audioTracks에 병합, SPA로는 스로틀 발신
      case 'audio_track_data': {
        const trackId = msgData?.track_id
        if (!trackId) break
        if (msgData.state === 'stopped') {
          // 종료 = 키 삭제 (SPA는 audioTracks를 통째 교체 수신하므로 즉시 반영)
          delete pStatus.audioTracks[trackId]
          delete audioTrackEmitAt[trackId]
          ioClient.emit('pStatus', { audioTracks: pStatus.audioTracks })
          break
        }
        if (!pStatus.audioTracks[trackId]) {
          pStatus.audioTracks[trackId] = { itemId: trackId }
        }
        Object.assign(pStatus.audioTracks[trackId], {
          time: msgData.time ?? 0,
          duration: msgData.duration ?? 0,
          position: msgData.position ?? 0,
          is_playing: !!msgData.is_playing,
          state: msgData.state || '',
        })
        const now = Date.now()
        if (
          !audioTrackEmitAt[trackId] ||
          now - audioTrackEmitAt[trackId] >= AUDIO_TRACK_EMIT_INTERVAL_MS
        ) {
          audioTrackEmitAt[trackId] = now
          ioClient.emit('pStatus', { audioTracks: pStatus.audioTracks })
        }
        break
      }

      // 타임라인 위치 틱 (v2 §5.2) — pStatus.timelinePos 갱신, SPA로 ~200ms 스로틀 발신
      case 'timeline_position': {
        pStatus.timelinePos = {
          time_ms: msgData.time_ms ?? 0,
          duration_ms: msgData.duration_ms ?? pStatus.timelinePos.duration_ms ?? 0,
          is_playing: !!msgData.is_playing,
        }
        const nowTl = Date.now()
        // is_playing 전이(정지/종료)는 즉시, 그 외는 스로틀
        if (
          !pStatus.timelinePos.is_playing ||
          nowTl - timelinePosEmitAt >= TIMELINE_POS_EMIT_INTERVAL_MS
        ) {
          timelinePosEmitAt = nowTl
          ioClient.emit('pStatus', { timelinePos: pStatus.timelinePos })
        }
        break
      }

      // 타임라인 큐 지연 경고 (진단)
      case 'timeline_cue_late':
        logger.warn(
          `Timeline cue late: clip=${msgData?.clip_id} by ${msgData?.late_ms}ms`,
        )
        break

      // probe_media / make_thumbnail 응답 → 대기 중인 playerRequest resolve (Phase 2.5)
      case 'probe_result':
      case 'thumbnail_result':
        resolvePlayerResult(msgData)
        break

      case 'closed':
        logger.warn('Player window closed, exiting application')
        app.exit(0)
        break

      default:
        logger.warn(`Unknown message type from player: ${type}`)
        break
    }
  } catch (error) {
    logger.error(`Error parsing player message: ${error.message}`)
    logger.debug(`Raw data: ${data}`)
  }
}

export default parsePlayerStatus
