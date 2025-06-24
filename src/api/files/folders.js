import { app } from 'electron'
import path from 'path'
import fs from 'fs'
// import logger from '../../logger/index.js'

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
    // logger.info(`Media path created: ${mediaPath}`)
  } // else { logger.info(`Media path exists: ${mediaPath}`) }
  return mediaPath
}

function existsTmpPath() {
  const tmpPath = getTmpPath()
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, { recursive: true })
    // logger.info(`Tmp path created: ${tmpPath}`)
  } // else { logger.info(`Tmp path exists: ${tmpPath}`) }
  return tmpPath
}

function existsLogoPath() {
  const logoPath = getLogoPath()
  if (!fs.existsSync(logoPath)) {
    fs.mkdirSync(logoPath, { recursive: true })
    // logger.info(`Logo path created: ${logoPath}`)
  } // else { logger.info(`Logo path exists: ${logoPath}`) }
  return logoPath
}

function deleteTmpFiles() {
  const tmpPath = getTmpPath()
  fs.readdir(tmpPath, (err, files) => {
    if (err) {
      // logger.error(`Error reading tmp directory: ${err}`)
      return
    }
    files.forEach((file) => {
      const filePath = path.join(tmpPath, file)
      fs.unlink(filePath, (err) => {
        // if (err) logger.error(`Error deleting tmp file: ${err}`)
        // else logger.info(`Tmp file deleted: ${filePath}`)
      })
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
