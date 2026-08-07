// 외부제어 TCP 명령 레지스트리 (재설계 v2 — 네임스페이스 전용, 레거시 없음).
// 각 명령 = { name, category, params[], handler(params) }.
//   - name    : 정규 명령 (domain.action, 소문자 dot 네임스페이스)
//   - params  : 위치/이름 파라미터 스펙. simple 포트는 순서(위치), JSON 포트는 이름으로 매핑.
//               { name, type:'number'|'string'|'boolean'|'number[]'|'raw', required?, default?, jsonAliases? }
//               type 'number[]'는 rest(남은 값 전부) — 반드시 마지막 파라미터.
//   - handler : 실제 동작. 전부 기존 api 함수에 위임(신규 로직 없음). 반환값:
//               string → message / 객체 → data / {message,data} → 그대로.
// 핸들러가 throw하면 dispatcher가 표준 에러 봉투로 변환한다(err.code 있으면 사용).
import pStatus from '../../pStatus.js'
import { dbFiles, dbStatus } from '../../db/index.js'
import { broadcastEvent } from '../../tcp/index.js'
import { PROTOCOL_VERSION, APP_VERSION, TCP_EVENTS } from '../../utils/tcpResponse.js'
import {
  play,
  pause,
  stop,
  setNext,
  setPrevious,
  updateTime,
  setFullscreen,
  setRepeat,
  setAudioDevice,
  setMasterVolume,
  setDisplay,
  getDisplays,
  setBackground,
  showLogo,
  setLogoSize,
} from '../player/index.js'
import {
  playlistPlay,
  getPlaylists,
  getPlaylist,
  setPlaybackMode,
  switchPlaylistMode,
  playWindowInPlaylist,
  stopWindow,
  preloadPlaylistOnly,
} from '../playlists/index.js'
import { listWindows, setPreloadConfig, setChannelDelays } from '../player/windows.js'
import {
  timelinePlay,
  timelinePause,
  timelineSeek,
  timelineStop,
} from '../timelines/index.js'

// 에러에 코드를 실어 throw (dispatcher가 표준 에러 봉투로 변환)
const fail = (message, code = 'EXECUTION_ERROR') => {
  const e = new Error(message)
  e.code = code
  throw e
}

// 플레이리스트/트랙 간소화 (TCP 응답 최소화 — AMX 등 외부 표시용 amx 필드 포함)
const simplifyTrack = (track, index) =>
  !track
    ? null
    : {
        trackId: index,
        uuid: track.uuid,
        amx: track.amx,
        filename: track.filename || track.originalname,
        time: track.time || 0,
        mimetype: track.mimetype,
        duration: track.metadata?.format?.duration,
        size: track.size,
        is_image: track.is_image || false,
      }

const simplifyPlaylist = (pl) =>
  !pl
    ? null
    : {
        playlistId: pl.playlistId,
        name: pl.name,
        description: pl.description,
        mode: pl.mode || 'scene',
        tracks: (pl.tracks || []).map((t, i) => simplifyTrack(t, i)),
        createdAt: pl.createdAt,
        updatedAt: pl.updatedAt,
      }

const allowedRepeatModes = () =>
  pStatus.playlistMode === false ? ['none', 'all'] : ['none', 'all', 'repeat_one']

export const commands = [
  // ── 재생 제어 (player.*) ────────────────────────────────────
  {
    name: 'player.play',
    category: 'playback',
    description: '재생 (windowId 지정 시 해당 창만, 윈도우 모드)',
    params: [{ name: 'windowId', type: 'number' }],
    handler: ({ windowId }) => play(windowId ?? null),
  },
  {
    name: 'player.pause',
    category: 'playback',
    description: '일시정지/재개 토글',
    params: [{ name: 'windowId', type: 'number' }],
    handler: ({ windowId }) => pause(windowId ?? null),
  },
  {
    name: 'player.stop',
    category: 'playback',
    description: '정지 (windowId 미지정 시 전체 정지)',
    params: [{ name: 'windowId', type: 'number' }],
    handler: ({ windowId }) => stop(windowId ?? null),
  },
  {
    name: 'player.next',
    category: 'playback',
    description: '다음 트랙',
    params: [{ name: 'windowId', type: 'number' }],
    handler: ({ windowId }) => setNext(windowId ?? null),
  },
  {
    name: 'player.prev',
    category: 'playback',
    description: '이전 트랙',
    params: [{ name: 'windowId', type: 'number' }],
    handler: ({ windowId }) => setPrevious(windowId ?? null),
  },
  {
    name: 'player.seek',
    category: 'playback',
    description: '재생 위치(탐색) 변경',
    params: [
      { name: 'time', type: 'number', required: true },
      { name: 'windowId', type: 'number' },
    ],
    handler: ({ time, windowId }) => updateTime(time, windowId),
  },
  {
    name: 'player.fullscreen',
    category: 'playback',
    description: '전체화면 설정 (값 생략 시 토글)',
    params: [{ name: 'value', type: 'boolean' }],
    handler: async ({ value }) => {
      const fs = value === undefined ? !pStatus.fullscreen : Boolean(value)
      await setFullscreen(fs)
      return { message: `Fullscreen ${fs ? 'enabled' : 'disabled'}`, data: { fullscreen: fs } }
    },
  },

  // ── 플레이리스트 (playlist.*) ───────────────────────────────
  {
    name: 'playlist.play',
    category: 'playlist',
    description: '플레이리스트 재생 (id + 시작 트랙)',
    params: [
      { name: 'id', type: 'number', required: true },
      { name: 'track', type: 'number', default: 0 },
    ],
    handler: async ({ id, track }) => {
      const r = await playlistPlay(id, track || 0)
      if (!r) fail('Failed to play playlist (player not connected or unavailable)', 'EXECUTION_ERROR')
      return { message: `Playing playlist ${id}`, data: { playlistId: id, track: track || 0 } }
    },
  },
  {
    name: 'playlist.preload',
    category: 'playlist',
    description: '플레이리스트 전체를 메모리에 프리롤 (재생 안 함)',
    params: [{ name: 'id', type: 'number', required: true }],
    handler: async ({ id }) => {
      const r = await preloadPlaylistOnly(id)
      if (!r) fail('Preload failed (player not connected?)', 'EXECUTION_ERROR')
      return { message: r, data: { playlistId: id } }
    },
  },
  {
    name: 'playlist.list',
    category: 'query',
    description: '플레이리스트 목록 조회',
    params: [],
    handler: async () => {
      const pls = await getPlaylists()
      return { message: `Found ${pls.length} playlists`, data: { playlists: pls.map(simplifyPlaylist), count: pls.length } }
    },
  },
  {
    name: 'playlist.get',
    category: 'query',
    description: '특정 플레이리스트 조회',
    params: [{ name: 'id', type: 'number', required: true }],
    handler: async ({ id }) => {
      const pl = await getPlaylist(id)
      return { message: pl ? `Found playlist ${id}` : `Playlist ${id} not found`, data: { playlist: simplifyPlaylist(pl) } }
    },
  },

  // ── 재생 모드 (mode.*) ──────────────────────────────────────
  {
    name: 'mode.set',
    category: 'mode',
    description: '전역 작업 모드 설정 (scene | window)',
    params: [{ name: 'mode', type: 'string', required: true }],
    handler: async ({ mode }) => {
      if (!['scene', 'window'].includes(mode)) fail('mode must be scene | window', 'INVALID_PARAMETER')
      const m = await setPlaybackMode(mode)
      broadcastEvent(TCP_EVENTS.PLAYBACK_MODE_CHANGED, { mode: m })
      return { message: `Playback mode: ${m}`, data: { playbackMode: m } }
    },
  },
  {
    name: 'mode.get',
    category: 'query',
    description: '현재 전역 작업 모드 조회',
    params: [],
    handler: () => ({ data: { playbackMode: pStatus.playbackMode } }),
  },
  {
    name: 'mode.switch',
    category: 'mode',
    description: '특정 플레이리스트의 타입 즉시 전환 (트랙 구조 변환)',
    params: [
      { name: 'playlistId', type: 'number', required: true },
      { name: 'mode', type: 'string', required: true },
    ],
    handler: async ({ playlistId, mode }) => {
      if (!['scene', 'window'].includes(mode)) fail('mode must be scene | window', 'INVALID_PARAMETER')
      const pl = await getPlaylist(playlistId)
      if (!pl) fail(`Playlist ${playlistId} not found`, 'NOT_FOUND')
      const r = await switchPlaylistMode(pl._id, mode)
      if (!r) fail('Failed to switch playlist mode', 'EXECUTION_ERROR')
      return { message: `Playlist ${playlistId} → ${mode}`, data: { playlistId, mode } }
    },
  },

  // ── 창별 제어 (window.*) ────────────────────────────────────
  {
    name: 'window.play',
    category: 'window',
    description: '지정 창만 재생 (윈도우 모드). playlistId 생략 시 현재 로드된 플레이리스트',
    params: [
      { name: 'windowId', type: 'number', required: true },
      { name: 'index', type: 'number', default: 0 },
      { name: 'playlistId', type: 'number' },
    ],
    handler: async ({ windowId, index, playlistId }) => {
      const r = await playWindowInPlaylist(playlistId ?? null, windowId, index || 0)
      if (!r) fail('Failed to play window (player not connected or not window mode)', 'EXECUTION_ERROR')
      return { message: r, data: { windowId, index: index || 0 } }
    },
  },
  {
    name: 'window.stop',
    category: 'window',
    description: '지정 창만 정지',
    params: [{ name: 'windowId', type: 'number', required: true }],
    handler: ({ windowId }) => {
      const r = stopWindow(windowId)
      broadcastEvent(TCP_EVENTS.WINDOW_STOPPED, { windowId })
      return { message: r, data: { windowId } }
    },
  },
  {
    name: 'window.next',
    category: 'window',
    description: '지정 창을 다음 항목으로',
    params: [{ name: 'windowId', type: 'number', required: true }],
    handler: ({ windowId }) => setNext(windowId),
  },
  {
    name: 'window.prev',
    category: 'window',
    description: '지정 창을 이전 항목으로',
    params: [{ name: 'windowId', type: 'number', required: true }],
    handler: ({ windowId }) => setPrevious(windowId),
  },
  {
    name: 'window.list',
    category: 'query',
    description: '출력 창 목록 조회 (설정 창 + 플레이어 실제 창)',
    params: [],
    handler: () => ({ data: listWindows() }),
  },

  // ── 프리로딩 (preload.*) ────────────────────────────────────
  {
    name: 'preload.config',
    category: 'preload',
    description: '프리롤 설정 (lookahead=창당 미리읽기 트랙 수, maxDecks=전역 덱 상한)',
    params: [
      { name: 'lookahead', type: 'number', required: true },
      { name: 'maxDecks', type: 'number', required: true },
    ],
    handler: async ({ lookahead, maxDecks }) => {
      const r = await setPreloadConfig({ lookahead, maxDecks })
      return { message: 'Preload config updated', data: r }
    },
  },
  {
    name: 'preload.get',
    category: 'query',
    description: '프리롤 설정 및 진척 상태 조회',
    params: [],
    handler: () => ({
      data: {
        lookahead: pStatus.preloadLookahead,
        maxDecks: pStatus.preloadMaxDecks,
        status: pStatus.preloadStatus,
        ready: pStatus.preloadReady,
      },
    }),
  },

  // ── 오디오 (audio.*) ────────────────────────────────────────
  {
    name: 'audio.listdevices',
    category: 'query',
    description: '사용 가능한 오디오 장치 목록',
    params: [],
    handler: () => ({ data: { devices: pStatus.audioDevices } }),
  },
  {
    name: 'audio.getdevice',
    category: 'query',
    description: '현재 선택된 오디오 장치',
    params: [],
    handler: () => ({ data: { device: pStatus.audioDevice } }),
  },
  {
    name: 'audio.setdevice',
    category: 'audio',
    description: '오디오 장치 설정',
    params: [{ name: 'device', type: 'string', required: true }],
    handler: async ({ device }) => {
      await setAudioDevice(device)
      return { message: `Audio device set`, data: { device: pStatus.audioDevice } }
    },
  },
  {
    name: 'audio.mastervolume',
    category: 'audio',
    description: '마스터 볼륨 설정 (0~100)',
    params: [{ name: 'value', type: 'number', required: true }],
    handler: async ({ value }) => {
      await setMasterVolume(value, true)
      return { message: `Master volume: ${pStatus.masterVolume}`, data: { masterVolume: pStatus.masterVolume } }
    },
  },
  {
    name: 'audio.getmastervolume',
    category: 'query',
    description: '현재 마스터 볼륨 조회',
    params: [],
    handler: () => ({ data: { masterVolume: pStatus.masterVolume } }),
  },
  {
    name: 'audio.channeldelays',
    category: 'audio',
    description: '출력 채널별 오디오 지연(ms) 설정',
    params: [{ name: 'delays', type: 'number[]', required: true }],
    handler: async ({ delays }) => {
      const r = await setChannelDelays(delays)
      return { message: 'Channel delays updated', data: { delays: r } }
    },
  },

  // ── 디스플레이 / 로고 (display.* / logo.*) ──────────────────
  {
    name: 'display.list',
    category: 'query',
    description: '감지된 모니터 목록 조회 (최신 목록 갱신 요청 포함)',
    params: [],
    handler: () => {
      getDisplays() // 플레이어에 최신 목록 재요청 (비동기 → socket 갱신)
      return { data: { displays: pStatus.displays } }
    },
  },
  {
    name: 'display.set',
    category: 'display',
    description: '전역 디스플레이 배치 (모니터/좌표/크기/비율)',
    params: [
      { name: 'monitorIndex', type: 'number', required: true },
      { name: 'x', type: 'number', default: 0 },
      { name: 'y', type: 'number', default: 0 },
      { name: 'width', type: 'number', default: 0 },
      { name: 'height', type: 'number', default: 0 },
      { name: 'aspectMode', type: 'string', default: 'letterbox' },
    ],
    handler: async ({ monitorIndex, x, y, width, height, aspectMode }) => {
      const r = await setDisplay({ monitorIndex, x, y, width, height, aspectMode })
      return { message: r, data: { display: pStatus.display } }
    },
  },
  {
    name: 'display.background',
    category: 'display',
    description: '배경색 설정 (#rrggbb)',
    params: [{ name: 'color', type: 'string', required: true }],
    handler: async ({ color }) => {
      await setBackground(color)
      return { message: `Background set`, data: { backgroundColor: pStatus.backgroundColor } }
    },
  },
  {
    name: 'logo.show',
    category: 'display',
    description: '로고 표시/숨김',
    params: [{ name: 'show', type: 'boolean', required: true }],
    handler: async ({ show }) => {
      await showLogo(show)
      return { message: `Logo ${show ? 'shown' : 'hidden'}`, data: { logoShow: pStatus.logoShow } }
    },
  },
  {
    name: 'logo.size',
    category: 'display',
    description: '로고 크기 설정',
    params: [{ name: 'size', type: 'number', required: true }],
    handler: async ({ size }) => {
      await setLogoSize(size)
      return { message: `Logo size: ${pStatus.logoSize}`, data: { logoSize: pStatus.logoSize } }
    },
  },

  // ── 반복 (repeat.*) ─────────────────────────────────────────
  {
    name: 'repeat.set',
    category: 'repeat',
    description: '반복 모드 설정 (none | all | repeat_one, 생략 시 토글)',
    params: [{ name: 'mode', type: 'string' }],
    handler: async ({ mode }) => {
      const allowed = allowedRepeatModes()
      if (mode && !allowed.includes(mode)) fail(`invalid mode (allowed: ${allowed.join(', ')})`, 'INVALID_PARAMETER')
      const r = await setRepeat(mode || undefined)
      broadcastEvent(TCP_EVENTS.REPEAT_CHANGED, { repeat: r })
      return { data: { repeat: r, allowedModes: allowed } }
    },
  },
  {
    name: 'repeat.get',
    category: 'query',
    description: '현재 반복 모드 및 허용 모드 조회',
    params: [],
    handler: () => ({ data: { repeat: pStatus.repeat, allowedModes: allowedRepeatModes() } }),
  },

  // ── 타임라인 (timeline.*) ───────────────────────────────────
  {
    name: 'timeline.play',
    category: 'timeline',
    description: '타임라인 재생 (timelineId, 선택적 시작 위치 ms)',
    params: [
      { name: 'timelineId', type: 'string', required: true },
      { name: 'ms', type: 'number', jsonAliases: ['time_ms', 'time'] },
    ],
    handler: async ({ timelineId, ms }) => {
      const r = await timelinePlay(timelineId, ms)
      if (!r) fail('Failed to play timeline (player not connected or feature unsupported)', 'EXECUTION_ERROR')
      return { message: r, data: { timelineId } }
    },
  },
  {
    name: 'timeline.pause',
    category: 'timeline',
    description: '타임라인 일시정지/재개 토글',
    params: [],
    handler: () => timelinePause() || 'Timeline not active',
  },
  {
    name: 'timeline.stop',
    category: 'timeline',
    description: '타임라인 정지',
    params: [],
    handler: () => timelineStop(),
  },
  {
    name: 'timeline.seek',
    category: 'timeline',
    description: '타임라인 위치 이동 (ms)',
    params: [{ name: 'ms', type: 'number', required: true, jsonAliases: ['time_ms', 'time'] }],
    handler: ({ ms }) => timelineSeek(ms) || 'Timeline not active',
  },

  // ── 자동 시작 (startonplay.*) ───────────────────────────────
  {
    name: 'startonplay.set',
    category: 'system',
    description: '프로그램 시작 시 자동 재생 설정 (+ 재생할 플레이리스트 ID)',
    params: [
      { name: 'enabled', type: 'boolean' },
      { name: 'playlistId', type: 'number' },
    ],
    handler: async ({ enabled, playlistId }) => {
      if (enabled === undefined) {
        return { message: 'Current start-on-play', data: { enabled: pStatus.startOnPlay, playlistId: pStatus.startOnPlaylistId } }
      }
      pStatus.startOnPlay = Boolean(enabled)
      await dbStatus.update({ type: 'startOnPlay' }, { $set: { value: pStatus.startOnPlay } }, { upsert: true })
      if (pStatus.startOnPlay && playlistId !== undefined) {
        pStatus.startOnPlaylistId = playlistId
        await dbStatus.update({ type: 'startOnPlaylistId' }, { $set: { playlistId } }, { upsert: true })
      }
      return {
        message: `Start-on-play ${pStatus.startOnPlay ? 'enabled' : 'disabled'}`,
        data: { enabled: pStatus.startOnPlay, playlistId: pStatus.startOnPlaylistId },
      }
    },
  },
  {
    name: 'startonplay.get',
    category: 'query',
    description: '현재 자동 시작 설정 조회',
    params: [],
    handler: () => ({ data: { enabled: pStatus.startOnPlay, playlistId: pStatus.startOnPlaylistId } }),
  },

  // ── 시스템 / 조회 (system.*) ────────────────────────────────
  {
    name: 'system.status',
    category: 'query',
    description: '현재 상태 스냅샷 조회',
    params: [],
    handler: () => ({
      data: {
        appVersion: APP_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        ready: !!pStatus.ready,
        playlistMode: pStatus.playlistMode,
        playbackMode: pStatus.playbackMode,
        timelineMode: pStatus.timelineMode,
        repeat: pStatus.repeat,
        trackId: pStatus.trackId,
        fullscreen: pStatus.fullscreen,
        audioDevice: pStatus.audioDevice,
        masterVolume: pStatus.masterVolume,
        backgroundColor: pStatus.backgroundColor,
        windows: (pStatus.windows || []).length,
        playerFeatures: pStatus.playerFeatures,
        file: pStatus.file?.uuid
          ? { uuid: pStatus.file.uuid, filename: pStatus.file.filename, number: pStatus.file.number }
          : null,
        player: {
          time: pStatus.player?.time ?? 0,
          duration: pStatus.player?.duration ?? 0,
          position: pStatus.player?.position ?? 0,
          is_playing: pStatus.player?.is_playing ?? false,
          event: pStatus.player?.event ?? '',
        },
      },
    }),
  },
  {
    name: 'system.version',
    category: 'query',
    description: '앱/프로토콜 버전 조회',
    params: [],
    handler: () => ({ data: { protocolVersion: PROTOCOL_VERSION, appVersion: APP_VERSION } }),
  },
  {
    name: 'system.capabilities',
    category: 'query',
    description: '프로토콜 버전 + 플레이어 기능(features) + 지원 명령 목록 조회',
    params: [],
    handler: () => ({
      data: {
        protocolVersion: PROTOCOL_VERSION,
        features: pStatus.playerFeatures || [],
        commands: commandNames,
      },
    }),
  },
  {
    name: 'files.list',
    category: 'query',
    description: '전체 파일 목록 조회',
    params: [],
    handler: async () => {
      const files = await dbFiles.find()
      return { message: `Found ${files.length} files`, data: { files, count: files.length } }
    },
  },
]

// 정규 명령 이름 목록 (system.capabilities / 도움말 노출용)
export const commandNames = commands.map((c) => c.name)

// name → def 조회 맵 (소문자)
export const commandLookup = (() => {
  const map = new Map()
  for (const def of commands) map.set(def.name.toLowerCase(), def)
  return map
})()

export default commands
