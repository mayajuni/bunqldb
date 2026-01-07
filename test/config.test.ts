import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  configureDb,
  DB,
  getDbType,
  isDateStringsEnabled,
  isSqlLoggingEnabled,
  sql,
  type SqlLogger,
} from "../src";

// ============================================================
// 테스트 테이블 설정
// ============================================================

const TEST_TABLE = "test_config";
const TEST_DATE_TABLE = "test_date_type";
const isMySQL = () => getDbType() === "mysql";

async function createTestTable(): Promise<void> {
  if (isMySQL()) {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    // DATE 타입 테스트용 테이블
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_DATE_TABLE)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100),
        only_date DATE,
        date_time DATETIME
      )
    `;
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    // DATE 타입 테스트용 테이블
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_DATE_TABLE)} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        only_date DATE,
        date_time TIMESTAMP
      )
    `;
  }
}

async function dropTestTable(): Promise<void> {
  await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE)}`;
  await sql`DROP TABLE IF EXISTS ${sql(TEST_DATE_TABLE)}`;
}

async function clearTestData(): Promise<void> {
  if (isMySQL()) {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE)}`;
  } else {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE)} RESTART IDENTITY`;
  }
}

// ============================================================
// 테스트 시작/종료 설정
// ============================================================

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  }
  console.log(`🔌 DB 타입: ${getDbType()}`);
  await createTestTable();
  await clearTestData();
});

afterAll(async () => {
  await dropTestTable();
  DB.close();
});

// 각 테스트 후 설정 초기화
afterEach(() => {
  configureDb({ dateStrings: false, logging: { enabled: false } });
});

// ============================================================
// configureDb() 테스트
// ============================================================

describe("configureDb()", () => {
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
});

// ============================================================
// dateStrings 옵션 동작 테스트
// ============================================================

describe("dateStrings 옵션", () => {
  beforeAll(async () => {
    await clearTestData();
    // 테스트 데이터 삽입
    if (isMySQL()) {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, created_at) 
        VALUES (${"TestUser"}, ${"2025-12-05 04:23:18"})
      `;
    } else {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, created_at) 
        VALUES (${"TestUser"}, ${"2025-12-05 04:23:18"})
      `;
    }
  });

  test("dateStrings: false (기본값)일 때 Date 객체를 반환해야 한다", async () => {
    configureDb({ dateStrings: false });

    const result = await DB.maybeOne<{ createdAt: Date | string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`
    );

    expect(result).toBeDefined();
    // Bun SQL은 Date 객체로 변환
    expect(result!.createdAt instanceof Date).toBe(true);
  });

  test("dateStrings: true일 때 MySQL 형식 문자열을 반환해야 한다", async () => {
    configureDb({ dateStrings: true });

    const result = await DB.maybeOne<{ createdAt: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`
    );

    expect(result).toBeDefined();
    expect(typeof result!.createdAt).toBe("string");
    // MySQL 형식: 'YYYY-MM-DD HH:mm:ss'
    expect(result!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("dateStrings 옵션 변경이 즉시 반영되어야 한다", async () => {
    // 먼저 Date 객체로 조회
    configureDb({ dateStrings: false });
    const result1 = await DB.maybeOne<{ createdAt: Date | string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`
    );
    expect(result1!.createdAt instanceof Date).toBe(true);

    // dateStrings를 true로 변경
    configureDb({ dateStrings: true });
    const result2 = await DB.maybeOne<{ createdAt: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`
    );
    expect(typeof result2!.createdAt).toBe("string");
    expect(result2!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

// ============================================================
// DATE 타입 vs DATETIME 타입 테스트
// ============================================================

describe("DATE 타입 vs DATETIME 타입", () => {
  beforeAll(async () => {
    // DATE 타입 테스트 데이터 삽입
    await sql`
      INSERT INTO ${sql(TEST_DATE_TABLE)} (name, only_date, date_time)
      VALUES (${"DateTest"}, ${"2023-07-01"}, ${"2023-07-01 14:30:00"})
    `;
  });

  afterAll(async () => {
    if (isMySQL()) {
      await sql`TRUNCATE TABLE ${sql(TEST_DATE_TABLE)}`;
    } else {
      await sql`TRUNCATE TABLE ${sql(TEST_DATE_TABLE)} RESTART IDENTITY`;
    }
  });

  test("dateStrings: true일 때 DATE 타입은 날짜만 반환해야 한다", async () => {
    configureDb({ dateStrings: true });

    const result = await DB.maybeOne<{ onlyDate: string; dateTime: string }>(
      sql`SELECT * FROM ${sql(TEST_DATE_TABLE)} WHERE name = ${"DateTest"}`
    );

    expect(result).toBeDefined();
    // DATE 타입: 'YYYY-MM-DD' 형식 (시간 없음)
    expect(result!.onlyDate).toBe("2023-07-01");
    // DATETIME 타입: 'YYYY-MM-DD HH:mm:ss' 형식
    expect(result!.dateTime).toBe("2023-07-01 14:30:00");
  });

  test("dateStrings: false일 때 두 타입 모두 Date 객체여야 한다", async () => {
    configureDb({ dateStrings: false });

    const result = await DB.maybeOne<{ onlyDate: Date; dateTime: Date }>(
      sql`SELECT * FROM ${sql(TEST_DATE_TABLE)} WHERE name = ${"DateTest"}`
    );

    expect(result).toBeDefined();
    expect(result!.onlyDate instanceof Date).toBe(true);
    expect(result!.dateTime instanceof Date).toBe(true);
  });
});

// ============================================================
// DB.many()에서 dateStrings 동작 테스트
// ============================================================

describe("DB.many()에서 dateStrings 동작", () => {
  beforeAll(async () => {
    await clearTestData();
    // 여러 테스트 데이터 삽입
    for (let i = 1; i <= 3; i++) {
      if (isMySQL()) {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, created_at) 
          VALUES (${`User${i}`}, ${`2025-12-0${i} 10:00:00`})
        `;
      } else {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, created_at) 
          VALUES (${`User${i}`}, ${`2025-12-0${i} 10:00:00`})
        `;
      }
    }
  });

  test("dateStrings: true일 때 모든 행의 날짜가 문자열이어야 한다", async () => {
    configureDb({ dateStrings: true });

    const results = await DB.many<{ name: string; createdAt: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY id`
    );

    expect(results).toHaveLength(3);
    for (const row of results) {
      expect(typeof row.createdAt).toBe("string");
      expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });
});

// ============================================================
// 페이지네이션에서 dateStrings 동작 테스트
// ============================================================

describe("페이지네이션에서 dateStrings 동작", () => {
  beforeAll(async () => {
    await clearTestData();
    // 테스트 데이터 삽입
    for (let i = 1; i <= 5; i++) {
      if (isMySQL()) {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, created_at) 
          VALUES (${`PaginateUser${i}`}, ${`2025-12-0${i} 12:00:00`})
        `;
      } else {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, created_at) 
          VALUES (${`PaginateUser${i}`}, ${`2025-12-0${i} 12:00:00`})
        `;
      }
    }
  });

  test("DB.paginate()에서 dateStrings가 적용되어야 한다", async () => {
    configureDb({ dateStrings: true });

    const result = await DB.paginate<{ name: string; createdAt: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY id`,
      { page: 1, row: 10 }
    );

    expect(result.data).toHaveLength(5);
    for (const row of result.data) {
      expect(typeof row.createdAt).toBe("string");
      expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  test("DB.cursorPaginate()에서 dateStrings가 적용되어야 한다", async () => {
    configureDb({ dateStrings: true });

    const result = await DB.cursorPaginate<{ name: string; createdAt: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: "id", cursor: null, limit: 3, isDesc: false }
    );

    expect(result.data).toHaveLength(3);
    for (const row of result.data) {
      expect(typeof row.createdAt).toBe("string");
      expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });
});
