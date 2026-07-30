; VP App 설치기 (Phase 2: Electron 제거 후 node.exe + server.cjs 구성)
; 컴파일: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\vpapp.iss
; 입력: ..\dist-node (scripts\build-node.mjs 산출물)
; 출력: installer\Output\VP-App-Setup-<version>.exe

#define AppName "VP App"
#define AppVersion "0.5.1"
#define AppPublisher "TechData"
#define AppExeName "node.exe"
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
CloseApplicationsFilter=node.exe,vplayer.exe

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Windows 시작 시 자동 실행 (작업 스케줄러)"
Name: "firewall"; Description: "방화벽에서 제어 포트 허용 (3000, 15000, 15001)"

[Files]
; dist-node 전체 (node.exe, server.cjs, public\, player\, ffmpeg\, start.cmd)
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; 콘솔 숨김 실행용 런처 (아래 Code 섹션에서 생성하는 VBS 대신 하드 링크)

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\vpapp-launch.vbs"; IconFilename: "{app}\public\icons\icon.ico"
Name: "{group}\{#AppName} 제거"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\vpapp-launch.vbs"; IconFilename: "{app}\public\icons\icon.ico"

[Run]
; VC++ 재배포 패키지 (vplayer.exe/GStreamer MSVC 런타임 — 앱 로컬 CRT도 있지만 안전차 설치)
; 방화벽 규칙
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App HTTP"" dir=in action=allow protocol=TCP localport=3000"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App TCP Simple"" dir=in action=allow protocol=TCP localport=15000"; Tasks: firewall; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""VP App TCP JSON"" dir=in action=allow protocol=TCP localport=15001"; Tasks: firewall; Flags: runhidden
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

