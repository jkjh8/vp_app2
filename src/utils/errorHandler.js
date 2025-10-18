import { logger } from '../logger/index.js'

// 공통 에러 처리 함수
export const handleError = (
  res,
  error,
  message = 'Internal Server Error',
  statusCode = 500,
) => {
  logger.error(`${message}: ${error.message || error}`)
  return res.status(statusCode).json({ error: message })
}

// 성공 응답 처리 함수
export const handleSuccess = (res, data, message = '', statusCode = 200) => {
  const response = { result: true }
  if (message) response.message = message
  if (data) Object.assign(response, data)
  return res.status(statusCode).json(response)
}

// 라우터 에러 처리 래퍼 함수
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// 에러 미들웨어
export const errorMiddleware = (err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
