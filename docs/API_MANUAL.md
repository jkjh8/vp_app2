# VP App2 API 매뉴얼

## 개요

VP App2는 미디어 파일 재생 및 플레이리스트 관리를 위한 애플리케이션입니다.
REST API와 TCP 소켓 통신을 통해 원격 제어가 가능합니다.

## API 엔드포인트

### 기본 정보

- **Base URL**: `http://localhost:3000/api`
- **WebSocket**: `ws://localhost:3000`
- **TCP Server**: `localhost:12345`

---

## REST API

### 플레이어 제어

#### 재생 시작

```http
GET /api/player/play
```

현재 파일을 재생하거나 일시정지된 상태를 재개합니다.

**응답 예시:**

```json
{
  "message": "play ok"
}
```

#### 일시정지

```http
GET /api/player/pause
```

재생 중인 미디어를 일시정지합니다.

**응답 예시:**

```json
{
  "message": "pause ok"
}
```

#### 정지

```http
GET /api/player/stop
```

재생을 중지하고 미디어를 처음으로 되돌립니다.

**응답 예시:**

```json
{
  "message": "stop ok"
}
```

#### 파일 ID로 재생

```http
GET /api/player/playid/:id
```

**파라미터:**

- `id` (number): 재생할 파일의 ID

**응답 예시:**

```json
{
  "message": "Playing file: /path/to/file.mp4"
}
```

#### 다음 트랙

```http
GET /api/player/next
```

플레이리스트의 다음 트랙으로 이동합니다.

**응답 예시:**

```json
{
  "message": "next ok"
}
```

#### 이전 트랙

```http
GET /api/player/prev
```

플레이리스트의 이전 트랙으로 이동합니다.

**응답 예시:**

```json
{
  "message": "previous ok"
}
```

#### 전체화면 설정

```http
GET /api/player/fullscreen/:value
```

**파라미터:**

- `value` (boolean): `true` 또는 `false`

**응답 예시:**

```json
{
  "message": "Set fullscreen to true"
}
```

#### 반복 모드 설정

```http
POST /api/player/repeat
```

**요청 본문:**

```json
{
  "mode": "none" | "all" | "repeat_one"
}
```

**응답 예시:**

```json
{
  "result": true,
  "repeat": "all"
}
```

---

### 파일 관리

#### 파일 목록 조회

```http
GET /api/files
```

**응답 예시:**

```json
{
  "result": true,
  "files": [
    {
      "number": 1,
      "id": "file-uuid",
      "filename": "video.mp4",
      "path": "/path/to/video.mp4",
      "mimetype": "video/mp4",
      "size": 1024000,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### 파일 추가

```http
POST /api/files
```

**요청 본문:**

```json
{
  "files": [
    {
      "filename": "video.mp4",
      "path": "/path/to/video.mp4",
      "mimetype": "video/mp4"
    }
  ]
}
```

**응답 예시:**

```json
{
  "result": true,
  "message": "Files added successfully"
}
```

#### 파일 삭제

```http
DELETE /api/files/:id
```

**파라미터:**

- `id` (string): 삭제할 파일의 ID

**응답 예시:**

```json
{
  "result": true,
  "message": "File deleted successfully"
}
```

---

### 플레이리스트 관리

#### 플레이리스트 목록 조회

```http
GET /api/playlists
```

**응답 예시:**

```json
{
  "result": true,
  "playlists": [
    {
      "playlistId": "playlist-uuid",
      "name": "My Playlist",
      "tracks": [
        {
          "id": "file-uuid",
          "name": "video.mp4",
          "path": "/path/to/video.mp4"
        }
      ],
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

#### 플레이리스트 생성

```http
POST /api/playlists
```

**요청 본문:**

```json
{
  "name": "New Playlist",
  "tracks": [
    {
      "id": "file-uuid",
      "name": "video.mp4"
    }
  ]
}
```

**응답 예시:**

```json
{
  "result": true,
  "message": "Playlist created successfully",
  "playlistId": "playlist-uuid"
}
```

#### 플레이리스트 재생

```http
GET /api/playlists/:id/play/:track?
```

**파라미터:**

- `id` (string): 플레이리스트 ID
- `track` (number, optional): 시작 트랙 인덱스 (기본값: 0)

**응답 예시:**

```json
{
  "result": true,
  "message": "Playlist playing"
}
```

#### 플레이리스트 삭제

```http
DELETE /api/playlists/:id
```

**파라미터:**

- `id` (string): 삭제할 플레이리스트 ID

**응답 예시:**

```json
{
  "result": true,
  "message": "Playlist deleted successfully"
}
```

---

### 상태 조회

#### 플레이어 상태 조회

```http
GET /api/status
```

**응답 예시:**

```json
{
  "result": true,
  "pStatus": {
    "player": {
      "state": "playing",
      "time": 5000,
      "duration": 120000,
      "volume": 100
    },
    "file": {
      "id": "file-uuid",
      "name": "video.mp4",
      "path": "/path/to/video.mp4"
    },
    "playlistMode": true,
    "playlist": {
      "playlistId": "playlist-uuid",
      "name": "My Playlist",
      "tracks": []
    },
    "trackId": 0,
    "repeat": "none",
    "fullscreen": false
  }
}
```

---

## TCP 프로토콜

### 연결

```
TCP 서버: localhost:12345
프로토콜: JSON over TCP
```

### 명령어 형식

#### JSON 형식

```json
{
  "command": "play"
}
```

#### 단순 형식

```
play
playid,123
playfile,video.mp4
```

### 지원 명령어

#### 플레이어 제어

- `play` - 재생 시작
- `pause` - 일시정지
- `stop` - 정지
- `playid,<id>` - 파일 ID로 재생
- `playfile,<filename>` - 파일 이름으로 재생
- `next` - 다음 트랙
- `prev` - 이전 트랙

#### 설정

- `fullscreen,<true|false>` - 전체화면 설정
- `setrepeat,<mode>` - 반복 모드 설정 (none, all, repeat_one)
- `getrepeat` - 현재 반복 모드 조회
- `setaudiodevice,<device>` - 오디오 장치 설정
- `getaudiodevices` - 사용 가능한 오디오 장치 목록
- `getaudiodevice` - 현재 오디오 장치 조회

#### 플레이리스트

- `playlistplay,<id>,<track>` - 플레이리스트 재생

#### 데이터 조회

- `getfiles` - 파일 목록 조회
- `getplaylists` - 플레이리스트 목록 조회
- `getplaylist,<id>` - 특정 플레이리스트 조회

#### 시간 제어

- `updatetime,<ms>` - 재생 위치 변경
- `imagetime,<seconds>` - 이미지 표시 시간 설정

### TCP 이벤트

서버에서 클라이언트로 자동 브로드캐스트되는 이벤트들:

#### playStarted

재생이 시작될 때 발생

```json
{
  "event": "playStarted",
  "data": {
    "fileId": 123,
    "filename": "video.mp4"
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### playPaused

재생이 일시정지될 때 발생

```json
{
  "event": "playPaused",
  "data": {},
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### playStopped

재생이 정지될 때 발생

```json
{
  "event": "playStopped",
  "data": {},
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### nextTrack

다음 트랙으로 이동할 때 발생 (수동 조작 시에만)

```json
{
  "event": "nextTrack",
  "data": {
    "trackId": 1
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### prevTrack

이전 트랙으로 이동할 때 발생

```json
{
  "event": "prevTrack",
  "data": {
    "trackId": 0
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### endReached

미디어 재생이 끝났을 때 발생

```json
{
  "event": "endReached",
  "data": {},
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### fullscreenChanged

전체화면 상태가 변경될 때 발생

```json
{
  "event": "fullscreenChanged",
  "data": {
    "value": true
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### audioDevicesUpdated

오디오 장치 목록이 업데이트될 때 발생

```json
{
  "event": "audioDevicesUpdated",
  "data": {
    "devices": ["Device 1", "Device 2"]
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

#### imageTimeChanged

이미지 표시 시간이 변경될 때 발생

```json
{
  "event": "imageTimeChanged",
  "data": {
    "time": 5
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## WebSocket 통신

### 연결

```javascript
const socket = io('http://localhost:3000')
```

### 네임스페이스

#### /client (클라이언트용)

웹 클라이언트를 위한 실시간 상태 업데이트

**이벤트:**

- `pStatus` - 플레이어 상태 변경
- `files` - 파일 목록 업데이트
- `playlists` - 플레이리스트 목록 업데이트

#### /player (플레이어용)

내부 플레이어 프로세스와의 통신

---

## 에러 코드

### HTTP 상태 코드

- `200 OK` - 성공
- `400 Bad Request` - 잘못된 요청
- `404 Not Found` - 리소스를 찾을 수 없음
- `500 Internal Server Error` - 서버 오류

### 에러 응답 형식

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### TCP 에러

```json
{
  "command": "error",
  "message": "Command execution failed: error details",
  "data": {
    "error": "EXECUTION_ERROR",
    "originalMessage": "original command",
    "errorDetails": "stack trace"
  }
}
```

---

## 사용 예시

### JavaScript (REST API)

```javascript
// 재생 시작
fetch('http://localhost:3000/api/player/play')
  .then((response) => response.json())
  .then((data) => console.log(data))

// 파일 목록 조회
fetch('http://localhost:3000/api/files')
  .then((response) => response.json())
  .then((data) => console.log(data.files))
```

### JavaScript (WebSocket)

```javascript
import io from 'socket.io-client'

const socket = io('http://localhost:3000/client')

socket.on('pStatus', (status) => {
  console.log('Player status:', status)
})

socket.on('files', (files) => {
  console.log('Files updated:', files)
})
```

### Python (TCP)

```python
import socket
import json

# 연결
client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
client.connect(('localhost', 12345))

# 명령 전송
command = json.dumps({"command": "play"})
client.send((command + '\n').encode())

# 응답 수신
response = client.recv(4096).decode()
print(response)

client.close()
```

### Node.js (TCP)

```javascript
const net = require('net')

const client = net.createConnection({ port: 12345 }, () => {
  console.log('Connected to server')

  // 명령 전송
  client.write(JSON.stringify({ command: 'play' }) + '\n')
})

client.on('data', (data) => {
  console.log('Received:', data.toString())
})

client.on('end', () => {
  console.log('Disconnected')
})
```

---

## 참고사항

1. **자동 플레이리스트 진행**: 플레이리스트 모드에서 곡이 끝나면 자동으로 다음 곡으로 진행되지만, TCP 이벤트는 발생하지 않습니다. 수동으로 next/prev를 호출할 때만 이벤트가 발생합니다.

2. **파일 정보 간소화**: TCP 이벤트에서 전송되는 파일 정보는 `id`와 `name`만 포함됩니다. 전체 정보가 필요한 경우 별도로 조회해야 합니다.

3. **반복 모드**: 플레이리스트 모드가 아닐 때는 `repeat_one` 모드를 사용할 수 없습니다.

4. **동시 연결**: 여러 TCP 클라이언트가 동시에 연결할 수 있으며, 모든 클라이언트는 동일한 이벤트를 수신합니다.

---

## 버전 정보

- **Version**: 0.1.5
- **Last Updated**: 2025-01-18
