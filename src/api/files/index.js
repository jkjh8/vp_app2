import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../../logger/index.js'

import { getTmpPath, getMediaPath } from './folders.js'
import { generateThumbnail, resizeImage } from './thumbnail.js'

import { dbFiles, dbPlaylists } from '../../db/index.js'

const setupFFmpeg = () => {
  let ffmpegExecutablePath = ffmpegPath
  let ffprobeExecutablePath = ffprobe.path
  if (ffmpegExecutablePath.includes('app.asar')) {
    ffmpegExecutablePath = ffmpegExecutablePath.replace(
      'app.asar',
      'app.asar.unpacked',
    )
  }
  if (ffprobeExecutablePath.includes('app.asar')) {
    ffprobeExecutablePath = ffprobeExecutablePath.replace(
      'app.asar',
      'app.asar.unpacked',
    )
  }
  ffmpeg.setFfmpegPath(ffmpegExecutablePath)
  ffmpeg.setFfprobePath(ffprobeExecutablePath)
}

// getVideoMetadata 함수는 비디오 파일의 메타데이터를 가져오는 Promise를 반환합니다.
const getMetadata = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        // logger.error('Error getting video metadata:', err)
        reject(err)
      } else {
        resolve(metadata)
      }
    })
  })
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

// update된 파일 후처리 하기
const postProcessFiles = async (files) => {
  const mediaPath = getMediaPath()
  const tmpPath = getTmpPath()

  for (const file of files) {
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

      // number와 uuid 미리 예약
      const { uuid, number } = await reserveFileNumber()

      // metadata를 가져오기
      const metadata = await getMetadata(filePath)
      // mediaPath아래 uuid 폴더 만들기
      const uuidFolderPath = path.join(mediaPath, uuid)
      await fs.promises.mkdir(uuidFolderPath, { recursive: true })

      // Windows에서 한글 경로 문제 방지: Buffer.from(str, 'utf8').toString() 사용
      // 단, Node.js는 기본적으로 UTF-8을 지원하므로, 문제가 계속된다면 파일시스템/환경 문제일 수 있음
      const safeFileName = Buffer.from(decodedFieldname, 'utf8').toString()
      const newFilePath = path.join(uuidFolderPath, safeFileName)

      // Move the file to the new location
      await fs.promises.rename(filePath, newFilePath)

      if (mimetype.startsWith('video/')) {
        thumbnailPath = generateThumbnail(newFilePath, uuidFolderPath)
      } else if (mimetype.startsWith('image/')) {
        thumbnailPath = resizeImage(newFilePath, uuidFolderPath)
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
