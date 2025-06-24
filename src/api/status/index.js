import { dbStatus } from '../../db/index.js'
import pStatus from '../../pStatus.js'

const updateStatusFromDb = async () => {
  const st = await dbStatus.find({})
  Object.assign(pStatus, st)
}

export { updateStatusFromDb }
