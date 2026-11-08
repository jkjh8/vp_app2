# VP App

AMX·AV 통합제어 시스템과 웹 브라우저에서 제어하는 Windows용 미디어 플레이어입니다.
전시, 공연, 사이니지, 관제 환경에서 여러 화면과 여러 PC의 재생을 한곳에서 운영합니다.

이 저장소는 VP App의 **제어 서버**입니다. 외부 컨트롤러의 TCP 명령과 운영자 웹 UI의 요청을 받아
재생 엔진(네이티브 플레이어)을 제어합니다.

## 주요 기능

- **멀티 창 재생** — 모니터별로 창을 배치하고, 창마다 독립 재생 또는 장면 단위 동시 재생
- **멀티 PC 동기 재생** — 같은 네트워크의 여러 PC를 자동으로 찾아 프레임 단위로 맞춰 재생
- **라이브 입력** — RTP / RTSP / SRT 스트림을 재생 소스로 사용
- **오디오 라우팅** — 창별 출력 장치 지정, 트랙별 채널 매핑, ASIO 지원
- **외부 제어** — AMX 등 AV 컨트롤러용 TCP 제어 (단순 텍스트 / JSON)
- **웹 UI** — 플레이리스트, 파일, 화면 구성, 동기 설정을 브라우저에서 관리
- **웹 소프트웨어 업데이트** — 웹 UI에서 업데이트 패키지를 올려 업그레이드

## 설치

1. [Releases](https://github.com/jkjh8/vp_app2/releases)에서 최신 `VP-App-Setup-<버전>.exe`를 내려받습니다.
2. 설치 파일을 실행합니다. 방화벽 허용 창이 나오면 허용합니다.
3. 브라우저에서 `http://<PC 주소>:3000` 에 접속합니다.

지원 환경: Windows 10 / 11 (x64)

## 네트워크 포트

| 포트 | 프로토콜 | 용도 |
|---|---|---|
| 3000 | HTTP / WebSocket | 웹 UI, REST API, socket.io (`VP_WEB_PORT`로 변경 가능) |
| 15000 | TCP | 외부 제어 — 단순 텍스트 명령 |
| 15001 | TCP | 외부 제어 — JSON 명령 |
| 15002 | UDP | 멀티 PC 재생 트리거 |
| 15003 | UDP 멀티캐스트 (239.255.42.100) | 멀티 PC 자동 탐색 |
| 15004 | UDP | 멀티 PC 네트워크 클럭 |

멀티 PC 동기를 쓰지 않으면 3000, 15000, 15001만 열면 됩니다.

## 문서

| 문서 | 대상 |
|---|---|
| [운영자 사용 설명서](docs/USER_GUIDE.md) | 웹 UI로 매일 운영하는 담당자 |
| [설치·네트워크 구성 가이드](docs/INSTALL_GUIDE.md) | 현장 설치·시스템 통합 담당자 |
| [AMX/TCP 연동 매뉴얼](docs/TCP_PROTOCOL.md) | AMX·AV 컨트롤러 프로그래머 |
| [API 매뉴얼](docs/API_MANUAL.md), [API 스펙](docs/api-spec.json) | REST / WebSocket 연동 개발자 |

PDF 버전은 [Releases](https://github.com/jkjh8/vp_app2/releases)에 함께 올라갑니다.

## 구성

VP App은 세 부분으로 이루어집니다.

| 구성 요소 | 역할 | 저장소 |
|---|---|---|
| 제어 서버 | REST / socket.io / TCP 제어, 플레이리스트·DB, 멀티 PC 동기 | 이 저장소 |
| 운영자 웹 UI | Vue 3 / Quasar SPA | [vp_ui](https://github.com/jkjh8/vp_ui) |
| 재생 엔진 | GStreamer 기반 네이티브 플레이어 (디코드·렌더·오디오) | 비공개, 설치 파일에 포함 |

## 개발

필요 환경: Node.js 22, Windows

```bash
npm install
npm run dev      # 개발 실행 (nodemon)
npm run lint
```

개발 실행 시 재생 엔진은 `VP_PLAYER_EXE` 환경변수로 지정한 `vplayer.exe`를 사용합니다.
웹 UI는 [vp_ui](https://github.com/jkjh8/vp_ui)를 빌드해 `public/spa/`에 배치합니다.

### 배포 빌드

```bash
npm run build          # dist-node/ 에 실행 번들 생성
npm run build:update   # 웹 업데이트 패키지(.vpu) 생성
```

웹 업데이트 패키지는 빌드 시 지정한 암호 키로 암호화됩니다. 키는 `VP_UPDATE_KEY` 환경변수나
`keys/update.key`에서 읽으며, 저장소에는 포함되지 않습니다. 키가 바뀌면 기존 설치본은
웹 업데이트를 받을 수 없으므로 키 파일을 따로 보관해야 합니다.

## 데이터 위치

| 경로 | 내용 |
|---|---|
| `%APPDATA%\db` | 설정, 플레이리스트 DB |
| `%APPDATA%\vp_app2\logs` | 로그 |
| `%USERPROFILE%\media` | 미디어 파일 |

## 라이선스

이 저장소의 소스 코드는 [GNU General Public License v3.0](LICENSE)으로 배포됩니다.
수정하거나 재배포할 때는 같은 GPL-3.0 조건으로 소스 코드를 함께 공개해야 합니다.

GPL-3.0은 이 저장소에서 직접 작성한 코드에 적용됩니다. 사용한 npm 패키지는 각자의 라이선스
(MIT, ISC, BSD, Apache-2.0 등)를 따릅니다. 설치 파일에 함께 들어가는 재생 엔진과
GStreamer·FFmpeg(LGPL, DLL로 분리 배포)의 라이선스, LGPL 소스 코드 제공 안내,
코덱 특허 고지는 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)를 참고하세요.
