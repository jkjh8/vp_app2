// Phase 2 배포 번들 생성: Electron 제거 → node.exe + 단일 server.cjs.
//
// 산출물 dist-node/:
//   node.exe          stock Node 런타임 (현재 실행 중인 node 복사)
//   server.cjs        전 의존성 번들 (esbuild)
//   public/spa/       vp_ui 빌드 결과 (기존 위치에서 복사)
//   player/           vp_player 네이티브 번들 (vplayer.exe + gst)
//   ffmpeg/           ffmpeg.exe, ffprobe.exe (Phase 2.5에서 제거 예정)
//   start.cmd         개발/수동 실행용 (VP_APP_ROOT 설정 후 node server.cjs)
//
// 사용법: node scripts/build-node.mjs

import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist-node')

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

// --- 3. node.exe (현재 런타임 복사) --------------------------------------------
cpSync(process.execPath, path.join(out, 'node.exe'))

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

// --- 6. ffmpeg / ffprobe (Phase 2.5에서 제거 예정) -----------------------------
mkdirSync(path.join(out, 'ffmpeg'), { recursive: true })
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
if (existsSync(ffmpegPath)) cpSync(ffmpegPath, path.join(out, 'ffmpeg', 'ffmpeg.exe'))
if (existsSync(ffprobePath)) cpSync(ffprobePath, path.join(out, 'ffmpeg', 'ffprobe.exe'))

// --- 7. 수동 실행 스크립트 -----------------------------------------------------
writeFileSync(
  path.join(out, 'start.cmd'),
  [
    '@echo off',
    'setlocal',
    'set VP_APP_ROOT=%~dp0',
    'set VP_PLAYER_ENGINE=native',
    'set PATH=%~dp0player;%PATH%',
    '"%~dp0node.exe" "%~dp0server.cjs"',
  ].join('\r\n') + '\r\n',
)

// 콘솔 창 없이 구동하는 VBS 런처 (자동시작·바로가기 대상). 자기 위치로 VP_APP_ROOT 도출.
writeFileSync(
  path.join(out, 'vpapp-launch.vbs'),
  [
    'Set sh = CreateObject("WScript.Shell")',
    'appRoot = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))',
    'sh.Environment("PROCESS")("VP_APP_ROOT") = appRoot',
    'sh.Environment("PROCESS")("VP_PLAYER_ENGINE") = "native"',
    'sh.CurrentDirectory = appRoot',
    "sh.Run \"\"\"\" & appRoot & \"node.exe\"\" \"\"\" & appRoot & \"server.cjs\"\"\", 0, False",
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
for (const name of ['node.exe', 'server.cjs']) {
  const fp = path.join(out, name)
  if (existsSync(fp)) console.log(`  ${name}: ${(statSync(fp).size / 1048576).toFixed(1)} MB`)
}
for (const d of ['public', 'player', 'ffmpeg']) {
  const fp = path.join(out, d)
  if (existsSync(fp)) console.log(`  ${d}/: ${dirSizeMB(fp)} MB`)
}
