import os, io, sys, json, time, threading, vlc, win32process, win32con
import socket
from PySide6.QtWidgets import QApplication, QMainWindow, QLabel, QVBoxLayout, QWidget, QGraphicsOpacityEffect
from PySide6.QtCore import QTimer, Qt, QThread, Signal
from PySide6.QtGui import QPixmap, QIcon
from PySide6.QtSvgWidgets import QSvgWidget
from PySide6.QtSvg import QSvgRenderer

# 표준 입출력 인코딩 설정
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')

# =====================
# Player 클래스 (미디어 플레이어)
# =====================
#
# 주요 기능:
# - 로고 표시/숨김 및 크기/위치 조정
# - 오디오 디바이스 관리
# - 플레이어 초기화 및 이벤트 연결
# - 미디어(오디오/비디오/이미지) 재생, 정지, 일시정지, 트랙 관리
# - 플레이리스트 모드 및 트랙 전환
# - UI 관련(배경색, 전체화면, 위젯 크기 등)
# - stdin 명령 처리
#
# 함수 그룹핑:
# 1. 명령 처리 및 유틸리티
# 2. 로고 관련 함수
# 3. 이미지 표시/정지 및 타이머
# 4. UI/윈도우 관련 함수
# 5. 오디오 디바이스 관련 함수
# 6. 플레이어 초기화 및 이벤트
# 7. 미디어/플레이어 제어 (set_media, play, stop 등)
# 8. 플레이리스트/트랙 관리
#
# =====================

# =========================
# TCP 소켓 서버 클래스
# =========================
class SocketServer(QThread):
    message_received = Signal(str)
    port_ready = Signal(int)
    
    def __init__(self):
        super().__init__()
        self.running = True
        self.client_socket = None
        self.server_socket = None
        self.port = 0

    def run(self):
        try:
            # TCP 서버 소켓 생성 및 바인딩
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind(('127.0.0.1', 1300))  # 0 = 랜덤 포트 자동 할당
            self.port = self.server_socket.getsockname()[1]
            self.server_socket.listen(1)
            
            # 포트 번호 출력 (Node.js가 읽을 수 있도록)
            print(json.dumps({"type": "port", "data": {"port": self.port}}), flush=True)
            
            # 클라이언트 연결 대기
            self.server_socket.settimeout(1.0)  # 1초 타임아웃
            while self.running:
                try:
                    self.client_socket, addr = self.server_socket.accept()
                    self.client_socket.settimeout(None)
                    print(json.dumps({"type": "info", "data": f"Client connected from {addr}"}), flush=True)
                    
                    # 클라이언트로부터 메시지 수신
                    buffer = ""
                    while self.running:
                        try:
                            data = self.client_socket.recv(4096).decode('utf-8')
                            if not data:
                                print(json.dumps({"type": "warn", "data": "Client disconnected"}), flush=True)
                                break
                            
                            buffer += data
                            # 줄 단위로 메시지 처리
                            while '\n' in buffer:
                                line, buffer = buffer.split('\n', 1)
                                if line.strip():
                                    self.message_received.emit(line.strip())
                        except socket.timeout:
                            continue
                        except Exception as e:
                            print(json.dumps({"type": "error", "data": f"Error receiving data: {e}"}), flush=True)
                            break
                    
                    if self.client_socket:
                        self.client_socket.close()
                        self.client_socket = None
                        
                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        print(json.dumps({"type": "error", "data": f"Error accepting connection: {e}"}), flush=True)
                    break
                    
        except Exception as e:
            print(json.dumps({"type": "error", "data": f"Error starting TCP server: {e}"}), flush=True)
        finally:
            self.cleanup()

    def send_message(self, message):
        """클라이언트에게 메시지 전송"""
        if self.client_socket:
            try:
                self.client_socket.sendall((message + '\n').encode('utf-8'))
            except Exception as e:
                print(json.dumps({"type": "error", "data": f"Error sending message: {e}"}), flush=True)

    def stop(self):
        self.running = False
        self.cleanup()

    def cleanup(self):
        if self.client_socket:
            try:
                self.client_socket.close()
            except:
                pass
            self.client_socket = None
        if self.server_socket:
            try:
                self.server_socket.close()
            except:
                pass
            self.server_socket = None

# =========================
# Player 메인 클래스
# =========================
class Player(QMainWindow):
    def __init__(self, pstatus=None, app_path=None):
        """
        Player 클래스 초기화
        - 윈도우 설정, 프로세스 우선순위, stdin 리더, 아이콘, 상태값, 위젯, 플레이어, 오디오 디바이스 등 초기화
        """
        super().__init__()
        self.setWindowTitle("Media Player")
        self.setGeometry(100, 100, 800, 600)

        # Set process priority
        try:
            win32process.SetPriorityClass(win32process.GetCurrentProcess(), win32con.REALTIME_PRIORITY_CLASS)
            self.print("info", "Process priority set to REALTIME")
        except Exception as e:
            self.print("error", f"Failed to set process priority: {e}")

        # Initialize TCP socket server for receiving commands
        self.socket_server = SocketServer()
        self.socket_server.message_received.connect(self.handle_stdin_message)
        self.socket_server.start()

        # Set window icon
        icon_path = os.path.join(app_path, "src/icon.png")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))
            self.print("info", f"Icon set from {icon_path}")
        else:
            self.print("error", f"Warning: Icon file not found at {icon_path}")

        # Initialize variables from pstatus
        self.pstatus = pstatus or {}
        self.playlist_mode = bool(self.pstatus.get("playlistMode", False))
        self.tracks = []
        self.track_index = int(self.pstatus.get("playlistTrackIndex", 0))
        self.next_track_index = 0
        self.active_player_id = 0 
        self.next_player_index = 1 if self.active_player_id == 0 else 0
        self.audio_devices = []
        self.image_time = int(self.pstatus.get("imageTime", 10))
        self.logo_file = self.pstatus.get("logo", {}).get("file", "")
        self.logo_show = bool(self.pstatus.get("logo", {}).get("show", True))
        self.logo_size = int(self.pstatus.get("logo", {}).get("size", 0))
        self.logo_width = 0
        self.logo_height = 0
        self.logo_svg = self.logo_file.lower().endswith(".svg")
        self.background_color = self.pstatus.get("background", "#000000")
        self.fullscreen = bool(self.pstatus.get("fullscreen", False))
        self.audio_devices = []
        
        self.instances = []
        self.players = []
        self.current_files = [{}, {}]
        
        # Create widgets
        self.player_widgets = [QLabel(self) for _ in range(2)]
        self.logo_widget = QLabel(self)
        self.set_background_color(self.background_color)
        for player in self.player_widgets:
            player.setGeometry(0, 0, self.width(), self.height())
            player.setVisible(False)

        self.set_logo_file(self.logo_file)

        self.update_active_player_id(self.active_player_id)
        
        self.init_players()
        self.init_players_events()
        
        # fullscreen mode
        self.set_fullscreen(self.fullscreen)

        # audio device management
        self.get_audio_devices()
        # set audio device 확인 필요
        self.set_audio_device_result = False
        self.set_audio_device_with_retry(self.pstatus.get("device", {}).get("audiodevice", "default"))
        
        # 이미지 타이머
        self.image_timer_instance = QTimer(self)
        self.image_timer_instance.timeout.connect(lambda: self.on_end_reached(self.active_player_id, None))
        
        # 상태 업데이트 타이머 (100ms마다 플레이어 상태 전송)
        self.status_timer = QTimer(self)
        self.status_timer.timeout.connect(self.send_status)
        self.status_timer.start(100)
        
    # =========================
    # 명령 처리 및 유틸 함수
    # =========================
    # 명령 처리 함수
    def handle_stdin_message(self, data):
        """표준입력으로 들어오는 명령 처리"""
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            self.print("error", "Invalid JSON received from stdin")
            return
        command = data.get("command")
        if not isinstance(command, str):
            self.print("error", f"Invalid command type: {type(command)}. Expected a string.")
            return
        # 짧은 시간 내 중복 메시지 필터링
        current_time = time.time()
        if not hasattr(self, 'last_command_time'):
            self.last_command_time = {}
        last_time = self.last_command_time.get(command, 0)
        if current_time - last_time < 0.1:  # 0.5초 이내 중복 메시지 무시
            self.print("debug", f"Skipping duplicate command within short interval: {command}")
            return
        self.last_command_time[command] = current_time
        # 명령어에 따라 적절한 함수 호출
        dispatch = {
            # logo
            "show_logo": lambda data: self.set_logo_visibility(data.get("show", True)),
            "logo_file": lambda data: self.set_logo_file(data.get("file", "")),
            "logo_size": lambda data: self.set_logo_size(int(data.get("size", 0))),
            # player
            "set_media": lambda data: self.set_media(data.get("file", {}), int(data.get("idx", 0))),
            "playid": lambda data: self.play_id(data.get("file", {})),
            "play": lambda data: self.play(int(data.get("idx", 0))),
            "pause": lambda data: self.pause(int(data.get("idx", 0))),
            "stop": lambda data: self.stop(int(data.get("idx", 0))),
            "stop_all": lambda data: self.stop_all(),
            # audio devices
            "set_audio_device": lambda data: self.set_audio_device(data.get("device_id", "")),
            "get_audio_devices": lambda data: self.get_audio_devices(),
            # playlist
            "playlist_mode": lambda data: self.set_playlist_mode(bool(data.get("value", False))),
            "playlist_play": lambda data: self.playlist_play(int(data.get("idx", 0))),
            "set_tracks": lambda data: self.set_tracks(data.get("tracks", [])),
            "image_time": lambda data: self.set_image_time(int(data.get("time", 0))),
            "set_track_index": lambda data: self.update_track_index(int(data.get("index", 0))),
            "next": lambda data: self.next(),
            "previous": lambda data: self.previous(),
            "set_time": lambda data: self.set_time(int(data.get("time", 0)), int(data.get("idx", 0))),
            # etc
            "set_fullscreen": lambda data: self.set_fullscreen(data.get("value", False)),
            "background_color": lambda data: self.set_background_color(data.get("color", "#000000")),
        }
        func = dispatch.get(command)
        if func:
            try:
                if command == "set_track_index":
                    pass
                func(data)
            except Exception as e:
                self.print("error", f"Error executing command '{command}': {e}")
        else:
            self.print("error", f"Unknown command: {command}")
            
        
    def print(self, type, data):
        """json 포맷으로 메시지 전송 (소켓 + stdout)"""
        message = json.dumps({"type": type, "data": data}, ensure_ascii=False, separators=(",", ":"))
        
        # 소켓으로 전송
        if hasattr(self, 'socket_server') and self.socket_server:
            self.socket_server.send_message(message)
        
        # stdout에도 출력 (디버깅용)
        print(message, flush=True)
        
    def resizeEvent(self, event):
        """윈도우 리사이즈 시 위젯 크기 조정"""
        super().resizeEvent(event)
        for player in self.player_widgets:
            player.setGeometry(0, 0, self.width(), self.height())
        for idx in range(len(self.player_widgets)):
            self.apply_image_layout(idx)
        self.apply_logo_layout()

    def closeEvent(self, event):
        """창 닫기 시 프로세스 종료"""
        self.print("info", "Closing player window, terminating process.")
        
        # 타이머 정리
        if hasattr(self, 'status_timer') and self.status_timer:
            self.status_timer.stop()
        if hasattr(self, 'image_timer_instance') and self.image_timer_instance:
            self.image_timer_instance.stop()
        
        # 소켓 서버 정리
        if hasattr(self, 'socket_server') and self.socket_server:
            self.socket_server.stop()
        
        sys.exit(0)
        
    def update_image_size(self):
        """이미지 위젯 크기 동기화 (중복 제거)"""
        for idx in range(len(self.player_widgets)):
            self.apply_image_layout(idx)

    def update_widget_sizes(self, event):
        for player in self.player_widgets:
            player.setGeometry(0, 0, self.width(), self.height())
        self.update_image_size()

    # =========================
    # 공통 위젯 레이아웃/가시성 헬퍼 함수
    # =========================
    def apply_logo_layout(self):
        """로고 위젯의 크기, 위치, 가시성 일괄 적용"""
        if not hasattr(self, 'logo_widget') or not self.logo_widget:
            return
        logo_x = (self.width() - self.logo_width) // 2
        logo_y = (self.height() - self.logo_height) // 2
        self.logo_widget.setGeometry(logo_x, logo_y, self.logo_width, self.logo_height)
        self.logo_widget.setVisible(self.logo_show)

    def apply_image_layout(self, idx):
        """이미지 위젯의 크기, 정렬 일괄 적용"""
        widget = self.player_widgets[idx]
        if hasattr(widget, 'original_pixmap') and widget.original_pixmap:
            pixmap = widget.original_pixmap
            scaled_pixmap = pixmap.scaled(
                widget.width(), widget.height(), Qt.KeepAspectRatio, Qt.SmoothTransformation
            )
            widget.setPixmap(scaled_pixmap)
            widget.setAlignment(Qt.AlignCenter)

    # =========================
    # 로고 관련 함수 (중복 제거)
    # =========================
    def set_logo_center(self):
        self.apply_logo_layout()

    def set_logo_size(self, size):
        try:
            self.logo_size = size
            self.update_logo_size()
        except Exception as e:
            self.print("error", f"Error setting logo size: {e}")

    def update_logo_size(self):
        if not self.logo_file or not os.path.exists(self.logo_file):
            self.print("error", "Logo file does not exist or path is empty.")
            return
        if self.logo_svg:
            try:
                svg_renderer = QSvgRenderer(self.logo_file)
                if not svg_renderer.isValid():
                    self.print("error", "Failed to load SVG logo file.")
                    return
                original_width = svg_renderer.defaultSize().width()
                original_height = svg_renderer.defaultSize().height()
                if self.logo_size > 0:
                    self.logo_width = self.logo_size
                    self.logo_height = int(original_height * (self.logo_size / original_width))
                else:
                    self.logo_width = original_width
                    self.logo_height = original_height
            except Exception as e:
                self.print("error", f"Error loading SVG logo: {e}")
        else:
            pixmap = QPixmap(self.logo_file)
            if pixmap.isNull():
                self.print("error", "Failed to load Pixmap logo file.")
                return
            original_width = pixmap.width()
            original_height = pixmap.height()
            if self.logo_size > 0:
                self.logo_width = self.logo_size
                self.logo_height = int(original_height * (self.logo_size / original_width))
            else:
                self.logo_width = original_width
                self.logo_height = original_height
        self.print("debug", f"Logo size updated: width={self.logo_width}, height={self.logo_height}")
        self.apply_logo_layout()

    def set_logo_file(self, file_path):
        if not hasattr(self, 'logo_widget') or self.logo_widget is None:
            self.logo_widget = QLabel(self)
            self.print("debug", "Logo widget initialized.")
        if hasattr(self, 'logo_widget') and self.logo_widget:
            self.logo_widget.setVisible(False)
            self.logo_widget.deleteLater()
            self.logo_widget = None
        self.logo_file = file_path
        self.logo_svg = self.logo_file.lower().endswith(".svg")
        self.print("debug", f"Logo file set to: {self.logo_file}")
        self.update_logo_size()
        if self.logo_svg:
            try:
                self.logo_widget = QSvgWidget(self.logo_file, self)
            except Exception as e:
                self.print("error", f"Failed to initialize SVG logo widget: {e}")
                return
        else:
            try:
                pixmap = QPixmap(self.logo_file)
                if not pixmap.isNull():
                    self.logo_widget = QLabel(self)
                    self.logo_widget.setPixmap(
                        pixmap.scaled(
                            self.logo_width,
                            self.logo_height,
                            Qt.KeepAspectRatio,
                            Qt.SmoothTransformation,
                        )
                    )
                else:
                    self.print("error", "Pixmap is null. Failed to load image.")
                    return
            except Exception as e:
                self.print("error", f"Failed to initialize Pixmap logo widget: {e}")
                return
        self.apply_logo_layout()

    def set_logo_visibility(self, visible):
        self.logo_show = visible
        self.apply_logo_layout()
        self.print("debug", f"Logo visibility set to: {visible}")

    # =========================
    # 이미지 표시/정지 및 타이머 (중복 제거)
    # =========================
    def display_image(self, file, idx=None):
        idx = self.active_player_id if idx is None else idx
        image_path = file.get("path")
        try:
            self.stop(idx)
            widget = self.player_widgets[idx]
            if not hasattr(widget, 'original_pixmap') or not isinstance(widget.original_pixmap, QPixmap):
                pixmap = QPixmap(image_path)
                if pixmap.isNull():
                    self.print("error", f"Failed to load image: {image_path}")
                    return
                widget.original_pixmap = pixmap
            else:
                pixmap = widget.original_pixmap
            self.print('media_changed', { "idx": idx, "uuid": file.get("uuid", ""), "path": image_path })
            self.apply_image_layout(idx)
            if not self.playlist_mode:
                widget.setVisible(True)
            self.print("player_data", {
                "id": idx,
                "event": "display_image",
                "media": image_path,
                "state": "displaying_image",
                "time": 0,
                "duration": 0,
                "position": 0,
                "is_playing": 1,
            })
        except Exception as e:
            self.print("error", f"Error displaying image: {e}")

    def stop_image(self, idx=None):
        if self.image_timer_instance.isActive():
            self.image_timer_instance.stop()
        idx = self.active_player_id if idx is None else idx
        widget = self.player_widgets[idx]
        widget.clear()
        widget.setVisible(False)
        if hasattr(widget, 'original_pixmap'):
            del widget.original_pixmap
        self.print("player_data", {
            "id": idx,
            "event": "stop_image",
            "media": "",
            "state": "stopped_image",
            "time": 0,
            "duration": 0,
            "position": 0,
            "is_playing": 0,
        })
        
    def set_image_time(self, time):
        """이미지 표시 시간 설정"""
        self.image_time = time
        self.print("set_image_time", {"value" : self.image_time})

    def image_timer(self):
        """이미지 재생 타이머 설정"""
        timer = self.image_timer_instance

        if timer.isActive():
            timer.stop()
            try:
                timer.timeout.disconnect()
                self.print("debug", "Existing image timer stopped and disconnected.")
            except RuntimeError:
                self.print("debug", "Timeout signal not connected, skipping disconnect.")

        if not self.playlist_mode:
            self.print("error", "Image timer can only be set in playlist mode.")
            return

        if not self.tracks or self.track_index >= len(self.tracks):
            self.print("debug", "Playlist is empty or index is out of range.")
            return

        current_file = self.current_files[self.active_player_id]
        if not current_file.get("is_image", False):
            self.print("debug", "Current file is not an image, skipping image timer setup.")
            return

        show_time = current_file.get("time")
        if show_time is None or show_time <= 0:
            self.print("debug", "Invalid show time for image, using default of 5 seconds.")
            show_time = self.image_time
        timer.start(show_time * 1000)
        self.print("debug", f"Image timer started for {show_time} seconds.")

    # =========================
    # UI/윈도우 관련 함수
    # =========================
    def set_background_color(self, color):
        """배경색 설정"""
        self.background_color = color
        self.setStyleSheet(f"background-color: {self.background_color};")  # 메인 윈도우 배경색 변경
        for widget in self.player_widgets:
            widget.setStyleSheet(f"background-color: {self.background_color};")

    def set_fullscreen(self, value):
        """전체화면 모드 설정"""
        if value:
            self.showFullScreen()
        else:
            self.showNormal()
        for player in self.players:
            player.set_fullscreen(value)
        self.print("set_fullscreen", { "value": value })
        
    def fade_transition(self, idx):
        """플레이어 전환 및 로고 표시/숨김"""
        from_id = 1 if idx == 0 else 0  # 현재 동작 중인 위젯의 인덱스
        from_widget = self.player_widgets[from_id]  # 현재 동작 중인 위젯
        to_widget = self.player_widgets[idx]
        to_file = self.current_files[idx] if self.current_files and len(self.current_files) > idx else {}
        mimetype = to_file.get("mimetype", "")

        # 미디어 타입에 따라 로고 표시/숨김
        if mimetype.startswith("audio/"):
            self.stop(from_id)
            to_widget.setVisible(False)
            from_widget.setVisible(False)
            for player_widget in self.player_widgets:
                player_widget.setVisible(False)
                self.logo_widget.raise_() # Bring the logo widget to the front
            if self.logo_widget and self.logo_show:
                self.set_logo_visibility(True)
            else:
                # 나머지 경우 모든 위젯 숨김
                from_widget.setVisible(False)
            self.print("debug", f"fade_transition: Audio file detected (mimetype: {mimetype}). Logo will be shown.")
        else:
            self.set_logo_visibility(False)
            self.print("debug", f"fade_transition: Non-audio file (mimetype: {mimetype}). Logo will be hidden.")
            to_widget.setVisible(True)  # Ensure the target widget is visible before fading in
            to_widget.raise_()  # Bring the target widget to the front

        self.update_active_player_id(idx)  # Update the active player ID
        
        from_widget.setVisible(False)
        if hasattr(from_widget, 'original_pixmap'):
            self.stop_image(from_id)  # Stop displaying image if it exists
        if self.players[from_id].is_playing():
            self.players[from_id].stop()
            
    # =========================
    # 오디오 디바이스 관련 함수
    # =========================
    def set_audio_device_with_retry(self, device_id, retry_interval=2, max_retries=3):
        """오디오 디바이스 설정(재시도 포함)"""
        def retry_logic():
            retries = 0
            while retries < max_retries:
                self.set_audio_device(device_id)
                if self.set_audio_device_result:
                    self.print("debug", f"Audio device successfully set to: {device_id}")
                    return
                self.print("warn", f"Retrying to set audio device: {device_id} (Attempt {retries + 1}/{max_retries})")
                retries += 1
                time.sleep(retry_interval)
            self.print("error", f"Failed to set audio device after {max_retries} attempts.")
        threading.Thread(target=retry_logic).start()

    def set_audio_device(self, device_id):
        """오디오 디바이스 설정"""
        try:
            for player in self.players:
                result = player.audio_output_device_set(None, device_id if device_id else None)
                if result is not None and result != 0:
                    self.print("error", f"Failed to set audio device: {device_id}. VLC returned: {result}")
                    self.set_audio_device_result = False
                    return
            self.set_audio_device_result = True
            self.print("debug", f"Audio device successfully set to: {device_id}")
        except Exception as e:
            self.print("error", f"Error setting audio device: {e}")
            self.set_audio_device_result = False

    def get_audio_devices(self):
        """오디오 디바이스 목록 반환"""
        try:
            devices = []
            player = self.players[0] if self.players else vlc.MediaPlayer()
            if not player:
                self.print("error", "No player available to get audio devices.")
                return []
            dev_list = player.audio_output_device_enum()
            if dev_list:
                dev = dev_list
                while dev:
                    dev_info = dev.contents
                    devices.append({
                        "deviceid": dev_info.device.decode() if dev_info.device else "default",
                        "name": dev_info.description.decode() if dev_info.description else "기본 장치"
                    })
                    dev = dev_info.next
            self.print("audiodevices", {"devices": devices})
            return devices
        except Exception as e:
            self.print("error", {"message": f"Error getting audio devices: {e}"})
            return []

    # =========================
    # 플레이어 초기화 및 이벤트
    # =========================
    def init_players(self):
        """VLC 플레이어 인스턴스 및 위젯 초기화"""
        self.print("info", f"Initializing VLC players...")
        vlc_args = [
            "--no-video-title-show",
            "--avcodec-hw=any",
            "--no-drop-late-frames",
            "--no-skip-frames"
        ]
        self.instances = [vlc.Instance(*vlc_args) for _ in range(2)]
        self.players = [instance.media_player_new() for instance in self.instances]
        for idx, player in enumerate(self.players):
            player.set_hwnd(int(self.player_widgets[idx].winId()))
            player.audio_output_device_set(None, self.pstatus.get("device", {}).get("audiodevice", "default"))
            player.audio_set_volume(100)

    def init_players_events(self):
        """VLC 플레이어 이벤트 핸들러 등록"""
        try:
            def make_handler(func, *args):
                def handler(event):
                    try:
                        func(*args, event)
                    except Exception as e:
                        print(f"Error in handler: {e}")
                return handler
            for idx, player in enumerate(self.players):
                em = player.event_manager()
                em.event_detach(vlc.EventType.MediaPlayerEndReached)
                em.event_attach(
                    vlc.EventType.MediaPlayerEndReached,
                    make_handler(self.on_end_reached, idx)
                )
                em.event_attach(
                    vlc.EventType.MediaPlayerEncounteredError,
                    lambda event, id=idx: self.print("error", f"Player {id} encountered an error.")
                )
                for event_type in [
                    vlc.EventType.MediaPlayerTimeChanged,
                    vlc.EventType.MediaPlayerPlaying,
                    vlc.EventType.MediaPlayerPaused,
                    vlc.EventType.MediaPlayerStopped,
                ]:
                    em.event_attach(
                        event_type,
                        make_handler(self.update_player_data, idx)
                    )
        except Exception as e:
            self.print("error", f"Error initializing player events: {e}")
        
    def update_active_player_id(self, idx):
        """활성 플레이어 인덱스 갱신"""
        self.active_player_id = idx
        self.print("active_player_id", { "value": self.active_player_id })
        
    # =========================
    # 미디어/플레이어 제어
    # =========================
    def set_media(self, file, idx):
        """플레이어에 미디어 파일 설정"""
        if idx < 0 or idx >= len(self.players):
            self.print("error", "Invalid player index provided.")
            return
        if not file:
            self.print("error", "No file provided to set media.")
            return

        media_path = file.get("path", "")
        if not media_path:
            self.print("error", "Invalid media path provided.")
            return

        # Update the current file for the player
        self.current_files[idx] = file

        try:
            if file.get("is_image", True):
                # Efficiently display image
                self.display_image(file, idx)
            else:
                # Only set media if it's different from current
                current_media = self.players[idx].get_media()
                if not current_media or current_media.get_mrl() != media_path:
                    media = self.players[idx].get_instance().media_new(media_path)
                    self.players[idx].set_media(media)
                self.print('media_changed', { "idx": idx, "uuid": file.get("uuid", ""), "path": media_path })
                self.update_player_data(idx, None)
        except Exception as e:
            self.print("error", f"Error setting media: {e}")
            
    def play(self, idx=0):
        """플레이어 재생"""
        if self.active_player_id != idx:
            self.update_active_player_id(idx)

        if self.current_files[idx].get("is_image", True):
            # 이미지 재생
            self.display_image(self.current_files[idx], idx)
            return
        else:
            # 미디어 재생
            self.players[idx].play()

        # 해당 플레이어의 위젯이 숨김 상태면 활성화 하기
        if not self.player_widgets[idx].isVisible():
            # 트랜지션(페이드 효과)으로 위젯 전환
            self.fade_transition(idx)

    def play_id(self, file):
        """특정 파일 재생"""
        idx = self.active_player_id

        # Determine next available player index if current is busy
        if len(self.players) < 2 or len(self.player_widgets) < 2:
            self.print("error", "Player or widget list is not properly initialized.")
            return

        if idx not in [0, 1]:
            self.print("error", f"Invalid player index: {idx}")
            return

        if self.players[idx].is_playing() or (self.player_widgets[idx].isVisible() and self.player_widgets[idx].pixmap()):
            idx = 1 if idx == 0 else 0

        if idx < 0 or idx >= len(self.players):
            self.print("error", f"play_id: idx {idx} out of range for players list.")
            return

        # set Media file for the player
        self.set_media(file, idx)
        self.update_active_player_id(idx)

        try:
            if file.get("is_image") == False:
                self.players[idx].play()
            self.fade_transition(idx)
        except Exception as e:
            self.print("error", f"Error playing file: {e}")

    def on_end_reached(self, idx, event):
        """재생 종료 이벤트 처리"""
        try:
            self.update_player_data(idx, event)
            self.print('end_reached', {
                "playlist_track_index": self.track_index,
                "active_player_id": self.active_player_id,
            })
        except Exception as e:
            self.print("error", f"Error handling end reached event: {e}")
            

    def pause(self, idx=0):
        """플레이어 일시정지"""
        if idx < 0 or idx >= len(self.players):
            self.print("error", f"Invalid player index: {idx}")
            return
        self.players[self.active_player_id].pause()
            
    def stop(self, idx=None):
        """플레이어 정지"""
        if idx is None:
            idx = self.active_player_id
        if self.current_files[idx].get("is_image", True):
            self.stop_image(idx)
        else :
            self.players[idx].stop()
        self.player_widgets[idx].setVisible(False)  # Hide the player widget
        self.set_logo_center()
        
    def stop_all(self):
        """모든 플레이어 정지"""
        # 모든 플레이어 중지 및 위젯 숨김
        for idx in range(len(self.player_widgets)):
            self.stop(idx)
                    
    def update_player_data(self, id, event):
        """플레이어 상태 정보 갱신"""
        try:
            player = self.players[id]
            media = player.get_media()
            data = {
                "id": id,
                "event": str(event.type if event else "None"),
                "media": media.get_mrl() if media else "No media",
                "state": str(player.get_state()),
                "time": player.get_time(),
                "duration": player.get_length(),
                "position": player.get_position(),
                "volume": player.audio_get_volume(),
                "rate": player.get_rate(),
                "is_playing": player.is_playing(),
                "fullscreen": player.get_fullscreen(),
            }
            self.print("player_data", data)
        except Exception as e:
            self.print("error", f"Error updating player data: {e}")

    def send_status(self):
        """활성 플레이어 상태 주기적 전송 (타이머용)"""
        try:
            if not hasattr(self, 'players') or not self.players:
                return
            
            idx = self.active_player_id
            if idx >= len(self.players):
                return
            
            player = self.players[idx]
            if player.is_playing():
                data = {
                    "id": idx,
                    "event": "TimeChanged",
                    "time": player.get_time(),
                    "duration": player.get_length(),
                    "position": player.get_position(),
                    "is_playing": True,
                    "state": str(player.get_state()),
                }
                self.print("player_data", data)
        except Exception as e:
            # 타이머에서 호출되므로 에러를 조용히 무시
            pass

    def set_time(self, time, idx=None):
        """플레이어 재생 위치 설정"""
        idx = self.active_player_id if idx is None else idx

        if not isinstance(time, int) or time < 0:
            self.print("error", "Invalid time value provided.")
            return

        try:
            self.players[idx].set_time(time)
        except Exception as e:
            self.print("error", f"Error setting time for player {idx}: {e}")

    # =========================
    # 플레이리스트/트랙 관리
    # =========================
    def set_playlist_mode(self, value):
        """플레이리스트 모드 설정"""
        self.print("debug", f"Setting playlist mode to: {value}")
        self.playlist_mode = value
        
    def set_tracks(self, tracks):
        """트랙 리스트 설정"""
        if not isinstance(tracks, list):
            self.print("error", "Invalid tracks format, expected a list.")
            return

        self.tracks = tracks
            
    def update_track_index(self, idx):
        """트랙 인덱스 갱신"""
        if idx < 0 or idx >= len(self.tracks):
            self.print("error", f"Invalid track index: {idx}")
            return
        self.track_index = idx
        self.print("track_index", { "value": self.track_index })

    def playlist_play(self, idx = 0):
        """플레이리스트 재생"""
        if idx is not None:
            if idx < 0 or idx >= len(self.tracks):
                self.print("error", f"Invalid playlist index: {idx}")
                return
            self.update_track_index(idx)
        if not self.tracks or self.track_index >= len(self.tracks):
            self.print("error", "Playlist is empty or index out of range.")
            return

        file = self.tracks[self.track_index]
        self.play_id(file)
        # set next track load next player
        self.next_file_load()
        self.image_timer()
            
    def next(self):
        """다음 트랙 재생"""
        if not self.playlist_mode:
            self.print("error", "Next track can only be used in playlist mode.")
            return

        if self.image_timer_instance.isActive():
            self.image_timer_instance.stop()
            self.print("debug", "Existing image timer stopped.")

        if not self.current_files[self.next_player_index].get("is_image"):
            self.players[self.next_player_index].play()

        self.fade_transition(self.next_player_index)
        self.track_index = self.next_track_index  # Update track_index for image playback
        self.update_track_index(self.track_index)
        self.next_file_load()
        self.image_timer()

    def previous(self):
        """이전 트랙 재생"""
        if not self.playlist_mode:
            self.print("error", "Previous track can only be used in playlist mode.")
            return

        if self.players[self.active_player_id].get_time() > 5000:
            self.players[self.active_player_id].set_time(0)
            return

        if self.image_timer_instance.isActive():
            self.image_timer_instance.stop()
            self.print("debug", "Existing image timer stopped.")

        # Calculate previous track index
        self.track_index -= 1
        if self.track_index < 0:
            self.track_index = len(self.tracks) - 1

        self.playlist_play(self.track_index)

    def next_file_load(self, idx=None):
        """다음 파일 미리 로드"""
        self.print("warn", f"Current track index: {self.track_index}, Next track index: {self.next_track_index}")

        if idx is not None:
            self.next_track_index = idx
        else:
            self.next_track_index = self.track_index + 1

        if self.next_track_index >= len(self.tracks):
            self.next_track_index = 0

        self.next_player_index = 1 if self.active_player_id == 0 else 0
        self.set_media(self.tracks[self.next_track_index], self.next_player_index)

if __name__ == "__main__":
    vp_pstatus_json = os.environ.get("VP_PSTATUS")
    app_path = os.environ.get("APP_PATH", "")
    app = QApplication(sys.argv)
    player = Player(pstatus=json.loads(vp_pstatus_json) if vp_pstatus_json else {}, app_path=app_path)
    player.show()
    sys.exit(app.exec())