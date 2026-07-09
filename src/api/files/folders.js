import { app } from '../../runtime.js'
import path from 'path'
import fs from 'fs'

function getMediaPath() {
  return path.join(app.getPath('home'), 'media')
}
function getTmpPath() {
  return path.join(app.getPath('userData'), 'tmp')
}

function getLogoPath() {
  return path.join(getMediaPath(), 'logo')
}

function existsMediaPath() {
  const mediaPath = getMediaPath()
  if (!fs.existsSync(mediaPath)) {
    fs.mkdirSync(mediaPath, { recursive: true })
  }
  return mediaPath
}

function existsTmpPath() {
  const tmpPath = getTmpPath()
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, { recursive: true })
  }
  return tmpPath
}

function existsLogoPath() {
  const logoPath = getLogoPath()
  if (!fs.existsSync(logoPath)) {
    fs.mkdirSync(logoPath, { recursive: true })
  }
  return logoPath
}

function deleteTmpFiles() {
  const tmpPath = getTmpPath()
  fs.readdir(tmpPath, (err, files) => {
    if (err) {
      return
    }
    files.forEach((file) => {
      const filePath = path.join(tmpPath, file)
      fs.unlink(filePath, () => {})
    })
  })
}

export {
  getMediaPath,
  getTmpPath,
  getLogoPath,
  existsMediaPath,
  existsTmpPath,
  existsLogoPath,
  deleteTmpFiles,
}
