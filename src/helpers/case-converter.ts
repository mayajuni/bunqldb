import { getDbType, isDateStringsEnabled } from "../internal/internal-db";

/**
 * Date 객체를 DB 형식 문자열로 변환합니다.
 * DB 타입에 따라 적절한 메서드를 사용하여 DB 저장값을 그대로 반환합니다.
 * - MySQL: 로컬 타임존 메서드 사용 (Bun SQL이 로컬 타임존으로 해석)
 * - PostgreSQL: UTC 메서드 사용 (Bun SQL이 UTC로 해석)
 * 시간이 00:00:00인 경우 날짜만 반환합니다 (DATE 타입 호환).
 * @example
 * formatDateToDbString(new Date('2023-07-01T00:00:00Z')) // '2023-07-01'
 * formatDateToDbString(new Date('2023-07-01T14:30:00Z')) // '2023-07-01 14:30:00'
 */
function formatDateToDbString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const isMySQL = getDbType() === "mysql";

  // MySQL: 로컬 타임존 메서드, PostgreSQL: UTC 메서드
  const year = isMySQL ? date.getFullYear() : date.getUTCFullYear();
  const month = isMySQL ? date.getMonth() + 1 : date.getUTCMonth() + 1;
  const day = isMySQL ? date.getDate() : date.getUTCDate();
  const hours = isMySQL ? date.getHours() : date.getUTCHours();
  const minutes = isMySQL ? date.getMinutes() : date.getUTCMinutes();
  const seconds = isMySQL ? date.getSeconds() : date.getUTCSeconds();

  const datePart = `${year}-${pad(month)}-${pad(day)}`;

  // 시간이 00:00:00인 경우 날짜만 반환 (DATE 타입 호환)
  if (hours === 0 && minutes === 0 && seconds === 0) {
    return datePart;
  }

  return `${datePart} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ============================================================
// MySQL 바이트 객체 변환 헬퍼 (집계 함수 DECIMAL 결과)
// ============================================================

/**
 * MySQL 와이어 프로토콜에서 반환된 바이트 객체를 문자열로 변환합니다.
 * Bun SQL이 IFNULL(SUM(...), 0), AVG(...) 등 집계 함수 결과를
 * {0:49, 1:53, 2:55, 3:46, ...} 형태의 ASCII 바이트 객체로 반환하는 문제를 해결합니다.
 * @param value 변환할 값
 * @returns 디코딩된 문자열 또는 undefined (바이트 객체가 아닌 경우)
 */
function tryDecodeByteObject(value: object): string | undefined {
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length === 0) return undefined;

  // 모든 키가 연속된 숫자 인덱스("0","1","2",...)이고, 값이 0~127 범위 정수인지 확인
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== String(i)) return undefined;
    const v = obj[keys[i]];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 127) {
      return undefined;
    }
  }

  return String.fromCharCode(...(keys.map((k) => obj[k] as number)));
}

// ============================================================
// PostgreSQL 타입 변환 헬퍼 (JSON/JSONB, INTEGER[] 등)
// ============================================================

/**
 * PostgreSQL에서 반환된 JSON/JSONB 문자열을 파싱합니다.
 * Bun SQL PostgreSQL 드라이버의 제한으로 JSON/JSONB가 string으로 반환되는 문제를 해결합니다.
 * @param value 파싱할 값
 * @returns 파싱된 객체 또는 원본 값
 */
function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;

  // JSON 객체/배열 문자열인지 빠르게 확인
  const trimmed = value.trim();
  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  // JSON 객체: { ... } 또는 JSON 배열: [ ... ]
  const isJsonLike =
    (firstChar === "{" && lastChar === "}") ||
    (firstChar === "[" && lastChar === "]");

  if (!isJsonLike) return value;

  try {
    return JSON.parse(value);
  } catch {
    // 파싱 실패 시 원본 문자열 반환
    return value;
  }
}

/**
 * PostgreSQL INTEGER[] 배열이 object로 반환되는 문제를 해결합니다.
 * Bun SQL에서 INTEGER[]가 {"0":1,"1":2,"2":3} 형태로 반환되는 경우 배열로 변환합니다.
 * @param value 변환할 값
 * @returns 배열 또는 원본 값
 */
function tryConvertNumericIndexedObject(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);

  // 빈 객체인 경우 (빈 INTEGER[] = {})
  if (keys.length === 0) {
    return value; // 빈 객체는 그대로 반환 (빈 배열과 구분 불가)
  }

  // 모든 키가 연속된 숫자 인덱스인지 확인 ("0", "1", "2", ...)
  const isNumericIndexed = keys.every((key, index) => key === String(index));

  if (!isNumericIndexed) return value;

  // 숫자 인덱스 객체를 배열로 변환
  return keys.map((key) => obj[key]);
}

/**
 * PostgreSQL 복합 타입 값을 변환합니다.
 * - JSON/JSONB 문자열 → 파싱된 객체/배열
 * - INTEGER[] (숫자 인덱스 객체) → 배열
 * MySQL에서는 변환 없이 원본 값을 반환합니다.
 * @param value 변환할 값
 * @returns 변환된 값
 */
function convertPostgresValue(value: unknown): unknown {
  // PostgreSQL에서만 변환 수행
  if (getDbType() !== "postgres") return value;

  // 1. JSON/JSONB 문자열 파싱
  const parsedJson = tryParseJsonString(value);
  if (parsedJson !== value) {
    // 파싱 성공 시 재귀적으로 내부 값도 변환
    return parsedJson;
  }

  // 2. INTEGER[] (숫자 인덱스 객체) → 배열 변환
  const convertedArray = tryConvertNumericIndexedObject(value);
  if (convertedArray !== value) {
    return convertedArray;
  }

  return value;
}

/**
 * snake_case를 camelCase로 변환합니다.
 */
export function snakeToCamel(str: string): string {
  return str.replace(/[_-]+(.)/g, (_, chr) => chr.toUpperCase());
}

/**
 * 값을 변환합니다 (PostgreSQL 타입 변환 + 재귀 처리).
 * @param value 변환할 값
 * @param recursive 재귀 변환 여부
 * @returns 변환된 값
 */
function transformValue(value: unknown, recursive: boolean): unknown {
  // PostgreSQL 복합 타입 변환 (JSON/JSONB, INTEGER[] 등)
  const converted = convertPostgresValue(value);

  // null/undefined는 그대로 반환
  if (converted === null || converted === undefined) {
    return converted;
  }

  // Date 처리
  if (converted instanceof Date) {
    return isDateStringsEnabled() ? formatDateToDbString(converted) : converted;
  }

  // 배열 처리
  if (Array.isArray(converted)) {
    return converted.map((item) =>
      typeof item === "object" && item !== null
        ? transformValue(item, recursive)
        : item
    );
  }

  // MySQL 바이트 객체 처리 (SUM, AVG 등 집계 함수 DECIMAL 결과)
  if (typeof converted === "object") {
    const decoded = tryDecodeByteObject(converted as object);
    if (decoded !== undefined) return decoded;

    // 일반 객체 처리 (재귀)
    if (recursive) {
      return toCamelCase(converted as Record<string, unknown>, recursive);
    }
  }

  return converted;
}

/**
 * 객체의 키를 snake_case에서 camelCase로 변환합니다.
 * 중첩된 객체와 배열도 재귀적으로 처리합니다.
 * PostgreSQL에서 JSON/JSONB가 문자열로 반환되는 문제와
 * INTEGER[]가 객체로 반환되는 문제도 자동으로 변환합니다.
 */
export function toCamelCase<T = Record<string, unknown>>(
  obj: Record<string, unknown>,
  recursive = true
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);
    result[camelKey] = transformValue(value, recursive);
  }

  return result as T;
}

/**
 * 배열의 각 객체를 camelCase로 변환합니다.
 */
export function toCamelCaseArray<T = Record<string, unknown>>(
  arr: Record<string, unknown>[]
): T[] {
  return arr.map((item) => toCamelCase<T>(item));
}
