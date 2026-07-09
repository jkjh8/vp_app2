import Datastore from 'nedb-promises'
import path from 'path'
import { app } from '../runtime.js'

let db = null
let dbStatus = null
let dbFiles = null
let dbPlaylists = null

const addTimestamps = (store) => {
  const originalInsert = store.insert
  store.insert = function (doc) {
    const now = new Date()
    if (Array.isArray(doc)) {
      doc.forEach((d) => {
        d.createdAt = now
        d.updatedAt = now
      })
    } else {
      doc.createdAt = now
      doc.updatedAt = now
    }
    return originalInsert.call(this, doc)
  }

  const originalUpdate = store.update
  store.update = function (query, update, options) {
    if (!update.$set) update.$set = {}
    update.$set.updatedAt = new Date()
    return originalUpdate.call(this, query, update, options)
  }
  return store
}

const initDb = () => {
  const dbPath = path.join(app.getPath('appData'), 'db')
  db = {
    status: addTimestamps(
      Datastore.create({
        filename: path.join(dbPath, 'status.db'),
        autoload: true,
      }),
    ),
    files: addTimestamps(
      Datastore.create({
        filename: path.join(dbPath, 'files.db'),
        autoload: true,
      }),
    ),
    playlists: addTimestamps(
      Datastore.create({
        filename: path.join(dbPath, 'playlists.db'),
        autoload: true,
      }),
    ),
  }
  dbStatus = db.status
  dbFiles = db.files
  dbPlaylists = db.playlists
  return db
}
export { initDb, dbStatus, dbFiles, dbPlaylists }
export default db
