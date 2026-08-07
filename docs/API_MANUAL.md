# VP App2 API 매뉴얼

## 개요

VP App2는 네트워크 멀티 윈도우 비디오 플레이어를 제어하는 Node.js/Express 제어 계층입니다.
브라우저 SPA는 **REST API**로 명령을 보내고, **socket.io**로 실시간 상태(`pStatus`)를 수신합니다.
실제 영상 출력은 별도 플레이어(vplayer) 프로세스가 담당하며, 제어 계층이 이를 원격 구동합니다.

> 재생 출력은 **항상 플레이리스트 기반**입니다. 단일 파일 직접 재생은 앱에서 폐지되었고
> (`GET /api/player/play_id/:id`, `PUT /api/playlist/mode` 라우트는 더 이상 존재하지 않습니다),
> 파일은 `GET /api/files/raw/:uuid`를 통한 브라우저 미리보기 용도로만 서빙됩니다.

## 접속 정보 (Base URL)

| 채널 | 주소 | 비고 |
| --- | --- | --- |
| REST API | `http://<host>:3000/api` | 포트는 `VP_WEB_PORT` 환경변수로 오버라이드 가능 |
| 실시간 상태 (socket.io) | `http://<host>:3000` 네임스페이스 `/client`, 이벤트 `pStatus` | 부분 패치(아래 스키마 참조) |
| TCP 외부 제어 | 15000(단순) / 15001(JSON) | 레거시 인터페이스 — `docs/TCP_PROTOCOL.md` 참조 |

응답은 대체로 JSON이며, 오류 시 `{ "error": "..." }` 형태와 4xx/5xx 상태 코드를 반환합니다.

---

## 1. Player — `/api/player`

| Method | Path | 설명 | 파라미터 / 바디 |
| --- | --- | --- | --- |
| GET | `/play/:id` | 재생/재개. 플레이리스트·장면·타임라인 모드를 자동 분기(일시정지면 재개, 정지면 현재 재시작). `:id`는 레거시로 실제 사용되지 않음 | `:id`(무시됨) |
| GET | `/stop` | 정지. 모드에 따라 전 창 동시 정지 + 상태 초기화 | - |
| GET | `/pause/:id` | 일시정지/재개 토글(전 창·오디오 일괄). `:id`는 무시됨 | `:id`(무시됨) |
| GET | `/fullscreen/:value` | 전체화면 설정 | `:value` = `true`\|`false` |
| POST | `/background` | 배경색 설정 | body `{ color }` |
| PUT | `/setaudiodevice` | 출력 오디오 장치 설정 | body `{ deviceId }` |
| PUT | `/hwaccel` | 하드웨어 가속 설정(저장 후 플레이어 재시작으로 적용) | body `{ value: 'auto'\|'on'\|'off' }` |
| PUT | `/master_volume` | 전역 마스터 볼륨(저장, 슬라이더 릴리즈) | body `{ value: 0~100 }` |
| PUT | `/master_volume/live` | 전역 마스터 볼륨(전송만, 드래그 — 저장 안 함) | body `{ value: 0~100 }` |
| GET | `/repeat` | 반복 모드 순환 토글(`none`→`all`→`repeat_one`) | 응답 `{ message, mode }` |
| GET | `/next` | 다음 트랙 | - |
| GET | `/prev` | 이전 트랙(5초 이내면 이전, 아니면 현재 트랙 처음으로) | - |
| GET | `/audio_devices` | 오디오 장치 목록 조회 요청(결과는 `pStatus.audioDevices`로 푸시) | - |
| GET | `/displays` | 모니터 목록 조회 요청(결과는 `pStatus.displays`로 푸시) | - |
| PUT | `/display` | 전역 디스플레이 배치 설정 | body `{ monitorIndex, x, y, width, height, aspectMode }` |
| GET | `/windows` | 출력 창 목록 조회 | 응답 `{ windows, playerWindows }` |
| POST | `/windows` | 출력 창 생성 | body `{ name?, monitorIndex?, x?, y?, width?, height?, aspectMode?, backgroundColor? }` |
| PUT | `/windows/:id` | 출력 창 수정(라이브 재배치) | `:id` + 위와 동일한 바디 |
| DELETE | `/windows/:id` | 출력 창 삭제(참조 클립 자동 정리) | `:id` |
| PUT | `/preload` | 전 트랙 프리롤 설정 | body `{ lookahead?, maxDecks? }` |
| PUT | `/channel_delays` | 출력 채널별 오디오 지연(ms) 설정 | body `{ delays: number[] }` |
| GET | `/sync` | 멀티 PC 클럭 동기 설정 조회(`pStatus.sync`) | - |
| PUT | `/sync` | 멀티 PC 클럭 동기 설정 | body `{ role?, domain?, peers?, multicastAddr?, multicastPort?, leadMs? }` |

> `aspectMode`: `'letterbox'` \| `'crop'` \| `'stretch'`. `monitorIndex` `-1` = 주 모니터.

---

## 2. Playlist — `/api/playlist`

| Method | Path | 설명 | 파라미터 / 바디 |
| --- | --- | --- | --- |
| GET | `/` | 플레이리스트 전체 조회(트랙 파일정보 하이드레이션 포함) | - |
| POST | `/` | 플레이리스트 생성 | body `{ playlistId, name?, mode?, ... }` |
| PUT | `/` | 플레이리스트 수정 | body `{ id, ...updateData }` |
| PUT | `/tracks` | 트랙 추가(append) | body `{ id, tracks: [] }` |
| PUT | `/select` | 현재 열람 중 플레이리스트 지정(편집 시 프리로드 대상) | body `{ playlistId }` |
| DELETE | `/:id` | 플레이리스트 삭제(`_id` 기준) | `:id` |
| GET | `/play` | 플레이리스트 재생(로드된 타입에 따라 장면/윈도우 분기) | query `{ playlistId, trackIndex? }` |
| GET | `/preload` | 재생 없이 전 트랙 프리롤(로딩 버튼) | query `{ playlistId }` |
| PUT | `/playbackmode` | 전역 작업 모드 토글(에디터/목록/신규 기본 타입 힌트) | body `{ value: 'scene'\|'window' }` |
| PUT | `/mode_switch` | 플레이리스트 1개 타입 즉시 전환(트랙 형태 변환 포함) | body `{ id, mode: 'scene'\|'window' }` |
| GET | `/window/play` | 윈도우 모드: 단일 창 재생 | query `{ playlistId?, windowId, index? }` |
| GET | `/window/stop` | 윈도우 모드: 단일 창 정지 | query `{ windowId }` |
| PUT | `/deck_audio/live` | 재생 중 임베디드 오디오 라이브 변경(재조회 없이 즉시) | body `{ window_id?, streams?, channel_map?, volume?, muted? }` |
| PUT | `/track_audio/live` | 재생 중 추가 오디오 라이브 변경 | body `{ audioId, volume?, muted?, channels? }` |
| PUT | `/track` | 트랙(장면) 부분 갱신(영속) | body `{ id, idx, patch: { clips?, audios? } }` |
| PUT | `/image_time` | 이미지 트랙 표시 시간 설정 | body `{ playlistId, idx, time }` |
| PUT | `/start_on_play` | 부팅 시 자동재생 on/off | body `{ value: boolean }` |
| PUT | `/start_on_playlist_id` | 부팅 자동재생 대상 플레이리스트 지정 | body `{ playlistId }` |

---

## 3. Files — `/api/files`

파일은 재생 소스이자 브라우저 미리보기 대상입니다(직접 재생 라우트 없음).

| Method | Path | 설명 | 파라미터 / 바디 |
| --- | --- | --- | --- |
| GET | `/` | 파일 목록 조회 | - |
| POST | `/` | 파일 업로드(후처리 포함) | `multipart/form-data` (any 필드) |
| GET | `/thumbnail/:uuid` | 섬네일 이미지 서빙 | `:uuid` |
| DELETE | `/:uuid` | 파일 삭제(디스크 폴더 + DB) | `:uuid` |
| GET | `/download/:uuid` | 파일 다운로드(첨부) | `:uuid` |
| GET | `/raw/:uuid` | 인라인 원본 스트리밍(브라우저 `<video>`/`<img>` 미리보기, range 지원) | `:uuid` |
| GET | `/check-id/:id` | 파일 ID 중복 검사 | `:id` → 응답 `{ exists, id }` |
| PUT | `/:uuid/id` | 파일 ID 변경(영문/숫자/`_`/`-`만 허용, 중복 검사) | `:uuid` + body `{ newId }` |
| GET | `/reset_all` | 전 파일 `reserved` 상태 초기화 | - |

---

## 4. Status — `/api/status`

| Method | Path | 설명 | 파라미터 / 바디 |
| --- | --- | --- | --- |
| GET | `/` | 현재 상태 조회 | 응답 `{ pStatus }` |
| POST | `/update` | 상태 키 임의 갱신(+DB 영속) | body `{ key, value }` |
| GET | `/logo` | 로고 파일 목록 | - |
| POST | `/logo` | 로고 파일 업로드 | `multipart/form-data` |
| GET | `/logo/img/:filename` | 로고 이미지 서빙 | `:filename` |
| DELETE | `/logo/:filename` | 로고 파일 삭제 | `:filename` |
| GET | `/logo/sel/:filename` | 로고 선택/적용 | `:filename` |
| GET | `/logo/show/:show` | 로고 표시 on/off | `:show` = `true`\|`false` |
| PUT | `/logo/size` | 로고 크기 설정 | body `{ size }` |

---

## 5. Timeline — `/api/timeline`

Phase B 타임라인 모드(플레이리스트 모드와 상호 배타). 트랜스포트 정적 라우트가 `/:id`보다 앞에 배치됩니다.

| Method | Path | 설명 | 파라미터 / 바디 |
| --- | --- | --- | --- |
| GET | `/` | 타임라인 목록 조회 | - |
| POST | `/` | 타임라인 생성 | body `{ ... }` |
| PUT | `/` | 타임라인 수정 | body `{ ... }` |
| GET | `/play` | 타임라인 재생(시작 위치 지정 가능) | query `{ timelineId, time? }` |
| GET | `/pause` | 일시정지/재개 토글 | - |
| GET | `/stop` | 정지(해체 + 모드 해제 + 위치 초기화) | - |
| PUT | `/seek` | 탐색 | body `{ time_ms }` (또는 `{ time }`) |
| GET | `/:id` | 개별 타임라인 조회 | `:id` |
| DELETE | `/:id` | 타임라인 삭제 | `:id` |

---

## 장면(scene) · 윈도우(window) 모드

플레이리스트마다 `mode: 'scene' | 'window'` 필드로 **재생 방식**이 저장됩니다. **실제 재생 분기는 로드된
플레이리스트의 `mode`가 결정합니다.**

- **scene (장면)**: 각 트랙이 하나의 "장면" = 전 창(window)에 걸친 클립 묶음(`clips[]`)입니다.
  모든 창이 락스텝으로 동시에 재생/전환됩니다. 장면의 모든 활성 창 클립이 끝나면(가장 긴 것 기준)
  전 창이 함께 다음 장면으로 넘어갑니다. 플레이어가 `play_synced`를 지원하면 배리어로 묶여 동일
  `start_at`에 동시 스왑됩니다.
- **window (윈도우)**: 각 창이 자기만의 순서 목록을 **독립적으로** 재생/정지합니다. 창별 커서가
  따로 전진하며, 전역 `repeat`가 창별로 적용됩니다. 단일 창 제어는
  `GET /api/playlist/window/play`, `GET /api/playlist/window/stop`을 사용합니다.

관련 상태/제어 요약:

- `pStatus.playlist.mode` — **실제 재생 분기 기준**(scene/window).
- `pStatus.playbackMode` (`'scene'|'window'`) — 전역 에디터/목록 필터/신규 플레이리스트 기본 타입
  **힌트일 뿐**, 재생 분기와 무관. `PUT /api/playlist/playbackmode`로 설정.
- `pStatus.playlistMode` (boolean) — 자동 관리(플레이리스트 재생 시 `true`로 설정). 수동 토글 라우트
  (`PUT /api/playlist/mode`)는 폐지됨.
- 플레이리스트 1개의 타입 전환은 `PUT /api/playlist/mode_switch { id, mode }` (트랙 데이터도 대상
  형태로 변환).
- 출력 창(window)은 사용자 정의 출력 표면이며 CRUD는 `/api/player/windows`에서 관리합니다.

---

## pStatus (소켓 상태) 스키마

`GET /api/status`의 응답 본문이자, socket.io `/client` 네임스페이스의 `pStatus` 이벤트로 푸시되는
객체입니다. 소켓 이벤트는 **부분 패치**로 전송되며, 다음 키들은 **통째 교체**(키 삭제가 의미를 가짐)로
전송됩니다: `windowStates`, `preloadStatus`, `audioTracks`, `memory`, `windows`, `playerWindows`.

| 키 | 타입 | 설명 |
| --- | --- | --- |
| `windowOpen` | boolean | 플레이어 창 오픈 여부 |
| `playlistMode` | boolean | 플레이리스트 재생 활성(자동 관리) |
| `playbackMode` | `'scene'\|'window'` | 전역 작업 모드 힌트(재생 분기 아님) |
| `playlist` | object | 현재 로드된 플레이리스트(하이드레이션 트랙 포함, `mode` 필드가 재생 분기 결정) |
| `preloadedPlaylistId` | number\|null | 프리로딩된 플레이리스트 id(재프리로드/배지 판단) |
| `preloadStatus` | object | 창별 프리롤 진척 `{ [windowId]: { expected, prerolled, ready } }` (통째 교체) |
| `preloadReady` | boolean | 활성 창 전부 프리롤 완료(파생값) |
| `trackId` | number | 현재 트랙/장면 인덱스 |
| `repeat` | `'none'\|'all'\|'repeat_one'` | 반복 모드 |
| `tcpSimplePort` / `tcpJsonPort` | number | TCP 외부 제어 포트(기본 15000 / 15001) |
| `webPort` | number | REST/소켓 포트(기본 3000, `VP_WEB_PORT` 오버라이드) |
| `startOnPlay` | boolean | 부팅 시 자동재생 여부 |
| `startOnPlaylistId` | number\|null | 부팅 자동재생 대상 플레이리스트 |
| `audioDevices` | array | 감지된 오디오 장치 목록(플레이어 피드백) |
| `audioDevice` | string | 현재 출력 오디오 장치 |
| `hardwareAcceleration` | `'auto'\|'on'\|'off'` | 하드웨어 가속 설정 |
| `hardwareAccelEffective` | `'hardware'\|'software'\|null` | 실효 가속 상태(플레이어 피드백) |
| `masterVolume` | number(0~100) | 전역 마스터 볼륨 |
| `channelDelays` | number[] | 출력 채널별 오디오 지연(ms) |
| `logoFile` / `logoShow` / `logoVisible` / `logoSize` | - | 로고 파일·선호 표시·실제 표시·크기 |
| `file` | object | 하위호환 대표 재생 파일(장면의 첫 클립 등) |
| `player` | object | 대표 덱 상태 `{ event, volume, speed, position, duration, time }` |
| `activePlayerId` | number | 대표 활성 덱 id |
| `fullscreen` | boolean | 전체화면 여부 |
| `backgroundColor` | string | 배경색 |
| `display` | object | 전역 디스플레이 배치 `{ monitorIndex, x, y, width, height, aspectMode }` |
| `displays` | array | 감지된 모니터 목록(플레이어 피드백) |
| `windows` | array | 사용자 정의 출력 창 목록(영속, 통째 교체) |
| `playerWindows` | array | 플레이어가 실제 보유한 창 목록(피드백, 통째 교체) |
| `windowStates` | object | 창별 재생 상태 `{ [windowId]: { trackId, seqIndex?, uuid, filename, activePlayerId, player } }` (통째 교체) |
| `preloadLookahead` / `preloadMaxDecks` | number | 프리롤 룩어헤드(창당) / 전역 덱 상한 |
| `memory` | object | 플레이어 메모리 상태(프리롤 압박 UI용, 통째 교체) |
| `audioTracks` | object | 병행 오디오 트랙 라이브 상태 `{ [itemId]: audio_track_data }` (통째 교체) |
| `playerFeatures` | string[] | 플레이어 capabilities(예: `multi_window`, `play_synced`, `channel_delay`) — 신규 명령 게이트 |
| `sync` | object | 멀티 PC 클럭 동기 `{ role, domain, peers, multicastAddr, multicastPort, leadMs, ptp }` |
| `timelineMode` | boolean | 타임라인 모드(플레이리스트 모드와 상호 배타) |
| `timeline` | object | 현재 로드된 타임라인 |
| `timelinePos` | object | 타임라인 위치 `{ time_ms, duration_ms, is_playing }` |

---

## TCP 외부 제어

TCP 인터페이스(단순 포트 15000 / JSON 포트 15001)는 REST/소켓 API와 **별개의 외부 제어** 경로입니다.
재설계 v2에서 `domain.action` 네임스페이스 명령 + 기능협상(`system.capabilities`)을 도입했고, 다중창·
재생모드(scene/window)·프리로딩·마스터볼륨·디스플레이·타임라인을 노출합니다. **네임스페이스 전용**이며
레거시 flat 명령(play/playid 등)은 제거됐습니다. 상세는 `docs/TCP_PROTOCOL.md`를 참조하세요.

---

## 버전 정보

- **Version**: 0.5.9
- **TCP 외부제어 프로토콜**: v2.0
