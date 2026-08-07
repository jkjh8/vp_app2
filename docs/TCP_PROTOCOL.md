# TCP 외부제어 프로토콜 (v2)

> **외부 제어 인터페이스** — 이 TCP 프로토콜은 외부 시스템(AV 컨트롤러 등) 연동용입니다. 브라우저
> SPA/일반 제어는 REST API + socket.io(`pStatus`) 경로(`docs/API_MANUAL.md`)를 사용합니다.

## 개요

VP App2의 TCP 서버는 표준 JSON 응답 봉투로 일관된 피드백을 제공합니다. 명령은 `domain.action`
네임스페이스(소문자)이며 **레거시 flat 명령은 없습니다**(재설계 v2에서 제거). 서버는 두 포트를 엽니다:
**단순(comma-separated)** 과 **JSON**. 각 포트는 해당 형식만 허용하며(교차 시 `format_error`), 명령
처리 로직은 동일합니다.

재설계 v2 요점:
- **네임스페이스 전용 명령** (`domain.action`).
- **모든 명령이 응답**한다.
- **버전/기능협상**: 접속 welcome 배너와 `system.capabilities`가 `protocolVersion` + 플레이어
  `features` + 지원 명령 목록을 제공한다.
- 다중창 · 재생모드(scene/window) · 프리로딩 · 마스터볼륨 · 디스플레이 · 타임라인 커버.

## 연결 정보

- **포트**: 15000 (단순/comma-separated) · 15001 (JSON) — 기본값(`pStatus.tcpSimplePort` / `tcpJsonPort`). 충돌 시 +1 대체.
- **프로토콜**: TCP (0.0.0.0 바인드), 한 줄당 하나의 명령(`\n` 구분).
- **접속 시** welcome 응답 예:

```json
{
  "timestamp": "2026-08-07T10:30:45.123Z",
  "success": true,
  "command": "connect",
  "message": "Connected to VP Server (JSON Command Port)",
  "data": {
    "serverId": "vp_app2",
    "appVersion": "0.5.9",
    "protocolVersion": "2.0",
    "port": "json",
    "format": "json",
    "features": ["multi_window", "timeline", "master_volume"],
    "commands": ["player.play", "player.pause", "..."]
  }
}
```

## 응답 형식

### 성공

```json
{
  "timestamp": "2026-08-07T10:30:45.123Z",
  "success": true,
  "command": "mode.set",
  "message": "Playback mode: window",
  "data": { "playbackMode": "window" }
}
```

### 에러

```json
{
  "timestamp": "2026-08-07T10:30:45.123Z",
  "success": false,
  "command": "window.play",
  "error": {
    "code": "EXECUTION_ERROR",
    "message": "Failed to play window (player not connected or not window mode)",
    "details": "..."
  }
}
```

### 이벤트 (브로드캐스트, 요청 없이 수신)

```json
{
  "timestamp": "2026-08-07T10:30:45.123Z",
  "success": true,
  "command": "event",
  "message": "Event: playStarted",
  "data": { "eventType": "playStarted", "fileId": 5, "filename": "example.mp4" }
}
```

## 명령 형식

- **JSON 포트(15001)**: `{"command": "domain.action", ...파라미터}` — 파라미터는 이름으로 지정.
- **단순 포트(15000)**: `domain.action,value1,value2,...` — 파라미터는 스펙 순서대로 위치 지정.

예) 창별 재생 — JSON `{"command":"window.play","windowId":2,"index":0}` · 단순 `window.play,2,0`

## 지원 명령

### 재생 제어 (player.*)
- `player.play [windowId]` — 재생
- `player.pause [windowId]` — 일시정지/재개
- `player.stop [windowId]` — 정지(미지정=전체)
- `player.next [windowId]` / `player.prev [windowId]`
- `player.seek <ms> [windowId]` — 탐색
- `player.fullscreen [true|false]` — 전체화면(값 생략 시 토글)

### 플레이리스트 (playlist.*)
- `playlist.play <id> [track]`
- `playlist.preload <id>` — 전 트랙 프리롤(재생 안 함)
- `playlist.list` / `playlist.get <id>`

### 재생 모드 (mode.*)
- `mode.set <scene|window>` — 전역 작업 모드
- `mode.get`
- `mode.switch <playlistId> <scene|window>` — 특정 플레이리스트 타입 즉시 전환

### 창별 제어 (window.*) — 윈도우 모드/멀티윈도우 기능 필요
- `window.play <windowId> [index] [playlistId]`
- `window.stop <windowId>`
- `window.next <windowId>` / `window.prev <windowId>`
- `window.list`

### 프리로딩 (preload.*)
- `preload.config <lookahead> <maxDecks>`
- `preload.get`

### 오디오 (audio.*)
- `audio.setdevice <deviceId>`
- `audio.listdevices` / `audio.getdevice`
- `audio.mastervolume <0-100>` / `audio.getmastervolume`
- `audio.channeldelays <ms,ms,...>`

### 화면 · 로고 (display.* / logo.*)
- `display.set <monitorIndex> [x y width height aspectMode]`
- `display.list`
- `display.background <#rrggbb>`
- `logo.show <true|false>` / `logo.size <n>`

### 반복 (repeat.*)
- `repeat.set [none|all|repeat_one]` — 생략 시 토글
- `repeat.get`

### 타임라인 (timeline.*) — 플레이어 timeline 기능 필요
- `timeline.play <timelineId> [ms]`
- `timeline.pause` / `timeline.stop` / `timeline.seek <ms>`

### 시스템 · 자동 시작 · 조회
- `system.status` — 상태 스냅샷
- `system.version` — 앱/프로토콜 버전
- `system.capabilities` — 버전 + features + 지원 명령 목록
- `startonplay.set [true|false] [playlistId]` / `startonplay.get`
- `files.list`

## 에러 코드

`UNKNOWN_COMMAND` · `MISSING_PARAMETER` · `INVALID_PARAMETER` · `NOT_FOUND` · `EXECUTION_ERROR` ·
`FORMAT_ERROR`(포트 형식 불일치) · `INVALID_JSON` · `INVALID_MESSAGE` · `COMMAND_ERROR` · `UNKNOWN_ERROR`

## 이벤트 타입

`playerReady` · `playStarted` · `playPaused` · `playStopped` · `nextTrack` · `prevTrack` ·
`trackEnded` · `endReached` · `mediaChanged` · `fullscreenChanged` · `audioDevicesUpdated` ·
`playbackModeChanged` · `windowStopped` · `repeatChanged`

## 사용 예시

### Node.js

```js
const net = require('net')

// 1) Simple 포트(15000): 쉼표 구분 텍스트 명령
const simple = net.connect(15000, 'localhost', () => {
  simple.write('mode.set,window\n')
  simple.write('window.play,2,0\n')
  simple.write('audio.mastervolume,50\n')
})

// 2) JSON 포트(15001): JSON 객체 명령
const json = net.connect(15001, 'localhost', () => {
  json.write(JSON.stringify({ command: 'system.capabilities' }) + '\n')
  json.write(JSON.stringify({ command: 'playlist.play', id: 1, track: 0 }) + '\n')
})

json.on('data', (buf) => {
  for (const line of buf.toString().split('\n').filter(Boolean)) {
    console.log('수신:', JSON.parse(line))
  }
})
```

### Python

```python
import socket, json

# 1) Simple 포트(15000): 쉼표 구분 텍스트 명령
s = socket.create_connection(('localhost', 15000))
for cmd in ['mode.set,window', 'window.play,2,0', 'audio.mastervolume,50']:
    s.sendall((cmd + '\n').encode())

# 2) JSON 포트(15001): JSON 객체 명령
j = socket.create_connection(('localhost', 15001))
def send(obj):
    j.sendall((json.dumps(obj) + '\n').encode())

send({'command': 'system.capabilities'})
send({'command': 'playlist.play', 'id': 1, 'track': 0})

buf = ''
while True:
    buf += j.recv(4096).decode()
    while '\n' in buf:
        line, buf = buf.split('\n', 1)
        if line:
            print('수신:', json.loads(line))
```

## 설계 원칙

1. **일관된 응답 봉투** — 모든 응답이 `timestamp/success/command` 공유.
2. **명확한 에러** — 코드 + 메시지 + 상세.
3. **모든 명령 응답** — 조회/설정/트랜스포트 모두 응답(이벤트는 별도 브로드캐스트).
4. **버전/기능협상** — 신규 명령 사용 전 `system.capabilities`로 features 확인.
5. **네임스페이스 전용** — 모든 명령은 `domain.action`. 레거시 flat 명령은 지원하지 않는다.
