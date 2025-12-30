/**
 * SQL 로깅에 사용할 로거 인터페이스
 */
export interface SqlLogger {
  info: (message: string | object) => void;
  error: (message: string | object) => void;
}

/**
 * SQL 로깅 설정 옵션
 */
export interface SqlLoggingOptions {
  /** 로깅 활성화 여부 */
  enabled: boolean;
  /** 커스텀 로거 (없으면 console 사용) */
  logger?: SqlLogger;
}

/**
 * 기본 console 로거
 */
export const consoleLogger: SqlLogger = {
  info: (message) => {
    if (typeof message === 'string') {
      console.log(message);
    } else {
      console.log(JSON.stringify(message, null, 2));
    }
  },
  error: (message) => {
    if (typeof message === 'string') {
      console.error(message);
    } else {
      console.error(JSON.stringify(message, null, 2));
    }
  },
};
