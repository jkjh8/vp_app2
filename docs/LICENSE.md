# VP App2 - 오픈소스 라이선스

## 프로젝트 정보

**VP App2** (Video Player Application 2)는 미디어 파일 재생 및 플레이리스트 관리를 위한 오픈소스 애플리케이션입니다.

- **버전**: 0.1.5
- **저작권**: © 2025 jkjh8
- **라이선스**: MIT License
- **저장소**: https://github.com/jkjh8/vp_app2

---

## MIT License

```
MIT License

Copyright (c) 2025 jkjh8

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

---

## 오픈소스 사용 조건

본 소프트웨어는 MIT 라이선스 하에 배포됩니다. 다음과 같은 자유를 제공합니다:

### ✅ 허용되는 사항

- **상업적 사용**: 상업적 목적으로 소프트웨어를 사용할 수 있습니다
- **수정**: 소프트웨어를 수정할 수 있습니다
- **배포**: 소프트웨어의 원본이나 수정본을 배포할 수 있습니다
- **개인 사용**: 개인적인 목적으로 자유롭게 사용할 수 있습니다
- **특허 사용**: 기여자의 특허 권리를 사용할 수 있습니다

### ⚠️ 필수 조건

- **라이선스 고지**: 소프트웨어의 모든 복사본에 원본 라이선스와 저작권 고지를 포함해야 합니다
- **면책 조항**: 소프트웨어는 "있는 그대로" 제공되며, 어떠한 보증도 제공하지 않습니다

### ❌ 제한 사항

- **책임 제한**: 저작권자는 소프트웨어 사용으로 인한 어떠한 손해에 대해서도 책임을 지지 않습니다
- **상표권**: 본 라이선스는 상표권 사용을 허가하지 않습니다

---

## 사용된 오픈소스 라이브러리

본 프로젝트는 다음과 같은 오픈소스 라이브러리를 사용합니다:

### 핵심 프레임워크

#### Electron

- **버전**: ^33.2.1
- **라이선스**: MIT
- **용도**: 데스크톱 애플리케이션 프레임워크
- **웹사이트**: https://www.electronjs.org/

#### Express.js

- **버전**: ^4.21.2
- **라이선스**: MIT
- **용도**: 웹 서버 및 REST API
- **웹사이트**: https://expressjs.com/

#### Socket.IO

- **버전**: ^4.8.1
- **라이선스**: MIT
- **용도**: 실시간 양방향 통신
- **웹사이트**: https://socket.io/

### 데이터베이스

#### NeDB

- **버전**: ^1.8.0
- **라이선스**: MIT
- **용도**: 내장형 NoSQL 데이터베이스
- **웹사이트**: https://github.com/louischatriot/nedb

### 유틸리티

#### UUID

- **버전**: ^11.0.5
- **라이선스**: MIT
- **용도**: 고유 식별자 생성
- **웹사이트**: https://github.com/uuidjs/uuid

#### Winston

- **버전**: ^3.17.0
- **라이선스**: MIT
- **용도**: 로깅 라이브러리
- **웹사이트**: https://github.com/winstonjs/winston

#### Winston Daily Rotate File

- **버전**: ^5.0.0
- **라이선스**: MIT
- **용도**: 로그 파일 순환 관리
- **웹사이트**: https://github.com/winstonjs/winston-daily-rotate-file

#### Morgan

- **버전**: ^1.10.0
- **라이선스**: MIT
- **용도**: HTTP 요청 로거
- **웹사이트**: https://github.com/expressjs/morgan

#### CORS

- **버전**: ^2.8.5
- **라이선스**: MIT
- **용도**: Cross-Origin Resource Sharing 지원
- **웹사이트**: https://github.com/expressjs/cors

---

## 기여 가이드라인

### 기여 방법

본 프로젝트에 기여하고 싶으시다면:

1. **Fork**: 저장소를 Fork 합니다
2. **Branch**: 새로운 기능 브랜치를 생성합니다 (`git checkout -b feature/AmazingFeature`)
3. **Commit**: 변경사항을 커밋합니다 (`git commit -m 'Add some AmazingFeature'`)
4. **Push**: 브랜치에 푸시합니다 (`git push origin feature/AmazingFeature`)
5. **Pull Request**: Pull Request를 생성합니다

### 코드 스타일

- **JavaScript**: ES6+ 문법 사용
- **들여쓰기**: 2 spaces
- **세미콜론**: 선택적 사용
- **따옴표**: 작은따옴표 선호
- **로깅**: Winston logger 사용 (console.log 사용 금지)

### 커밋 메시지

커밋 메시지는 다음 형식을 따릅니다:

```
<type>: <subject>

<body>
```

**Type:**

- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅
- `refactor`: 코드 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드 프로세스 변경

---

## 보안 취약점 보고

보안 취약점을 발견하신 경우:

1. **공개 이슈로 제보하지 마세요**
2. GitHub Security Advisory를 통해 비공개로 제보해주세요
3. 또는 저장소 관리자에게 직접 연락해주세요

---

## 연락처

- **GitHub**: https://github.com/jkjh8
- **이슈 트래커**: https://github.com/jkjh8/vp_app2/issues

---

## 감사의 말

본 프로젝트는 오픈소스 커뮤니티의 훌륭한 라이브러리들 덕분에 가능했습니다.
모든 기여자와 라이브러리 개발자분들께 감사드립니다.

---

## 변경 이력

### v0.1.5 (2025-01-18)

- TCP 통신 프로토콜 개선
- API 응답 형식 표준화
- 로깅 시스템 개선
- 코드 정리 및 최적화

### v0.1.0 (2024)

- 초기 릴리스
- 기본 미디어 재생 기능
- 플레이리스트 관리
- REST API 제공
- TCP 소켓 통신 지원

---

**면책 조항**: 본 소프트웨어는 "있는 그대로" 제공되며, 명시적이든 묵시적이든 어떠한 종류의 보증도 제공하지 않습니다. 저작권자는 계약, 불법행위 또는 기타 어떠한 경우에도 소프트웨어의 사용 또는 기타 거래로 인해 발생하는 청구, 손해 또는 기타 책임에 대해 책임을 지지 않습니다.
