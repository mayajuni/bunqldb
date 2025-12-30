import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DB, getDbType, sql } from '../src';

// ============================================================
// 테스트 테이블 설정
// ============================================================

const TEST_TABLE = 'test_db_helpers';
const isMySQL = () => getDbType() === 'mysql';

async function createTestTable(): Promise<void> {
  if (isMySQL()) {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        seq INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        age INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        seq SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        age INT DEFAULT 0,
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

async function insertTestData(count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, email, status, age)
      VALUES (${`User${i}`}, ${`user${i}@test.com`}, ${i % 2 === 0 ? 'active' : 'inactive'}, ${
        20 + i
      })
    `;
  }
}

// ============================================================
// 테스트 시작/종료 설정
// ============================================================

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
  }
  console.log(`🔌 DB 타입: ${getDbType()}`);
  await createTestTable();
  await clearTestData();
});

afterAll(async () => {
  await dropTestTable();
  DB.close();
});

// ============================================================
// DB.many() 테스트
// ============================================================

describe('DB.many()', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(5);
  });

  test('여러 행을 조회하고 camelCase로 변환해야 한다', async () => {
    const result = await DB.many<{
      seq: number;
      name: string;
      email: string;
      createdAt: string;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`);

    expect(result).toHaveLength(5);
    expect(result[0].name).toBe('User1');
    expect(result[0]).toHaveProperty('createdAt'); // snake_case -> camelCase
  });

  test('조건에 맞는 행만 조회해야 한다', async () => {
    const result = await DB.many(sql`
      SELECT * FROM ${sql(TEST_TABLE)} 
      WHERE status = ${'active'}
    `);

    expect(result).toHaveLength(2); // User2, User4
    expect(result.every((r: any) => r.status === 'active')).toBe(true);
  });

  test('결과가 없으면 빈 배열을 반환해야 한다', async () => {
    const result = await DB.many(sql`
      SELECT * FROM ${sql(TEST_TABLE)} 
      WHERE name = ${'NonExistent'}
    `);

    expect(result).toEqual([]);
  });
});

// ============================================================
// DB.maybeOne() 테스트
// ============================================================

describe('DB.maybeOne()', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(3);
  });

  test('단일 행을 조회하고 camelCase로 변환해야 한다', async () => {
    const result = await DB.maybeOne<{ seq: number; name: string }>(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${1}
    `);

    expect(result).toBeDefined();
    expect(result?.name).toBe('User1');
  });

  test('결과가 없으면 undefined를 반환해야 한다', async () => {
    const result = await DB.maybeOne(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${9999}
    `);

    expect(result).toBeUndefined();
  });
});

// ============================================================
// DB.insert() 테스트
// ============================================================

describe('DB.insert()', () => {
  beforeAll(async () => {
    await clearTestData();
  });

  test('새 행을 삽입하고 생성된 ID를 반환해야 한다', async () => {
    let id: number;

    if (isMySQL()) {
      // MySQL: insertId 자동 반환
      id = await DB.insert(sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, email)
        VALUES (${'NewUser'}, ${'new@test.com'})
      `);
    } else {
      // PostgreSQL: RETURNING 사용
      id = await DB.insert(sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, email)
        VALUES (${'NewUser'}, ${'new@test.com'})
        RETURNING seq
      `);
    }

    expect(id).toBeGreaterThan(0);

    // 삽입 확인
    const inserted = await DB.maybeOne<{ name: string }>(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${id}
    `);
    expect(inserted?.name).toBe('NewUser');
  });

  test('여러 행을 삽입하면 각각 다른 ID를 반환해야 한다', async () => {
    const ids: number[] = [];

    for (let i = 1; i <= 3; i++) {
      let id: number;
      if (isMySQL()) {
        id = await DB.insert(sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, email)
          VALUES (${`BatchUser${i}`}, ${`batch${i}@test.com`})
        `);
      } else {
        id = await DB.insert(sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, email)
          VALUES (${`BatchUser${i}`}, ${`batch${i}@test.com`})
          RETURNING seq
        `);
      }
      ids.push(id);
    }

    // 모든 ID가 고유해야 함
    expect(new Set(ids).size).toBe(3);
    // ID가 순차적으로 증가해야 함
    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
  });
});

// ============================================================
// DB.update() 테스트
// ============================================================

describe('DB.update()', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(5);
  });

  test('단일 행을 업데이트하고 영향받은 행 수를 반환해야 한다', async () => {
    const affectedRows = await DB.update(sql`
      UPDATE ${sql(TEST_TABLE)} 
      SET name = ${'UpdatedUser'} 
      WHERE seq = ${1}
    `);

    expect(affectedRows).toBe(1);

    // 업데이트 확인
    const updated = await DB.maybeOne<{ name: string }>(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${1}
    `);
    expect(updated?.name).toBe('UpdatedUser');
  });

  test('여러 행을 업데이트하고 영향받은 행 수를 반환해야 한다', async () => {
    const affectedRows = await DB.update(sql`
      UPDATE ${sql(TEST_TABLE)} 
      SET status = ${'updated'} 
      WHERE status = ${'active'}
    `);

    expect(affectedRows).toBeGreaterThanOrEqual(1);

    // 업데이트 확인
    const result = await DB.many(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE status = ${'updated'}
    `);
    expect(result.length).toBe(affectedRows);
  });

  test('조건에 맞는 행이 없으면 0을 반환해야 한다', async () => {
    const affectedRows = await DB.update(sql`
      UPDATE ${sql(TEST_TABLE)} 
      SET name = ${'NoMatch'} 
      WHERE seq = ${9999}
    `);

    expect(affectedRows).toBe(0);
  });
});

// ============================================================
// DB.delete() 테스트
// ============================================================

describe('DB.delete()', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(10);
  });

  test('단일 행을 삭제하고 영향받은 행 수를 반환해야 한다', async () => {
    const affectedRows = await DB.delete(sql`
      DELETE FROM ${sql(TEST_TABLE)} WHERE seq = ${1}
    `);

    expect(affectedRows).toBe(1);

    // 삭제 확인
    const deleted = await DB.maybeOne(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${1}
    `);
    expect(deleted).toBeUndefined();
  });

  test('여러 행을 삭제하고 영향받은 행 수를 반환해야 한다', async () => {
    // inactive 상태인 행들 삭제 (User1, User3, User5, User7, User9 - 홀수)
    const affectedRows = await DB.delete(sql`
      DELETE FROM ${sql(TEST_TABLE)} WHERE status = ${'inactive'}
    `);

    expect(affectedRows).toBeGreaterThanOrEqual(1);

    // 삭제 확인
    const remaining = await DB.many(sql`
      SELECT * FROM ${sql(TEST_TABLE)} WHERE status = ${'inactive'}
    `);
    expect(remaining).toHaveLength(0);
  });

  test('조건에 맞는 행이 없으면 0을 반환해야 한다', async () => {
    const affectedRows = await DB.delete(sql`
      DELETE FROM ${sql(TEST_TABLE)} WHERE seq = ${9999}
    `);

    expect(affectedRows).toBe(0);
  });
});

// ============================================================
// DB.paginate() 테스트
// ============================================================

describe('DB.paginate()', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(25);
  });

  test('첫 페이지를 올바르게 조회해야 한다', async () => {
    const result = await DB.paginate<{
      seq: number;
      name: string;
      pagingIndex: number;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`, {
      page: 1,
      row: 10,
    });

    expect(result.data).toHaveLength(10);
    expect(result.totalRow).toBe(25);
    expect(result.data[0].name).toBe('User1');
    expect(result.data[0]).toHaveProperty('pagingIndex');
    expect(result.data[0].pagingIndex).toBe(25); // 첫 번째 항목의 pagingIndex
  });

  test('마지막 페이지를 올바르게 조회해야 한다', async () => {
    const result = await DB.paginate(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`, {
      page: 3,
      row: 10,
    });

    expect(result.data).toHaveLength(5); // 25개 중 마지막 5개
    expect(result.totalRow).toBe(25);
  });

  test('조건이 있는 쿼리도 페이징이 작동해야 한다', async () => {
    const result = await DB.paginate(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE status = ${'active'} ORDER BY seq`,
      { page: 1, row: 5 },
    );

    expect(result.data.length).toBeLessThanOrEqual(5);
    expect(result.data.every((r: any) => r.status === 'active')).toBe(true);
  });

  test('row가 0이면 전체 데이터를 반환해야 한다', async () => {
    const result = await DB.paginate(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`, {
      page: 1,
      row: 0,
    });

    expect(result.data).toHaveLength(25);
    expect(result.totalRow).toBe(25);
  });
});

// ============================================================
// DB.cursorPaginate() 테스트
// ============================================================

describe('DB.cursorPaginate()', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(20);
  });

  test('첫 페이지를 올바르게 조회해야 한다 (cursor: null)', async () => {
    const result = await DB.cursorPaginate<{ seq: number; name: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: null, limit: 5, isDesc: true },
    );

    expect(result.data).toHaveLength(5);
    expect(result.data[0].seq).toBe(20); // DESC이므로 가장 큰 seq
    expect(result.nextCursor).toBe(16); // 다음 커서
  });

  test('다음 페이지를 올바르게 조회해야 한다', async () => {
    // 첫 페이지
    const first = await DB.cursorPaginate<{ seq: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: null, limit: 5, isDesc: true },
    );

    // 두 번째 페이지
    const second = await DB.cursorPaginate<{ seq: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: first.nextCursor, limit: 5, isDesc: true },
    );

    expect(second.data).toHaveLength(5);
    expect(second.data[0].seq).toBe(15); // 16보다 작은 값
  });

  test('마지막 페이지에서 nextCursor가 null이어야 한다', async () => {
    const result = await DB.cursorPaginate<{ seq: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: 5, limit: 10, isDesc: true },
    );

    expect(result.data).toHaveLength(4); // seq 4, 3, 2, 1
    expect(result.nextCursor).toBeNull();
  });

  test('ASC 정렬도 올바르게 작동해야 한다', async () => {
    const result = await DB.cursorPaginate<{ seq: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: 'seq', cursor: null, limit: 5, isDesc: false },
    );

    expect(result.data[0].seq).toBe(1); // ASC이므로 가장 작은 seq
    expect(result.data[4].seq).toBe(5);
  });
});

// ============================================================
// 템플릿 리터럴 조합 테스트
// ============================================================

describe('템플릿 리터럴 조합', () => {
  beforeAll(async () => {
    await clearTestData();
    await insertTestData(10);
  });

  test('조건부 쿼리 조합이 올바르게 작동해야 한다', async () => {
    const status = 'active';
    const minAge = 22;

    // 조건부 조각 조합
    let query = sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`;

    if (status) {
      query = sql`${query} AND status = ${status}`;
    }

    if (minAge) {
      query = sql`${query} AND age >= ${minAge}`;
    }

    query = sql`${query} ORDER BY seq`;

    const result = await DB.many<{ status: string; age: number }>(query);

    expect(result.every((r) => r.status === 'active')).toBe(true);
    expect(result.every((r) => r.age >= minAge)).toBe(true);
  });

  test('동적 ORDER BY와 LIMIT 조합이 작동해야 한다', async () => {
    const orderColumn = 'age';
    const orderDir = 'DESC';
    const limitValue = 3;

    let query = sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE 1=1`;
    query = sql`${query} ORDER BY ${sql(orderColumn)} ${sql.unsafe(orderDir)}`;
    query = sql`${query} LIMIT ${limitValue}`;

    const result = await DB.many<{ age: number }>(query);

    expect(result).toHaveLength(3);
    // DESC 정렬 확인
    expect(result[0].age).toBeGreaterThanOrEqual(result[1].age);
    expect(result[1].age).toBeGreaterThanOrEqual(result[2].age);
  });
});
