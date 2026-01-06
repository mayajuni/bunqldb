import { afterEach, describe, expect, test } from "bun:test";
import {
  configureDb,
  isDateStringsEnabled,
  isSqlLoggingEnabled,
  toCamelCase,
  toCamelCaseArray,
  type SqlLogger,
} from "../src";

// 각 테스트 후 설정 초기화
afterEach(() => {
  configureDb({ dateStrings: false, logging: { enabled: false } });
});

// ============================================================
// configureDb() 단위 테스트
// ============================================================

describe("configureDb() 단위 테스트", () => {
  test("dateStrings 옵션을 설정할 수 있어야 한다", () => {
    expect(isDateStringsEnabled()).toBe(false); // 기본값

    configureDb({ dateStrings: true });
    expect(isDateStringsEnabled()).toBe(true);

    configureDb({ dateStrings: false });
    expect(isDateStringsEnabled()).toBe(false);
  });

  test("logging 옵션을 설정할 수 있어야 한다", () => {
    expect(isSqlLoggingEnabled()).toBe(false); // 기본값

    configureDb({ logging: { enabled: true } });
    expect(isSqlLoggingEnabled()).toBe(true);

    configureDb({ logging: { enabled: false } });
    expect(isSqlLoggingEnabled()).toBe(false);
  });

  test("logging과 dateStrings를 함께 설정할 수 있어야 한다", () => {
    configureDb({
      logging: { enabled: true },
      dateStrings: true,
    });

    expect(isSqlLoggingEnabled()).toBe(true);
    expect(isDateStringsEnabled()).toBe(true);
  });

  test("커스텀 로거를 설정할 수 있어야 한다", () => {
    const logs: string[] = [];
    const customLogger: SqlLogger = {
      info: (msg) =>
        logs.push(
          `INFO: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`
        ),
      error: (msg) =>
        logs.push(
          `ERROR: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`
        ),
    };

    configureDb({
      logging: { enabled: true, logger: customLogger },
    });

    expect(isSqlLoggingEnabled()).toBe(true);
  });

  test("undefined 옵션은 기존 값을 유지해야 한다", () => {
    // dateStrings만 설정
    configureDb({ dateStrings: true });
    expect(isDateStringsEnabled()).toBe(true);
    expect(isSqlLoggingEnabled()).toBe(false);

    // logging만 설정 - dateStrings는 유지되어야 함
    configureDb({ logging: { enabled: true } });
    expect(isDateStringsEnabled()).toBe(true);
    expect(isSqlLoggingEnabled()).toBe(true);
  });
});

// ============================================================
// toCamelCase dateStrings 변환 테스트
// ============================================================

describe("toCamelCase() dateStrings 변환", () => {
  test("dateStrings: false일 때 Date 객체를 그대로 유지해야 한다", () => {
    configureDb({ dateStrings: false });

    const date = new Date("2025-12-05T04:23:18.000Z");
    const input = { created_at: date, name: "test" };
    const result = toCamelCase<{ createdAt: Date; name: string }>(input);

    expect(result.createdAt).toBe(date);
    expect(result.createdAt instanceof Date).toBe(true);
  });

  test("dateStrings: true일 때 Date 객체를 MySQL 형식 문자열로 변환해야 한다", () => {
    configureDb({ dateStrings: true });

    const date = new Date(2025, 11, 5, 4, 23, 18); // 2025-12-05 04:23:18 (로컬 시간)
    const input = { created_at: date, name: "test" };
    const result = toCamelCase<{ createdAt: string; name: string }>(input);

    expect(typeof result.createdAt).toBe("string");
    expect(result.createdAt).toBe("2025-12-05 04:23:18");
  });

  test("dateStrings: true일 때 시간이 한 자리 수여도 0이 패딩되어야 한다", () => {
    configureDb({ dateStrings: true });

    const date = new Date(2025, 0, 1, 1, 2, 3); // 2025-01-01 01:02:03
    const input = { created_at: date };
    const result = toCamelCase<{ createdAt: string }>(input);

    expect(result.createdAt).toBe("2025-01-01 01:02:03");
  });

  test("dateStrings가 배열 내의 Date에도 적용되어야 한다", () => {
    configureDb({ dateStrings: true });

    const date1 = new Date(2025, 11, 1, 10, 0, 0);
    const date2 = new Date(2025, 11, 2, 11, 0, 0);

    const input = [
      { id: 1, created_at: date1 },
      { id: 2, created_at: date2 },
    ];

    const result = toCamelCaseArray<{ id: number; createdAt: string }>(input);

    expect(result).toHaveLength(2);
    expect(result[0].createdAt).toBe("2025-12-01 10:00:00");
    expect(result[1].createdAt).toBe("2025-12-02 11:00:00");
  });

  test("dateStrings가 중첩된 객체의 Date에도 적용되어야 한다", () => {
    configureDb({ dateStrings: true });

    const date = new Date(2025, 11, 5, 12, 30, 45);
    const input = {
      user_name: "test",
      profile: {
        birth_date: date,
        address: {
          created_at: date,
        },
      },
    };

    const result = toCamelCase<{
      userName: string;
      profile: {
        birthDate: string;
        address: {
          createdAt: string;
        };
      };
    }>(input);

    expect(result.profile.birthDate).toBe("2025-12-05 12:30:45");
    expect(result.profile.address.createdAt).toBe("2025-12-05 12:30:45");
  });

  test("dateStrings 옵션 변경이 즉시 반영되어야 한다", () => {
    const date = new Date(2025, 11, 5, 4, 23, 18);

    // false로 시작
    configureDb({ dateStrings: false });
    const result1 = toCamelCase<{ createdAt: Date }>({ created_at: date });
    expect(result1.createdAt instanceof Date).toBe(true);

    // true로 변경
    configureDb({ dateStrings: true });
    const result2 = toCamelCase<{ createdAt: string }>({ created_at: date });
    expect(typeof result2.createdAt).toBe("string");
    expect(result2.createdAt).toBe("2025-12-05 04:23:18");
  });

  test("dateStrings: true일 때 시간이 00:00:00이면 날짜만 반환해야 한다 (DATE 타입 호환)", () => {
    configureDb({ dateStrings: true });

    // DATE 타입처럼 시간이 00:00:00인 경우
    const dateOnly = new Date(2023, 6, 1, 0, 0, 0); // 2023-07-01 00:00:00
    const input = { birth_date: dateOnly };
    const result = toCamelCase<{ birthDate: string }>(input);

    expect(result.birthDate).toBe("2023-07-01");
  });

  test("dateStrings: true일 때 시간이 있으면 전체 형식을 반환해야 한다", () => {
    configureDb({ dateStrings: true });

    // DATETIME 타입처럼 시간이 있는 경우
    const dateTime = new Date(2023, 6, 1, 14, 30, 0); // 2023-07-01 14:30:00
    const input = { created_at: dateTime };
    const result = toCamelCase<{ createdAt: string }>(input);

    expect(result.createdAt).toBe("2023-07-01 14:30:00");
  });
});

// ============================================================
// null/undefined 처리 테스트
// ============================================================

describe("null/undefined 날짜 처리", () => {
  test("null 날짜 값은 그대로 null을 반환해야 한다", () => {
    configureDb({ dateStrings: true });

    const input = { created_at: null, name: "test" };
    const result = toCamelCase<{ createdAt: null; name: string }>(input);

    expect(result.createdAt).toBeNull();
  });

  test("undefined 날짜 값은 그대로 undefined를 반환해야 한다", () => {
    configureDb({ dateStrings: true });

    const input = { created_at: undefined, name: "test" };
    const result = toCamelCase<{ createdAt: undefined; name: string }>(input);

    expect(result.createdAt).toBeUndefined();
  });
});
