import { isDateStringsEnabled } from "../internal/internal-db";

/**
 * Date 객체를 MySQL 형식 문자열로 변환합니다.
 * 시간이 00:00:00인 경우 날짜만 반환합니다 (DATE 타입 호환).
 * @example
 * formatDateToMySql(new Date('2023-07-01')) // '2023-07-01'
 * formatDateToMySql(new Date('2023-07-01 14:30:00')) // '2023-07-01 14:30:00'
 */
function formatDateToMySql(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;

  // 시간이 00:00:00인 경우 날짜만 반환 (DATE 타입 호환)
  if (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0
  ) {
    return datePart;
  }

  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
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
          ? formatDateToMySql(value)
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
