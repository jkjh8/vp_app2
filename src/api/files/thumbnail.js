import ffmpeg from 'fluent-ffmpeg'
import path from 'path'

// 썸네일 파일 이름을 먼저 반환하고, 실제 처리는 비동기로 진행
const generateThumbnail = (filePath, outputPath, time = 5) => {
  const baseName = path.parse(filePath).name
  const thumbnailName = `thumbnail-${baseName}.png`
  const thumbnailPath = path.join(outputPath, thumbnailName)

  setImmediate(() => {
    ffmpeg(filePath)
      .on('end', () => {})
      .on('error', () => {})
      .screenshots({
        timestamps: [time],
        filename: thumbnailName,
        folder: outputPath,
        size: '320x?',
      })
  })

  // 파일 이름(경로) 즉시 반환
  return thumbnailPath
}

// 이미지 파일을 비율은 유지하면서 320x240 보다 작은 이미지 만들기
// 파일 이름을 먼저 반환하고, 실제 처리는 비동기로 진행
const resizeImage = (inputPath, outputPath) => {
  const baseName = path.parse(inputPath).name
  const thumbnailName = `thumbnail-${baseName}.png`
  const thumbnailPath = path.join(outputPath, thumbnailName)

  setImmediate(() => {
    ffmpeg(inputPath)
      .on('end', () => {})
      .on('error', () => {})
      .output(thumbnailPath)
      .size('320x?')
      .run()
  })

  return thumbnailPath
}

export { generateThumbnail, resizeImage }
