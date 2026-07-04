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
}

export default pStatus
