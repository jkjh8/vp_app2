import { logger } from '../logger/index.js'

/**
 * TCP 응답 표준 포맷
 */
export class TcpResponse {
  constructor() {
    this.timestamp = new Date().toISOString()
    this.success = true
    this.command = null
    this.message = null
    this.data = {}
    this.error = null
  }

  /**
   * 성공 응답 생성
   */
  static success(command, message = null, data = {}) {
    const response = new TcpResponse()
    response.command = command
    response.message = message || `Command '${command}' executed successfully`
    response.data = data
    return response
  }

  /**
   * 에러 응답 생성
   */
  static error(command, error, code = 'UNKNOWN_ERROR') {
    const response = new TcpResponse()
    response.success = false
    response.command = command
    response.error = {
      code,
      message: typeof error === 'string' ? error : error.message,
      details: error.stack || null,
    }
    return response
  }

  /**
   * 이벤트 알림 생성 (브로드캐스트용)
   */
  static event(eventType, data = {}) {
    const response = new TcpResponse()
    response.command = 'event'
    response.message = `Event: ${eventType}`
    response.data = {
      eventType,
      ...data,
    }
    return response
  }

  /**
   * JSON으로 변환
   */
  toJSON() {
    const result = {
      timestamp: this.timestamp,
      success: this.success,
      command: this.command,
    }

    if (this.message) result.message = this.message
    if (Object.keys(this.data).length > 0) result.data = this.data
    if (this.error) result.error = this.error

    return result
  }

  /**
   * 문자열로 변환 (TCP 전송용)
   */
  toString() {
    return JSON.stringify(this.toJSON())
  }
}

/**
 * TCP 응답 전송 유틸리티
 */
export class TcpResponseSender {
  constructor(clients) {
    this.clients = clients || []
  }

  /**
   * 특정 클라이언트에게 응답 전송
   */
  sendTo(client, response) {
    if (!client || client.destroyed) return

    try {
      const message =
        response instanceof TcpResponse
          ? response.toString()
          : JSON.stringify(response)
      client.write(message + '\n')

      logger.debug(`TCP response sent to client: ${message}`)
    } catch (error) {
      logger.error(`Failed to send TCP response to client: ${error.message}`)
    }
  }

  /**
   * 모든 클라이언트에게 브로드캐스트
   */
  broadcast(response) {
    const message =
      response instanceof TcpResponse
        ? response.toString()
        : JSON.stringify(response)

    this.clients.forEach((client, index) => {
      if (client.destroyed) {
        logger.warn(`Removing destroyed client at index ${index}`)
        return
      }

      try {
        client.write(message + '\n')
      } catch (error) {
        logger.error(`Failed to broadcast to client ${index}: ${error.message}`)
      }
    })

    logger.debug(
      `TCP response broadcasted to ${this.clients.length} clients: ${message}`,
    )
  }

  /**
   * 명령어 실행 결과 응답
   */
  respondToCommand(client, command, result, error = null) {
    let response

    if (error) {
      response = TcpResponse.error(command, error, this._getErrorCode(error))
    } else if (result) {
      response = TcpResponse.success(
        command,
        result.message || null,
        result.data || result,
      )
    } else {
      response = TcpResponse.success(command, `Command '${command}' executed`)
    }

    this.sendTo(client, response)
  }

  /**
   * 이벤트 브로드캐스트
   */
  broadcastEvent(eventType, data = {}) {
    const response = TcpResponse.event(eventType, data)
    this.broadcast(response)
  }

  /**
   * 에러 코드 결정
   */
  _getErrorCode(error) {
    if (typeof error === 'string') return 'COMMAND_ERROR'
    if (error.code) return error.code
    if (error.message?.includes('not found')) return 'NOT_FOUND'
    if (error.message?.includes('invalid')) return 'INVALID_PARAMETER'
    return 'EXECUTION_ERROR'
  }
}

/**
 * 이벤트 타입
 */
export const TCP_EVENTS = {
  PLAY_STARTED: 'playStarted',
  PLAY_PAUSED: 'playPaused',
  PLAY_STOPPED: 'playStopped',
  NEXT_TRACK: 'nextTrack',
  PREV_TRACK: 'prevTrack',
  END_REACHED: 'endReached',
  FULLSCREEN_CHANGED: 'fullscreenChanged',
  AUDIO_DEVICES_UPDATED: 'audioDevicesUpdated',
  IMAGE_TIME_CHANGED: 'imageTimeChanged',
}
