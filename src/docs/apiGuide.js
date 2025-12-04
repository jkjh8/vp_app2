/**
 * API 사용 가이드
 */

// VP App 터미널 명령어 체계 가이드
export const terminalGuide = {
  overview: {
    title: 'VP App 터미널 명령어 가이드',
    description:
      'TCP(터미널)로 제어할 수 있는 명령어 체계와 예시를 안내합니다.',
    port: 3001,
    protocol: 'TCP',
    lastUpdated: '2025-10-20',
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
      name: 'playid',
      description: 'ID로 파일 재생',
      simple: 'playid,123',
      json: '{"command": "playid", "id": 123}',
      params: [
        { name: 'id', type: 'number', required: true, description: '파일 ID' },
      ],
    },
    {
      name: 'next',
      description: '다음 트랙',
      simple: 'next',
      json: '{"command": "next"}',
      params: [],
    },
    {
      name: 'prev',
      description: '이전 트랙',
      simple: 'prev',
      json: '{"command": "prev"}',
      params: [],
    },
    {
      name: 'updatetime',
      description: '재생 시간 변경',
      simple: 'updatetime,30000',
      json: '{"command": "updatetime", "time": 30000}',
      params: [
        {
          name: 'time',
          type: 'number',
          required: true,
          description: '재생 시간(ms)',
        },
      ],
    },
    {
      name: 'fullscreen',
      description: '전체화면 토글',
      simple: 'fullscreen',
      json: '{"command": "fullscreen"}',
      params: [],
    },
    {
      name: 'getaudiodevices',
      description: '오디오 장치 목록 조회',
      simple: 'getaudiodevices',
      json: '{"command": "getaudiodevices"}',
      params: [],
    },
    {
      name: 'setaudiodevice',
      description: '오디오 장치 설정',
      simple: null,
      json: '{"command": "setaudiodevice", "device": "스피커"}',
      params: [
        {
          name: 'device',
          type: 'string',
          required: true,
          description: '장치명',
        },
      ],
    },
    {
      name: 'playlistplay',
      description: '플레이리스트 재생',
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
          description: '트랙 번호',
        },
      ],
    },
    {
      name: 'imagetime',
      description: '이미지 표시 시간 설정',
      simple: 'imagetime,5000',
      json: '{"command": "imagetime", "time": 5000}',
      params: [
        {
          name: 'time',
          type: 'number',
          required: true,
          description: '표시 시간(ms)',
        },
      ],
    },
    {
      name: 'getfiles',
      description: '파일 목록 조회',
      simple: 'getfiles',
      json: '{"command": "getfiles"}',
      params: [],
    },
    {
      name: 'getplaylists',
      description: '플레이리스트 목록 조회',
      simple: 'getplaylists',
      json: '{"command": "getplaylists"}',
      params: [],
    },
    {
      name: 'getplaylist',
      description: '특정 플레이리스트 조회',
      simple: null,
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
