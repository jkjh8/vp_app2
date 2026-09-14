// 라이브 입력 소스 (RTP/RTSP/SRT) CRUD — 파일(dbFiles)과 별개 축.
// 소스는 "정의"만 저장(주소/프로토콜/코덱 힌트). 실제 재생은 창(window)에 귀속(sourceId)해
// 플레이어의 set_window_source로 지속 레이어를 띄운다(windows.js가 귀속·발신을 담당).
// 이 모듈은 창/플레이어를 모르며(순환 의존 방지), 창 귀속 재적용은 라우트/윈도우 계층이 조율한다.

import { dbSources } from '../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

// udp = 순수 UDP(RTP 헤더 없는 MPEG-TS 등), rtp = RTP. 둘은 전송 방식이 달라 구분한다.
const KINDS = ['rtsp', 'rtp', 'udp', 'srt', 'ndi']

// 저장 레코드 정규화. rtp 하위 필드는 순수 RTP(SDP 없음)에서 사용자가 지정해야 하는 값.
// ndi_name/url_address 는 NDI 송출기 식별자(둘 중 하나).
const normalizeSource = (data = {}) => {
  const rtp = data.rtp || {}
  return {
    id: data.id || uuidv4(),
    name: (data.name && String(data.name).trim()) || 'Live Source',
    kind: KINDS.includes(data.kind) ? data.kind : 'rtsp',
    uri: typeof data.uri === 'string' ? data.uri.trim() : '', // rtsp://… / srt://…
    rtp: {
      address: typeof rtp.address === 'string' ? rtp.address.trim() : '', // 멀티캐스트 그룹(옵션)
      port: Number.isInteger(rtp.port) ? rtp.port : 5004,
      // AUTO = 페이로드 타입으로 depay+코덱 자동 감지(권장, VLC의 MP2T 포함). 그 외 H264|H265|VP8|VP9|JPEG|MP2T
      encoding_name: rtp.encoding_name || 'AUTO',
      payload: Number.isInteger(rtp.payload) ? rtp.payload : 96,
      clock_rate: Number.isInteger(rtp.clock_rate) ? rtp.clock_rate : 90000,
      media: rtp.media || 'video',
    },
    ndi_name: typeof data.ndi_name === 'string' ? data.ndi_name.trim() : '', // NDI 송출기 이름
    url_address: typeof data.url_address === 'string' ? data.url_address.trim() : '', // NDI ip:port
    latency_ms: Number.isFinite(data.latency_ms) ? data.latency_ms : 200,
    has_audio: !!data.has_audio,
    channel_map: Array.isArray(data.channel_map) ? data.channel_map : null,
    volume: Number.isFinite(data.volume) ? data.volume : 100,
    muted: !!data.muted,
  }
}

// 저장 레코드 → 플레이어 set_window_source 의 source 파라미터. 엔진 ParseFileAudio가
// channel_map/volume/muted 를 상단에서 읽으므로 그대로 실어 보낸다.
const toEngineSource = (src) => {
  if (!src) return null
  const out = {
    kind: src.kind,
    latency_ms: Number.isFinite(src.latency_ms) ? src.latency_ms : 200,
    has_audio: !!src.has_audio,
  }
  if (Array.isArray(src.channel_map)) out.channel_map = src.channel_map
  if (Number.isFinite(src.volume)) out.volume = src.volume
  if (src.muted != null) out.muted = !!src.muted
  if (src.kind === 'rtsp' || src.kind === 'srt') {
    out.uri = src.uri || ''
  } else if (src.kind === 'rtp' || src.kind === 'udp') {
    // udp는 코덱 자동(decodebin 타입파인드)이라 address/port만 의미. rtp는 encoding까지 실어보냄.
    const r = src.rtp || {}
    out.rtp = {
      address: r.address || '',
      port: Number.isInteger(r.port) ? r.port : 5004,
      encoding_name: r.encoding_name || 'AUTO',
      payload: Number.isInteger(r.payload) ? r.payload : 96,
      clock_rate: Number.isInteger(r.clock_rate) ? r.clock_rate : 90000,
      media: r.media || 'video',
    }
  } else if (src.kind === 'ndi') {
    out.ndi_name = src.ndi_name || ''
    out.url_address = src.url_address || ''
  }
  return out
}

const listSources = async () => {
  const rows = await dbSources.find({})
  return rows.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))
}
const getSource = async (id) => (id ? dbSources.findOne({ id }) : null)

const createSource = async (data) => {
  const src = normalizeSource(data)
  await dbSources.insert(src)
  return src
}

const updateSource = async (id, patch = {}) => {
  const cur = await dbSources.findOne({ id })
  if (!cur) return null
  const next = normalizeSource({ ...cur, ...patch, id })
  await dbSources.update({ id }, { $set: next })
  return next
}

const deleteSource = async (id) => {
  await dbSources.remove({ id }, {})
  return true
}

export { listSources, getSource, createSource, updateSource, deleteSource, toEngineSource }
