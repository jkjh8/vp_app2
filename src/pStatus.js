let pStatus = {
  windowOpen: false,
  playlistMode: false,
  // 전역 작업 모드 (영속). 'scene' = 장면(전 창 락스텝) / 'window' = 창별 독립 재생·정지.
  // 실제 재생/편집 분기는 로드된 플레이리스트의 mode 필드를 따르고, 이 값은 UI 에디터/목록 필터/
  // 신규 플레이리스트 기본 타입을 정한다.
  playbackMode: 'scene',
  playlist: {},
  preloadedPlaylistId: null, // 프리로딩(로딩 버튼/편집)된 플레이리스트 — 재프리로드/배지 판단
  // 창별 프리롤 진척 (preload_status 피드백) — { [windowId]: {expected, prerolled, ready} }.
  // socketio.js에서 통째 교체 전송(키 삭제 의미).
  preloadStatus: {},
  preloadReady: false, // 파생: 활성 창 전부 프리롤 완료 (UI "로딩됨" 배지)
  trackId: 0,
  repeat: 'none',
  tcpSimplePort: 15000,
  tcpJsonPort: 15001,
  // VP_WEB_PORT: 개발 환경 포트 충돌(예: VS Code 프리뷰가 3000 점유) 대응용 오버라이드
  webPort: Number(process.env.VP_WEB_PORT) || 3000,
  startOnPlay: false,
  startOnPlaylistId: null,
  audioDevices: [],
  audioDevice: '',
  // 하드웨어 가속: 'auto' | 'on' | 'off' | 'hwonly' (기동 시 VP_HWACCEL env로 전달, 변경 시 재시작).
  //  hwonly = GPU 디코더 전용(소프트웨어 폴백 없음) — 코덱 특허 SW 디코드 회피용.
  hardwareAcceleration: 'auto',
  hardwareAccelEffective: null, // 'hardware' | 'software' (플레이어 hwaccel_status 실효값)
  hardwareAccelMode: null, // 'hw_only' | 'on' | 'off' (플레이어 실효 모드)
  // 최근 재생 실패 (HW 전용 코덱 미지원/파일 오류 등) — UI 배지/토스트용. {windowId,path,reason,message,at}
  lastPlaybackError: null,
  // 전역 오디오 마스터 볼륨 (0~100) — 플레이어 출력 버스에 적용.
  masterVolume: 100,
  // 출력 채널별 오디오 지연(ms) — 스피커 동기 보정 (믹서 출력에 적용, 임베디드+오디오트랙 공통)
  channelDelays: [],
  logoFile: '',
  logoShow: true, // 사용자 선호값 (show_logo 커맨드로 설정)
  logoVisible: false, // 실제 화면 표시 여부 (logo_visibility 피드백, §2.7 자동 규칙 반영 결과)
  logoSize: 0,
  file: {},
  player: {
    event: '',
    volume: 100,
    speed: 1.0,
    position: 0,
    duration: 0,
    time: 0,
  },
  activePlayerId: 0,
  fullscreen: false,
  backgroundColor: '#000000',
  // 프로그램 전역 디스플레이 배치 설정 (모니터/좌표/크기/비율 강제)
  display: {
    monitorIndex: -1, // -1 = primary
    x: 0,
    y: 0,
    width: 0, // 0 = 모니터 전체 폭
    height: 0, // 0 = 모니터 전체 높이
    aspectMode: 'letterbox', // 'letterbox' | 'crop' | 'stretch'
  },
  displays: [], // get_displays 피드백으로 채워지는 현재 감지된 모니터 목록
  // 멀티 윈도우(v3): 사용자 정의 출력 창 목록 (dbStatus에 영속). 각 창은 모니터/좌표/크기 배치.
  // { id, name, monitorIndex, x, y, width, height, aspectMode, backgroundColor }
  windows: [],
  // 플레이어가 실제 보유한 창 목록 (get_windows/windows 피드백) — 사용자 설정(windows)과 구분
  playerWindows: [],
  // 창별 재생 상태 (창 동시 재생 — 창마다 독립 커서/활성 덱). { [windowId]: {trackId, activePlayerId, player} }
  // socketio.js에서 통째 교체로 전송 (키 삭제 의미)
  windowStates: {},
  // 전 트랙 프리롤 설정 (v3). lookahead = 창당 미리 프리롤할 다음 트랙 수, maxDecks = 전역 상한.
  preloadLookahead: 2,
  preloadMaxDecks: 8,
  // 메모리 상태 (플레이어 memory_status 피드백) — 전 트랙 프리롤 압박 UI 표시용.
  // { surfaces, live_decks, prerolled_decks, pool_decks, audio_tracks, rss_bytes,
  //   private_bytes, sys_total_bytes, sys_avail_bytes, sys_load_percent }
  memory: {},
  // v2 (PROTOCOL.md §5.1): 병행 오디오 트랙 라이브 상태 — { [itemId]: audio_track_data }
  // SPA로는 통째 교체로 전송 (키 삭제가 의미를 가짐 — socketio.js 참고)
  audioTracks: {},
  // 플레이어 capabilities.features — 신규 명령 송신 게이트 (구버전 플레이어 = 빈 배열)
  playerFeatures: [],
  // 멀티 PC 클럭 동기 (v3 Phase 5). role standalone=단독(기본), master=주, slave=종.
  // PTP(멀티캐스트) 클럭 + base_time 공유 + 멀티캐스트 start_at 트리거로 전 PC 락스텝 재생.
  sync: {
    role: 'standalone', // 'standalone' | 'master' | 'slave'
    domain: 0, // PTP 도메인
    peers: [], // master가 제어할 slave IP 목록
    multicastAddr: '239.255.42.99',
    multicastPort: 15002,
    leadMs: 1000, // start_at = 현재 공유 러닝타임 + leadMs
    ptp: {}, // 로컬 플레이어 ptp_status (enabled/synced/base_time/running_time)
  },
  // Phase B 타임라인 모드 (playlistMode와 상호배타)
  timelineMode: false,
  timeline: {},
  timelinePos: { time_ms: 0, duration_ms: 0, is_playing: false },
}

export default pStatus
