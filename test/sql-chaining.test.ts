import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import {
  configureDb,
  DB,
  getDbType,
  sql,
} from "../src";

// ============================================================
// 테스트 테이블 설정
// ============================================================

const TEST_TABLE = "test_sql_chaining";
const isMySQL = () => getDbType() === "mysql";

async function createTestTable(): Promise<void> {
  if (isMySQL()) {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }
}

async function dropTestTable(): Promise<void> {
  await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE)}`;
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
afterEach(async () => {
  configureDb({ logging: { enabled: false } });
  await clearTestData();
});

// ============================================================
// sql.verbose 테스트
// ============================================================

describe("sql.verbose", () => {
  test("전역 로깅이 꺼져 있어도 sql.verbose는 로깅해야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      // 전역 로깅 OFF
      configureDb({ logging: { enabled: false } });

      // 일반 sql - 로깅 안됨
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"NormalUser"})`;
      expect(logs.length).toBe(0);

      // sql.verbose - 강제 로깅
      await sql.verbose`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"VerboseUser"})`;

      // verbose는 전역 설정 무시하고 로깅해야 함
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((log) => log.includes("VerboseUser"))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("sql.verbose로 조회한 결과가 정상적으로 반환되어야 한다", async () => {
    // 테스트 데이터 삽입
    await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"TestUser"})`;

    // sql.verbose로 조회
    const result = await sql.verbose`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("TestUser");
  });
});

// ============================================================
// sql.silent 테스트
// ============================================================

describe("sql.silent", () => {
  test("전역 로깅이 켜져 있어도 sql.silent는 로깅하지 않아야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      // 전역 로깅 ON
      configureDb({ logging: { enabled: true } });

      // 일반 sql - 로깅됨
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"NormalUser"})`;
      const logsAfterNormal = logs.length;
      expect(logsAfterNormal).toBeGreaterThan(0);

      // sql.silent - 로깅 안됨
      await sql.silent`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"SilentUser"})`;

      // silent 쿼리는 로깅되지 않아야 함
      expect(logs.length).toBe(logsAfterNormal);
      expect(logs.some((log) => log.includes("SilentUser"))).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("sql.silent로 조회한 결과가 정상적으로 반환되어야 한다", async () => {
    // 테스트 데이터 삽입
    await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"TestUser"})`;

    // sql.silent로 조회
    const result = await sql.silent`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("TestUser");
  });
});

// ============================================================
// DB 헬퍼와 체이닝 조합 테스트
// ============================================================

describe("DB 헬퍼와 체이닝 조합", () => {
  test("DB.many()에서 sql.silent가 정상 작동해야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      configureDb({ logging: { enabled: true } });

      // 테스트 데이터 삽입
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"User1"})`;
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"User2"})`;
      const logsAfterInsert = logs.length;

      // DB.many()와 sql.silent 조합
      const users = await DB.many<{ id: number; name: string }>(
        sql.silent`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY id`
      );

      expect(users.length).toBe(2);
      expect(users[0].name).toBe("User1");
      expect(users[1].name).toBe("User2");
      // silent 쿼리는 로깅되지 않아야 함
      expect(logs.length).toBe(logsAfterInsert);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("DB.maybeOne()에서 sql.silent가 정상 작동해야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      configureDb({ logging: { enabled: true } });

      // 테스트 데이터 삽입
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"TestUser"})`;
      const logsAfterInsert = logs.length;

      // DB.maybeOne()과 sql.silent 조합
      const user = await DB.maybeOne<{ id: number; name: string }>(
        sql.silent`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`
      );

      expect(user).toBeDefined();
      expect(user!.name).toBe("TestUser");
      // silent 쿼리는 로깅되지 않아야 함
      expect(logs.length).toBe(logsAfterInsert);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("DB.many()에서 sql.verbose가 정상 작동해야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      // 전역 로깅 OFF
      configureDb({ logging: { enabled: false } });

      // 테스트 데이터 삽입 (로깅 안됨)
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"User1"})`;
      expect(logs.length).toBe(0);

      // DB.many()와 sql.verbose 조합 - 강제 로깅
      const users = await DB.many<{ id: number; name: string }>(
        sql.verbose`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY id`
      );

      expect(users.length).toBe(1);
      expect(users[0].name).toBe("User1");
      // verbose 쿼리는 전역 설정 무시하고 로깅해야 함
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ============================================================
// 기본 동작 테스트 (전역 설정 따름)
// ============================================================

describe("기본 sql 동작 (전역 설정 따름)", () => {
  test("전역 로깅 ON일 때 일반 sql은 로깅되어야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      configureDb({ logging: { enabled: true } });

      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"TestUser"})`;

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((log) => log.includes("TestUser"))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("전역 로깅 OFF일 때 일반 sql은 로깅되지 않아야 한다", async () => {
    const logs: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      configureDb({ logging: { enabled: false } });

      await sql`INSERT INTO ${sql(TEST_TABLE)} (name) VALUES (${"TestUser"})`;

      expect(logs.length).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
