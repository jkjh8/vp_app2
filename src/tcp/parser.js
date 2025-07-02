import { logger } from '../logger/index.js'
import pStatus from '../pStatus.js'

const parser = (data) => {
  const messages = data.toString().split('\n').filter(Boolean)
  for (const msg of messages) {
    console.log(`Received message: ${msg}`)
  }
}

export default parser
