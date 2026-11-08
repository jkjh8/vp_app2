# 서드파티 소프트웨어 고지 (Third-Party Software Notices)

**제품**: VP App (TechData)
**버전**: 이 문서는 배포 번들과 함께 제공됩니다.

이 소프트웨어는 아래의 오픈소스 구성요소를 포함하거나 함께 배포합니다. 각 구성요소는
해당 라이센스 조건에 따라 사용됩니다. 라이센스 원문은 배포본의 다음 위치에 함께 제공됩니다:

- `player\licenses\` — 네이티브 플레이어(GStreamer/FFmpeg 등)의 라이센스 원문
- `THIRD-PARTY-LICENSES\npm-backend.txt` — Node 백엔드 npm 패키지 라이센스 전문
- `THIRD-PARTY-LICENSES\npm-webui.txt` — 웹 UI(SPA) npm 패키지 라이센스 전문

저장소(소스 코드)에서는 아래 위치에 라이센스 원문이 있습니다:

- `LICENSE` — VP App 소스 코드 라이센스 (GPL-3.0)
- `licenses\npm-webui.txt` — `public\spa\`(웹 UI 빌드 산출물)에 포함된 npm 패키지 라이센스 전문
- `licenses\Apache-2.0.txt` — Roboto, Material Icons 폰트 라이센스 원문
- `licenses\OFL-1.1-NanumGothic.txt` — 나눔고딕 폰트 라이센스 원문

> DISCLAIMER: 이 문서는 최선의 노력으로 작성된 것이며 법률 자문이 아닙니다.
> 상업적 배포 시 라이센스 준수 및 코덱 특허에 관하여 변호사의 검토를 받으십시오.

---

## 0. VP App 자체의 라이센스

| 구성 | 라이센스 | 소스 코드 |
|---|---|---|
| 제어 서버 (`server.cjs`, 이 저장소) | GPL-3.0-only | https://github.com/jkjh8/vp_app2 |
| 운영자 웹 UI (`public\spa\`) | GPL-3.0-only | https://github.com/jkjh8/vp_ui |
| 네이티브 플레이어 (`player\vplayer.exe`) | 독점 (별도 프로그램) | 비공개 |

- 제어 서버와 웹 UI는 GNU General Public License v3.0으로 배포됩니다. 배포본에 대응하는
  소스 코드는 위 저장소의 같은 버전 태그(예: `v0.7.7`)에서 받을 수 있습니다.
- `server.cjs`는 이 저장소의 소스와 npm 패키지를 하나로 묶은(esbuild) 파일이며, 웹 UI는
  vp_ui 저장소를 빌드한 결과입니다. 두 결과물 모두 위 소스와 공개된 빌드 스크립트로 다시 만들 수 있습니다.
- 네이티브 플레이어는 제어 서버와 **별도 프로세스로 실행되고 로컬 TCP 소켓으로만 통신하는
  독립 프로그램**입니다. 제어 서버의 코드를 포함하거나 링크하지 않으므로 GPL-3.0 제5조의
  "집합물(aggregate)"에 해당하며, GPL-3.0이 적용되지 않습니다.
- GPL-3.0과 아래 서드파티 라이센스(MIT, ISC, BSD, Apache-2.0, LGPL-2.1+, OFL-1.1)는 서로 충돌하지 않습니다.

---

## 1. 네이티브 플레이어 (vplayer) 구성요소

### 1.1 LGPL 라이센스 구성요소 (동적 링크 — 별도 DLL로 배포)

다음 라이브러리들은 **LGPL-2.1-or-later**(또는 LGPL-2.0-or-later)에 따라, `player\` 폴더에
**독립 DLL**로 동적 링크되어 배포됩니다. 사용자는 이 라이브러리를 수정하거나 교체할 권리가
있습니다(아래 3항 LGPL 준수 안내 참조).

| 구성요소 | 라이센스 | 용도 |
|---|---|---|
| GStreamer 1.26.11 (core, gst-plugins-base/good/bad, gst-libav) | LGPL-2.1-or-later | 미디어 파이프라인 |
| FFmpeg (avcodec/avformat/avutil/swresample/swscale/avfilter, **LGPL 빌드**) | LGPL-2.1-or-later | `libav` 플러그인의 디코딩 백엔드 |
| GLib / GObject / GIO | LGPL-2.1-or-later | GStreamer 기반 라이브러리 |
| ORC | BSD-2-Clause / BSD-3-Clause | 런타임 SIMD 최적화 |
| libmpg123 | LGPL-2.1-or-later | MP3 디코드 (MP3 특허 만료: 2017) |
| proxy-libintl (libintl) | LGPL-2.0-or-later | 국제화 런타임 |
| gstasio (직접 빌드) | LGPL-2.1-or-later | ASIO 오디오 출력 — 아래 1.4 참조 |

> **gst-plugins-good**은 별도 라이센스 폴더가 없으며 LGPL-2.1-or-later로 배포됩니다
> (`player\licenses\gstreamer\gstreamer-1.0\`의 LGPL 원문이 이를 포괄합니다).

### 1.2 Permissive 라이센스 구성요소

| 구성요소 | 라이센스 |
|---|---|
| libjpeg-turbo | IJG / BSD-3-Clause |
| libpng | libpng License (zlib 계열) |
| libogg / libvorbis | BSD-3-Clause (Xiph) |
| Opus | BSD-3-Clause |
| FLAC | BSD-3-Clause (Xiph) |
| zlib | zlib License |
| bzip2 | BSD 계열 |
| libffi | MIT |
| PCRE2 | BSD-3-Clause |

### 1.3 정적 링크 구성요소 (vplayer.exe에 포함)

| 구성요소 | 라이센스 | 원문 |
|---|---|---|
| nlohmann/json v3.11.3 | MIT | 아래 부록 A |
| lunasvg v2.4.1 (+ plutovg) | MIT | 아래 부록 A |
| stb (stb_image) | MIT / Public Domain | 아래 부록 A |

### 1.4 ASIO 관련 고지 (중요)

`gstasio` 플러그인은 GStreamer 프로젝트의 **클린룸(clean-room) ASIO 인터페이스 재구현**
(gst-plugins-bad 1.20+)을 사용하며 **Steinberg ASIO SDK를 포함하거나 사용하지 않습니다.**
따라서 Steinberg ASIO SDK 라이센스 계약의 적용을 받지 않습니다.

> "ASIO is a registered trademark of Steinberg Media Technologies GmbH."
>
> ASIO는 Steinberg Media Technologies GmbH의 등록 상표입니다. 본 제품에서 "ASIO"는
> 해당 오디오 인터페이스와의 호환성을 표시하기 위한 명목적 사용(nominative use)이며,
> 본 제품은 Steinberg와 제휴/보증 관계가 없습니다.

### 1.5 Microsoft Visual C++ 재배포 런타임

`msvcp140*.dll`, `vcruntime140*.dll`, `concrt140.dll`, `vccorlib140.dll` 등은 Microsoft
Visual C++ Redistributable의 일부로, Visual Studio 재배포 조건에 따라 배포됩니다.

---

## 2. 백엔드(Node.js) 및 웹 UI 구성요소

| 계층 | 구성요소 | 라이센스 |
|---|---|---|
| 런타임 | Node.js | MIT (및 OpenSSL/V8/libuv 등 permissive 종속) |
| 백엔드 npm | express, socket.io, winston, multer, nedb-promises, cors, cookie-parser, morgan, uuid 등 (전 종속 트리) | 전부 permissive (MIT/ISC/BSD/Apache-2.0) — 전문은 `THIRD-PARTY-LICENSES\npm-backend.txt` |
| 웹 UI (SPA) | Vue 3, Quasar, Pinia, axios, socket.io-client, vuedraggable 등 | 전부 permissive (MIT/BSD/Apache-2.0) — 전문은 `THIRD-PARTY-LICENSES\npm-webui.txt` (저장소: `licenses\npm-webui.txt`) |

카피레프트(GPL/LGPL/AGPL/MPL) npm 패키지는 배포 대상에 **포함되지 않습니다.**

### 2.1 웹 UI 폰트

| 폰트 | 라이센스 | 저작권 | 원문 |
|---|---|---|---|
| 나눔고딕 (NanumGothic) | SIL Open Font License 1.1 | © 2010 NAVER Corporation | `licenses\OFL-1.1-NanumGothic.txt` |
| Roboto | Apache License 2.0 | © Google | `licenses\Apache-2.0.txt` |
| Material Icons | Apache License 2.0 | © Google | `licenses\Apache-2.0.txt` |

폰트는 수정 없이 웹 UI에 포함되며, OFL-1.1에 따라 폰트 자체를 단독으로 판매하지 않습니다.

---

## 3. LGPL 준수 안내 (1.1항 구성요소 대상)

본 제품은 위 LGPL 라이브러리들을 **동적 링크된 별도 DLL 파일**(`player\` 및
`player\gst-plugins\` 폴더)로 배포합니다. 이는 LGPL이 요구하는 "사용자가 라이브러리를
수정/교체할 수 있어야 한다"는 조건을 충족합니다:

- 해당 DLL을 동일 인터페이스의 다른 빌드로 **교체**하여 본 제품과 함께 사용할 수 있습니다.
- 각 라이브러리의 라이센스 원문은 `player\licenses\` 에 포함되어 있습니다.
- 본 제품의 어떤 부분도 이들 LGPL 라이브러리를 정적 링크하지 않습니다.

---

## 4. 대응 소스 코드 제공 (Written Offer)

위 LGPL 및 기타 오픈소스 구성요소의 **대응 소스 코드**는 아래에서 입수할 수 있습니다. 배포된
바이너리와 동일한 버전의 소스입니다:

- **GStreamer 1.26.11** 및 플러그인:
  https://gstreamer.freedesktop.org/src/ (gstreamer, gst-plugins-base/good/bad, gst-libav)
- **FFmpeg** (GStreamer가 LGPL 모드로 빌드한 버전):
  https://ffmpeg.org/download.html — 정확한 리비전은 GStreamer 1.26.11 빌드 메타데이터 참조
- **GLib**: https://download.gnome.org/sources/glib/
- **libmpg123**: https://www.mpg123.de/download.shtml
- **gstasio**: gst-plugins-bad 1.26.11의 `sys/asio` 소스에 기반하며, 본 제품에 사용된 소스
  일체는 요청 시 제공합니다(하단 연락처). 원본: 위 gst-plugins-bad 배포본.
- 기타 permissive 구성요소의 소스도 각 프로젝트 공식 사이트에서 입수 가능합니다.

또한 본 제품의 배포자(TechData)는 배포일로부터 **최소 3년간**, 실비의 매체 비용만으로
위 LGPL 구성요소의 대응 소스 코드를 제공할 것을 제안합니다.

**연락처**: jhkang@techdata.co.kr

---

## 5. 코덱 특허에 관한 고지 (저작권과 별개)

본 제품에 포함된 오픈소스 라이센스는 소프트웨어 **저작권**에 관한 것이며, 영상/오디오 코덱
(H.264/AVC, H.265/HEVC, AAC 등)에 대한 **특허** 실시권을 부여하지 않습니다. 이들 코덱의
특허 로열티는 소프트웨어를 무료로 배포하더라도 면제되지 않을 수 있습니다.

본 제품은 가능한 경우 운영체제/하드웨어 디코더(Windows Media Foundation, Direct3D11/DXVA)를
사용하며, 이 경우 해당 코덱의 특허 실시권은 운영체제/GPU 공급자에 귀속됩니다. 소프트웨어
디코더(FFmpeg `libav`)를 통한 특허 코덱 디코딩이 필요한 상업적 배포의 경우, 관련 특허풀
(Via LA, Access Advance 등)에 대한 실시권 확보 여부를 별도로 검토하십시오.

---

## 부록 A — 정적 링크 구성요소 라이센스 원문

### nlohmann/json (MIT)

```
MIT License

Copyright (c) 2013-2025 Niels Lohmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### lunasvg / plutovg (MIT)

```
MIT License

Copyright (c) 2020 Nwutobo Samuel Ugochukwu <sammycageagle@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED... (전문은 lunasvg 배포본 LICENSE 참조)
```

### stb (MIT / Public Domain 택일)

```
This software is available under 2 licenses -- choose whichever you prefer.

ALTERNATIVE A - MIT License
Copyright (c) 2017 Sean Barrett
(MIT 전문 — stb LICENSE 참조)

ALTERNATIVE B - Public Domain (www.unlicense.org)
This is free and unencumbered software released into the public domain.
```
