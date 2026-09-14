// Phase 2 배포 번들 생성: Electron 제거 → VPApp.exe + 단일 server.cjs.
//
// 산출물 dist-node/:
//   VPApp.exe         stock Node 런타임 복사본 + 앱 브랜드 리소스(아이콘/버전정보) 스탬프(rcedit)
//   server.cjs        전 의존성 번들 (esbuild)
//   public/spa/       vp_ui 빌드 결과 (기존 위치에서 복사)
//   player/           vp_player 네이티브 번들 (vplayer.exe + gst + licenses/)
//   THIRD-PARTY-NOTICES.md      서드파티 고지 (LGPL 소스 오퍼 포함)
//   THIRD-PARTY-LICENSES/       npm 라이센스 전문 (백엔드/웹UI)
//   start.cmd         개발/수동 실행용 (VP_APP_ROOT 설정 후 node server.cjs)
//   (Phase 2.5부터 ffmpeg.exe/ffprobe.exe 미포함 — 메타/썸네일은 네이티브 플레이어가 담당)
//
// 사용법: node scripts/build-node.mjs

import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectNpmLicenses } from './collect-licenses.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist-node')
const pkgVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

// 배포 실행 파일 이름 — stock node.exe를 이 이름으로 복사 후 버전정보/아이콘을 앱 브랜드로 스탬프.
// (방화벽 대화상자·목록·작업관리자에 "Node.js" 대신 앱 이름/아이콘이 표시되도록)
const EXE_NAME = 'VPApp.exe'

// --- 1. 클린 ------------------------------------------------------------------
if (existsSync(out)) rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// --- 2. esbuild 번들 (ESM 소스 전체 → 단일 CJS) --------------------------------
// ffmpeg-static/ffprobe-static은 바이너리 경로만 제공 — 번들에 포함하되 실제 경로는
// setupFFmpeg가 VP_FFMPEG_PATH/앱-로컬 ffmpeg\로 오버라이드하므로 무해.
await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(out, 'server.cjs'),
  // 네이티브 애드온이 있으면 external 처리 (현재 전 의존성 순수 JS라 없음)
  external: [],
  banner: { js: '/* vp_app2 bundled server (Phase 2, no Electron) */' },
  logLevel: 'info',
})

// --- 3. VPApp.exe (현재 node 런타임 복사 + 브랜드 리소스 스탬프) ----------------
const exePath = path.join(out, EXE_NAME)
cpSync(process.execPath, exePath)
// rcedit로 버전정보(FileDescription 등)와 아이콘을 앱 브랜드로 교체. 미설치 시 경고 후 스킵.
// 참고: stock node.exe의 Authenticode 서명은 리소스 편집으로 무효화됨(어차피 미서명 배포).
try {
  const { rcedit } = await import('rcedit')
  await rcedit(exePath, {
    'version-string': {
      FileDescription: 'VP App',
      ProductName: 'VP App',
      CompanyName: 'TechData',
      LegalCopyright: '© TechData',
      OriginalFilename: EXE_NAME,
      InternalName: 'VPApp',
    },
    'file-version': pkgVersion,
    'product-version': pkgVersion,
    icon: path.join(root, 'public', 'icons', 'icon.ico'),
  })
  console.log(`  ${EXE_NAME}: 브랜드 리소스 스탬프 완료 (아이콘 + 버전정보)`)
} catch (e) {
  console.warn(
    `WARN: ${EXE_NAME} 리브랜딩 건너뜀 (${e.message}). 브랜딩하려면 npm i 후 다시 빌드하세요 (rcedit).`,
  )
}

// --- 4. SPA (vp_ui 빌드 결과) --------------------------------------------------
const spaSrc = path.join(root, 'public', 'spa')
if (existsSync(spaSrc)) {
  cpSync(spaSrc, path.join(out, 'public', 'spa'), { recursive: true })
} else {
  console.warn('WARN: public/spa 없음 — vp_ui를 먼저 빌드해 public/spa에 배치할 것')
}
// 아이콘(설치기·바로가기용) 및 로고 에셋
const iconsSrc = path.join(root, 'public', 'icons')
if (existsSync(iconsSrc)) cpSync(iconsSrc, path.join(out, 'public', 'icons'), { recursive: true })

// --- 5. player (vp_player 네이티브 번들) ---------------------------------------
const playerSrc = path.join(root, '..', 'vp_player', 'dist', 'player')
if (existsSync(playerSrc)) {
  cpSync(playerSrc, path.join(out, 'player'), { recursive: true })
} else {
  console.warn('WARN: vp_player/dist/player 없음 — vp_player에서 bundle.ps1 먼저 실행')
}

// (Phase 2.5: ffmpeg-static/ffprobe-static 제거 — 메타/썸네일은 네이티브 플레이어가 담당)

// --- 6. 서드파티 라이센스 (LGPL 준수: NOTICE + npm 라이센스 전문) ---------------
// 마스터 고지 파일 (수기 작성, LGPL 소스 제공 오퍼 포함)
const noticeSrc = path.join(root, 'THIRD-PARTY-NOTICES.md')
if (existsSync(noticeSrc)) {
  cpSync(noticeSrc, path.join(out, 'THIRD-PARTY-NOTICES.md'))
} else {
  console.warn('WARN: THIRD-PARTY-NOTICES.md 없음 — 배포 전 반드시 포함할 것 (LGPL 고지)')
}
// 네이티브 플레이어(GStreamer/FFmpeg 등) 라이센스는 player/licenses/ 에 bundle.ps1이 이미 복사.
const playerLic = path.join(out, 'player', 'licenses')
if (!existsSync(playerLic)) {
  console.warn('WARN: player/licenses/ 없음 — vp_player bundle.ps1 재실행 필요 (LGPL 원문 누락)')
}
// npm 라이센스 전문 수집 (백엔드 + 웹UI)
const licDir = path.join(out, 'THIRD-PARTY-LICENSES')
mkdirSync(licDir, { recursive: true })
const backend = collectNpmLicenses(root, 'vp_app2 (Node 백엔드)')
writeFileSync(path.join(licDir, 'npm-backend.txt'), backend.text)
console.log(`  THIRD-PARTY-LICENSES/npm-backend.txt: ${backend.count} packages`)
const uiRoot = path.join(root, '..', 'vp_ui')
if (existsSync(path.join(uiRoot, 'node_modules'))) {
  const webui = collectNpmLicenses(uiRoot, 'vp_ui (웹 UI — SPA 정적 산출물에 포함)')
  writeFileSync(path.join(licDir, 'npm-webui.txt'), webui.text)
  console.log(`  THIRD-PARTY-LICENSES/npm-webui.txt: ${webui.count} packages`)
} else {
  console.warn('WARN: vp_ui/node_modules 없음 — 웹UI npm 라이센스 미수집')
}

// --- 7. 수동 실행 스크립트 -----------------------------------------------------
writeFileSync(
  path.join(out, 'start.cmd'),
  [
    '@echo off',
    'setlocal',
    'set VP_APP_ROOT=%~dp0',
    'set PATH=%~dp0player;%PATH%',
    `"%~dp0${EXE_NAME}" "%~dp0server.cjs"`,
  ].join('\r\n') + '\r\n',
)

// 콘솔 창 없이 구동하는 VBS 런처 (자동시작·바로가기 대상). 자기 위치로 VP_APP_ROOT 도출.
writeFileSync(
  path.join(out, 'vpapp-launch.vbs'),
  [
    'Set sh = CreateObject("WScript.Shell")',
    'appRoot = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))',
    'sh.Environment("PROCESS")("VP_APP_ROOT") = appRoot',
    'sh.CurrentDirectory = appRoot',
    "sh.Run \"\"\"\" & appRoot & \"" + EXE_NAME + "\"\" \"\"\" & appRoot & \"server.cjs\"\"\", 0, False",
  ].join('\r\n') + '\r\n',
)

// --- 8. 크기 요약 --------------------------------------------------------------
const dirSizeMB = (p) => {
  let total = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) walk(fp)
      else total += statSync(fp).size
    }
  }
  walk(p)
  return (total / 1048576).toFixed(1)
}
console.log(`\n=== dist-node 완성: ${out} ===`)
console.log(`total: ${dirSizeMB(out)} MB`)
for (const name of [EXE_NAME, 'server.cjs']) {
  const fp = path.join(out, name)
  if (existsSync(fp)) console.log(`  ${name}: ${(statSync(fp).size / 1048576).toFixed(1)} MB`)
}
for (const d of ['public', 'player']) {
  const fp = path.join(out, d)
  if (existsSync(fp)) console.log(`  ${d}/: ${dirSizeMB(fp)} MB`)
}
