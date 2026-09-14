; VP App 설치기 (Phase 2: Electron 제거 후 VPApp.exe[브랜드된 node] + server.cjs 구성)
; 컴파일: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\vpapp.iss
; 입력: ..\dist-node (scripts\build-node.mjs 산출물)
; 출력: installer\Output\VP-App-Setup-<version>.exe

#define AppName "VP App"
#define AppVersion "0.7.0"
#define AppPublisher "TechData"
#define AppExeName "VPApp.exe"
#define SrcDir "..\dist-node"

[Setup]
AppId={{8F3B2A10-VP01-4C7E-9A2D-VPAPP0000001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\public\icons\icon.ico
OutputDir=Output
OutputBaseFilename=VP-App-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
; 서버가 실행 중이면 파일 잠금 → 설치/제거 시 자동 종료
CloseApplications=yes
CloseApplicationsFilter=VPApp.exe,vplayer.exe

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Windows 시작 시 자동 실행 (작업 스케줄러)"
Name: "firewall"; Description: "방화벽에서 제어/동기 포트 허용 (TCP 3000/15000/15001, PTP UDP 319/320, 동기 UDP 15002-15004)"

[Files]
; dist-node 전체 (VPApp.exe, server.cjs, public\, player\, start.cmd,
;  THIRD-PARTY-NOTICES.md, THIRD-PARTY-LICENSES\, player\licenses\ — LGPL 고지 포함)
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; 콘솔 숨김 실행용 런처 (아래 Code 섹션에서 생성하는 VBS 대신 하드 링크)

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\vpapp-launch.vbs"; IconFilename: "{app}\public\icons\icon.ico"
Name: "{group}\{#AppName} 제거"; Filename: "{uninstallexe}"
Name: "{group}\라이센스 고지 (Third-Party Licenses)"; Filename: "{app}\THIRD-PARTY-NOTICES.md"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\vpapp-launch.vbs"; IconFilename: "{app}\public\icons\icon.ico"

[Run]
; VC++ 재배포 패키지 (vplayer.exe/GStreamer MSVC 런타임 — 앱 로컬 CRT도 있지만 안전차 설치)
; 방화벽 규칙
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App HTTP"" dir=in action=allow protocol=TCP localport=3000"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App TCP Simple"" dir=in action=allow protocol=TCP localport=15000"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App TCP JSON"" dir=in action=allow protocol=TCP localport=15001"; Tasks: firewall; Flags: runhidden
; 멀티 PC 동기 UDP — PTP(319/320) + 트리거(15002)/디스커버리(15003)/넷클럭(15004)
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App PTP"" dir=in action=allow protocol=UDP localport=319,320"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App Sync"" dir=in action=allow protocol=UDP localport=15002-15004"; Tasks: firewall; Flags: runhidden
; 프로그램 단위 허용 — Windows 첫 실행 시 "Node.js 허용?" 팝업을 방지하고, 방화벽 목록에 앱 이름으로 표시.
; PTP는 GStreamer 헬퍼(gst-ptp-helper.exe)가 UDP 319/320을 바인딩하므로 반드시 함께 등록.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App (Server)"" dir=in action=allow program=""{app}\VPApp.exe"" enable=yes profile=any"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App (Player)"" dir=in action=allow program=""{app}\player\vplayer.exe"" enable=yes profile=any"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App (PTP Helper)"" dir=in action=allow program=""{app}\player\gst-ptp-helper.exe"" enable=yes profile=any"; Tasks: firewall; Flags: runhidden
; 자동시작 작업 등록 (로그온 시, 콘솔 숨김, 최고 권한)
Filename: "{sys}\schtasks.exe"; Parameters: "/Create /F /TN ""VP App"" /SC ONLOGON /RL HIGHEST /TR ""wscript.exe \""{app}\vpapp-launch.vbs\"""""; Tasks: autostart; Flags: runhidden
; 설치 직후 바로 실행
Filename: "{app}\vpapp-launch.vbs"; Description: "지금 VP App 실행"; Flags: postinstall nowait runasoriginaluser shellexec skipifsilent

; 참고: vpapp-launch.vbs 는 scripts\build-node.mjs 가 dist-node 에 생성해 [Files]로 복사됨

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /F /TN ""VP App"""; Flags: runhidden; RunOnceId: "DelTask"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App HTTP"""; Flags: runhidden; RunOnceId: "DelFw1"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App TCP Simple"""; Flags: runhidden; RunOnceId: "DelFw2"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App TCP JSON"""; Flags: runhidden; RunOnceId: "DelFw3"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App PTP"""; Flags: runhidden; RunOnceId: "DelFw4"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App Sync"""; Flags: runhidden; RunOnceId: "DelFw5"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App (Server)"""; Flags: runhidden; RunOnceId: "DelFw6"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App (Player)"""; Flags: runhidden; RunOnceId: "DelFw7"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VP App (PTP Helper)"""; Flags: runhidden; RunOnceId: "DelFw8"

