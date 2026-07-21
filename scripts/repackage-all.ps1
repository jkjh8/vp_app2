# VP App 전체 재패키징 — 3개 형제 리포(vp_ui/vp_player/vp_app2)를 순서대로 빌드해
# 최종 설치기(installer\Output\VP-App-Setup-<version>.exe)까지 만든다.
#
# 사용법: vp_app2 리포 루트에서 실행
#   powershell -ExecutionPolicy Bypass -File scripts\repackage-all.ps1
#
# 단계:
#   1. vp_ui   — quasar build + public/spa로 복사 (vp_ui\scripts\copy-to-app.mjs)
#   2. vp_player — CMake Release 빌드 + dist\player\ 번들 (vplayer.exe + GStreamer 플러그인 클로저)
#   3. vp_app2 — esbuild로 server.cjs 번들 + dist-node\ 구성 (scripts\build-node.mjs)
#   4. Inno Setup — dist-node\ → installer\Output\VP-App-Setup-<version>.exe
#      (ISCC.exe가 없으면 이 단계만 건너뛰고 dist-node\ 언팩 상태로 안내)
#
# 전제: vp_ui/vp_player/vp_app2 가 형제 디렉터리로 배치되어 있을 것 (기존 빌드 스크립트들의 상대경로 가정과 동일).

$ErrorActionPreference = "Stop"

$vpApp2 = Split-Path $PSScriptRoot -Parent
$devRoot = Split-Path $vpApp2 -Parent
$vpUi = Join-Path $devRoot "vp_ui"
$vpPlayer = Join-Path $devRoot "vp_player"

function Step($msg) {
  Write-Host ""
  Write-Host "=== $msg ===" -ForegroundColor Cyan
}

# --- 1. vp_ui: SPA 빌드 + public/spa 복사 ---------------------------------------
Step "1/4 vp_ui: SPA 빌드"
if (-not (Test-Path $vpUi)) { throw "vp_ui not found at $vpUi" }
Push-Location $vpUi
npm run build:app
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "vp_ui build:app failed" }
Pop-Location

# --- 2. vp_player: Release 빌드 + 번들 ------------------------------------------
Step "2/4 vp_player: Release 빌드"
if (-not (Test-Path $vpPlayer)) { throw "vp_player not found at $vpPlayer" }
$gstRoot = $env:GSTREAMER_1_0_ROOT_MSVC_X86_64
if (-not $gstRoot) { $gstRoot = "C:\Program Files\gstreamer\1.0\msvc_x86_64" }
$env:PATH = "$gstRoot\bin;$env:PATH"
Push-Location $vpPlayer
cmake --build build --config Release --target vplayer
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "vp_player cmake build failed" }

Step "vp_player: 배포 번들 생성 (dist\player)"
powershell -File scripts\bundle.ps1 -Config Release
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "vp_player bundle.ps1 failed" }
Pop-Location

# --- 3. vp_app2: server.cjs 번들 + dist-node ------------------------------------
Step "3/4 vp_app2: dist-node 번들"
Push-Location $vpApp2
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "vp_app2 build (build-node.mjs) failed" }
Pop-Location

# --- 4. Inno Setup 설치기 ---------------------------------------------------------
Step "4/4 Inno Setup: 설치기 컴파일"
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )
  $iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($iscc) {
  $isccPath = if ($iscc -is [System.Management.Automation.CommandInfo]) { $iscc.Source } else { $iscc }
  Push-Location $vpApp2
  & $isccPath installer\vpapp.iss
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "ISCC.exe compile failed" }
  Pop-Location
  Write-Host ""
  Write-Host "=== 완료: installer\Output\ 에 설치기 생성됨 ===" -ForegroundColor Green
} else {
  Write-Warning "ISCC.exe(Inno Setup 6)를 찾지 못해 설치기 컴파일을 건너뜁니다."
  Write-Warning "https://jrsoftware.org/isdl.php 에서 설치 후 다시 이 스크립트를 실행하거나,"
  Write-Warning "직접 실행: & 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' installer\vpapp.iss"
  Write-Host ""
  Write-Host "=== dist-node\ 는 최신 상태 — 언팩 실행: dist-node\start.cmd ===" -ForegroundColor Yellow
}
