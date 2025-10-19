# VP App2 문서

이 폴더에는 VP App2의 사용자 및 개발자 문서가 포함되어 있습니다.

## 📚 문서 목록

### 사용자 문서

- **[USER_GUIDE.md](./USER_GUIDE.md)** - 사용자 가이드
  - 시작하기
  - 기본 사용법
  - 플레이리스트 관리
  - 원격 제어
  - 설정
  - 문제 해결

### 개발자 문서

- **[API_MANUAL.md](./API_MANUAL.md)** - API 매뉴얼
  - REST API 엔드포인트
  - TCP 프로토콜
  - WebSocket 통신
  - 사용 예시

- **[api-spec.json](./api-spec.json)** - API 스펙 (JSON)
  - API 엔드포인트 정의
  - 데이터 모델
  - 요청/응답 형식

- **[TCP_PROTOCOL.md](./TCP_PROTOCOL.md)** - TCP 프로토콜 상세 문서
  - TCP 통신 프로토콜 상세 설명
  - 명령어 및 이벤트 정의

### 라이선스

- **[LICENSE.md](./LICENSE.md)** - 오픈소스 라이선스
  - MIT 라이선스
  - 사용 조건
  - 사용된 오픈소스 라이브러리
  - 기여 가이드라인

## 🚀 빠른 시작

### 사용자

1. [USER_GUIDE.md](./USER_GUIDE.md)에서 설치 및 기본 사용법을 확인하세요
2. 문제가 발생하면 "문제 해결" 섹션을 참조하세요

### 개발자

1. [API_MANUAL.md](./API_MANUAL.md)에서 API 사용법을 확인하세요
2. [api-spec.json](./api-spec.json)에서 API 스펙을 확인하세요
3. Vue.js 프로젝트에서 이 문서들을 import하여 사용할 수 있습니다

## 📦 Vue.js에서 사용하기

### Markdown 파일 import

```javascript
// Vue 컴포넌트에서
import { ref, onMounted } from 'vue'

const apiManual = ref('')
const license = ref('')

onMounted(async () => {
  // Markdown 파일 로드
  const apiResponse = await fetch('/docs/API_MANUAL.md')
  apiManual.value = await apiResponse.text()

  const licenseResponse = await fetch('/docs/LICENSE.md')
  license.value = await licenseResponse.text()
})
```

### JSON 스펙 import

```javascript
// JavaScript/TypeScript에서
import apiSpec from './docs/api-spec.json'

// API 엔드포인트 정보 사용
console.log(apiSpec.endpoints.player.play)
console.log(apiSpec.tcp.commands)
```

### Markdown 렌더링

Markdown을 HTML로 렌더링하려면 라이브러리를 사용하세요:

```bash
npm install marked
```

```vue
<template>
  <div v-html="renderedMarkdown"></div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { marked } from 'marked'

const markdown = ref('')
const renderedMarkdown = computed(() => marked(markdown.value))

onMounted(async () => {
  const response = await fetch('/docs/API_MANUAL.md')
  markdown.value = await response.text()
})
</script>
```

## 🔗 관련 링크

- **GitHub 저장소**: https://github.com/jkjh8/vp_app2
- **이슈 트래커**: https://github.com/jkjh8/vp_app2/issues
- **릴리스**: https://github.com/jkjh8/vp_app2/releases

## 📝 문서 업데이트

문서에 오류가 있거나 개선 사항이 있다면:

1. GitHub Issues에 문서 개선 제안을 올려주세요
2. 또는 Pull Request를 통해 직접 수정해주세요

## 📄 라이선스

모든 문서는 MIT 라이선스 하에 배포됩니다.
자유롭게 사용, 수정, 배포할 수 있습니다.
