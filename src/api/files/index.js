import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../../logger/index.js'

import { getTmpPath, getMediaPath } from './folders.js'
import { playerRequest } from '../../player/index.js'

import { dbFiles, dbPlaylists } from '../../db/index.js'

// Phase 2.5: ffmpeg-static 제거 — 메타/썸네일을 네이티브 플레이어(GStreamer)에 위임.
// setupFFmpeg는 하위호환용 no-op (main.js가 계속 호출).
const setupFFmpeg = () => {
  logger.info('media probe/thumbnail delegated to native player (GStreamer)')
}

// 네이티브 플레이어로 메타데이터 프로브 (ffprobe 대체). 실패해도 업로드는 진행.
const getMetadata = async (filePath) => {
  const res = await playerRequest('probe_media', { path: filePath }, 30000)
  if (!res || !res.ok) {
    logger.warn(`probe_media failed for ${filePath}: ${res && res.error}`)
    return {} // 메타데이터는 표시용 — 실패 시 빈 객체로 계속
  }
  return { format: res.format, streams: res.streams }
}

// 네이티브 플레이어로 썸네일 생성 (ffmpeg 대체). 결과 경로를 즉시 반환하고
// 생성은 백그라운드로 진행(기존 fire-and-forget 동작 유지). 0=무한 이미지 대비 at_sec.
const makeThumbnail = (filePath, outputDir, isImage) => {
  const baseName = path.parse(filePath).name
  const thumbnailPath = path.join(outputDir, `thumbnail-${baseName}.png`)
  playerRequest(
    'make_thumbnail',
    { path: filePath, out: thumbnailPath, is_image: isImage, at_sec: 5, width: 320 },
    30000,
  ).then((r) => {
    if (!r || !r.ok) logger.warn(`make_thumbnail failed for ${filePath}: ${r && r.error}`)
  })
  return thumbnailPath
}

// 파일 등록 시 중복되지 않는 숫자(순번) 생성 함수
const getNextFileNumber = async () => {
  try {
    // cfind()를 사용하여 cursor 반환
    const lastFiles = await dbFiles
      .find({})
      .sort({ number: -1 })
      .limit(1)
      .exec()

    return lastFiles.length > 0 ? lastFiles[0].number + 1 : 1
  } catch (error) {
    logger.error('Error getting next file number:', error)
    throw error
  }
}

// number만 미리 등록(예약)
const reserveFileNumber = async () => {
  const number = await getNextFileNumber()
  // 임시로 uuid만 넣고 number만 등록
  const uuid = uuidv4()
  await dbFiles.insert({
    uuid,
    number,
    reserved: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { uuid, number }
}

// 여러 파일에 대해 번호를 일괄 예약
const reserveMultipleFileNumbers = async (count) => {
  const startNumber = await getNextFileNumber()
  const reservations = []

  // 모든 예약 데이터를 먼저 생성
  for (let i = 0; i < count; i++) {
    const uuid = uuidv4()
    const number = startNumber + i
    reservations.push({
      uuid,
      number,
      reserved: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // 한 번에 모두 삽입
  await dbFiles.insert(reservations)

  return reservations.map((r) => ({ uuid: r.uuid, number: r.number }))
}

// update된 파일 후처리 하기
const postProcessFiles = async (files) => {
  const mediaPath = getMediaPath()
  const tmpPath = getTmpPath()

  // 모든 파일에 대해 번호를 미리 예약
  const reservations = await reserveMultipleFileNumbers(files.length)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const { uuid, number } = reservations[i]

    try {
      let thumbnailPath = null
      const {
        path: filePath,
        mimetype,
        fieldname,
        filename,
        size,
        originalname,
      } = file

      // 한글 파일명 디코딩 처리 (이미 디코딩된 경우 예외처리)
      function safeDecode(str) {
        try {
          // 이미 디코딩된 문자열이면 decodeURIComponent에서 오류 발생하므로 그대로 반환
          return decodeURIComponent(str)
        } catch {
          return str
        }
      }
      const decodedOriginalname = safeDecode(originalname)
      const decodedFilename = safeDecode(filename)
      const decodedFieldname = safeDecode(fieldname)

      // mediaPath아래 uuid 폴더 만들기
      const uuidFolderPath = path.join(mediaPath, uuid)
      await fs.promises.mkdir(uuidFolderPath, { recursive: true })

      // Windows에서 한글 경로 문제 방지: Buffer.from(str, 'utf8').toString() 사용
      const safeFileName = Buffer.from(decodedFieldname, 'utf8').toString()
      const newFilePath = path.join(uuidFolderPath, safeFileName)

      // 최종 위치로 이동한 뒤 프로브/썸네일 (플레이어가 최종 경로를 읽음)
      await fs.promises.rename(filePath, newFilePath)

      // metadata (표시용) — 네이티브 플레이어 GstDiscoverer, 실패해도 계속
      const metadata = await getMetadata(newFilePath)

      const isImage = mimetype.startsWith('image/')
      if (mimetype.startsWith('video/') || isImage) {
        thumbnailPath = makeThumbnail(newFilePath, uuidFolderPath, isImage)
      }

      // 예약된 number와 uuid로 파일 정보 업데이트
      await dbFiles.update(
        { uuid, number },
        {
          $set: {
            reserved: false,
            id: String(number), // 기본적으로 number를 id로 변환
            // fieldname: decodedFieldname,
            filename: decodedFilename,
            originalname: decodedOriginalname,
            amx: convertforAMX(decodedFilename),
            mimetype,
            size,
            path: newFilePath,
            metadata,
            thumbnail: thumbnailPath,
            is_image: mimetype.startsWith('image/'),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      )
      logger.info(`File processed and saved: ${newFilePath}`)
    } catch (error) {
      logger.error('Error processing file:', error)
      throw error
    }
  }
}

const insertFileWithUniqueNumber = async (fileData) => {
  let retry = 0
  while (retry < 5) {
    const number = await getNextFileNumber()
    try {
      await dbFiles.insert({ ...fileData, number })
      return
    } catch (err) {
      if (err.errorType === 'uniqueViolated') {
        retry++
        continue
      }
      throw err
    }
  }
  throw new Error('Failed to insert file with unique number after retries')
}

// utf-8을 amx tp에서 사용하는 스트링으로 변환하는 함수
const convertforAMX = (str) => {
  const encoder = new TextEncoder('utf-16le')
  const encoded = encoder.encode(str)
  const hexArray = Array.from(encoded)
    .map((byte) => byte.toString(16).padStart(4, '0'))
    .join(',')

  return hexArray
}

const resetAllMediaFiles = async () => {
  const mediaPath = getMediaPath()
  try {
    // mediaPath 아래 logo폴더를 제외한 모든 파일과 폴더를 삭제
    const files = await fs.promises.readdir(mediaPath, { withFileTypes: true })
    for (const file of files) {
      const filePath = path.join(mediaPath, file.name)
      if (file.isDirectory() && file.name !== 'logo') {
        await fs.promises.rmdir(filePath, { recursive: true })
      } else if (file.name !== 'logo') {
        await fs.promises.unlink(filePath)
      }
    }
    // dbFiles초기화
    await dbFiles.remove({}, { multi: true })
    await dbPlaylists.remove({}, { multi: true })
  } catch (error) {
    logger.error('Error resetting media files:', error)
  }
}

export {
  setupFFmpeg,
  getMetadata,
  postProcessFiles,
  insertFileWithUniqueNumber,
  convertforAMX,
  resetAllMediaFiles,
}
