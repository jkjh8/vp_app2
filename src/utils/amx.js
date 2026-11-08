// AMX 터치패널 유니코드 표시용 문자열 변환.
// UTF-16 코드 단위마다 4자리 hex(소문자)로 만들어 쉼표로 잇는다. 예: 'A가' → '0041,ac00'
export const convertforAMX = (str) =>
  Array.from({ length: str.length }, (_, i) =>
    str.charCodeAt(i).toString(16).padStart(4, '0'),
  ).join(',')

// 파일/트랙 문서의 amx 값. 업로드 시 저장된 값 대신 filename에서 다시 계산해
// 이전 버전이 저장한 값도 올바르게 내보낸다.
export const amxOf = (doc) => (doc?.filename ? convertforAMX(doc.filename) : doc?.amx)
