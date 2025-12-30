import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { DB, getBaseSql, getDbType, sql, Transactional } from '../src';

// ============================================================
// 테스트 테이블 설정
// ============================================================

const TEST_TABLE = 'test_transaction';
const isMySQL = () => getDbType() === 'mysql';

async function createTestTable(): Promise<void> {
  if (isMySQL()) {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        seq INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        balance INT DEFAULT 0
      )
    `;
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        seq SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        balance INT DEFAULT 0
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
    throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
  }
  console.log(`🔌 DB 타입: ${getDbType()}`);
  await createTestTable();
});

beforeEach(async () => {
  await clearTestData();
});

afterAll(async () => {
  await dropTestTable();
  DB.close();
});

// ============================================================
// sql.begin() 트랜잭션 테스트
// ============================================================

describe('sql.begin() 트랜잭션', () => {
  test('트랜잭션 내 모든 작업이 커밋되어야 한다', async () => {
    const baseSql = getBaseSql();

    await baseSql.begin(async (tx) => {
      await tx`INSERT INTO ${sql(
        TEST_TABLE,
      )} (name, balance) VALUES (${'Alice'}, ${1000})`;
      await tx`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${'Bob'}, ${500})`;
    });

    const result = await DB.many(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe('Bob');
  });

  test('에러 발생 시 트랜잭션이 롤백되어야 한다', async () => {
    const baseSql = getBaseSql();

    try {
      await baseSql.begin(async (tx) => {
        await tx`INSERT INTO ${sql(
          TEST_TABLE,
        )} (name, balance) VALUES (${'Alice'}, ${1000})`;
        throw new Error('의도적인 에러');
      });
    } catch (error) {
      // 에러가 발생해야 함
      expect(error).toBeDefined();
    }

    // 롤백되어 데이터가 없어야 함
    const result = await DB.many(sql`SELECT * FROM ${sql(TEST_TABLE)}`);
    expect(result).toHaveLength(0);
  });

  test('트랜잭션 내에서 UPDATE와 SELECT가 올바르게 작동해야 한다', async () => {
    const baseSql = getBaseSql();

    // 초기 데이터 삽입
    await sql`INSERT INTO ${sql(
      TEST_TABLE,
    )} (name, balance) VALUES (${'Alice'}, ${1000})`;
    await sql`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${'Bob'}, ${500})`;

    await baseSql.begin(async (tx) => {
      // Alice에서 Bob으로 200 이체
      await tx`UPDATE ${sql(
        TEST_TABLE,
      )} SET balance = balance - 200 WHERE name = ${'Alice'}`;
      await tx`UPDATE ${sql(
        TEST_TABLE,
      )} SET balance = balance + 200 WHERE name = ${'Bob'}`;
    });

    const alice = await DB.maybeOne<{ balance: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${'Alice'}`,
    );
    const bob = await DB.maybeOne<{ balance: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${'Bob'}`,
    );

    expect(alice?.balance).toBe(800);
    expect(bob?.balance).toBe(700);
  });
});

// ============================================================
// Savepoint 테스트
// ============================================================

describe('Savepoint (부분 롤백)', () => {
  test('savepoint 내부 에러가 발생해도 외부 트랜잭션은 유지되어야 한다', async () => {
    const baseSql = getBaseSql();

    await baseSql.begin(async (tx) => {
      await tx`INSERT INTO ${sql(
        TEST_TABLE,
      )} (name, balance) VALUES (${'Alice'}, ${1000})`;

      try {
        await tx.savepoint(async (sp) => {
          await sp`INSERT INTO ${sql(
            TEST_TABLE,
          )} (name, balance) VALUES (${'Bob'}, ${500})`;
          throw new Error('Savepoint 내부 에러');
        });
      } catch {
        // savepoint 에러 무시
      }

      // Alice는 유지되어야 함
      await tx`INSERT INTO ${sql(
        TEST_TABLE,
      )} (name, balance) VALUES (${'Charlie'}, ${300})`;
    });

    const result = await DB.many(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe('Charlie');
    // Bob은 savepoint 롤백으로 없어야 함
    expect(result.find((r: any) => r.name === 'Bob')).toBeUndefined();
  });
});

// ============================================================
// @Transactional 데코레이터 테스트
// ============================================================

describe('@Transactional 데코레이터', () => {
  class TestService {
    @Transactional()
    async createUser(name: string, balance: number): Promise<number> {
      if (isMySQL()) {
        // MySQL: insertId 자동 반환
        return await DB.insert(sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, balance) 
          VALUES (${name}, ${balance})
        `);
      } else {
        // PostgreSQL: RETURNING 사용
        return await DB.insert(sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, balance) 
          VALUES (${name}, ${balance})
          RETURNING seq
        `);
      }
    }

    @Transactional()
    async createUserWithError(name: string): Promise<void> {
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${name}, ${100})`;
      throw new Error('의도적인 에러');
    }

    @Transactional()
    async transferMoney(fromName: string, toName: string, amount: number): Promise<void> {
      await sql`UPDATE ${sql(
        TEST_TABLE,
      )} SET balance = balance - ${amount} WHERE name = ${fromName}`;
      await sql`UPDATE ${sql(
        TEST_TABLE,
      )} SET balance = balance + ${amount} WHERE name = ${toName}`;
    }

    @Transactional()
    async nestedTransaction(name: string): Promise<void> {
      await sql`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${name}, ${100})`;
      // 중첩 호출 (기존 트랜잭션 재사용)
      await this.createUser(`${name}_nested`, 50);
    }
  }

  const service = new TestService();

  test('트랜잭션 내 작업이 커밋되어야 한다', async () => {
    const seq = await service.createUser('TestUser', 1000);

    expect(seq).toBeGreaterThan(0);

    const user = await DB.maybeOne<{ name: string }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE seq = ${seq}`,
    );
    expect(user?.name).toBe('TestUser');
  });

  test('에러 발생 시 롤백되어야 한다', async () => {
    try {
      await service.createUserWithError('FailUser');
    } catch (error) {
      expect(error).toBeDefined();
    }

    // 롤백되어 데이터가 없어야 함
    const user = await DB.maybeOne(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${'FailUser'}`,
    );
    expect(user).toBeUndefined();
  });

  test('이체 트랜잭션이 올바르게 작동해야 한다', async () => {
    // 초기 데이터
    await sql`INSERT INTO ${sql(
      TEST_TABLE,
    )} (name, balance) VALUES (${'Alice'}, ${1000})`;
    await sql`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${'Bob'}, ${500})`;

    await service.transferMoney('Alice', 'Bob', 300);

    const alice = await DB.maybeOne<{ balance: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${'Alice'}`,
    );
    const bob = await DB.maybeOne<{ balance: number }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${'Bob'}`,
    );

    expect(alice?.balance).toBe(700);
    expect(bob?.balance).toBe(800);
  });

  test('중첩 트랜잭션이 기존 트랜잭션을 재사용해야 한다', async () => {
    await service.nestedTransaction('Parent');

    const result = await DB.many(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY seq`);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Parent');
    expect(result[1].name).toBe('Parent_nested');
  });
});

// ============================================================
// 병렬 쿼리 테스트
// ============================================================

describe('병렬 쿼리 실행', () => {
  test('트랜잭션 내에서 병렬 쿼리가 올바르게 실행되어야 한다', async () => {
    const baseSql = getBaseSql();

    await baseSql.begin(async (tx) => {
      // 병렬로 여러 INSERT 실행
      await Promise.all([
        tx`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${'User1'}, ${100})`,
        tx`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${'User2'}, ${200})`,
        tx`INSERT INTO ${sql(TEST_TABLE)} (name, balance) VALUES (${'User3'}, ${300})`,
      ]);
    });

    const result = await DB.many(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY name`);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('User1');
    expect(result[1].name).toBe('User2');
    expect(result[2].name).toBe('User3');
  });
});
