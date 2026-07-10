let pStatus = {
  windowOpen: false,
  playlistMode: false,
  playlist: {},
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
  logoFile: '',
  logoShow: true,
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
  // v2 (PROTOCOL.md §5.1): 병행 오디오 트랙 라이브 상태 — { [itemId]: audio_track_data }
  // SPA로는 통째 교체로 전송 (키 삭제가 의미를 가짐 — socketio.js 참고)
  audioTracks: {},
  // 플레이어 capabilities.features — 신규 명령 송신 게이트 (구버전 플레이어 = 빈 배열)
  playerFeatures: [],
  // Phase B 타임라인 모드 (playlistMode와 상호배타)
  timelineMode: false,
  timeline: {},
  timelinePos: { time_ms: 0, duration_ms: 0, is_playing: false },
}

export default pStatus
