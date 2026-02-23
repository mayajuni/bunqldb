import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DB, getDbType, sql } from '../src';

const TEST_TABLE = 'test_decimal_helpers';
const isMySQL = () => getDbType() === 'mysql';

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
  }
  console.log(`🔌 DB 타입: ${getDbType()}`);

  await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE)}`;

  if (isMySQL()) {
    await sql`
      CREATE TABLE ${sql(TEST_TABLE)} (
        seq INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        rate DECIMAL(5, 4),
        big_amount DECIMAL(20, 6),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } else {
    await sql`
      CREATE TABLE ${sql(TEST_TABLE)} (
        seq SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        rate DECIMAL(5, 4),
        big_amount DECIMAL(20, 6),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }
});

afterAll(async () => {
  await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE)}`;
  DB.close();
});

async function clearAndSeed(count: number) {
  if (isMySQL()) {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE)}`;
  } else {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE)} RESTART IDENTITY`;
  }

  for (let i = 1; i <= count; i++) {
    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, price, rate, big_amount)
      VALUES (${`Item${i}`}, ${(i * 10.5)}, ${(i * 0.0012)}, ${(i * 1234.567891)})
    `;
  }
}

// ============================================================
// DECIMAL 타입: raw SQL 반환값 확인
// ============================================================

describe('DECIMAL 타입 raw SQL 반환값', () => {
  beforeAll(() => clearAndSeed(3));

  test('DECIMAL 컬럼이 문자열로 반환되어야 한다 (Bun SQL 드라이버 동작)', async () => {
    const rows = await sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq` as Record<string, unknown>[];

    for (const row of rows) {
      expect(typeof row.price).toBe('string');
      expect(Number.isNaN(Number(row.price))).toBe(false);

      if (row.rate !== null) {
        expect(typeof row.rate).toBe('string');
        expect(Number.isNaN(Number(row.rate as string))).toBe(false);
      }

      if (row.big_amount !== null) {
        expect(typeof row.big_amount).toBe('string');
        expect(Number.isNaN(Number(row.big_amount as string))).toBe(false);
      }
    }
  });
});

// ============================================================
// DB.many() + DECIMAL
// ============================================================

describe('DB.many() + DECIMAL', () => {
  beforeAll(() => clearAndSeed(5));

  test('DECIMAL 값이 camelCase 변환 후에도 유효해야 한다', async () => {
    const result = await DB.many<{
      seq: number;
      name: string;
      price: string;
      rate: string | null;
      bigAmount: string | null;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`);

    expect(result).toHaveLength(5);

    for (const row of result) {
      expect(typeof row.price).toBe('string');
      expect(Number.isNaN(Number(row.price))).toBe(false);
      expect(Number(row.price)).toBeGreaterThan(0);

      expect(row).toHaveProperty('bigAmount');

      if (row.rate !== null) {
        expect(typeof row.rate).toBe('string');
        expect(Number.isNaN(Number(row.rate))).toBe(false);
      }

      if (row.bigAmount !== null) {
        expect(typeof row.bigAmount).toBe('string');
        expect(Number.isNaN(Number(row.bigAmount))).toBe(false);
      }
    }
  });

  test('Number() 변환이 정상 동작해야 한다', async () => {
    const result = await DB.many<{ price: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`,
    );

    const prices = result.map((r) => Number(r.price));
    expect(prices.every((p) => !Number.isNaN(p))).toBe(true);
    expect(prices[0]).toBeCloseTo(10.5, 1);
    expect(prices[1]).toBeCloseTo(21.0, 1);
  });
});

// ============================================================
// DB.maybeOne() + DECIMAL
// ============================================================

describe('DB.maybeOne() + DECIMAL', () => {
  beforeAll(() => clearAndSeed(3));

  test('단일 행의 DECIMAL 값이 정상이어야 한다', async () => {
    const row = await DB.maybeOne<{
      seq: number;
      name: string;
      price: string;
      rate: string | null;
      bigAmount: string | null;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${1}`);

    expect(row).toBeDefined();
    expect(typeof row!.price).toBe('string');
    expect(Number(row!.price)).toBeCloseTo(10.5, 1);
    expect(row!).toHaveProperty('bigAmount');
  });

  test('DECIMAL이 [object Object]나 NaN이 아니어야 한다', async () => {
    const row = await DB.maybeOne<{ price: string; rate: string | null }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${1}`,
    );

    expect(String(row!.price)).not.toBe('[object Object]');
    expect(Number.isNaN(Number(row!.price))).toBe(false);

    if (row!.rate !== null) {
      expect(String(row!.rate)).not.toBe('[object Object]');
      expect(Number.isNaN(Number(row!.rate))).toBe(false);
    }
  });
});

// ============================================================
// DB.insert() + DECIMAL
// ============================================================

describe('DB.insert() + DECIMAL', () => {
  beforeAll(() => clearAndSeed(0));

  test('DECIMAL 값 삽입 후 ID를 정상 반환해야 한다', async () => {
    let id: number;
    if (isMySQL()) {
      id = await DB.insert(sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, price, rate, big_amount)
        VALUES (${'DecimalTest'}, ${99.99}, ${1.2345}, ${987654.321})
      `);
    } else {
      id = await DB.insert(sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, price, rate, big_amount)
        VALUES (${'DecimalTest'}, ${99.99}, ${1.2345}, ${987654.321})
        RETURNING seq
      `);
    }

    expect(id).toBeGreaterThan(0);

    const inserted = await DB.maybeOne<{ name: string; price: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${id}`,
    );
    expect(inserted?.name).toBe('DecimalTest');
    expect(Number(inserted!.price)).toBeCloseTo(99.99, 1);
  });
});

// ============================================================
// DB.paginate() + DECIMAL
// ============================================================

describe('DB.paginate() + DECIMAL', () => {
  beforeAll(() => clearAndSeed(15));

  test('페이지네이션 결과의 DECIMAL 값이 정상이어야 한다', async () => {
    const result = await DB.paginate<{
      seq: number;
      price: string;
      bigAmount: string | null;
      pagingIndex: number;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`, {
      page: 1,
      row: 5,
    });

    expect(result.data).toHaveLength(5);
    expect(result.totalRow).toBe(15);

    for (const row of result.data) {
      expect(typeof row.price).toBe('string');
      expect(Number.isNaN(Number(row.price))).toBe(false);
      expect(String(row.price)).not.toBe('[object Object]');

      if (row.bigAmount !== null) {
        expect(typeof row.bigAmount).toBe('string');
        expect(Number.isNaN(Number(row.bigAmount))).toBe(false);
      }
    }
  });

  test('totalRow의 COUNT 결과가 DECIMAL이 아닌 숫자여야 한다', async () => {
    const result = await DB.paginate(
      sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`,
      { page: 1, row: 5 },
    );

    expect(typeof result.totalRow).toBe('number');
    expect(result.totalRow).toBe(15);
  });
});

// ============================================================
// DB.cursorPaginate() + DECIMAL
// ============================================================

describe('DB.cursorPaginate() + DECIMAL', () => {
  beforeAll(() => clearAndSeed(10));

  test('커서 페이지네이션 결과의 DECIMAL 값이 정상이어야 한다', async () => {
    const result = await DB.cursorPaginate<{
      seq: number;
      price: string;
      rate: string | null;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`, {
      cursorColumn: 'seq',
      cursor: null,
      limit: 5,
      isDesc: true,
    });

    expect(result.data).toHaveLength(5);

    for (const row of result.data) {
      expect(typeof row.price).toBe('string');
      expect(Number.isNaN(Number(row.price))).toBe(false);
      expect(String(row.price)).not.toBe('[object Object]');
    }
  });

  test('다음 페이지 커서 이동 후에도 DECIMAL 값이 정상이어야 한다', async () => {
    const first = await DB.cursorPaginate<{ seq: number; price: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: null, limit: 5, isDesc: true },
    );

    const second = await DB.cursorPaginate<{ seq: number; price: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: first.nextCursor, limit: 5, isDesc: true },
    );

    expect(second.data).toHaveLength(5);

    for (const row of second.data) {
      expect(typeof row.price).toBe('string');
      expect(Number.isNaN(Number(row.price))).toBe(false);
    }
  });
});

// ============================================================
// DECIMAL NULL 처리
// ============================================================

describe('DECIMAL NULL 처리', () => {
  beforeAll(async () => {
    if (isMySQL()) {
      await sql`TRUNCATE TABLE ${sql(TEST_TABLE)}`;
    } else {
      await sql`TRUNCATE TABLE ${sql(TEST_TABLE)} RESTART IDENTITY`;
    }

    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, price, rate, big_amount)
      VALUES (${'NullTest'}, ${0}, ${null}, ${null})
    `;
  });

  test('NULL DECIMAL 값이 null로 반환되어야 한다', async () => {
    const row = await DB.maybeOne<{
      price: string;
      rate: string | null;
      bigAmount: string | null;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${'NullTest'}`);

    expect(row).toBeDefined();
    expect(row!.rate).toBeNull();
    expect(row!.bigAmount).toBeNull();
    expect(Number(row!.price)).toBe(0);
  });
});
