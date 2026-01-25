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

/**
 * snake_case를 camelCase로 변환합니다.
 */
export function snakeToCamel(str: string): string {
  return str.replace(/[_-]+(.)/g, (_, chr) => chr.toUpperCase());
}

/**
 * 객체의 키를 snake_case에서 camelCase로 변환합니다.
 * 중첩된 객체와 배열도 재귀적으로 처리합니다.
 */
export function toCamelCase<T = Record<string, unknown>>(
  obj: Record<string, unknown>,
  recursive = true
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);

    if (recursive && value && typeof value === "object") {
      if (Array.isArray(value)) {
        result[camelKey] = value.map((item) =>
          typeof item === "object" && item !== null && !Array.isArray(item)
            ? toCamelCase(item as Record<string, unknown>, recursive)
            : item
        );
      } else if (value instanceof Date) {
        result[camelKey] = isDateStringsEnabled()
          ? formatDateToDbString(value)
          : value;
      } else {
        result[camelKey] = toCamelCase(
          value as Record<string, unknown>,
          recursive
        );
      }
    } else {
      result[camelKey] = value;
    }
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
