# TCP 통신 프로토콜 문서

## 개요

VP App2의 TCP 서버는 표준화된 JSON 응답 형식을 사용하여 일관성 있고 명확한 피드백을 제공합니다.

## 연결 정보

- **포트**: 12345 (기본값)
- **프로토콜**: TCP
- **데이터 형식**: JSON (한 줄당 하나의 JSON 객체)

## 응답 형식

### 성공 응답

```json
{
  "timestamp": "2025-10-18T10:30:45.123Z",
  "success": true,
  "command": "play",
  "message": "Playback started",
  "data": {
    "currentFile": { ... },
    "playlistMode": false
  }
}
```

### 에러 응답

```json
{
  "timestamp": "2025-10-18T10:30:45.123Z",
  "success": false,
  "command": "playid",
  "error": {
    "code": "NOT_FOUND",
    "message": "File not found",
    "details": "Error stack trace..."
  }
}
```

### 이벤트 알림 (브로드캐스트)

```json
{
  "timestamp": "2025-10-18T10:30:45.123Z",
  "success": true,
  "command": "event",
  "message": "Event: nextTrack",
  "data": {
    "eventType": "nextTrack",
    "trackId": 2,
    "track": { ... }
  }
}
```

## 지원 명령어

### 플레이어 제어

- `play` - 재생 시작
- `pause` - 일시정지
- `stop` - 정지
- `playid,<id>` - 특정 ID 파일 재생
- `playfile,<filename>` - 파일명으로 검색하여 재생
- `next` - 다음 트랙
- `prev` - 이전 트랙

### 설정

- `fullscreen,true/false` - 전체화면 설정
- `setrepeat,<mode>` - 반복 모드 설정 (none/all/repeat_one)
- `getrepeat` - 현재 반복 모드 조회
- `setaudiodevice,<deviceId>` - 오디오 장치 설정
- `getaudiodevices` - 사용 가능한 오디오 장치 목록

### 플레이리스트

- `playlistplay,<playlistId>,<trackIndex>` - 플레이리스트 재생
- `getplaylists` - 플레이리스트 목록 조회
- `getplaylist,<id>` - 특정 플레이리스트 조회

### 파일 관리

- `getfiles` - 파일 목록 조회

### 기타

- `updatetime,<milliseconds>` - 재생 시간 업데이트
- `imagetime,<seconds>` - 이미지 표시 시간 설정

## 명령어 형식

### JSON 형식 (권장)

```json
{
  "command": "playid",
  "id": 5
}
```

### 간단한 형식

```
playid,5
```

## 에러 코드

- `UNKNOWN_ERROR` - 알 수 없는 오류
- `COMMAND_ERROR` - 명령어 실행 오류
- `NOT_FOUND` - 요청한 리소스를 찾을 수 없음
- `INVALID_PARAMETER` - 잘못된 매개변수
- `EXECUTION_ERROR` - 실행 중 오류
- `MISSING_PARAMETER` - 필수 매개변수 누락
- `UNKNOWN_COMMAND` - 알 수 없는 명령어

## 이벤트 타입

클라이언트는 다음 이벤트들을 자동으로 수신합니다:

- `playStarted` - 재생 시작 (play, playId, playFile)
- `playPaused` - 재생 일시정지
- `playStopped` - 재생 정지
- `nextTrack` - 다음 트랙으로 이동
- `prevTrack` - 이전 트랙으로 이동
- `endReached` - 재생 종료
- `fullscreenChanged` - 전체화면 상태 변경
- `audioDevicesUpdated` - 오디오 장치 목록 업데이트
- `imageTimeChanged` - 이미지 표시 시간 변경

## 이벤트 데이터 예시

### 재생 시작 이벤트

```json
{
  "timestamp": "2025-10-18T10:30:45.123Z",
  "success": true,
  "command": "event",
  "message": "Event: playStarted",
  "data": {
    "eventType": "playStarted",
    "fileId": 5,
    "filename": "example.mp4"
  }
}
```

### 다음 트랙 이벤트

```json
{
  "timestamp": "2025-10-18T10:30:45.123Z",
  "success": true,
  "command": "event",
  "message": "Event: nextTrack",
  "data": {
    "eventType": "nextTrack",
    "trackId": 2
  }
}
```

## 사용 예시

### Python 클라이언트 예시

```python
import socket
import json

# 연결
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(('localhost', 12345))

# 명령 전송
command = {"command": "play"}
sock.send((json.dumps(command) + '\n').encode())

# 응답 수신
response = sock.recv(1024).decode()
data = json.loads(response)

if data['success']:
    print(f"Success: {data['message']}")
else:
    print(f"Error: {data['error']['message']}")
```

### 간단한 텔넷 테스트

```bash
telnet localhost 12345
# 연결 후 명령 입력:
play
# 또는
{"command": "playid", "id": 1}
```

## 주요 개선사항

1. **일관된 응답 형식**: 모든 응답이 동일한 구조를 따름
2. **명확한 에러 정보**: 에러 코드와 상세 메시지 제공
3. **타임스탬프**: 모든 응답에 시간 정보 포함
4. **구조화된 데이터**: 명령어별 관련 데이터를 체계적으로 제공
5. **이벤트 시스템**: 의미있는 액션과 상태 변경만 실시간으로 알림
6. **최적화된 이벤트**: 중요한 이벤트만 선별하여 불필요한 트래픽 최소화
7. **간소화된 데이터**: 필수 정보만 포함하여 네트워크 효율성 극대화
