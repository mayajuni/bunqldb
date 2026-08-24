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
 * DB 설정 옵션
 */
export interface DbConfig {
  /** SQL 로깅 설정 */
  logging?: SqlLoggingOptions;
  /**
   * Date 객체를 MySQL 형식 문자열로 반환할지 여부
   * - false (기본값): Date 객체 그대로 반환
   * - true: MySQL 형식 문자열 ('YYYY-MM-DD HH:mm:ss')로 반환
   */
  dateStrings?: boolean;
  /**
   * 연결 풀 설정. 주지 않으면 기본값을 쓴다.
   *
   * 값을 코드에 박아 두면 환경마다 다른 사정을 못 담는다 — 원격 DB 는 연결 수립만으로도
   * 몇 초가 걸려서 `idleTimeout` 을 짧게 두면 연결 자체가 실패하고(실측: 2초로 두니 첫
   * 쿼리부터 실패), 가까운 DB 는 길게 둘 이유가 없다. 그래서 호출하는 쪽이 정한다.
   */
  pool?: DbPoolConfig;
}

/**
 * 연결 풀 설정.
 *
 * 이 값들로 "끊긴 연결" 문제를 막을 수는 없다(그건 재시도가 맡는다). 환경에 맞게
 * 조이거나 푸는 손잡이일 뿐이다.
 */
export interface DbPoolConfig {
  /** 최대 연결 수 (기본 10) */
  max?: number;
  /** 유휴 연결을 닫기까지의 시간(초). 0 이면 닫지 않는다 (기본 30) */
  idleTimeout?: number;
  /** 연결 수립을 기다리는 최대 시간(초) */
  connectionTimeout?: number;
  /** 연결 하나의 최대 수명(초). 0 이면 무제한 */
  maxLifetime?: number;
}

/**
 * 기본 console 로거
 */
export const consoleLogger: SqlLogger = {
  info: (message) => {
    if (typeof message === "string") {
      console.log(message);
    } else {
      console.log(JSON.stringify(message, null, 2));
    }
  },
  error: (message) => {
    if (typeof message === "string") {
      console.error(message);
    } else {
      console.error(JSON.stringify(message, null, 2));
    }
  },
};
