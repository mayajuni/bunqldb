import {
  afterAll,
  beforeAll,
  describe,
  test,
} from "bun:test";
import {
  DB,
  getDbType,
  sql,
} from "../src";
import { SQL } from "bun";

// ============================================================
// 테스트 테이블 설정
// ============================================================

const TEST_TABLE = "test_json_solutions";
const isMySQL = () => getDbType() === "mysql";

async function createTestTable(): Promise<void> {
  if (isMySQL()) {
    console.log("MySQL은 이 테스트를 스킵합니다.");
    return;
  }

  // PostgreSQL: JSONB, JSON, ARRAY 타입 테스트
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      data_jsonb JSONB,
      data_json JSON,
      int_array INTEGER[],
      text_array TEXT[]
    )
  `;
}

async function dropTestTable(): Promise<void> {
  if (!isMySQL()) {
    await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE)}`;
  }
}

async function clearTestData(): Promise<void> {
  if (!isMySQL()) {
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
  console.log(`📋 테스트: JSON/JSONB/ARRAY 타입 해결책 검증`);
  
  if (isMySQL()) {
    console.log("MySQL은 이 테스트를 지원하지 않습니다.");
    return;
  }
  
  await dropTestTable();
  await createTestTable();
});

afterAll(async () => {
  await dropTestTable();
  DB.close();
});

// ============================================================
// sql.array() 헬퍼 테스트
// ============================================================

describe("sql.array() 헬퍼 테스트", () => {
  test("sql.array()가 존재하는지 확인", async () => {
    if (isMySQL()) {
      console.log("MySQL 스킵");
      return;
    }

    // sql.array 헬퍼가 존재하는지 확인
    console.log("\n📊 sql.array 헬퍼 확인:");
    console.log(`  - typeof sql.array: ${typeof (sql as any).array}`);
    
    if (typeof (sql as any).array === "function") {
      console.log("  ✅ sql.array() 헬퍼가 존재합니다!");
      
      // sql.array() 사용 테스트
      try {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, int_array)
          VALUES (${"ArrayHelper"}, ${(sql as any).array([1, 2, 3, 4, 5])})
        `;
        
        const result = await DB.maybeOne<{
          id: number;
          name: string;
          intArray: unknown;
        }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"ArrayHelper"}`);
        
        console.log(`  - 삽입 후 조회 결과:`);
        console.log(`    - intArray 타입: ${typeof result?.intArray}`);
        console.log(`    - Array.isArray: ${Array.isArray(result?.intArray)}`);
        console.log(`    - 값: ${JSON.stringify(result?.intArray)}`);
      } catch (error) {
        console.log(`  ❌ sql.array() 사용 중 에러: ${error}`);
      }
    } else {
      console.log("  ⚠️ sql.array() 헬퍼가 존재하지 않습니다.");
    }
  });

  test("SQL 클래스에서 array 헬퍼 확인", async () => {
    if (isMySQL()) {
      console.log("MySQL 스킵");
      return;
    }

    // Bun SQL 인스턴스에서 array 헬퍼 확인
    const directSql = new SQL(process.env.DATABASE_URL!);
    
    console.log("\n📊 SQL 인스턴스에서 array 헬퍼 확인:");
    console.log(`  - typeof directSql.array: ${typeof (directSql as any).array}`);
    
    if (typeof (directSql as any).array === "function") {
      console.log("  ✅ SQL.array() 헬퍼가 존재합니다!");
    } else {
      console.log("  ⚠️ SQL.array() 헬퍼가 존재하지 않습니다.");
    }
    
    directSql.close();
  });
});

// ============================================================
// 다양한 삽입 방법 테스트
// ============================================================

describe("다양한 JSON/JSONB 삽입 방법 테스트", () => {
  test("방법 1: JSON.stringify() + ::jsonb 캐스팅", async () => {
    if (isMySQL()) return;

    await clearTestData();
    const testObj = { key: "value", num: 123 };

    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, data_jsonb)
      VALUES (${"Method1"}, ${JSON.stringify(testObj)}::jsonb)
    `;

    const result = await DB.maybeOne<{ dataJsonb: unknown }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"Method1"}`
    );

    console.log("\n📊 방법 1 (JSON.stringify + ::jsonb):");
    console.log(`  - 반환 타입: ${typeof result?.dataJsonb}`);
    console.log(`  - 값: ${JSON.stringify(result?.dataJsonb)}`);
    
    if (typeof result?.dataJsonb === "string") {
      console.log("  ⚠️ 여전히 string으로 반환됨");
    } else {
      console.log("  ✅ object로 반환됨");
    }
  });

  test("방법 2: JSON 타입 직접 사용 (::json)", async () => {
    if (isMySQL()) return;

    await clearTestData();
    const testObj = { key: "value", num: 123 };

    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, data_json)
      VALUES (${"Method2"}, ${JSON.stringify(testObj)}::json)
    `;

    const result = await DB.maybeOne<{ dataJson: unknown }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"Method2"}`
    );

    console.log("\n📊 방법 2 (JSON.stringify + ::json):");
    console.log(`  - 반환 타입: ${typeof result?.dataJson}`);
    console.log(`  - 값: ${JSON.stringify(result?.dataJson)}`);
    
    if (typeof result?.dataJson === "string") {
      console.log("  ⚠️ 여전히 string으로 반환됨");
    } else {
      console.log("  ✅ object로 반환됨");
    }
  });

  test("방법 3: 파라미터 바인딩 없이 리터럴 JSON", async () => {
    if (isMySQL()) return;

    await clearTestData();

    // sql.unsafe 사용
    await sql.unsafe(`
      INSERT INTO ${TEST_TABLE} (name, data_jsonb)
      VALUES ('Method3', '{"key": "value", "num": 123}'::jsonb)
    `);

    const result = await DB.maybeOne<{ dataJsonb: unknown }>(
      sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"Method3"}`
    );

    console.log("\n📊 방법 3 (리터럴 JSON):");
    console.log(`  - 반환 타입: ${typeof result?.dataJsonb}`);
    console.log(`  - 값: ${JSON.stringify(result?.dataJsonb)}`);
    
    if (typeof result?.dataJsonb === "string") {
      console.log("  ⚠️ 여전히 string으로 반환됨");
    } else {
      console.log("  ✅ object로 반환됨");
    }
  });
});

// ============================================================
// 조회 시 변환 방법 테스트
// ============================================================

describe("조회 시 JSON 변환 방법 테스트", () => {
  test("PostgreSQL에서 직접 파싱하여 조회", async () => {
    if (isMySQL()) return;

    await clearTestData();
    const testObj = { key: "value", nested: { a: 1 } };

    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, data_jsonb)
      VALUES (${"ParseTest"}, ${JSON.stringify(testObj)}::jsonb)
    `;

    // 일반 조회
    const normalResult = await DB.maybeOne<{ dataJsonb: unknown }>(
      sql`SELECT data_jsonb FROM ${sql(TEST_TABLE)} WHERE name = ${"ParseTest"}`
    );

    // to_json() 함수 사용
    const toJsonResult = await DB.maybeOne<{ dataJsonb: unknown }>(
      sql`SELECT to_json(data_jsonb) as data_jsonb FROM ${sql(TEST_TABLE)} WHERE name = ${"ParseTest"}`
    );

    console.log("\n📊 조회 방법 비교:");
    console.log(`  일반 조회:`);
    console.log(`    - 타입: ${typeof normalResult?.dataJsonb}`);
    console.log(`    - 값: ${JSON.stringify(normalResult?.dataJsonb)}`);
    
    console.log(`  to_json() 사용:`);
    console.log(`    - 타입: ${typeof toJsonResult?.dataJsonb}`);
    console.log(`    - 값: ${JSON.stringify(toJsonResult?.dataJsonb)}`);
  });

  test("json_build_object() 함수 사용", async () => {
    if (isMySQL()) return;

    // json_build_object 함수로 직접 JSON 생성
    const result = await DB.maybeOne<{ data: unknown }>(
      sql`SELECT json_build_object('key', 'value', 'num', 123) as data`
    );

    console.log("\n📊 json_build_object() 사용:");
    console.log(`  - 타입: ${typeof result?.data}`);
    console.log(`  - 값: ${JSON.stringify(result?.data)}`);
    
    if (typeof result?.data === "string") {
      console.log("  ⚠️ string으로 반환됨");
    } else {
      console.log("  ✅ object로 반환됨");
    }
  });
});

// ============================================================
// 배열 삽입/조회 방법 테스트
// ============================================================

describe("배열 삽입/조회 방법 테스트", () => {
  test("ARRAY 리터럴 사용", async () => {
    if (isMySQL()) return;

    await clearTestData();

    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, int_array, text_array)
      VALUES (${"ArrayLiteral"}, ARRAY[1, 2, 3, 4, 5], ARRAY['a', 'b', 'c'])
    `;

    const result = await DB.maybeOne<{
      intArray: unknown;
      textArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"ArrayLiteral"}`);

    console.log("\n📊 ARRAY 리터럴 사용:");
    console.log(`  int_array:`);
    console.log(`    - 타입: ${typeof result?.intArray}`);
    console.log(`    - Array.isArray: ${Array.isArray(result?.intArray)}`);
    console.log(`    - 값: ${JSON.stringify(result?.intArray)}`);
    console.log(`  text_array:`);
    console.log(`    - 타입: ${typeof result?.textArray}`);
    console.log(`    - Array.isArray: ${Array.isArray(result?.textArray)}`);
    console.log(`    - 값: ${JSON.stringify(result?.textArray)}`);
  });

  test("파라미터로 배열 전달 (문자열 형식)", async () => {
    if (isMySQL()) return;

    await clearTestData();

    // PostgreSQL 배열 리터럴 형식으로 전달
    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, int_array)
      VALUES (${"ArrayString"}, ${"{1,2,3,4,5}"}::integer[])
    `;

    const result = await DB.maybeOne<{
      intArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"ArrayString"}`);

    console.log("\n📊 PostgreSQL 배열 리터럴 문자열 사용:");
    console.log(`  - 타입: ${typeof result?.intArray}`);
    console.log(`  - Array.isArray: ${Array.isArray(result?.intArray)}`);
    console.log(`  - 값: ${JSON.stringify(result?.intArray)}`);
  });
});

// ============================================================
// 종합 결과 요약
// ============================================================

describe("종합 해결책 정리", () => {
  test("현재 Bun 버전 및 해결책 요약", async () => {
    console.log(`\n${"=".repeat(70)}`);
    console.log("📋 PostgreSQL JSON/JSONB/ARRAY 타입 문제 해결책 요약");
    console.log("=".repeat(70));
    console.log(`\n현재 Bun 버전: 1.3.6`);
    console.log(`\n발견된 문제점:`);
    console.log(`  1. JSON/JSONB 컬럼이 string으로 반환됨`);
    console.log(`  2. INTEGER[] 배열이 object ({"0":1,"1":2,...})로 반환됨`);
    console.log(`  3. 빈 INTEGER[]가 빈 object {}로 반환됨`);
    
    console.log(`\n해결 상태:`);
    console.log(`  - Bun v1.3.6에서 일부 버그 수정됨:`);
    console.log(`    - 빈 배열 읽기 오류 수정`);
    console.log(`    - JSON 파싱 에러 처리 개선`);
    console.log(`  - 그러나 JSON/JSONB가 string으로 반환되는 문제는 여전히 존재`);
    
    console.log(`\n권장 해결책:`);
    console.log(`  1. 조회 후 수동 JSON.parse() 변환`);
    console.log(`  2. bunqldb 라이브러리 레벨에서 자동 변환 로직 추가`);
    console.log(`  3. Bun 팀의 추가 수정 대기 (관련 이슈: #18775, #23129)`);
    console.log("=".repeat(70));
  });
});
