# VP App TCP 외부제어 연동 매뉴얼 (AMX / Crestron)

이 문서는 AMX, Crestron 등 AV 컨트롤 시스템에서 VP App을 TCP로 제어하려는 프로그래머를 위한
연동 매뉴얼입니다. 연결 방법, 명령 문법, 전체 명령 목록, 응답과 이벤트(피드백) 형식, 바로 복사해
쓸 수 있는 예제를 담고 있습니다.

- 프로토콜 버전: `2.0` (`protocolVersion`)
- 관련 문서: [운영자 사용 설명서](USER_GUIDE.md), [설치·네트워크 구성 가이드](INSTALL_GUIDE.md)

## 목차

1. [개요](#1-개요)
2. [연결 정보](#2-연결-정보)
3. [명령 형식](#3-명령-형식)
4. [응답 형식](#4-응답-형식)
5. [명령 빠른 참조표](#5-명령-빠른-참조표)
6. [명령 상세](#6-명령-상세)
7. [이벤트(피드백) 메시지](#7-이벤트피드백-메시지)
8. [플레이어 기능(features)과 명령](#8-플레이어-기능features과-명령)
9. [연동 예제](#9-연동-예제)
10. [문제 해결](#10-문제-해결)

---

## 1. 개요

VP App은 외부 제어용 TCP 서버 두 개를 엽니다.

| 포트 | 이름 | 보내는 명령 형식 | 받는 응답 형식 |
| --- | --- | --- | --- |
| 15000 | Simple 명령 포트 | 쉼표 구분 텍스트 (`player.play`, `window.play,2,0`) | JSON 한 줄 |
| 15001 | JSON 명령 포트 | JSON 객체 (`{"command":"player.play"}`) | JSON 한 줄 |

- 두 포트는 같은 명령 집합을 처리합니다. 차이는 명령을 보내는 형식뿐입니다.
- **응답은 두 포트 모두 JSON**입니다. Simple 포트를 쓰더라도 수신 측은 JSON 한 줄을 해석해야 합니다.
- 명령 이름은 `domain.action` 형식입니다(예: `player.play`, `audio.mastervolume`).
- **모든 명령은 응답을 돌려줍니다.** 성공이면 `"success":true`, 실패면 `"success":false`와 `error` 객체가 옵니다.
- 상태 변화(재생 시작, 트랙 변경, 종료 등)는 요청 없이 **이벤트**로 전달됩니다(7장).

AMX/Crestron에서는 문자열 조립이 쉬운 **Simple 포트(15000)** 사용을 권장합니다. 중첩 객체가 필요한
명령(라이브 소스의 `rtp` 설정)만 JSON 포트(15001)를 사용하십시오.

---

## 2. 연결 정보

| 항목 | 값 |
| --- | --- |
| 전송 계층 | TCP (raw socket, Telnet 협상 없음) |
| 바인드 주소 | `0.0.0.0` (VP App PC의 모든 네트워크 인터페이스) |
| 포트 | Simple `15000`, JSON `15001` |
| 문자 인코딩 | UTF-8 |
| 명령 종결자 | LF (`\n`, `0x0A`). CR LF(`\r\n`)도 허용됩니다(앞뒤 공백·CR은 제거됨). |
| 응답 종결자 | LF (`\n`, `0x0A`) 한 개. 응답 하나 = JSON 한 줄. |
| 동시 접속 | 제한 없음. 여러 컨트롤러가 동시에 접속할 수 있습니다. |
| 인증 | 없음 |
| 유휴 타임아웃 | 없음. 서버는 유휴 연결을 끊지 않습니다. |
| TCP keepalive / 하트비트 | 서버가 별도로 설정하지 않습니다. 필요하면 클라이언트가 주기적으로 조회 명령(예: `system.version`)을 보내 연결을 확인하십시오. |

### 2.1 접속 직후 환영(welcome) 메시지

접속하면 서버가 즉시 다음과 같은 한 줄을 보냅니다(실제로는 줄바꿈 없는 한 줄, 여기서는 보기 좋게 정리).

```json
{
  "timestamp": "2026-11-08T01:23:45.678Z",
  "success": true,
  "command": "connect",
  "message": "Connected to VP Server (Simple Command Port)",
  "data": {
    "serverId": "vp_app2",
    "appVersion": "0.7.8",
    "protocolVersion": "2.0",
    "clientId": "192.168.0.50:49152",
    "port": "simple",
    "format": "comma-separated",
    "features": ["multi_window", "timeline", "master_volume", "live_source", "..."],
    "commands": ["player.play", "player.pause", "..."]
  }
}
```

| 필드 | 설명 |
| --- | --- |
| `serverId` | 고정값 `vp_app2` |
| `appVersion` | VP App 버전 |
| `protocolVersion` | TCP 프로토콜 버전 (`2.0`) |
| `clientId` | 서버가 본 클라이언트 주소 `IP:포트` |
| `port` | `simple` 또는 `json` (접속한 포트의 종류) |
| `format` | Simple 포트는 `comma-separated`, JSON 포트는 `json` |
| `features` | 재생 엔진이 보고한 기능 목록(8장). 엔진이 아직 준비되지 않았으면 빈 배열일 수 있습니다. |
| `commands` | 지원하는 전체 명령 이름 목록 |

> 환영 메시지는 명령 목록을 포함하므로 길이가 수 KB에 이를 수 있습니다. 컨트롤러의 수신 버퍼를
> 충분히(권장 16 KB 이상) 확보하십시오. `playlist.list`, `files.list` 응답은 이보다 훨씬 길 수 있습니다.

### 2.2 포트 충돌 시 동작

시작 시 포트가 이미 사용 중이면 서버는 1초 후 **포트 번호 +1**로 재시도합니다. 예를 들어 15000이
점유돼 있으면 Simple 서버가 15001을 시도하고, 그 결과 JSON 서버도 다음 번호로 밀릴 수 있습니다.
연결이 안 되면 다른 프로그램이 15000/15001을 사용하고 있지 않은지 확인하십시오. 방화벽 설정은
[설치·네트워크 구성 가이드](INSTALL_GUIDE.md)를 참고하십시오.

### 2.3 전송 시 주의 (중요)

- 서버는 **수신한 TCP 패킷 단위로** 데이터를 LF 기준으로 나누어 처리합니다. 패킷 사이에 걸친 줄을
  이어 붙이는 버퍼링을 하지 않습니다. 따라서 **명령 한 줄은 한 번의 전송(SEND_STRING 한 번)으로
  종결자까지 함께 보내십시오.** 명령을 여러 번에 나눠 보내면 조각마다 별개의 명령으로 해석됩니다.
- 한 번의 전송에 여러 줄(`cmd1\ncmd2\n`)을 담으면 순서대로 처리되고, 응답도 같은 순서로 옵니다.
- 종결자 없이 보낸 명령도 그 패킷이 처리될 때 실행되지만, 호환성을 위해 항상 LF를 붙이십시오.
- 빈 줄은 무시됩니다.

---

## 3. 명령 형식

### 3.1 Simple 포트 (15000)

```
명령[,값1[,값2[,...]]]<LF>
```

- 쉼표(`,`)로 구분합니다. 각 값의 앞뒤 공백은 제거됩니다.
- 값은 **파라미터 순서대로(위치 기반)** 대응됩니다. 각 명령의 파라미터 순서는 6장 표의 순서와 같습니다.
- 중간 파라미터를 생략하려면 빈 값으로 둡니다. 예: `window.play,2,,3` (index 생략, playlistId=3)
- 값에 쉼표를 넣을 수 없고 따옴표 이스케이프도 없습니다. 쉼표가 필요한 문자열은 JSON 포트를 쓰십시오.
- 줄이 `{` 또는 `[`로 시작하면 `FORMAT_ERROR`로 거부됩니다.

예:

```
player.play\n
window.play,2,0\n
audio.mastervolume,50\n
```

### 3.2 JSON 포트 (15001)

```
{"command":"명령", "파라미터명": 값, ...}<LF>
```

- 한 줄에 JSON 객체 하나. 파라미터는 **이름으로** 지정합니다(순서 무관).
- 올바른 JSON이 아니면 `FORMAT_ERROR`로 거부됩니다. `command` 필드가 없으면 `INVALID_MESSAGE`입니다.
- 일부 파라미터는 snake_case 별칭도 받습니다(예: `monitorIndex` 대신 `monitor_index`). 6장에 표기했습니다.

예:

```
{"command":"player.play"}\n
{"command":"window.play","windowId":2,"index":0}\n
{"command":"audio.mastervolume","value":50}\n
```

### 3.3 공통 규칙

- **명령 이름은 대소문자를 구분하지 않습니다**(`PLAYER.PLAY`도 동작). 응답의 `command`에는 소문자 정규 이름이 들어갑니다.
- JSON 포트의 **파라미터 이름은 대소문자를 구분합니다**(`windowId`이지 `windowid`가 아님).
- 파라미터 값 변환:

| 타입 | 허용 값 | 비고 |
| --- | --- | --- |
| number | `10`, `-1`, `2.5` (JSON에서는 `"10"` 같은 문자열도 허용) | 숫자로 해석할 수 없으면 "값 없음"으로 처리 |
| boolean | 참: `1` `true` `yes` `on` / 거짓: `0` `false` `no` `off` (대소문자 무관) | 그 외 값은 "값 없음"으로 처리 |
| string | 그대로 | |
| number[] | Simple: 나머지 값 전부 (`audio.channeldelays,0,10,20`) / JSON: 배열 (`[0,10,20]`) | 숫자가 아닌 항목은 제외 |

- "값 없음"으로 처리된 필수 파라미터는 `MISSING_PARAMETER` 오류가 됩니다. 선택 파라미터는 생략한 것과
  같습니다. 예를 들어 `player.fullscreen,abc`는 값 생략과 같으므로 **토글**로 동작합니다.
- ID 체계:
  - `windowId`, 창 `id`, 플레이리스트 `id`/`playlistId`, 레이아웃(프리셋) `id`: 정수
  - 라이브 소스 `id`/`sourceId`, `timelineId`: 문자열
  - 트랙/항목 인덱스(`track`, `index`, `trackId`): **0부터** 시작
  - 시간(`time`, `ms`): **밀리초**

---

## 4. 응답 형식

모든 응답과 이벤트는 공백 없는 압축 JSON 한 줄 + LF입니다. 필드 순서는
`timestamp`, `success`, `command`, `message`, `data`, `error` 입니다. `message`, `data`, `error`는
값이 비어 있으면 생략됩니다(예: 데이터가 없는 성공 응답에는 `data` 필드가 없음).

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `timestamp` | string | 응답 생성 시각 (ISO 8601, UTC) |
| `success` | boolean | 성공 `true` / 실패 `false` |
| `command` | string | 명령 이름. 접속 시 `connect`, 이벤트는 `event`, 형식 오류는 `format_error`, 해석 불가 시 `unknown` |
| `message` | string | 사람이 읽는 결과 문구 (성공 시) |
| `data` | object | 결과 데이터 (명령별, 6장 참고) |
| `error` | object | 실패 시 `{ code, message, details }` |

### 4.1 성공

```
{"timestamp":"2026-11-08T01:23:45.678Z","success":true,"command":"audio.mastervolume","message":"Master volume: 50","data":{"masterVolume":50}}
```

명령이 문구만 돌려주는 경우 `data`가 없습니다.

```
{"timestamp":"2026-11-08T01:23:45.678Z","success":true,"command":"player.stop","message":"Player stopped"}
```

> **주의: `success:true`는 "명령을 받아 처리했다"는 뜻입니다.** 일부 재생 명령은 현재 상태에서 할
> 일이 없을 때도 성공으로 응답하고 `message`로 이유를 알립니다. 예: `Not in playlist mode`,
> `No file to play`, `window not playing`, `Timeline not active`. 실제 재생 상태는 이벤트(7장)나
> `system.status`로 확인하십시오.

### 4.2 실패

```
{"timestamp":"2026-11-08T01:23:45.678Z","success":false,"command":"playlist.play","error":{"code":"MISSING_PARAMETER","message":"Missing required parameter: id","details":null}}
```

- `error.code`: 아래 오류 코드 중 하나. 컨트롤러 로직은 이 값으로 분기하십시오.
- `error.message`: 사람이 읽는 오류 문구.
- `error.details`: 진단용 문자열(내부 스택 정보) 또는 `null`. 파싱에 의존하지 마십시오.

### 4.3 오류 코드

| 코드 | 발생 조건 |
| --- | --- |
| `FORMAT_ERROR` | Simple 포트에 JSON을 보냄 / JSON 포트에 JSON이 아닌 텍스트를 보냄 (`command`는 `format_error`) |
| `INVALID_MESSAGE` | JSON에 `command` 필드가 없음, 또는 Simple 명령 이름이 비어 있음 (`command`는 `unknown`) |
| `UNKNOWN_COMMAND` | 존재하지 않는 명령 이름 |
| `MISSING_PARAMETER` | 필수 파라미터 누락 또는 해석 불가 값 |
| `INVALID_PARAMETER` | 허용되지 않은 값 (예: `mode.set,foo`, 허용되지 않는 반복 모드) |
| `NOT_FOUND` | 지정한 창/플레이리스트/소스/레이아웃이 없음 |
| `EXECUTION_ERROR` | 실행 실패 (재생 엔진 미연결, 기능 미지원, 내부 오류 등) |

`FORMAT_ERROR` 문구:

- Simple 포트: `JSON format not allowed on Simple TCP port. Use JSON TCP port instead.`
- JSON 포트: `Invalid JSON format. Simple commands not allowed on JSON TCP port. Use Simple TCP port instead.`

---

## 5. 명령 빠른 참조표

`<>`는 필수, `[]`는 선택 파라미터입니다. Simple 포트에서는 표기된 순서대로 쉼표로 이어 씁니다.
전체 61개 명령.

### 재생 제어

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `player.play` | `player.play[,windowId]` | 재생 / 재개 |
| `player.pause` | `player.pause[,windowId]` | 일시정지/재개 토글 |
| `player.stop` | `player.stop[,windowId]` | 정지 (창 미지정 시 전체) |
| `player.next` | `player.next[,windowId]` | 다음 트랙(장면/항목) |
| `player.prev` | `player.prev[,windowId]` | 이전 트랙 (3초 경과 시 현재 처음으로) |
| `player.seek` | `player.seek,<time>[,windowId]` | 위치 이동 (ms) |
| `player.fullscreen` | `player.fullscreen[,value]` | 전체화면 설정 / 토글 |

### 플레이리스트

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `playlist.play` | `playlist.play,<id>[,track]` | 플레이리스트 재생 |
| `playlist.preload` | `playlist.preload,<id>` | 미리 로딩(재생 안 함) |
| `playlist.list` | `playlist.list` | 플레이리스트 목록 |
| `playlist.get` | `playlist.get,<id>` | 플레이리스트 1개 조회 |

### 재생 모드

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `mode.set` | `mode.set,<mode>` | 전역 작업 모드 설정 (`scene` / `window`) |
| `mode.get` | `mode.get` | 전역 작업 모드 조회 |
| `mode.switch` | `mode.switch,<playlistId>,<mode>` | 특정 플레이리스트의 타입 전환 |

### 창

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `window.play` | `window.play,<windowId>[,index][,playlistId]` | 지정 창만 재생 |
| `window.stop` | `window.stop,<windowId>` | 지정 창만 정지 |
| `window.next` | `window.next,<windowId>` | 지정 창 다음 항목 |
| `window.prev` | `window.prev,<windowId>` | 지정 창 이전 항목 |
| `window.create` | `window.create[,name][,monitorIndex][,x][,y][,width][,height][,aspectMode][,backgroundColor][,zOrder][,sourceId][,audioOnly][,audioDevice][,muted]` | 출력 창 생성 |
| `window.update` | `window.update,<id>[,name][,monitorIndex][,x][,y][,width][,height][,aspectMode][,backgroundColor][,zOrder][,audioOnly][,audioDevice]` | 출력 창 수정 |
| `window.mute` | `window.mute,<id>[,muted]` | 창 오디오 뮤트 / 토글 |
| `window.delete` | `window.delete,<id>` | 출력 창 삭제 |
| `window.setsource` | `window.setsource,<windowId>,<sourceId>` | 창에 라이브 소스 연결 |
| `window.clearsource` | `window.clearsource,<windowId>` | 창의 라이브 소스 해제 |
| `window.list` | `window.list` | 창 목록 조회 |

### 라이브 입력 소스

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `source.list` | `source.list` | 소스 목록 |
| `source.get` | `source.get,<id>` | 소스 1개 조회 |
| `source.create` | `source.create,<name>[,kind][,uri][,ndi_name][,url_address][,latency_ms][,has_audio]` | 소스 생성 (`rtp`는 JSON 전용) |
| `source.update` | `source.update,<id>[,name][,kind][,uri][,ndi_name][,url_address][,latency_ms][,has_audio]` | 소스 수정 |
| `source.delete` | `source.delete,<id>` | 소스 삭제 |

### 화면 구성 프리셋 (레이아웃)

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `layout.list` | `layout.list` | 프리셋 목록 |
| `layout.apply` | `layout.apply,<id>` | 프리셋 적용 |
| `layout.save` | `layout.save[,name]` | 현재 배치를 새 프리셋으로 저장 |
| `layout.update` | `layout.update,<id>` | 프리셋을 현재 배치로 덮어쓰기 |
| `layout.rename` | `layout.rename,<id>,<name>` | 프리셋 이름 변경 |
| `layout.delete` | `layout.delete,<id>` | 프리셋 삭제 |

### 프리로딩

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `preload.config` | `preload.config,<lookahead>,<maxDecks>` | 프리롤 설정 |
| `preload.get` | `preload.get` | 프리롤 설정·진행 상태 조회 |

### 오디오

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `audio.mastervolume` | `audio.mastervolume,<value>` | 마스터 볼륨 (0~100) |
| `audio.getmastervolume` | `audio.getmastervolume` | 마스터 볼륨 조회 |
| `audio.listdevices` | `audio.listdevices` | 오디오 장치 목록 |
| `audio.getdevice` | `audio.getdevice` | 현재 오디오 장치 |
| `audio.setdevice` | `audio.setdevice,<device>` | 오디오 장치 설정 |
| `audio.channeldelays` | `audio.channeldelays,<ms>[,ms...]` | 출력 채널별 지연(ms) |

### 디스플레이

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `display.list` | `display.list` | 모니터 목록 |
| `display.set` | `display.set,<monitorIndex>[,x][,y][,width][,height][,aspectMode]` | 전역 디스플레이 배치 |
| `display.background` | `display.background,<color>` | 배경색 (`#rrggbb`) |

### 반복

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `repeat.set` | `repeat.set[,mode][,windowId]` | 반복 모드 설정 / 토글 |
| `repeat.get` | `repeat.get` | 반복 모드 조회 |

### 타임라인

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `timeline.play` | `timeline.play,<timelineId>[,ms]` | 타임라인 재생 |
| `timeline.pause` | `timeline.pause` | 일시정지/재개 토글 |
| `timeline.stop` | `timeline.stop` | 정지 |
| `timeline.seek` | `timeline.seek,<ms>` | 위치 이동 |

### 자동 시작 · 자동 실행

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `startonplay.set` | `startonplay.set[,enabled][,playlistId]` | 프로그램 시작 시 자동 재생 |
| `startonplay.get` | `startonplay.get` | 자동 재생 설정 조회 |
| `autostart.set` | `autostart.set[,enabled]` | Windows 로그온 시 앱 자동 실행 |
| `autostart.get` | `autostart.get` | 자동 실행 설정 조회 |

### 상태 조회

| 명령 | Simple 문법 | 설명 |
| --- | --- | --- |
| `system.status` | `system.status` | 현재 상태 스냅샷 |
| `system.version` | `system.version` | 앱/프로토콜 버전 |
| `system.capabilities` | `system.capabilities` | 버전 + 기능 + 명령 목록 |
| `files.list` | `files.list` | 전체 미디어 파일 목록 |

---

## 6. 명령 상세

각 명령의 파라미터 표에서 "순서"는 Simple 포트에서의 위치입니다. JSON 포트에서는 "이름"(과 별칭)을 씁니다.

용어:

- **장면(scene) 플레이리스트**: 트랙 하나가 여러 창의 클립 묶음인 장면이며, 모든 창이 함께 넘어갑니다.
- **윈도우(window) 플레이리스트**: 창마다 자기 항목 목록을 독립적으로 재생합니다.
- 플레이리스트의 종류는 각 플레이리스트의 `mode`(`scene`/`window`)를 따릅니다.

### 6.1 재생 제어 (player.*)

#### player.play

재생 또는 재개합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 아니오 | 대상 창 (윈도우 플레이리스트 재생 중일 때만 의미) |

동작:

- 타임라인 재생 중: 타임라인 일시정지 토글(일시정지 상태면 재개).
- 윈도우 플레이리스트 + `windowId` 지정: 그 창이 일시정지면 재개, 정지 상태면 첫 항목부터 시작.
- 플레이리스트 재생 상태(그 외): 일시정지면 전 창 재개, 아니면 현재 장면부터 다시 시작(윈도우
  플레이리스트는 전 창 목록 시작).
- 단일 파일 상태: 일시정지면 재개, 아니면 마지막 파일을 다시 재생. 재생할 파일이 없으면 `No file to play`.

```
player.play\n
player.play,2\n
{"command":"player.play","windowId":2}\n
```

응답 예: `{"...","success":true,"command":"player.play","message":"Playing scene"}`

#### player.pause

일시정지/재개를 토글합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 아니오 | 대상 창 (윈도우 플레이리스트에서 그 창만 토글) |

윈도우 플레이리스트에서 지정 창이 재생 중이 아니면 `window not playing`(성공)으로 응답합니다.
타임라인 재생 중에는 타임라인을 토글합니다.

```
player.pause\n
{"command":"player.pause"}\n
```

#### player.stop

정지합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 아니오 | 대상 창. 생략 시 전체 정지 |

- 윈도우 플레이리스트 + `windowId`: 그 창만 정지, 다른 창은 계속 재생.
- 그 외: 전체 정지(트랙에 딸린 추가 오디오 포함).
- 타임라인 재생 중: 타임라인 정지.

```
player.stop\n
player.stop,2\n
{"command":"player.stop","windowId":2}\n
```

#### player.next / player.prev

다음 / 이전 트랙으로 이동합니다. 반복 설정과 무관하게 즉시 이동합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 아니오 | 대상 창 (윈도우 플레이리스트). 생략 시 재생 중인 첫 창 |

- 장면 플레이리스트: 모든 창이 함께 다음/이전 장면으로 이동합니다.
- 윈도우 플레이리스트: 지정한 창 하나만 이동합니다.
- `player.prev`: 현재 항목이 3초 넘게 재생됐으면 현재 항목 처음으로, 아니면 이전 항목으로 갑니다.
- 플레이리스트 재생 상태가 아니면 `Not in playlist mode`(성공)로 응답합니다.
- 재생 엔진이 `multi_window` 기능을 지원하지 않으면 `Next unsupported (legacy player)` /
  `Previous unsupported (legacy player)`(성공)로 응답합니다.

```
player.next\n
player.prev,2\n
{"command":"player.next","windowId":2}\n
```

#### player.seek

재생 위치를 이동합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `time` | number | 예 | 위치 (밀리초) |
| 2 | `windowId` | number | 아니오 | 대상 창. 생략 시 기본 창 |

타임라인 재생 중에는 타임라인 위치(ms)로 이동합니다.

```
player.seek,30000\n
player.seek,30000,2\n
{"command":"player.seek","time":30000,"windowId":2}\n
```

#### player.fullscreen

전체화면을 설정합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `value` | boolean | 아니오 | `true`/`false`. 생략 시 현재 상태 반전(토글) |

응답 `data`: `{ "fullscreen": true }`. 실제 전환이 완료되면 `fullscreenChanged` 이벤트가 옵니다.

```
player.fullscreen,1\n
player.fullscreen,0\n
player.fullscreen\n
{"command":"player.fullscreen","value":true}\n
```

### 6.2 플레이리스트 (playlist.*)

#### playlist.play

플레이리스트를 재생합니다. 장면/윈도우 동작은 플레이리스트의 `mode`를 따릅니다.

| 순서 | 이름 | 타입 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- | --- | --- |
| 1 | `id` | number | 예 | | 플레이리스트 ID (`playlistId`) |
| 2 | `track` | number | 아니오 | `0` | 시작 트랙(장면) 인덱스, 0부터 |

- 성공 `data`: `{ "playlistId": 1, "track": 0 }`
- 재생 엔진 미연결, 플레이리스트 없음, 트랙 없음 등으로 시작하지 못하면 `EXECUTION_ERROR`
  (`Failed to play playlist (player not connected or unavailable)`).
- 윈도우 플레이리스트에서는 `track`과 관계없이 모든 창이 각자 목록을 시작합니다. 특정 창의 특정
  항목은 `window.play`를 쓰십시오.

```
playlist.play,1\n
playlist.play,1,3\n
{"command":"playlist.play","id":1,"track":3}\n
```

#### playlist.preload

플레이리스트를 재생하지 않고 미리 로딩(프리롤)합니다. 이후 `playlist.play`로 같은 플레이리스트를
재생하면 지연 없이 시작됩니다. 진행 상태는 `preload.get`으로 확인합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `id` | number | 예 | 플레이리스트 ID |

- 성공: `message` `Preloaded 1`, `data` `{ "playlistId": 1 }`
- 실패: `EXECUTION_ERROR` (`Preload failed (player not connected?)`)

```
playlist.preload,1\n
{"command":"playlist.preload","id":1}\n
```

#### playlist.list

전체 플레이리스트 목록을 조회합니다. 파라미터 없음.

응답 `data`:

```json
{
  "playlists": [
    {
      "playlistId": 1,
      "name": "Main Show",
      "description": "",
      "mode": "scene",
      "tracks": [ { "trackId": 0, "time": 0, "is_image": false } ],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "count": 1
}
```

트랙 항목 필드: `trackId`(0부터 인덱스), `uuid`, `amx`, `filename`, `time`, `mimetype`, `duration`,
`size`, `is_image`. `trackId`, `time`, `is_image`는 항상 들어가고, 나머지 필드는 트랙 데이터에 해당
값이 있을 때만 들어갑니다(장면 단위 트랙에서는 생략될 수 있음). 현재 재생 중인 파일 이름은
`mediaChanged` 이벤트나 `system.status`의 `file.filename`으로 확인하십시오.

```
playlist.list\n
{"command":"playlist.list"}\n
```

#### playlist.get

플레이리스트 하나를 조회합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `id` | number | 예 | 플레이리스트 ID |

응답 `data`: `{ "playlist": {...} }` (형식은 `playlist.list`의 항목과 동일). 없으면 오류가 아니라
`success:true`, `message` `Playlist 9 not found`, `data` `{ "playlist": null }`로 응답합니다.

```
playlist.get,1\n
{"command":"playlist.get","id":1}\n
```

### 6.3 재생 모드 (mode.*)

#### mode.set

전역 작업 모드를 저장합니다(웹 UI의 작업 모드 설정과 같은 값). 실제 재생 방식은 각 플레이리스트의
`mode`를 따르므로, 특정 플레이리스트의 종류를 바꾸려면 `mode.switch`를 쓰십시오.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `mode` | string | 예 | `scene` 또는 `window` |

- 성공 `data`: `{ "playbackMode": "window" }`, 이벤트 `playbackModeChanged` 발생.
- 그 외 값: `INVALID_PARAMETER` (`mode must be scene | window`).

```
mode.set,window\n
{"command":"mode.set","mode":"window"}\n
```

#### mode.get

응답 `data`: `{ "playbackMode": "scene" }`

```
mode.get\n
```

#### mode.switch

특정 플레이리스트의 종류(장면/윈도우)를 즉시 바꾸고 트랙 구조를 변환해 저장합니다. 그 플레이리스트가
현재 재생 중이면 재생을 정지합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `playlistId` | number | 예 | 플레이리스트 ID |
| 2 | `mode` | string | 예 | `scene` 또는 `window` |

- 성공 `data`: `{ "playlistId": 1, "mode": "window" }`
- 오류: `INVALID_PARAMETER`(mode 값), `NOT_FOUND`(플레이리스트 없음), `EXECUTION_ERROR`

```
mode.switch,1,window\n
{"command":"mode.switch","playlistId":1,"mode":"window"}\n
```

### 6.4 창 (window.*)

창 ID는 1부터 시작하는 정수입니다. 현재 창 구성은 `window.list`로 확인하십시오.

#### window.play

지정한 창만 재생합니다(윈도우 플레이리스트용). 다른 창에는 영향이 없습니다.

| 순서 | 이름 | 타입 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 예 | | 대상 창 |
| 2 | `index` | number | 아니오 | `0` | 그 창 목록의 시작 항목 (0부터). 범위를 벗어나면 0 |
| 3 | `playlistId` | number | 아니오 | | 재생할 플레이리스트. 생략 시 현재 로드된 플레이리스트 |

- 성공 `data`: `{ "windowId": 2, "index": 0 }`
- 재생 엔진 미연결, `multi_window` 미지원, 창이 구성돼 있지 않음, 그 창에 항목이 없음 등은
  `EXECUTION_ERROR` (`Failed to play window (player not connected or not window mode)`).

```
window.play,2\n
window.play,2,3\n
window.play,2,0,5\n
{"command":"window.play","windowId":2,"index":0,"playlistId":5}\n
```

#### window.stop

지정한 창만 정지합니다. `windowStopped` 이벤트가 발생합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 예 | 대상 창 |

응답: `message` `stop window 2`, `data` `{ "windowId": 2 }`

```
window.stop,2\n
{"command":"window.stop","windowId":2}\n
```

#### window.next / window.prev

지정한 창을 다음 / 이전 항목으로 이동합니다. 동작은 `player.next` / `player.prev`에 창을 지정한
것과 같습니다(`window.prev`도 3초 규칙 적용).

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 예 | 대상 창 |

```
window.next,2\n
window.prev,2\n
{"command":"window.next","windowId":2}\n
```

#### window.create

출력 창을 만듭니다. ID는 비어 있는 가장 작은 번호(1부터)가 자동 할당됩니다.

| 순서 | 이름 (JSON 별칭) | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `name` | string | `Window <id>` | 창 이름 |
| 2 | `monitorIndex` (`monitor_index`) | number | 보조 모니터가 있으면 그 모니터, 없으면 `-1` | 모니터 번호 (`display.list`의 `index`). `-1` = 주 모니터 |
| 3 | `x` | number | `0` | 모니터 기준 X (px) |
| 4 | `y` | number | `0` | 모니터 기준 Y (px) |
| 5 | `width` | number | `0` | 너비 (px) |
| 6 | `height` | number | `0` | 높이 (px) |
| 7 | `aspectMode` (`aspect_mode`) | string | `letterbox` | `letterbox` / `crop` / `stretch` |
| 8 | `backgroundColor` (`background_color`) | string | `#000000` | 배경색 `#rrggbb` |
| 9 | `zOrder` (`z_order`) | number | `0` | 겹칠 때 쌓임 순서 (클수록 앞) |
| 10 | `sourceId` (`source_id`) | string | 없음 | 연결할 라이브 소스 ID |
| 11 | `audioOnly` (`audio_only`) | boolean | `false` | 화면 출력 없는 오디오 전용 창 |
| 12 | `audioDevice` (`audio_device`) | string | 없음 (전역 장치) | 창 전용 오디오 장치 (`audio.listdevices`의 `deviceId`) |
| 13 | `muted` | boolean | `false` | 창 오디오 뮤트 |

모든 파라미터는 선택입니다. 응답 `data`: `{ "window": {창 객체} }` (창 객체 필드는 `window.list` 참고).

```
window.create,Left,1,0,0,1920,1080\n
window.create,Audio Zone,,,,,,,,,,1\n
{"command":"window.create","name":"Left","monitorIndex":1,"width":1920,"height":1080,"aspectMode":"letterbox"}\n
```

#### window.update

창 설정에서 지정한 필드만 바꿉니다.

| 순서 | 이름 (JSON 별칭) | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `id` (`windowId`) | number | 예 | 대상 창 |
| 2 | `name` | string | 아니오 | |
| 3 | `monitorIndex` (`monitor_index`) | number | 아니오 | |
| 4 | `x` | number | 아니오 | |
| 5 | `y` | number | 아니오 | |
| 6 | `width` | number | 아니오 | |
| 7 | `height` | number | 아니오 | |
| 8 | `aspectMode` (`aspect_mode`) | string | 아니오 | `letterbox` / `crop` / `stretch` |
| 9 | `backgroundColor` (`background_color`) | string | 아니오 | `#rrggbb` |
| 10 | `zOrder` (`z_order`) | number | 아니오 | |
| 11 | `audioOnly` (`audio_only`) | boolean | 아니오 | |
| 12 | `audioDevice` (`audio_device`) | string | 아니오 | |

- 위치/크기/비율/배경/z순서 변경은 재생 중에도 즉시 반영됩니다.
- `audioOnly` 또는 `audioDevice`가 바뀌면 창을 다시 만들기 때문에 그 창의 재생이 끊깁니다.
- 뮤트는 `window.mute`, 라이브 소스는 `window.setsource` / `window.clearsource`로 바꿉니다.
- 성공 `data`: `{ "window": {...} }`, 창이 없으면 `NOT_FOUND`.

```
window.update,2,,,0,0,1280,720\n
{"command":"window.update","id":2,"x":0,"y":0,"width":1280,"height":720}\n
```

#### window.mute

창의 오디오 전체(클립, 라이브 입력, 창에 딸린 오디오)를 뮤트/해제합니다. 재생 중 즉시 적용됩니다.

| 순서 | 이름 (JSON 별칭) | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `id` (`windowId`) | number | 예 | 대상 창 |
| 2 | `muted` | boolean | 아니오 | `true`/`false`. 생략 시 토글 |

응답: `message` `Window 2 muted` 또는 `Window 2 unmuted`, `data` `{ "window": {...} }`. 창이 없으면 `NOT_FOUND`.

```
window.mute,2,1\n
window.mute,2,0\n
window.mute,2\n
{"command":"window.mute","id":2,"muted":true}\n
```

#### window.delete

창을 삭제합니다. 모든 플레이리스트에서 이 창을 참조하던 클립도 함께 제거되고, 클립이 모두 사라진
장면은 삭제됩니다.

| 순서 | 이름 (JSON 별칭) | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `id` (`windowId`) | number | 예 | 대상 창 |

응답 `data`: `{ "id": 2 }`

```
window.delete,2\n
{"command":"window.delete","id":2}\n
```

#### window.setsource

창에 라이브 입력 소스를 연결합니다. 연결된 소스는 창에 계속 표시됩니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 예 | 대상 창 |
| 2 | `sourceId` | string | 예 | 소스 ID (`source.list`의 `id`) |

응답 `data`: `{ "window": {...} }`. 소스나 창이 없으면 `NOT_FOUND`.

```
window.setsource,2,3f1c2b7e-5d6a-4c1b-9e0f-1234567890ab\n
{"command":"window.setsource","windowId":2,"sourceId":"3f1c2b7e-5d6a-4c1b-9e0f-1234567890ab"}\n
```

#### window.clearsource

창의 라이브 소스 연결을 해제합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `windowId` | number | 예 | 대상 창 |

```
window.clearsource,2\n
{"command":"window.clearsource","windowId":2}\n
```

#### window.list

창 목록을 조회합니다. 파라미터 없음.

응답 `data`:

```json
{
  "windows": [
    {
      "id": 1,
      "name": "Window 1",
      "monitorIndex": 1,
      "monitorKey": "...",
      "monitorSerial": "...",
      "monitorName": "...",
      "x": 0, "y": 0, "width": 0, "height": 0,
      "aspectMode": "letterbox",
      "backgroundColor": "#000000",
      "zOrder": 0,
      "sourceId": null,
      "audioOnly": false,
      "audioDevice": null,
      "muted": false
    }
  ],
  "playerWindows": [ ]
}
```

- `windows`: 저장된 창 설정.
- `playerWindows`: 재생 엔진이 보고한 실제 창 목록.

```
window.list\n
```

### 6.5 라이브 입력 소스 (source.*)

라이브 소스(RTSP, SRT, RTP, UDP, NDI)의 정의를 관리합니다. 화면에 띄우려면 `window.setsource`로
창에 연결하십시오. 소스 ID는 생성 시 자동으로 만들어지는 문자열입니다.

소스 객체 필드:

| 필드 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `id` | string | 자동 생성 | 소스 ID |
| `name` | string | `Live Source` | 이름 |
| `kind` | string | `rtsp` | `rtsp` / `srt` / `rtp` / `udp` / `ndi`. 그 외 값은 `rtsp`로 저장됨 |
| `uri` | string | `""` | RTSP/SRT 주소 (`rtsp://...`, `srt://...`) |
| `rtp` | object | 아래 참고 | RTP/UDP 수신 설정 (JSON 포트 전용) |
| `ndi_name` | string | `""` | NDI 송출기 이름 |
| `url_address` | string | `""` | NDI 송출기 `ip:port` (`ndi_name` 대신 사용 가능) |
| `latency_ms` | number | `200` | 수신 지연 버퍼 (ms) |
| `has_audio` | boolean | `false` | 오디오 포함 여부 |

`rtp` 객체 필드:

| 필드 | 기본값 | 설명 |
| --- | --- | --- |
| `address` | `""` | 멀티캐스트 그룹 주소 (선택) |
| `port` | `5004` | 수신 포트 |
| `encoding_name` | `AUTO` | `AUTO` / `H264` / `H265` / `VP8` / `VP9` / `JPEG` / `MP2T` |
| `payload` | `96` | RTP 페이로드 타입 |
| `clock_rate` | `90000` | 클럭 레이트 |
| `media` | `video` | 미디어 종류 |

`udp`는 `rtp.address`, `rtp.port`만 사용합니다(코덱 자동 감지).

#### source.list / source.get

- `source.list`: `data` `{ "sources": [...], "count": n }`
- `source.get,<id>`: `data` `{ "source": {...} }`. 없으면 `success:true`, `data` `{ "source": null }`.

```
source.list\n
source.get,3f1c2b7e-5d6a-4c1b-9e0f-1234567890ab\n
{"command":"source.get","id":"3f1c2b7e-5d6a-4c1b-9e0f-1234567890ab"}\n
```

#### source.create

| 순서 | 이름 (JSON 별칭) | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `name` | string | 예 | 이름 |
| 2 | `kind` | string | 아니오 | `rtsp` / `srt` / `rtp` / `udp` / `ndi` |
| 3 | `uri` | string | 아니오 | RTSP/SRT 주소 |
| 4 | `ndi_name` (`ndiName`) | string | 아니오 | NDI 송출기 이름 |
| 5 | `url_address` (`urlAddress`) | string | 아니오 | NDI `ip:port` |
| 6 | `latency_ms` (`latency`) | number | 아니오 | 수신 지연 (ms) |
| 7 | `has_audio` (`hasAudio`) | boolean | 아니오 | 오디오 포함 |
| - | `rtp` | object | 아니오 | **JSON 포트 전용**. RTP/UDP 설정 객체 |

응답 `data`: `{ "source": {...} }`. 새 소스의 `id`는 `data.source.id`에서 얻습니다.

```
source.create,Cam1,rtsp,rtsp://10.0.0.5/stream\n
source.create,Stage NDI,ndi,,STAGE-PC (OBS)\n
{"command":"source.create","name":"Cam1","kind":"rtsp","uri":"rtsp://10.0.0.5/stream","latency_ms":200}\n
{"command":"source.create","name":"Encoder","kind":"rtp","rtp":{"address":"239.1.1.1","port":5004,"encoding_name":"AUTO"}}\n
```

#### source.update

지정한 필드만 바꿉니다. 이 소스가 연결된 창은 즉시 새 설정으로 다시 연결됩니다. `rtp`를 보내면
`rtp` 객체 전체가 교체되므로 필요한 하위 필드를 모두 넣으십시오.

| 순서 | 이름 (JSON 별칭) | 타입 | 필수 |
| --- | --- | --- | --- |
| 1 | `id` | string | 예 |
| 2 | `name` | string | 아니오 |
| 3 | `kind` | string | 아니오 |
| 4 | `uri` | string | 아니오 |
| 5 | `ndi_name` (`ndiName`) | string | 아니오 |
| 6 | `url_address` (`urlAddress`) | string | 아니오 |
| 7 | `latency_ms` (`latency`) | number | 아니오 |
| 8 | `has_audio` (`hasAudio`) | boolean | 아니오 |
| - | `rtp` | object | 아니오 (JSON 전용) |

없는 소스면 `NOT_FOUND`.

```
source.update,3f1c2b7e-5d6a-4c1b-9e0f-1234567890ab,,,rtsp://10.0.0.6/stream\n
{"command":"source.update","id":"3f1c2b7e-5d6a-4c1b-9e0f-1234567890ab","uri":"rtsp://10.0.0.6/stream"}\n
```

#### source.delete

소스를 삭제합니다. 이 소스가 연결된 창은 자동으로 연결 해제됩니다.

| 순서 | 이름 | 타입 | 필수 |
| --- | --- | --- | --- |
| 1 | `id` | string | 예 |

응답 `data`: `{ "id": "..." }`

### 6.6 화면 구성 프리셋 (layout.*)

프리셋은 현재 창 배치(창 목록, 위치, 크기, 라이브 소스 연결 포함)의 이름 붙은 스냅샷입니다. 프리셋
ID는 1부터 시작하는 정수입니다.

| 명령 | 파라미터 (순서) | 동작 | 응답 `data` |
| --- | --- | --- | --- |
| `layout.list` | 없음 | 프리셋 목록 | `{ "presets": [...], "count": n, "activePresetId": 1 }` |
| `layout.apply` | `id`(number, 필수) | 현재 창을 모두 제거하고 프리셋 배치로 재생성 | `{ "preset": {...} }` |
| `layout.save` | `name`(string, 선택. 생략 시 `Layout <id>`) | 현재 배치를 새 프리셋으로 저장 | `{ "preset": {...} }` |
| `layout.update` | `id`(number, 필수) | 프리셋을 현재 배치로 덮어쓰기 | `{ "preset": {...} }` |
| `layout.rename` | `id`(number, 필수), `name`(string, 필수) | 이름 변경 | `{ "preset": {...} }` |
| `layout.delete` | `id`(number, 필수) | 삭제 | `{ "id": 1 }` |

- 프리셋 객체: `{ "id", "name", "windows": [창 객체...], "createdAt", "updatedAt" }`
- `activePresetId`: 현재 배치와 일치하는 프리셋 ID. 창을 직접 생성/수정/삭제하면 `null`이 됩니다.
- `layout.apply`, `layout.update`, `layout.rename`은 프리셋이 없으면 `NOT_FOUND`.
- `layout.apply`는 창을 다시 만들기 때문에 재생 중인 화면이 끊깁니다.

```
layout.list\n
layout.apply,1\n
layout.save,Concert\n
layout.rename,1,Lecture\n
{"command":"layout.apply","id":1}\n
```

### 6.7 프리로딩 (preload.*)

#### preload.config

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `lookahead` | number (정수) | 예 | 창마다 미리 읽어 둘 다음 항목 수 (기본 2) |
| 2 | `maxDecks` | number (정수) | 예 | 전체 디코더 덱 상한 (기본 8) |

정수가 아닌 값은 반영되지 않습니다. 응답 `data`: `{ "lookahead": 2, "maxDecks": 8 }`

```
preload.config,2,8\n
{"command":"preload.config","lookahead":2,"maxDecks":8}\n
```

#### preload.get

응답 `data`:

```json
{
  "lookahead": 2,
  "maxDecks": 8,
  "status": { "1": { "expected": 3, "prerolled": 3, "ready": true } },
  "ready": true
}
```

- `status`: 창 ID별 프리롤 진행 (`expected` 대상 수, `prerolled` 완료 수, `ready` 완료 여부)
- `ready`: 프리롤 대상이 있는 모든 창이 준비되면 `true`

`playlist.preload` 후 `ready`가 `true`가 될 때까지 폴링하면 무지연 시작 시점을 판단할 수 있습니다.

### 6.8 오디오 (audio.*)

#### audio.mastervolume

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `value` | number | 예 | 0~100. 범위를 벗어나면 0 또는 100으로 고정 |

값은 저장되어 재시작 후에도 유지됩니다. 응답 `data`: `{ "masterVolume": 50 }`

```
audio.mastervolume,50\n
{"command":"audio.mastervolume","value":50}\n
```

#### audio.getmastervolume

응답 `data`: `{ "masterVolume": 100 }`

#### audio.listdevices

응답 `data`: `{ "devices": [ { "deviceId": "...", "name": "Speakers (...)", "type": "wasapi", "channels": 2 } ] }`

장치 목록은 재생 엔진이 보고한 마지막 목록입니다. 목록이 갱신되면 `audioDevicesUpdated` 이벤트가 옵니다.

#### audio.getdevice

응답 `data`: `{ "device": "<deviceId>" }`

#### audio.setdevice

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `device` | string | 예 | `audio.listdevices`의 `deviceId` |

응답 `data`: `{ "device": "<deviceId>" }`. `deviceId`에 쉼표가 들어 있으면 JSON 포트를 쓰십시오.

```
{"command":"audio.setdevice","device":"<deviceId>"}\n
```

#### audio.channeldelays

출력 채널별 오디오 지연(ms)을 설정합니다. 첫 값이 채널 1, 두 번째 값이 채널 2 ... 입니다. 음수는 0으로 처리됩니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1~ | `delays` | number[] | 예 | Simple: 나머지 값 전부 / JSON: 배열 |

응답 `data`: `{ "delays": [0, 10, 20, 0] }`

```
audio.channeldelays,0,10,20,0\n
{"command":"audio.channeldelays","delays":[0,10,20,0]}\n
```

### 6.9 디스플레이 (display.*)

#### display.list

감지된 모니터 목록을 돌려주고, 동시에 재생 엔진에 최신 목록을 다시 요청합니다(응답에는 마지막으로
받은 목록이 들어갑니다).

응답 `data`:

```json
{
  "displays": [
    { "index": 0, "device_name": "...", "key": "...", "name": "...", "serial": "...",
      "x": 0, "y": 0, "width": 1920, "height": 1080, "primary": true }
  ]
}
```

#### display.set

전역 디스플레이 배치를 설정합니다. 개별 출력 창은 `window.update`를 쓰십시오.

| 순서 | 이름 | 타입 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- | --- | --- |
| 1 | `monitorIndex` | number | 예 | | 모니터 번호. `-1` = 주 모니터 |
| 2 | `x` | number | 아니오 | `0` | |
| 3 | `y` | number | 아니오 | `0` | |
| 4 | `width` | number | 아니오 | `0` | `0` = 모니터 크기 |
| 5 | `height` | number | 아니오 | `0` | `0` = 모니터 크기 |
| 6 | `aspectMode` | string | 아니오 | `letterbox` | `letterbox` / `crop` / `stretch` |

응답: `message` `Display settings updated`, `data` `{ "display": {...} }`

```
display.set,1\n
display.set,1,0,0,1920,1080,crop\n
{"command":"display.set","monitorIndex":1,"aspectMode":"letterbox"}\n
```

#### display.background

모든 출력 창의 배경색을 바꿉니다(각 창 설정에도 저장).

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `color` | string | 예 | `#rrggbb` |

응답 `data`: `{ "backgroundColor": "#000000" }`

```
display.background,#000000\n
{"command":"display.background","color":"#202020"}\n
```

### 6.10 반복 (repeat.*)

#### repeat.set

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `mode` | string | 아니오 | `none` / `all` / `repeat_one`. 생략 시 다음 모드로 순환(토글) |
| 2 | `windowId` | number | 아니오 | 지정하면 그 창의 반복만 설정 (윈도우 플레이리스트용, 전역 설정과 독립) |

- 플레이리스트 재생 상태가 아닐 때(단일 파일)는 `none`, `all`만 허용됩니다. 허용되지 않은 값은
  `INVALID_PARAMETER` (`invalid mode (allowed: none, all)`).
- 순환 순서: `none` → `all` → `repeat_one` → `none` (단일 파일 상태는 `none` ↔ `all`).
- 창별 반복을 지정하지 않은 창은 전역 반복을 따릅니다.
- 응답 `data`: `{ "repeat": "all", "windowId": null, "allowedModes": ["none","all","repeat_one"] }`
- 이벤트 `repeatChanged` 발생.

```
repeat.set,all\n
repeat.set,repeat_one,2\n
repeat.set\n
{"command":"repeat.set","mode":"all","windowId":1}\n
```

Simple 포트에서 모드는 그대로 두고 창만 지정해 토글하려면 `repeat.set,,2`처럼 첫 값을 비웁니다.

#### repeat.get

응답 `data`:

```json
{ "repeat": "none", "windowRepeat": { "2": "all" }, "allowedModes": ["none", "all", "repeat_one"] }
```

`windowRepeat`: 창 ID별 반복 설정(지정한 창만 들어 있음).

### 6.11 타임라인 (timeline.*)

재생 엔진의 `timeline` 기능이 필요합니다. 타임라인 ID는 웹 UI에서 만든 타임라인의 내부 ID(문자열)이며,
TCP로는 목록을 조회하는 명령이 없습니다.

| 명령 | 파라미터 (순서) | 동작 |
| --- | --- | --- |
| `timeline.play` | `timelineId`(string, 필수), `ms`(number, 선택. JSON 별칭 `time_ms`, `time`) | 타임라인 재생. `ms` 지정 시 그 위치부터 |
| `timeline.pause` | 없음 | 일시정지/재개 토글 |
| `timeline.stop` | 없음 | 정지, 타임라인 모드 해제 |
| `timeline.seek` | `ms`(number, 필수. JSON 별칭 `time_ms`, `time`) | 위치 이동 (ms) |

- `timeline.play` 실패(엔진 미연결, 기능 미지원, 타임라인 없음): `EXECUTION_ERROR`
  (`Failed to play timeline (player not connected or feature unsupported)`). 성공 `data`: `{ "timelineId": "..." }`
- `timeline.pause`, `timeline.seek`는 타임라인 재생 중이 아니면 `Timeline not active`(성공)로 응답합니다.
- 타임라인 재생 중에는 `player.play` / `player.pause` / `player.stop` / `player.seek`도 타임라인에 적용됩니다.

```
timeline.play,AbCdEf0123456789\n
timeline.play,AbCdEf0123456789,15000\n
timeline.seek,60000\n
{"command":"timeline.play","timelineId":"AbCdEf0123456789","ms":15000}\n
```

### 6.12 자동 시작 · 자동 실행

#### startonplay.set

VP App이 시작될 때 자동으로 재생할지 설정합니다.

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `enabled` | boolean | 아니오 | 사용 여부. 생략 시 아무것도 바꾸지 않고 현재 설정을 돌려줌 |
| 2 | `playlistId` | number | 아니오 | 자동 재생할 플레이리스트. `enabled`가 참일 때만 저장 |

응답 `data`: `{ "enabled": true, "playlistId": 1 }`

```
startonplay.set,1,1\n
startonplay.set,0\n
{"command":"startonplay.set","enabled":true,"playlistId":1}\n
```

#### startonplay.get

응답 `data`: `{ "enabled": false, "playlistId": null }`

#### autostart.set

Windows 로그온 시 VP App을 자동 실행할지 설정합니다(현재 사용자 기준, 관리자 권한 불필요).

| 순서 | 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| 1 | `enabled` | boolean | 아니오 | 생략 시 현재 설정 반환 |

응답 `data`: `{ "enabled": true, "supported": true, "taskName": "VP App" }`

```
autostart.set,1\n
{"command":"autostart.set","enabled":true}\n
```

#### autostart.get

응답 `data`: `{ "enabled": true, "registered": true, "supported": true, "method": "registry", "taskName": "VP App" }`

- `enabled`: 저장된 설정, `registered`: 실제로 OS에 등록돼 있는지, `supported`: Windows에서만 `true`.

### 6.13 상태 조회 (system.* / files.list)

#### system.status

현재 상태 스냅샷입니다. 컨트롤러 재접속 직후 화면(터치패널) 상태를 맞출 때 사용하십시오.

응답 `data`:

```json
{
  "appVersion": "0.7.8",
  "protocolVersion": "2.0",
  "ready": true,
  "playlistMode": true,
  "playbackMode": "scene",
  "timelineMode": false,
  "repeat": "none",
  "windowRepeat": {},
  "trackId": 0,
  "fullscreen": true,
  "audioDevice": "<deviceId>",
  "masterVolume": 100,
  "backgroundColor": "#000000",
  "windows": 2,
  "autoStart": false,
  "playerFeatures": ["multi_window", "timeline", "..."],
  "file": { "uuid": "...", "filename": "intro.mp4", "number": 5 },
  "player": { "time": 12000, "duration": 60000, "position": 0.2, "is_playing": true, "event": "playing" }
}
```

| 필드 | 설명 |
| --- | --- |
| `ready` | 재생 엔진 준비 완료 여부 |
| `playlistMode` | 플레이리스트 재생 상태면 `true`, 단일 파일 상태면 `false` |
| `playbackMode` | 전역 작업 모드 (`scene` / `window`) |
| `timelineMode` | 타임라인 재생 상태 여부 |
| `repeat`, `windowRepeat` | 전역 / 창별 반복 모드 |
| `trackId` | 현재 트랙(장면) 인덱스, 0부터 |
| `windows` | 구성된 출력 창 개수 |
| `autoStart` | 로그온 시 자동 실행 설정 |
| `file` | 현재(마지막) 재생 파일. 없으면 `null` |
| `player` | 재생 엔진의 마지막 상태. `time`/`duration`은 ms, `event`는 엔진이 보고한 상태 문자열 |

#### system.version

응답 `data`: `{ "protocolVersion": "2.0", "appVersion": "0.7.8" }`. 가벼우므로 연결 확인(하트비트)용으로 적합합니다.

#### system.capabilities

응답 `data`: `{ "protocolVersion": "2.0", "features": [...], "commands": [...] }` (8장 참고)

#### files.list

등록된 전체 미디어 파일 목록입니다. 응답 `data`: `{ "files": [...], "count": n }`. 파일 수가 많으면
응답이 매우 길어지므로 컨트롤러에서는 필요할 때만 사용하십시오.

파일 객체의 주요 필드: `number`(파일 번호, 이벤트의 `fileId`와 같은 값), `id`, `uuid`, `filename`,
`originalname`, `amx`, `mimetype`, `size`, `is_image`, `metadata`.

`amx` 필드는 파일 이름을 AMX 터치패널 유니코드 표시용 문자열로 변환한 값입니다. 파일 이름의 UTF-16
코드 단위 각각을 4자리 소문자 16진수로 표기하고 쉼표로 이어 붙인 형식입니다
(예: `A가.mp4` → `0041,ac00,002e,006d,0070,0034`).

---

## 7. 이벤트(피드백) 메시지

이벤트는 요청 없이 서버가 보내는 메시지입니다.

- **두 포트에 접속한 모든 클라이언트에게** 같은 이벤트가 전송됩니다(Simple 포트 클라이언트도 JSON으로 받음).
- 웹 UI나 다른 컨트롤러가 조작한 결과로도 발생합니다(단, 아래 표에 "TCP 명령만"으로 표시한 이벤트 제외).
- 이벤트를 일으킨 명령의 응답보다 이벤트가 먼저 도착할 수 있습니다.

형식:

```
{"timestamp":"2026-11-08T01:23:45.678Z","success":true,"command":"event","message":"Event: playStarted","data":{"eventType":"playStarted","fileId":5,"filename":"intro.mp4"}}
```

`command`가 `event`이면 이벤트이고, 종류는 `data.eventType`입니다. 나머지 `data` 필드는 이벤트마다 다릅니다.

| eventType | 발생 시점 | `data` 필드 (eventType 외) |
| --- | --- | --- |
| `playerReady` | 재생 엔진 준비 완료 (앱 시작, 엔진 재시작 후) | 없음 |
| `playStarted` | 재생 / 재개 | `fileId`, `filename` (값이 없으면 `null`). 경우에 따라 `trackId` |
| `playPaused` | 일시정지 토글 | `fileId` |
| `playStopped` | 정지 | 전체 정지: 없음 / 창 정지(`player.stop,<windowId>`): `windowId` |
| `nextTrack` | 다음 트랙 명령 | `playlistId`, `trackId`, `filename` |
| `prevTrack` | 이전 트랙 명령 | `playlistId`, `trackId`, `filename` |
| `mediaChanged` | 실제로 화면의 미디어가 바뀜 | `fileId`, `filename`, `trackId`, `playlistId`, 멀티 창 재생 시 `windowId` |
| `trackEnded` | 플레이리스트 재생 중 한 트랙(항목)의 재생이 끝남 | 멀티 창 재생 시 `window_id`(끝난 창), 그 외 없음 |
| `endReached` | 단일 파일 재생이 끝남(반복 `repeat_one` 제외). 구형 엔진의 플레이리스트가 끝까지 재생된 경우. 멀티 창 플레이리스트 재생에서는 발생하지 않음(대신 `trackEnded`) | 없음 |
| `fullscreenChanged` | 전체화면 전환 완료 | `value` (boolean) |
| `audioDevicesUpdated` | 오디오 장치 목록 갱신 | `count` |
| `playbackModeChanged` | `mode.set` 실행 (TCP 명령만) | `mode` |
| `windowStopped` | `window.stop` 실행 (TCP 명령만) | `windowId` |
| `repeatChanged` | `repeat.set` 실행 (TCP 명령만) | `repeat`, 창 지정 시 `windowId` |

참고:

- `trackEnded`의 창 필드 이름은 `window_id`(snake_case), 다른 이벤트는 `windowId`입니다.
- 현재 재생 중인 파일/트랙을 터치패널에 표시하려면 `mediaChanged`를 기준으로 삼는 것이 가장 정확합니다.
  `playStarted`, `nextTrack`, `prevTrack`는 명령 시점의 값이라 전환 직전 정보일 수 있습니다.
- 이벤트를 놓쳤거나 재접속한 경우 `system.status`로 상태를 다시 맞추십시오.

이벤트 예:

```
{"timestamp":"...","success":true,"command":"event","message":"Event: mediaChanged","data":{"eventType":"mediaChanged","fileId":7,"filename":"scene2.mp4","trackId":1,"windowId":1,"playlistId":1}}
{"timestamp":"...","success":true,"command":"event","message":"Event: playStopped","data":{"eventType":"playStopped"}}
{"timestamp":"...","success":true,"command":"event","message":"Event: repeatChanged","data":{"eventType":"repeatChanged","repeat":"all"}}
```

---

## 8. 플레이어 기능(features)과 명령

`features`는 VP App의 재생 엔진이 지원한다고 보고한 기능 목록으로, 환영 메시지와 `system.capabilities`,
`system.status.playerFeatures`에서 확인할 수 있습니다. 명령을 쓰기 전에 관련 기능이 있는지 확인하면
설치 환경 차이로 인한 오동작을 피할 수 있습니다.

| feature | 관련 명령 |
| --- | --- |
| `multi_window` | `player.next`, `player.prev`, `window.play`, `window.next`, `window.prev`, 장면/윈도우 플레이리스트 재생 |
| `timeline` | `timeline.*` |
| `live_source` | `source.*`로 만든 소스를 `window.setsource`로 표시 |
| `live_ndi` | `kind: ndi` 소스 (NDI 런타임이 설치된 경우에만 보고됨) |
| `master_volume` | `audio.mastervolume` |
| `channel_delay` | `audio.channeldelays` |
| `audio_only_window` | `window.create` / `window.update`의 `audioOnly` |
| `window_audio_device` | `window.create` / `window.update`의 `audioDevice` |
| `window_mute` | `window.mute`, `window.create`의 `muted` |
| `display` | `display.set`, `display.list` |

---

## 9. 연동 예제

### 9.1 원시 송신 문자열

아래는 컨트롤러에서 그대로 보내는 바이트열입니다. `\n`은 LF(`0x0A`) 한 바이트를 뜻합니다.

| 목적 | 포트 | 송신 문자열 | 끝 바이트 |
| --- | --- | --- | --- |
| 재생 | 15000 | `player.play\n` | `0x0A` |
| 일시정지 토글 | 15000 | `player.pause\n` | `0x0A` |
| 정지 | 15000 | `player.stop\n` | `0x0A` |
| 다음 / 이전 | 15000 | `player.next\n` / `player.prev\n` | `0x0A` |
| 플레이리스트 1 재생 | 15000 | `playlist.play,1\n` | `0x0A` |
| 플레이리스트 1의 4번째 장면부터 | 15000 | `playlist.play,1,3\n` | `0x0A` |
| 창 2만 재생 | 15000 | `window.play,2\n` | `0x0A` |
| 창 2 정지 | 15000 | `window.stop,2\n` | `0x0A` |
| 창 2 뮤트 / 해제 | 15000 | `window.mute,2,1\n` / `window.mute,2,0\n` | `0x0A` |
| 볼륨 75 | 15000 | `audio.mastervolume,75\n` | `0x0A` |
| 레이아웃 1 적용 | 15000 | `layout.apply,1\n` | `0x0A` |
| 전체화면 켜기 | 15000 | `player.fullscreen,1\n` | `0x0A` |
| 반복 전체 | 15000 | `repeat.set,all\n` | `0x0A` |
| 상태 조회 | 15000 | `system.status\n` | `0x0A` |
| 재생 (JSON) | 15001 | `{"command":"player.play"}\n` | `0x0A` |
| 플레이리스트 재생 (JSON) | 15001 | `{"command":"playlist.play","id":1,"track":0}\n` | `0x0A` |

16진수 예: `player.play\n` = `70 6C 61 79 65 72 2E 70 6C 61 79 0A`

### 9.2 AMX NetLinx

```
DEFINE_DEVICE
dvVP = 0:3:0                     // IP 클라이언트 로컬 포트 3

DEFINE_CONSTANT
CHAR    VP_IP[]   = '192.168.0.10'
INTEGER VP_PORT   = 15000        // Simple 명령 포트

DEFINE_VARIABLE
VOLATILE CHAR cVpBuf[32768]
VOLATILE INTEGER nVpOnline

DEFINE_FUNCTION fnVpSend(CHAR cCmd[])
{
    IF (nVpOnline)
        SEND_STRING dvVP, "cCmd, $0A"     // 명령 + LF를 한 번에 전송
}

DEFINE_FUNCTION fnVpConnect()
{
    IP_CLIENT_OPEN(dvVP.PORT, VP_IP, VP_PORT, IP_TCP)
}

DEFINE_START
CREATE_BUFFER dvVP, cVpBuf
fnVpConnect()

DEFINE_EVENT
DATA_EVENT[dvVP]
{
    ONLINE:  { nVpOnline = 1; fnVpSend('system.status') }
    OFFLINE: { nVpOnline = 0 }          // 재접속은 타이머 등에서 fnVpConnect() 호출
    ONERROR: { nVpOnline = 0 }
    STRING:
    {
        STACK_VAR CHAR cLine[8192]
        WHILE (FIND_STRING(cVpBuf, "$0A", 1))
        {
            cLine = REMOVE_STRING(cVpBuf, "$0A", 1)
            IF (FIND_STRING(cLine, '"eventType":"mediaChanged"', 1))
            {
                // "filename":"..." 값을 잘라 터치패널에 표시
            }
            ELSE IF (FIND_STRING(cLine, '"eventType":"playStopped"', 1))
            {
                // 정지 상태 표시
            }
            ELSE IF (FIND_STRING(cLine, '"success":false', 1))
            {
                // 오류 처리 ("code":"..." 확인)
            }
        }
    }
}

// 버튼 예
BUTTON_EVENT[dvTP, 1] { PUSH: { fnVpSend('player.play') } }
BUTTON_EVENT[dvTP, 2] { PUSH: { fnVpSend('player.stop') } }
BUTTON_EVENT[dvTP, 3] { PUSH: { fnVpSend('playlist.play,1') } }
BUTTON_EVENT[dvTP, 4] { PUSH: { fnVpSend('window.play,2') } }
```

JSON 포트(15001)를 쓸 경우, JSON 문자열을 작은따옴표 문자열 변수에 담은 뒤 LF와 함께 보내는 방식이 안전합니다.

```
STACK_VAR CHAR cJson[200]
cJson = '{"command":"playlist.play","id":1}'
SEND_STRING dvVPJson, "cJson, $0A"
```

메모:

- 응답은 공백 없는 JSON이므로 `'"eventType":"mediaChanged"'`, `'"success":false'` 같은 부분 문자열
  검색으로 간단히 분기할 수 있습니다.
- 환영 메시지와 목록 응답은 길 수 있으므로 버퍼(`CREATE_BUFFER`)와 줄 변수 크기를 넉넉히 잡으십시오.
  줄 변수보다 긴 줄은 잘리지만, 이벤트와 일반 명령 응답은 보통 수백 바이트 이내입니다.
- 서버는 유휴 연결을 끊지 않습니다. 연결 상태 감시가 필요하면 주기적으로 `system.version`을 보내고
  응답이 없으면 재접속하십시오.

### 9.3 Crestron

- SIMPL: **TCP/IP Client** 심볼에 VP App PC의 IP와 포트 `15000`을 지정합니다. 송신 문자열은
  `player.play\x0A`처럼 끝에 `\x0A`를 붙입니다. 수신은 **Serial Gather** 등으로 `\x0A` 구분자 기준으로
  한 줄씩 모아 처리합니다.
- SIMPL+ / SIMPL#: 명령 문자열 끝에 `"\n"`(LF)을 붙여 한 번에 보내고, 수신 데이터를 LF로 나누어
  JSON을 해석합니다.

### 9.4 Python (테스트용)

```python
import json, socket

s = socket.create_connection(("192.168.0.10", 15000))
f = s.makefile("r", encoding="utf-8", newline="\n")

print(json.loads(f.readline()))            # 환영 메시지

s.sendall(b"playlist.play,1\n")
print(json.loads(f.readline()))            # 응답 (이벤트가 먼저 올 수 있음)

for line in f:                             # 이후 이벤트 수신
    msg = json.loads(line)
    if msg.get("command") == "event":
        print(msg["data"]["eventType"], msg["data"])
```

### 9.5 Node.js (테스트용)

```js
const net = require('net')

const sock = net.connect(15001, '192.168.0.10', () => {
  sock.write(JSON.stringify({ command: 'system.capabilities' }) + '\n')
  sock.write(JSON.stringify({ command: 'playlist.play', id: 1, track: 0 }) + '\n')
})

let buf = ''
sock.on('data', (chunk) => {
  buf += chunk.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (line) console.log(JSON.parse(line))
  }
})
```

### 9.6 PuTTY로 빠른 확인

PuTTY에서 Connection type을 **Raw**, 호스트 `192.168.0.10`, 포트 `15000`으로 접속하고
Terminal 설정의 **Local line editing**을 **Force on**으로 둔 뒤 `system.version`을 입력하고 Enter를
누르면 JSON 응답을 확인할 수 있습니다. 글자를 칠 때마다 바로 전송하는 클라이언트(기본 설정의 Windows
Telnet 등)는 명령이 글자 단위로 쪼개져 전송되므로(2.3) 사용하지 마십시오.

---

## 10. 문제 해결

| 증상 | 확인할 내용 |
| --- | --- |
| 연결이 거부됨 | VP App이 실행 중인지, 방화벽에서 TCP 15000/15001 인바운드가 허용됐는지 확인. 포트가 다른 프로그램과 충돌하면 +1 포트로 열릴 수 있습니다(2.2). |
| `FORMAT_ERROR` | Simple 포트(15000)에 JSON을 보냈거나, JSON 포트(15001)에 텍스트 명령을 보냈습니다. |
| `UNKNOWN_COMMAND` | 명령 이름 철자를 확인하십시오. `system.capabilities`의 `commands`에 전체 목록이 있습니다. |
| `MISSING_PARAMETER` | 필수 파라미터가 빠졌거나 숫자/불리언으로 해석할 수 없는 값입니다. Simple 포트는 순서가 맞는지 확인하십시오. |
| 명령이 가끔 무시되거나 이상하게 해석됨 | 명령과 LF를 한 번의 전송으로 보내고 있는지 확인하십시오(2.3). |
| `success:true`인데 화면 변화 없음 | 응답 `message`를 확인하십시오(예: `Not in playlist mode`, `window not playing`). |
| 창 명령이 `EXECUTION_ERROR` | `features`에 `multi_window`가 있는지, 창이 구성돼 있는지(`window.list`), 그 창에 재생할 항목이 있는지 확인하십시오. |
| 라이브 소스가 표시되지 않음 | `features`에 `live_source`(NDI는 `live_ndi`)가 있는지, `source.get`으로 주소가 맞는지, 대상 창이 존재하는지 확인하십시오. RTP 설정은 JSON 포트로 보내야 합니다. |
| 이벤트를 받지 못함 | 접속이 유지되고 있는지 확인하십시오. 이벤트는 접속 중인 모든 클라이언트에 자동 전송되며 별도 구독 명령은 없습니다. |
| 한글 파일 이름이 깨짐 | 응답은 UTF-8입니다. 컨트롤러가 UTF-8을 처리하지 못하면 `files.list`의 `amx` 필드를 활용하십시오. |

---

관련 문서: [운영자 사용 설명서](USER_GUIDE.md) · [설치·네트워크 구성 가이드](INSTALL_GUIDE.md)

---

## 라이선스

VP App(제어 서버와 웹 UI)의 소스 코드는 GNU General Public License v3.0으로 배포되며,
https://github.com/jkjh8/vp_app2 와 https://github.com/jkjh8/vp_ui 에서 받을 수 있습니다.
함께 배포되는 오픈소스 구성 요소(GStreamer, FFmpeg, npm 패키지, 폰트 등)의 라이선스, LGPL 소스 코드 제공 안내,
코덱 특허 고지는 설치 폴더와 저장소의 `THIRD-PARTY-NOTICES.md`를 참고하십시오.
설치된 앱에서는 시작 메뉴의 라이센스 고지 바로가기나 웹 UI의 오픈소스 라이선스 화면에서도 볼 수 있습니다.
