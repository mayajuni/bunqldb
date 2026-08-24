import { SQL } from "bun";
import {
  dbContextStorage,
  getDbContext,
  getTx,
  isSqlLoggingSkipped,
} from "./context";
import {
  consoleLogger,
  type DbConfig,
  type DbPoolConfig,
  type SqlLogger,
  type SqlLoggingOptions,
} from "../types";

// ============================================================
// 확장된 SQL 타입 정의 (verbose/silent 체이닝 지원)
// ============================================================

/**
 * verbose/silent 체이닝을 지원하는 확장된 SQL 타입
 * - sql.verbose`...`: 전역 설정 무시하고 항상 로깅
 * - sql.silent`...`: 전역 설정 무시하고 로깅 안함
 */
export interface ExtendedSQL extends SQL {
  /** 전역 설정 무시하고 항상 로깅 */
  verbose: SQL;
  /** 전역 설정 무시하고 로깅 안함 */
  silent: SQL;
}

// ============================================================
// 타입 정의
// ============================================================

export type DbType = "mysql" | "postgres";

// ============================================================
// 상태 및 설정
// ============================================================

let baseSql: SQL | null = null;
let detectedDbType: DbType | null = null;
let sqlLoggingEnabled = false;
let currentLogger: SqlLogger = consoleLogger;
let dateStringsEnabled = false;

// 연결 풀 설정. configureDb({ pool }) 로 덮어쓸 수 있다 — 환경마다 알맞은 값이 달라서
// 코드에 박아 두면 안 된다(원격 DB 는 연결 수립만으로 몇 초가 걸리기도 한다).
const DEFAULT_CONNECTION_POOL_CONFIG = {
  max: 10, // 최대 연결 수
  idleTimeout: 30, // 유휴 연결 타임아웃 (초)
};

let poolConfig: DbPoolConfig = {};

// DB 타입별 기본 포트
const DEFAULT_PORTS: Record<DbType, number> = {
  mysql: 3306,
  postgres: 5432,
};

// ============================================================
// SQL 로깅 설정
// ============================================================

/**
 * SQL 로깅 설정 (내부 함수)
 */
function setSqlLogging(options: SqlLoggingOptions): void {
  sqlLoggingEnabled = options.enabled;
  if (options.logger) {
    currentLogger = options.logger;
  } else {
    currentLogger = consoleLogger;
  }
}

/**
 * SQL 로깅 활성화 여부 확인
 */
export function isSqlLoggingEnabled(): boolean {
  return sqlLoggingEnabled;
}

/**
 * DB 설정
 * @example
 * // 로깅 + dateStrings 설정
 * configureDb({
 *   logging: { enabled: true, logger: myLogger },
 *   dateStrings: true,
 * });
 *
 * // dateStrings만 설정
 * configureDb({ dateStrings: true });
 */
export function configureDb(config: DbConfig): void {
  if (config.logging !== undefined) {
    setSqlLogging(config.logging);
  }
  if (config.dateStrings !== undefined) {
    dateStringsEnabled = config.dateStrings;
  }
  if (config.pool !== undefined) {
    poolConfig = config.pool;
    // 이미 풀이 열려 있으면 새 설정으로 다시 연다. 그러지 않으면 설정이 조용히 무시된다.
    if (baseSql) {
      resetConnection();
    }
  }
}

/**
 * dateStrings 옵션 활성화 여부 확인
 */
export function isDateStringsEnabled(): boolean {
  return dateStringsEnabled;
}

/**
 * SQL 로깅을 스킵하는 컨텍스트 내에서 함수 실행
 * - 통합된 dbContextStorage를 사용하여 기존 컨텍스트(트랜잭션 등) 유지
 */
export function withSkippedSqlLogging<T>(fn: () => Promise<T>): Promise<T> {
  const currentContext = getDbContext();
  return dbContextStorage.run({ ...currentContext, skipSqlLogging: true }, fn);
}

/**
 * SQL 문자열 빌드 (바인딩 값 포함)
 */
function buildSqlString(
  strings: TemplateStringsArray,
  values: unknown[]
): string {
  let result = strings[0] || "";
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    result += formatValue(value);
    result += strings[i + 1] || "";
  }
  // result가 string이 아닌 경우 대비
  if (typeof result !== "string") {
    result = String(result);
  }
  // prod 환경에서는 줄바꿈 제거, 그 외에는 유지
  if (process.env.STAGE === "prod") {
    return result.replace(/\s+/g, " ").trim();
  }
  return result.trim();
}

/**
 * Symbol 속성에서 값 추출 (안전한 폴백 포함)
 * - Bun 내부 구현에 의존하므로 버전 업데이트 시 깨질 수 있음
 * - try-catch로 안전하게 처리
 */
function getSymbolProperty(obj: any, symbolName: string): any {
  try {
    const symbols = Object.getOwnPropertySymbols(obj);
    const targetSymbol = symbols.find(
      (s) => s.toString() === `Symbol(${symbolName})`
    );
    return targetSymbol ? obj[targetSymbol] : undefined;
  } catch {
    // Symbol 접근 실패 시 undefined 반환
    return undefined;
  }
}

/**
 * SQL Fragment 객체에서 SQL 문자열 추출 시도
 * - 여러 방법으로 시도하여 안정성 확보
 * - Bun 버전 업데이트에도 대응할 수 있도록 다중 폴백 구현
 */
function extractSqlFromFragment(obj: any): string | null {
  try {
    // 방법 1: Bun SQL Query 객체의 Symbol 속성에서 추출
    // Symbol(strings)와 Symbol(values)에서 SQL 정보 추출
    const symbolStrings = getSymbolProperty(obj, "strings");
    const symbolValues = getSymbolProperty(obj, "values");

    if (symbolStrings && Array.isArray(symbolStrings)) {
      const values = Array.isArray(symbolValues) ? symbolValues : [];
      // TemplateStringsArray처럼 사용하기 위해 raw 속성 추가
      const strings = Object.assign([...symbolStrings], { raw: symbolStrings });
      return buildSqlString(strings as TemplateStringsArray, values);
    }

    // 방법 2: 일반 속성으로 strings/values가 있는 경우
    if (obj.strings && Array.isArray(obj.strings) && "values" in obj) {
      const strings = obj.strings as TemplateStringsArray;
      const values = Array.isArray(obj.values) ? obj.values : [];
      return buildSqlString(strings, values);
    }

    // 방법 3: raw SQL 문자열이 있는 경우
    if (typeof obj.raw === "string") {
      return obj.raw;
    }

    // 방법 4: query 속성이 있는 경우
    if (typeof obj.query === "string") {
      return obj.query;
    }

    // 방법 5: toString() 메서드가 유용한 정보를 반환하는 경우
    if (typeof obj.toString === "function") {
      const str = obj.toString();
      // [object Object]가 아닌 경우에만 사용
      if (str && !str.includes("[object")) {
        return str;
      }
    }

    return null;
  } catch {
    // 모든 시도 실패 시 null 반환 (로깅에서 [SQL Fragment]로 표시됨)
    return null;
  }
}

/**
 * 값을 SQL 문자열로 포맷팅
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => (isNumber(v) ? v : JSON.stringify(v)))
      .join(",")}]`;
  }
  // SQL 템플릿 리터럴 객체 (쿼리 조합용)
  if (value && typeof value === "object") {
    const obj = value as any;

    // SQL Fragment에서 실제 SQL 문자열 추출 시도
    const extractedSql = extractSqlFromFragment(obj);
    if (extractedSql !== null) {
      return extractedSql;
    }

    // Promise-like 객체인 경우 (SQL 추출 실패 시)
    if (typeof obj.then === "function") {
      return "[SQL Fragment]";
    }
  }
  return JSON.stringify(value);
}

function isNumber(value: unknown): boolean {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * 테스트 환경 여부 확인
 */
function isTestEnv(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.BUN_TEST !== undefined ||
    process.env.JEST_WORKER_ID !== undefined
  );
}

/**
 * 프로덕션 환경 여부 확인
 */
function isProdEnv(): boolean {
  return process.env.STAGE === "prod" || process.env.NODE_ENV === "production";
}

/**
 * 스택 트레이스 캡처 (로깅 활성화 시에만)
 * - 프로덕션 환경에서는 성능을 위해 스택 트레이스 캡처 비활성화
 * - 개발/테스트 환경에서만 스택 트레이스 제공
 */
function captureStack(): Error | undefined {
  // 프로덕션에서는 스택 트레이스 캡처하지 않음 (성능 최적화)
  if (isProdEnv()) {
    return undefined;
  }
  return sqlLoggingEnabled ? new Error("Stack Capture") : undefined;
}

/**
 * 스택 트레이스 포맷팅
 */
function formatStackTrace(stackCapture?: Error): string {
  const stack = stackCapture?.stack || new Error().stack;
  return stack?.replace(/^Error.*\n/, "").replace(/Stack Capture\n/, "") || "";
}

/**
 * SQL 쿼리 로깅
 * - 프로덕션에서는 SQL과 Duration만 로깅 (스택 트레이스 제외)
 * - 개발/테스트 환경에서는 스택 트레이스 포함
 */
function logQuery(
  sqlString: string,
  duration: number,
  stackCapture?: Error
): void {
  // 프로덕션에서는 간단한 로그만
  if (isProdEnv()) {
    const logMessage = `${sqlString} [${duration.toFixed(2)}ms]`;
    currentLogger.info(logMessage);
    return;
  }

  // 개발/테스트 환경에서는 스택 트레이스 포함
  const formattedStack = formatStackTrace(stackCapture);
  const logMessage = `${sqlString}

    Duration: ${duration.toFixed(2)}ms

${formattedStack}`;

  if (isTestEnv()) {
    console.log(`🔍 [SQL] ${logMessage}`);
  } else {
    currentLogger.info(logMessage);
  }
}

/**
 * SQL 에러 로깅
 */
function logError(sqlString: string, error: Error): void {
  const errorData = {
    sql: sqlString,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };

  if (isTestEnv()) {
    console.error(`❌ [SQL ERROR] ${errorData.sql}`);
    console.error(`💥 Error: ${errorData.error}`);
    console.error(`📍 Stack: ${errorData.stack}`);
  } else {
    currentLogger.error(errorData);
  }
}

// ============================================================
// DB 타입 감지
// ============================================================

/**
 * DATABASE_URL에서 DB 타입을 자동 감지합니다.
 */
function detectDbType(): DbType {
  const url = process.env.DATABASE_URL;
  if (url?.startsWith("mysql://")) return "mysql";
  return "postgres"; // 기본값
}

/**
 * 현재 DB 타입을 반환합니다.
 */
export function getDbType(): DbType {
  if (!detectedDbType) {
    detectedDbType = detectDbType();
  }
  return detectedDbType;
}

// ============================================================
// Public API
// ============================================================

export function getBaseSql(): SQL {
  if (baseSql) {
    return baseSql;
  }

  const connectionOptions = {
    // 연결 풀 설정
    max: poolConfig.max ?? DEFAULT_CONNECTION_POOL_CONFIG.max,
    idleTimeout: poolConfig.idleTimeout ?? DEFAULT_CONNECTION_POOL_CONFIG.idleTimeout,
    ...(poolConfig.connectionTimeout !== undefined
      ? { connectionTimeout: poolConfig.connectionTimeout }
      : {}),
    ...(poolConfig.maxLifetime !== undefined
      ? { maxLifetime: poolConfig.maxLifetime }
      : {}),
    // 이벤트 핸들러 제거 (로그 노이즈 및 중복 재연결 방지)
    // Bun SQL이 내부적으로 연결 상태를 관리하도록 함
  };

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    baseSql = new SQL(databaseUrl, connectionOptions);
    return baseSql;
  }

  const host = process.env.DB_HOST;
  const dbType = getDbType();
  const port = process.env.DB_PORT
    ? Number.parseInt(process.env.DB_PORT, 10)
    : DEFAULT_PORTS[dbType];
  const username = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;

  if (host && username && password && database) {
    baseSql = new SQL({
      host,
      port,
      username,
      password,
      database,
      ...connectionOptions,
    });
    return baseSql;
  }

  throw new Error(
    "데이터베이스 설정이 누락되었습니다. DATABASE_URL 또는 (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)을 설정해주세요."
  );
}

export function resetConnection(): void {
  if (baseSql) {
    baseSql.close();
    baseSql = null;
  }
  detectedDbType = null; // DB 타입 캐시도 초기화
}

export function isDbConnected(): boolean {
  // Bun SQL 인스턴스가 생성되어 있으면 연결 가능한 상태로 간주
  // 실제 연결은 쿼리 실행 시점에 자동으로 맺어짐 (Lazy Connection)
  return baseSql !== null;
}

// ============================================================
// SQL Proxy (트랜잭션 자동 전환 + 로깅)
// ============================================================

/**
 * SQL 결과 객체에 로깅을 추가하는 Proxy 생성
 * - 원래 SQL 객체의 모든 속성을 유지 (쿼리 조합 기능 보존)
 * - then/catch만 오버라이드하여 실행 시점에 로깅
 * @param mode 로깅 모드 (verbose: 항상 로깅, silent: 로깅 안함, default: 전역 설정 따름)
 */
function createLoggingProxy(
  result: any,
  sqlString: string,
  stackCapture: Error | undefined,
  start: number,
  mode: "default" | "verbose" | "silent" = "default"
): any {
  // result가 Promise가 아니면 그대로 반환
  if (!result || typeof result.then !== "function") {
    return result;
  }

  // 원래 SQL 객체를 Proxy로 감싸서 then/catch만 오버라이드
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (
          onFulfilled?: (value: any) => any,
          onRejected?: (error: Error) => any
        ) => {
          return target.then(
            (res: unknown) => {
              // 로깅 모드에 따른 처리
              // verbose: 항상 로깅
              // silent: 로깅 안함 (이 경우 createLoggingProxy가 호출되지 않음)
              // default: 전역 설정 + 컨텍스트에 따름
              const shouldLog =
                mode === "verbose" ||
                (mode === "default" && !isSqlLoggingSkipped());

              if (shouldLog) {
                const duration = performance.now() - start;
                logQuery(sqlString, duration, stackCapture);
              }
              return onFulfilled ? onFulfilled(res) : res;
            },
            (error: Error) => {
              // 에러는 항상 로깅 (SQL 로깅 스킵과 무관)
              logError(sqlString, error);
              if (onRejected) return onRejected(error);
              throw error;
            }
          );
        };
      }

      if (prop === "catch") {
        return (onRejected?: (error: Error) => any) => {
          return target.catch((error: Error) => {
            logError(sqlString, error);
            if (onRejected) return onRejected(error);
            throw error;
          });
        };
      }

      // 나머지 속성은 원래 객체에서 가져옴 (SQL 조합 기능 유지)
      return Reflect.get(target, prop, receiver);
    },
  });
}

// ============================================================
// 끊긴 연결 복구 (재시도)
// ============================================================

/**
 * 연결이 죽어서 난 오류인가.
 *
 * TCP 가 FIN/RST 없이 침묵하면(노트북 절전·VPN 끊김·경로 장애) 소켓은 살아 있는 것처럼
 * 보인다. 그래서 Bun 은 죽은 커넥션에 쿼리를 실어 보내고 타임아웃까지 기다린 뒤 실패한다.
 * 유휴 시간을 조절해서 막을 수 있는 문제가 아니다 — 실측(2026-08-24)에서 35초를 놀려도,
 * 서버가 커넥션을 끊어도(pg_terminate_backend) 재연결은 멀쩡했고, 오직 이 "침묵" 만 실패했다.
 * 그리고 실패 직후 같은 쿼리를 다시 보내면 곧바로 성공한다. 그래서 여기서 한 번 되살린다.
 */
function isConnectionLostError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && CONNECTION_LOST_CODES.has(code)) {
    return true;
  }
  // 드라이버가 코드를 안 붙이는 경로가 있어 문구도 함께 본다.
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && CONNECTION_LOST_PATTERN.test(message);
}

const CONNECTION_LOST_CODES = new Set([
  "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_POSTGRES_CONNECTION_TIMEOUT",
  "ERR_POSTGRES_CONNECTION_CLOSED",
  "ERR_POSTGRES_LIFETIME_TIMEOUT",
  "ERR_MYSQL_IDLE_TIMEOUT",
  "ERR_MYSQL_CONNECTION_TIMEOUT",
  "ERR_MYSQL_CONNECTION_CLOSED",
  "ERR_MYSQL_LIFETIME_TIMEOUT",
]);

const CONNECTION_LOST_PATTERN =
  /(idle timeout|connection timeout|connection closed|connection ended|socket hang up|ECONNRESET|EPIPE)/i;

/**
 * 재시도해도 되는 쿼리인가.
 *
 * **읽기만 되살린다.** 연결이 끊긴 자리에서는 쿼리가 서버에 닿기 전에 죽었는지, 닿아서
 * 실행된 뒤 응답만 못 받았는지 구분할 수 없다. 쓰기를 다시 보내면 두 번 들어갈 수 있다 —
 * 조회가 한 번 실패하는 것보다 결제가 두 번 되는 쪽이 훨씬 나쁘다.
 *
 * 트랜잭션 안에서도 하지 않는다. 그 커넥션이 죽었다면 트랜잭션은 이미 롤백된 것이라,
 * 한 문장만 새 연결에서 다시 실행하면 반쪽짜리 결과가 남는다.
 */
function isRetryableRead(argArray: unknown[]): boolean {
  if (getTx()) return false;

  const first = argArray[0] as { raw?: unknown; [index: number]: unknown } | undefined;
  const isTemplateCall =
    !!first && typeof first === "object" && "raw" in first && typeof first[0] === "string";
  if (!isTemplateCall) return false;

  return /^\s*select\b/i.test(first[0] as string);
}

/** 동시에 실패한 요청들이 저마다 풀을 닫아 대는 것을 막는다. */
let lastReconnectAt = 0;
const RECONNECT_COOLDOWN_MS = 1000;

function reconnectOnce(): void {
  const now = Date.now();
  if (now - lastReconnectAt < RECONNECT_COOLDOWN_MS) return;
  lastReconnectAt = now;
  resetConnection();
}

/**
 * 연결이 끊겨 실패하면 풀을 새로 열고 **한 번만** 다시 실행한다.
 *
 * 쿼리 객체는 await 하는 시점에 실행되는 thenable 이라, 재실행은 `make()` 로 새로 만든다.
 * `then` 외의 속성(`.values()`, `.raw()`, SQL 조합 등)은 원본에 그대로 넘긴다.
 */
function withConnectionRetry<T extends object>(make: () => T): T {
  const first = make();

  return new Proxy(first, {
    get(target, prop, receiver) {
      if (prop !== "then") {
        return Reflect.get(target, prop, receiver);
      }

      return (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve(target as unknown as Promise<unknown>)
          .catch((error) => {
            if (!isConnectionLostError(error)) throw error;
            reconnectOnce();
            return make() as unknown as Promise<unknown>;
          })
          .then(
            onFulfilled as (value: unknown) => unknown,
            onRejected as (reason: unknown) => unknown
          );
    },
  });
}

// ============================================================
// SQL Proxy 로깅 모드
// ============================================================

type LoggingMode = "default" | "verbose" | "silent";

/**
 * 지정된 로깅 모드로 SQL Proxy 생성
 */
function createSqlProxyWithMode(mode: LoggingMode): SQL {
  // Proxy target은 실제로 사용되지 않음 (apply 핸들러에서 처리)
  const noop = () => {
    /* 의도적 빈 함수 */
  };
  return new Proxy(noop as unknown as SQL, {
    apply(_target, _thisArg, argArray) {
      // 원래 SQL 결과 생성.
      // 트랜잭션 밖의 읽기만, 연결이 끊겼을 때 새 연결로 한 번 되살린다.
      const makeQuery = () => {
        const currentSql = getTx() || getBaseSql();
        return (currentSql as any)(...argArray);
      };
      const result = isRetryableRead(argArray) ? withConnectionRetry(makeQuery) : makeQuery();

      // 로깅 모드에 따른 처리
      // silent: 항상 로깅 스킵
      if (mode === "silent") {
        return result;
      }

      // verbose: 전역 설정 무시하고 항상 로깅
      // default: 전역 설정에 따름
      const shouldLog =
        mode === "verbose" ||
        (mode === "default" && sqlLoggingEnabled && !isSqlLoggingSkipped());

      if (!shouldLog) {
        return result;
      }

      // sql(values) 형태의 호출인지 확인 (템플릿 리터럴이 아닌 경우)
      // TemplateStringsArray는 raw 속성을 가지고, 첫 번째 요소가 string임
      const firstArg = argArray[0];
      const isTemplateCall =
        firstArg &&
        typeof firstArg === "object" &&
        "raw" in firstArg &&
        typeof firstArg[0] === "string";

      // 템플릿 리터럴 호출이 아니면 로깅 없이 반환 (sql(values) 같은 경우)
      if (!isTemplateCall) {
        return result;
      }

      // 로깅을 위한 정보 준비
      const [strings, ...values] = argArray as [
        TemplateStringsArray,
        ...unknown[]
      ];
      const sqlString = buildSqlString(strings, values);
      const stackCapture = captureStack();
      const start = performance.now();

      // 로깅 Proxy로 감싸서 반환 (원래 SQL 객체 특성 유지)
      return createLoggingProxy(result, sqlString, stackCapture, start, mode);
    },
    get(_target, prop, _receiver) {
      // verbose/silent 체이닝 지원
      if (prop === "verbose") {
        return createSqlProxyWithMode("verbose");
      }
      if (prop === "silent") {
        return createSqlProxyWithMode("silent");
      }

      const tx = getTx();
      const currentSql = tx || getBaseSql();
      return Reflect.get(currentSql, prop, currentSql);
    },
  });
}

const sqlProxy = createSqlProxyWithMode("default") as ExtendedSQL;

export { sqlProxy as sql };
