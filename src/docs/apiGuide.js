/**
 * 터미널 명령어 가이드
 */

// VP App 터미널 명령어 체계 가이드
export const terminalGuide = {
  overview: {
    title: 'VP App 터미널 명령어 가이드',
    description:
      'TCP(터미널)로 제어할 수 있는 명령어 체계와 예시를 안내합니다.',
    port: 3001,
    protocol: 'TCP',
    lastUpdated: '2025-12-04',
  },

  commandFormat: [
    {
      type: 'simple',
      title: '간단한 명령어 형식',
      description: '쉼표로 구분된 텍스트 명령어. 예: play, playid,123',
      format: 'command[,value1[,value2]]',
      examples: [
        'play',
        'pause',
        'playid,123',
        'updatetime,30000',
        'playlistplay,1,2',
        'getplaylist,1',
      ],
    },
    {
      type: 'json',
      title: 'JSON 명령어 형식',
      description:
        'JSON 객체로 명령 전달. 예: {"command": "playid", "id": 123}',
      format: '{"command": "commandName", ...}',
      examples: [
        '{"command": "play"}',
        '{"command": "pause"}',
        '{"command": "playid", "id": 123}',
        '{"command": "setaudiodevice", "device": "스피커"}',
        '{"command": "setrepeat", "mode": "all"}',
      ],
    },
  ],

  commands: [
    {
      name: 'play',
      description: '현재 미디어 재생',
      simple: 'play',
      json: '{"command": "play"}',
      params: [],
    },
    {
      name: 'pause',
      description: '일시정지',
      simple: 'pause',
      json: '{"command": "pause"}',
      params: [],
    },
    {
      name: 'stop',
      description: '정지',
      simple: 'stop',
      json: '{"command": "stop"}',
      params: [],
    },
    {
      name: 'playfile',
      description: '파일명으로 재생',
      simple: 'playfile,video.mp4',
      json: '{"command": "playfile", "file": "video.mp4"}',
      params: [
        {
          name: 'file',
          type: 'string',
          required: true,
          description: '파일명',
        },
      ],
    },
    {
      name: 'playid',
      description: 'UUID로 파일 재생',
      simple: 'playid,uuid-string',
      json: '{"command": "playid", "id": "uuid-string"}',
      params: [
        {
          name: 'id',
          type: 'string',
          required: true,
          description: '파일 UUID',
        },
      ],
    },
    {
      name: 'next',
      description: '다음 트랙으로 이동',
      simple: 'next',
      json: '{"command": "next"}',
      params: [],
    },
    {
      name: 'prev',
      description: '이전 트랙으로 이동',
      simple: 'prev',
      json: '{"command": "prev"}',
      params: [],
    },
    {
      name: 'updatetime',
      description: '재생 시간 변경 (밀리초)',
      simple: 'updatetime,30000',
      json: '{"command": "updatetime", "time": 30000}',
      params: [
        {
          name: 'time',
          type: 'number',
          required: true,
          description: '재생 시간(밀리초)',
        },
      ],
    },
    {
      name: 'fullscreen',
      description: '전체화면 토글 또는 설정',
      simple: 'fullscreen',
      json: '{"command": "fullscreen", "fullscreen": true}',
      params: [
        {
          name: 'fullscreen',
          type: 'boolean',
          required: false,
          description: '전체화면 여부 (생략 시 토글)',
        },
      ],
    },
    {
      name: 'togglefullscreen',
      description: '전체화면 토글',
      simple: 'togglefullscreen',
      json: '{"command": "togglefullscreen"}',
      params: [],
    },
    {
      name: 'setrepeat',
      description:
        '반복 모드 설정 (none, all, repeat_one). 플레이리스트 모드가 아닐 때는 repeat_one 사용 불가',
      simple: 'setrepeat,all',
      json: '{"command": "setrepeat", "mode": "all"}',
      params: [
        {
          name: 'mode',
          type: 'string',
          required: false,
          description:
            '반복 모드 (none/all/repeat_one, 생략 시 다음 모드로 토글)',
        },
      ],
    },
    {
      name: 'getrepeat',
      description: '현재 반복 모드 조회',
      simple: 'getrepeat',
      json: '{"command": "getrepeat"}',
      params: [],
    },
    {
      name: 'getaudiodevices',
      description: '사용 가능한 오디오 장치 목록 조회',
      simple: 'getaudiodevices',
      json: '{"command": "getaudiodevices"}',
      params: [],
    },
    {
      name: 'getaudiodevice',
      description: '현재 오디오 장치 조회',
      simple: 'getaudiodevice',
      json: '{"command": "getaudiodevice"}',
      params: [],
    },
    {
      name: 'setaudiodevice',
      description: '오디오 장치 설정',
      simple: 'setaudiodevice,스피커',
      json: '{"command": "setaudiodevice", "device": "스피커"}',
      params: [
        {
          name: 'device',
          type: 'string',
          required: true,
          description: '설정할 오디오 장치명',
        },
      ],
    },
    {
      name: 'playlistplay',
      description: '플레이리스트 재생 (ID와 시작 트랙 번호)',
      simple: 'playlistplay,1,2',
      json: '{"command": "playlistplay", "id": 1, "track": 2}',
      params: [
        {
          name: 'id',
          type: 'number',
          required: true,
          description: '플레이리스트 ID',
        },
        {
          name: 'track',
          type: 'number',
          required: false,
          description: '시작 트랙 인덱스 (기본값: 0)',
        },
      ],
    },
    {
      name: 'imagetime',
      description: '플레이리스트 이미지 표시 시간 설정 (밀리초)',
      simple: 'imagetime,5000',
      json: '{"command": "imagetime", "time": 5000}',
      params: [
        {
          name: 'time',
          type: 'number',
          required: true,
          description: '이미지 표시 시간(밀리초)',
        },
      ],
    },
    {
      name: 'getfiles',
      description: '모든 파일 목록 조회',
      simple: 'getfiles',
      json: '{"command": "getfiles"}',
      params: [],
    },
    {
      name: 'getplaylists',
      description:
        '모든 플레이리스트 목록 조회 (간소화된 트랙 정보 포함: uuid, filename, time, mimetype, duration, trackId)',
      simple: 'getplaylists',
      json: '{"command": "getplaylists"}',
      params: [],
    },
    {
      name: 'getplaylist',
      description:
        '특정 플레이리스트 조회 (간소화된 트랙 정보 포함: uuid, filename, time, mimetype, duration, trackId)',
      simple: 'getplaylist,1',
      json: '{"command": "getplaylist", "id": 1}',
      params: [
        {
          name: 'id',
          type: 'number',
          required: true,
          description: '플레이리스트 ID',
        },
      ],
    },
  ],

  example: {
    title: 'TCP 클라이언트 예제',
    code: `const net = require('net');

const client = new net.Socket();
client.connect(3001, 'localhost', () => {
  console.log('TCP 서버에 연결됨');
  // 간단한 명령
  client.write('play\n');
  // JSON 명령
  client.write(JSON.stringify({ command: 'playid', id: 123 }) + '\n');
});

client.on('data', (data) => {
  console.log('서버 응답:', data.toString());
});

client.on('close', () => {
  console.log('연결 종료');
});`,
  },

  troubleshooting: [
    {
      issue: '연결이 거부됨',
      solution: '서버가 실행 중인지, 포트(3001)가 열려있는지 확인하세요.',
    },
    {
      issue: '명령이 실행되지 않음',
      solution:
        '명령어 형식(간단/JSON)이 올바른지, 줄바꿈(\n) 포함 여부를 확인하세요.',
    },
    {
      issue: 'JSON 파싱 오류',
      solution: 'JSON 명령어는 반드시 올바른 JSON 문자열이어야 합니다.',
    },
  ],
}

export default terminalGuide
