import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  DB,
  getDbType,
  sql,
} from "../src";

// ============================================================
// 테스트 테이블 설정
// ============================================================

const TEST_TABLE = "test_json_type";
const TEST_TABLE_COMPREHENSIVE = "test_pg_complex_types";
const isMySQL = () => getDbType() === "mysql";

async function createTestTable(): Promise<void> {
  if (isMySQL()) {
    // MySQL: JSON 타입 사용
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        metadata JSON,
        settings JSON
      )
    `;
  } else {
    // PostgreSQL: JSONB 타입 사용
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE)} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        metadata JSONB,
        settings JSONB
      )
    `;
  }
}

async function createComprehensiveTestTable(): Promise<void> {
  if (isMySQL()) {
    // MySQL은 ARRAY 타입을 지원하지 않음
    console.log("MySQL은 ARRAY 타입을 지원하지 않으므로 스킵합니다.");
    return;
  }

  // PostgreSQL: 다양한 복합 타입 테스트
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(TEST_TABLE_COMPREHENSIVE)} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      -- JSON 타입들
      data_json JSON,
      data_jsonb JSONB,
      -- ARRAY 타입들
      int_array INTEGER[],
      text_array TEXT[],
      float_array FLOAT[],
      bool_array BOOLEAN[],
      -- 다차원 배열
      int_2d_array INTEGER[][],
      -- JSON 배열
      jsonb_array JSONB[]
    )
  `;
}

async function dropTestTable(): Promise<void> {
  await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE)}`;
  if (!isMySQL()) {
    await sql`DROP TABLE IF EXISTS ${sql(TEST_TABLE_COMPREHENSIVE)}`;
  }
}

async function clearTestData(): Promise<void> {
  if (isMySQL()) {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE)}`;
  } else {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE)} RESTART IDENTITY`;
  }
}

async function clearComprehensiveTestData(): Promise<void> {
  if (!isMySQL()) {
    await sql`TRUNCATE TABLE ${sql(TEST_TABLE_COMPREHENSIVE)} RESTART IDENTITY`;
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
  console.log(`📋 테스트: JSON/JSONB/ARRAY 타입 반환값 검증`);
  await dropTestTable(); // 기존 테이블 제거 (스키마 변경 대응)
  await createTestTable();
  await createComprehensiveTestTable();
});

afterAll(async () => {
  await dropTestTable();
  DB.close();
});

// ============================================================
// JSON/JSONB 타입 반환값 테스트
// ============================================================

describe("JSON/JSONB 타입 반환값 검증", () => {
  test("JSON 객체 삽입 및 조회 시 반환 타입 확인", async () => {
    const testMetadata = { key: "value", nested: { a: 1, b: 2 } };
    const testSettings = { theme: "dark", notifications: true };

    // JSON 데이터 삽입
    if (isMySQL()) {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata, settings)
        VALUES (${"TestUser"}, ${JSON.stringify(testMetadata)}, ${JSON.stringify(testSettings)})
      `;
    } else {
      // PostgreSQL: JSONB 타입에 직접 삽입
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata, settings)
        VALUES (${"TestUser"}, ${JSON.stringify(testMetadata)}::jsonb, ${JSON.stringify(testSettings)}::jsonb)
      `;
    }

    // 조회
    const result = await DB.maybeOne<{
      id: number;
      name: string;
      metadata: unknown;
      settings: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"TestUser"}`);

    expect(result).toBeDefined();
    console.log("\n📊 조회 결과:");
    console.log(`  - name: ${result!.name}`);
    console.log(`  - metadata 타입: ${typeof result!.metadata}`);
    console.log(`  - metadata 값: ${JSON.stringify(result!.metadata)}`);
    console.log(`  - settings 타입: ${typeof result!.settings}`);
    console.log(`  - settings 값: ${JSON.stringify(result!.settings)}`);

    // 타입 검증
    if (typeof result!.metadata === "string") {
      console.log("\n⚠️ 문제 발견: metadata가 string으로 반환됨!");
      console.log(`  - 반환된 string: "${result!.metadata}"`);
      // 파싱 가능한지 확인
      const parsed = JSON.parse(result!.metadata as string);
      console.log(`  - 파싱 후: ${JSON.stringify(parsed)}`);
    } else if (typeof result!.metadata === "object") {
      console.log("\n✅ 정상: metadata가 object로 반환됨");
    }

    // 실제 반환 타입 기록 (테스트 결과 확인용)
    console.log("\n📋 타입 검증 결과:");
    console.log(`  - ${getDbType() === "mysql" ? "MySQL JSON" : "PostgreSQL JSONB"} 타입`);
    console.log(`  - metadata instanceof Object: ${result!.metadata instanceof Object}`);
    console.log(`  - typeof metadata: ${typeof result!.metadata}`);
  });

  test("JSON 배열 삽입 및 조회 시 반환 타입 확인", async () => {
    await clearTestData();

    const testArray = [1, 2, 3, "a", "b", { nested: true }];

    // JSON 배열 데이터 삽입
    if (isMySQL()) {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
        VALUES (${"ArrayTest"}, ${JSON.stringify(testArray)})
      `;
    } else {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
        VALUES (${"ArrayTest"}, ${JSON.stringify(testArray)}::jsonb)
      `;
    }

    // 조회
    const result = await DB.maybeOne<{
      id: number;
      name: string;
      metadata: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"ArrayTest"}`);

    expect(result).toBeDefined();
    console.log("\n📊 배열 조회 결과:");
    console.log(`  - metadata 타입: ${typeof result!.metadata}`);
    console.log(`  - metadata 값: ${JSON.stringify(result!.metadata)}`);
    console.log(`  - Array.isArray(metadata): ${Array.isArray(result!.metadata)}`);

    if (typeof result!.metadata === "string") {
      console.log("\n⚠️ 문제 발견: 배열이 string으로 반환됨!");
    } else if (Array.isArray(result!.metadata)) {
      console.log("\n✅ 정상: 배열이 Array로 반환됨");
    }
  });

  test("NULL JSON 값 조회 시 반환 타입 확인", async () => {
    await clearTestData();

    // NULL 값으로 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE)} (name, metadata, settings)
      VALUES (${"NullTest"}, NULL, NULL)
    `;

    // 조회
    const result = await DB.maybeOne<{
      id: number;
      name: string;
      metadata: unknown;
      settings: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"NullTest"}`);

    expect(result).toBeDefined();
    console.log("\n📊 NULL JSON 조회 결과:");
    console.log(`  - metadata: ${result!.metadata}`);
    console.log(`  - metadata === null: ${result!.metadata === null}`);
    console.log(`  - settings: ${result!.settings}`);
    console.log(`  - settings === null: ${result!.settings === null}`);

    expect(result!.metadata).toBeNull();
    expect(result!.settings).toBeNull();
  });

  test("복잡한 중첩 JSON 객체 조회 시 반환 타입 확인", async () => {
    await clearTestData();

    const complexJson = {
      level1: {
        level2: {
          level3: {
            value: "deep",
            numbers: [1, 2, 3],
            bool: true,
          },
        },
        array: [
          { id: 1, name: "first" },
          { id: 2, name: "second" },
        ],
      },
      unicode: "한글 테스트 🎉",
      special: "quotes\"and'apostrophes",
    };

    // 복잡한 JSON 삽입
    if (isMySQL()) {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
        VALUES (${"ComplexTest"}, ${JSON.stringify(complexJson)})
      `;
    } else {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
        VALUES (${"ComplexTest"}, ${JSON.stringify(complexJson)}::jsonb)
      `;
    }

    // 조회
    const result = await DB.maybeOne<{
      id: number;
      name: string;
      metadata: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"ComplexTest"}`);

    expect(result).toBeDefined();
    console.log("\n📊 복잡한 JSON 조회 결과:");
    console.log(`  - metadata 타입: ${typeof result!.metadata}`);

    if (typeof result!.metadata === "string") {
      console.log("\n⚠️ 문제 발견: 복잡한 JSON이 string으로 반환됨!");
      const parsed = JSON.parse(result!.metadata as string);
      console.log(`  - 파싱 후 level1.level2.level3.value: ${parsed?.level1?.level2?.level3?.value}`);
    } else if (typeof result!.metadata === "object" && result!.metadata !== null) {
      console.log("\n✅ 정상: 복잡한 JSON이 object로 반환됨");
      const obj = result!.metadata as any;
      console.log(`  - level1.level2.level3.value: ${obj?.level1?.level2?.level3?.value}`);
    }
  });

  test("DB.many()로 여러 JSON 레코드 조회 시 반환 타입 확인", async () => {
    await clearTestData();

    // 여러 레코드 삽입
    for (let i = 1; i <= 3; i++) {
      const metadata = { index: i, data: `item${i}` };
      if (isMySQL()) {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
          VALUES (${`User${i}`}, ${JSON.stringify(metadata)})
        `;
      } else {
        await sql`
          INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
          VALUES (${`User${i}`}, ${JSON.stringify(metadata)}::jsonb)
        `;
      }
    }

    // 여러 레코드 조회
    const results = await DB.many<{
      id: number;
      name: string;
      metadata: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY id`);

    expect(results).toHaveLength(3);
    console.log("\n📊 여러 레코드 JSON 조회 결과:");

    let allStrings = true;
    let allObjects = true;

    for (const row of results) {
      const metaType = typeof row.metadata;
      console.log(`  - ${row.name}: metadata 타입 = ${metaType}`);

      if (metaType === "string") {
        allObjects = false;
      } else if (metaType === "object") {
        allStrings = false;
      }
    }

    if (allStrings) {
      console.log("\n⚠️ 문제 발견: 모든 metadata가 string으로 반환됨!");
    } else if (allObjects) {
      console.log("\n✅ 정상: 모든 metadata가 object로 반환됨");
    } else {
      console.log("\n❓ 혼합: 일부는 string, 일부는 object로 반환됨");
    }
  });
});

// ============================================================
// 문제 발생 시 해결책 테스트
// ============================================================

describe("JSON 타입 처리 해결책 테스트", () => {
  test("JSON.parse()를 사용한 수동 변환 테스트", async () => {
    await clearTestData();

    const testData = { test: "value", number: 42 };

    if (isMySQL()) {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
        VALUES (${"ParseTest"}, ${JSON.stringify(testData)})
      `;
    } else {
      await sql`
        INSERT INTO ${sql(TEST_TABLE)} (name, metadata)
        VALUES (${"ParseTest"}, ${JSON.stringify(testData)}::jsonb)
      `;
    }

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      metadata: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE)} WHERE name = ${"ParseTest"}`);

    expect(result).toBeDefined();

    // 타입에 따라 처리
    let metadata: { test: string; number: number };
    if (typeof result!.metadata === "string") {
      // string인 경우 파싱 필요
      metadata = JSON.parse(result!.metadata);
      console.log("\n📋 JSON.parse() 사용하여 변환 필요");
    } else {
      // 이미 object인 경우
      metadata = result!.metadata as { test: string; number: number };
      console.log("\n📋 이미 object이므로 변환 불필요");
    }

    // 최종 검증
    expect(metadata.test).toBe("value");
    expect(metadata.number).toBe(42);
    console.log(`  - 최종 metadata.test: ${metadata.test}`);
    console.log(`  - 최종 metadata.number: ${metadata.number}`);
  });
});

// ============================================================
// PostgreSQL 복합 타입 포괄적 테스트 (JSON, JSONB, ARRAY)
// ============================================================

describe("PostgreSQL 복합 타입 포괄적 테스트", () => {
  // MySQL은 ARRAY 타입을 지원하지 않으므로 PostgreSQL에서만 테스트
  const skipIfMySQL = isMySQL();

  test("JSON vs JSONB 타입 비교 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    const testObj = { key: "value", num: 123 };

    // JSON과 JSONB 모두 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, data_json, data_jsonb)
      VALUES (${"JsonCompare"}, ${JSON.stringify(testObj)}::json, ${JSON.stringify(testObj)}::jsonb)
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      dataJson: unknown;
      dataJsonb: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"JsonCompare"}`);

    expect(result).toBeDefined();

    console.log("\n📊 JSON vs JSONB 비교:");
    console.log(`  - JSON 타입: ${typeof result!.dataJson}`);
    console.log(`  - JSON 값: ${JSON.stringify(result!.dataJson)}`);
    console.log(`  - JSONB 타입: ${typeof result!.dataJsonb}`);
    console.log(`  - JSONB 값: ${JSON.stringify(result!.dataJsonb)}`);

    if (typeof result!.dataJson === "string") {
      console.log("  ⚠️ JSON이 string으로 반환됨");
    } else {
      console.log("  ✅ JSON이 object로 반환됨");
    }

    if (typeof result!.dataJsonb === "string") {
      console.log("  ⚠️ JSONB가 string으로 반환됨");
    } else {
      console.log("  ✅ JSONB가 object로 반환됨");
    }
  });

  test("INTEGER[] 배열 타입 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // INTEGER 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, int_array)
      VALUES (${"IntArray"}, ARRAY[1, 2, 3, 4, 5])
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      intArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"IntArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 INTEGER[] 배열 타입:");
    console.log(`  - 타입: ${typeof result!.intArray}`);
    console.log(`  - Array.isArray: ${Array.isArray(result!.intArray)}`);
    console.log(`  - 값: ${JSON.stringify(result!.intArray)}`);

    if (typeof result!.intArray === "string") {
      console.log("  ⚠️ INTEGER[]가 string으로 반환됨");
      console.log(`  - 반환된 string: "${result!.intArray}"`);
    } else if (Array.isArray(result!.intArray)) {
      console.log("  ✅ INTEGER[]가 Array로 반환됨");
    }
  });

  test("TEXT[] 배열 타입 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // TEXT 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, text_array)
      VALUES (${"TextArray"}, ARRAY['hello', 'world', '한글', 'test'])
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      textArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"TextArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 TEXT[] 배열 타입:");
    console.log(`  - 타입: ${typeof result!.textArray}`);
    console.log(`  - Array.isArray: ${Array.isArray(result!.textArray)}`);
    console.log(`  - 값: ${JSON.stringify(result!.textArray)}`);

    if (typeof result!.textArray === "string") {
      console.log("  ⚠️ TEXT[]가 string으로 반환됨");
      console.log(`  - 반환된 string: "${result!.textArray}"`);
    } else if (Array.isArray(result!.textArray)) {
      console.log("  ✅ TEXT[]가 Array로 반환됨");
    }
  });

  test("FLOAT[] 배열 타입 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // FLOAT 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, float_array)
      VALUES (${"FloatArray"}, ARRAY[1.1, 2.2, 3.3, 4.4])
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      floatArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"FloatArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 FLOAT[] 배열 타입:");
    console.log(`  - 타입: ${typeof result!.floatArray}`);
    console.log(`  - Array.isArray: ${Array.isArray(result!.floatArray)}`);
    console.log(`  - 값: ${JSON.stringify(result!.floatArray)}`);

    if (typeof result!.floatArray === "string") {
      console.log("  ⚠️ FLOAT[]가 string으로 반환됨");
      console.log(`  - 반환된 string: "${result!.floatArray}"`);
    } else if (Array.isArray(result!.floatArray)) {
      console.log("  ✅ FLOAT[]가 Array로 반환됨");
    }
  });

  test("BOOLEAN[] 배열 타입 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // BOOLEAN 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, bool_array)
      VALUES (${"BoolArray"}, ARRAY[true, false, true, false])
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      boolArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"BoolArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 BOOLEAN[] 배열 타입:");
    console.log(`  - 타입: ${typeof result!.boolArray}`);
    console.log(`  - Array.isArray: ${Array.isArray(result!.boolArray)}`);
    console.log(`  - 값: ${JSON.stringify(result!.boolArray)}`);

    if (typeof result!.boolArray === "string") {
      console.log("  ⚠️ BOOLEAN[]가 string으로 반환됨");
      console.log(`  - 반환된 string: "${result!.boolArray}"`);
    } else if (Array.isArray(result!.boolArray)) {
      console.log("  ✅ BOOLEAN[]가 Array로 반환됨");
    }
  });

  test("2차원 INTEGER[][] 배열 타입 테스트 (미지원)", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    // Bun SQL은 다차원 배열을 아직 지원하지 않음
    // ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET
    console.log("\n📊 INTEGER[][] 2차원 배열 타입:");
    console.log("  ❌ Bun SQL에서 다차원 배열 미지원");
    console.log("  - 에러: ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET");
  });

  test("JSONB[] 배열 타입 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // JSONB 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, jsonb_array)
      VALUES (${"JsonbArray"}, ARRAY['{"a": 1}'::jsonb, '{"b": 2}'::jsonb, '{"c": 3}'::jsonb])
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      jsonbArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"JsonbArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 JSONB[] 배열 타입:");
    console.log(`  - 타입: ${typeof result!.jsonbArray}`);
    console.log(`  - Array.isArray: ${Array.isArray(result!.jsonbArray)}`);
    console.log(`  - 값: ${JSON.stringify(result!.jsonbArray)}`);

    if (typeof result!.jsonbArray === "string") {
      console.log("  ⚠️ JSONB[]가 string으로 반환됨");
      console.log(`  - 반환된 string: "${result!.jsonbArray}"`);
    } else if (Array.isArray(result!.jsonbArray)) {
      console.log("  ✅ JSONB[]가 Array로 반환됨");
      const arr = result!.jsonbArray as any[];
      if (arr.length > 0) {
        console.log(`  - 첫 번째 요소 타입: ${typeof arr[0]}`);
        if (typeof arr[0] === "string") {
          console.log("  ⚠️ 배열 내부 JSONB 요소가 string으로 반환됨");
        } else if (typeof arr[0] === "object") {
          console.log("  ✅ 배열 내부 JSONB 요소가 object로 반환됨");
        }
      }
    }
  });

  test("빈 배열 타입 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // 빈 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, int_array, text_array)
      VALUES (${"EmptyArray"}, ARRAY[]::integer[], ARRAY[]::text[])
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      intArray: unknown;
      textArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"EmptyArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 빈 배열 타입:");
    console.log(`  - int_array 타입: ${typeof result!.intArray}`);
    console.log(`  - int_array Array.isArray: ${Array.isArray(result!.intArray)}`);
    console.log(`  - int_array 값: ${JSON.stringify(result!.intArray)}`);
    console.log(`  - text_array 타입: ${typeof result!.textArray}`);
    console.log(`  - text_array Array.isArray: ${Array.isArray(result!.textArray)}`);
    console.log(`  - text_array 값: ${JSON.stringify(result!.textArray)}`);

    if (typeof result!.intArray === "string") {
      console.log("  ⚠️ 빈 INTEGER[]가 string으로 반환됨");
    } else if (Array.isArray(result!.intArray) && (result!.intArray as any[]).length === 0) {
      console.log("  ✅ 빈 INTEGER[]가 빈 Array로 반환됨");
    }
  });

  test("NULL 배열 값 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // NULL 배열 삽입
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (name, int_array, text_array, data_jsonb)
      VALUES (${"NullArray"}, NULL, NULL, NULL)
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      intArray: unknown;
      textArray: unknown;
      dataJsonb: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"NullArray"}`);

    expect(result).toBeDefined();

    console.log("\n📊 NULL 배열/JSON 값:");
    console.log(`  - int_array: ${result!.intArray}`);
    console.log(`  - int_array === null: ${result!.intArray === null}`);
    console.log(`  - text_array: ${result!.textArray}`);
    console.log(`  - text_array === null: ${result!.textArray === null}`);
    console.log(`  - data_jsonb: ${result!.dataJsonb}`);
    console.log(`  - data_jsonb === null: ${result!.dataJsonb === null}`);

    expect(result!.intArray).toBeNull();
    expect(result!.textArray).toBeNull();
    expect(result!.dataJsonb).toBeNull();
  });

  test("모든 복합 타입 동시 조회 테스트", async () => {
    if (skipIfMySQL) {
      console.log("MySQL은 이 테스트를 스킵합니다.");
      return;
    }

    await clearComprehensiveTestData();

    // 모든 타입 동시 삽입 (2차원 배열 제외 - Bun SQL 미지원)
    await sql`
      INSERT INTO ${sql(TEST_TABLE_COMPREHENSIVE)} (
        name,
        data_json,
        data_jsonb,
        int_array,
        text_array,
        float_array,
        bool_array,
        jsonb_array
      ) VALUES (
        ${"AllTypes"},
        '{"json": true}'::json,
        '{"jsonb": true}'::jsonb,
        ARRAY[1, 2, 3],
        ARRAY['a', 'b', 'c'],
        ARRAY[1.1, 2.2],
        ARRAY[true, false],
        ARRAY['{"x": 1}'::jsonb, '{"y": 2}'::jsonb]
      )
    `;

    const result = await DB.maybeOne<{
      id: number;
      name: string;
      dataJson: unknown;
      dataJsonb: unknown;
      intArray: unknown;
      textArray: unknown;
      floatArray: unknown;
      boolArray: unknown;
      jsonbArray: unknown;
    }>(sql`SELECT * FROM ${sql(TEST_TABLE_COMPREHENSIVE)} WHERE name = ${"AllTypes"}`);

    expect(result).toBeDefined();

    console.log(`\n${"=".repeat(60)}`);
    console.log("📊 PostgreSQL 복합 타입 종합 결과");
    console.log("=".repeat(60));

    const types = [
      { name: "JSON", value: result!.dataJson },
      { name: "JSONB", value: result!.dataJsonb },
      { name: "INTEGER[]", value: result!.intArray },
      { name: "TEXT[]", value: result!.textArray },
      { name: "FLOAT[]", value: result!.floatArray },
      { name: "BOOLEAN[]", value: result!.boolArray },
      { name: "JSONB[]", value: result!.jsonbArray },
    ];

    let hasIssue = false;

    for (const t of types) {
      const actualType = typeof t.value;
      const isArray = Array.isArray(t.value);
      let status = "✅";

      // JSON/JSONB는 object여야 함, 배열 타입은 Array여야 함
      if (t.name.includes("JSON") && !t.name.includes("[]")) {
        if (actualType === "string") {
          status = "⚠️";
          hasIssue = true;
        }
      } else if (t.name.includes("[]")) {
        if (!isArray) {
          status = "⚠️";
          hasIssue = true;
        }
      }

      console.log(`  ${status} ${t.name.padEnd(12)} | 타입: ${actualType.padEnd(8)} | isArray: ${String(isArray).padEnd(5)} | 값: ${JSON.stringify(t.value)}`);
    }

    console.log("=".repeat(60));
    if (hasIssue) {
      console.log("⚠️ 일부 복합 타입이 예상과 다르게 반환됨 - 수동 변환 필요");
    } else {
      console.log("✅ 모든 복합 타입이 정상적으로 반환됨");
    }
    console.log("=".repeat(60));
  });
});

// ============================================================
// DB 헬퍼 함수별 JSON 타입 자동 변환 테스트
// ============================================================

describe("DB 헬퍼 함수별 JSON 타입 자동 변환 테스트", () => {
  const HELPER_TEST_TABLE = "test_helper_json";

  beforeAll(async () => {
    // 테스트 테이블 생성
    if (isMySQL()) {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql(HELPER_TEST_TABLE)} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          metadata JSON,
          score INT
        )
      `;
    } else {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql(HELPER_TEST_TABLE)} (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          metadata JSONB,
          score INT
        )
      `;
    }

    // 테스트 데이터 삽입
    for (let i = 1; i <= 5; i++) {
      const metadata = { index: i, data: `item${i}`, nested: { value: i * 10 } };
      if (isMySQL()) {
        await sql`
          INSERT INTO ${sql(HELPER_TEST_TABLE)} (name, metadata, score)
          VALUES (${`User${i}`}, ${JSON.stringify(metadata)}, ${i * 100})
        `;
      } else {
        await sql`
          INSERT INTO ${sql(HELPER_TEST_TABLE)} (name, metadata, score)
          VALUES (${`User${i}`}, ${JSON.stringify(metadata)}::jsonb, ${i * 100})
        `;
      }
    }
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS ${sql(HELPER_TEST_TABLE)}`;
  });

  test("DB.many()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const results = await DB.many<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} ORDER BY id`);

    expect(results).toHaveLength(5);

    // 모든 결과의 metadata가 object인지 확인
    for (const row of results) {
      expect(typeof row.metadata).toBe("object");
      expect(row.metadata).not.toBeNull();
      expect(typeof row.metadata.index).toBe("number");
      expect(typeof row.metadata.data).toBe("string");
      expect(typeof row.metadata.nested.value).toBe("number");
    }

    console.log("\n✅ DB.many() JSON 자동 변환 테스트 통과");
    console.log(`  - 첫 번째 레코드 metadata: ${JSON.stringify(results[0].metadata)}`);
  });

  test("DB.maybeOne()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const result = await DB.maybeOne<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} WHERE name = ${"User1"}`);

    expect(result).toBeDefined();
    expect(typeof result!.metadata).toBe("object");
    expect(result!.metadata.index).toBe(1);
    expect(result!.metadata.data).toBe("item1");
    expect(result!.metadata.nested.value).toBe(10);

    console.log("\n✅ DB.maybeOne() JSON 자동 변환 테스트 통과");
    console.log(`  - metadata: ${JSON.stringify(result!.metadata)}`);
  });

  test("DB.paginate()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const result = await DB.paginate<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(
      sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} ORDER BY id`,
      { page: 1, row: 3 }
    );

    expect(result.data).toHaveLength(3);
    expect(result.totalRow).toBe(5);

    // 모든 결과의 metadata가 object인지 확인
    for (const row of result.data) {
      expect(typeof row.metadata).toBe("object");
      expect(row.metadata).not.toBeNull();
      expect(typeof row.metadata.index).toBe("number");
    }

    console.log("\n✅ DB.paginate() JSON 자동 변환 테스트 통과");
    console.log(`  - 첫 페이지 데이터 수: ${result.data.length}`);
    console.log(`  - 첫 번째 레코드 metadata: ${JSON.stringify(result.data[0].metadata)}`);
  });

  test("DB.cursorPaginate()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const result = await DB.cursorPaginate<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(
      sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: "id", cursor: null, limit: 3, isDesc: false }
    );

    expect(result.data).toHaveLength(3);

    // 모든 결과의 metadata가 object인지 확인
    for (const row of result.data) {
      expect(typeof row.metadata).toBe("object");
      expect(row.metadata).not.toBeNull();
      expect(typeof row.metadata.nested.value).toBe("number");
    }

    console.log("\n✅ DB.cursorPaginate() JSON 자동 변환 테스트 통과");
    console.log(`  - 데이터 수: ${result.data.length}`);
    console.log(`  - nextCursor: ${result.nextCursor}`);
    console.log(`  - 첫 번째 레코드 metadata: ${JSON.stringify(result.data[0].metadata)}`);
  });

  test("DB.manyPaging()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const result = await DB.manyPaging<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(3, 0, sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} ORDER BY id`);

    expect(result.data).toHaveLength(3);
    expect(result.totalRow).toBe(5);

    // 모든 결과의 metadata가 object인지 확인
    for (const row of result.data) {
      expect(typeof row.metadata).toBe("object");
      expect(row.metadata).not.toBeNull();
    }

    console.log("\n✅ DB.manyPaging() JSON 자동 변환 테스트 통과");
    console.log(`  - 데이터 수: ${result.data.length}, 총 행 수: ${result.totalRow}`);
  });

  test("DB.manyPagingParams()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const result = await DB.manyPagingParams<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(
      { page: 1, row: 3 },
      sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} ORDER BY id`
    );

    expect(result.data).toHaveLength(3);
    expect(result.totalRow).toBe(5);

    // 모든 결과의 metadata가 object인지 확인
    for (const row of result.data) {
      expect(typeof row.metadata).toBe("object");
      expect(row.metadata).not.toBeNull();
    }

    console.log("\n✅ DB.manyPagingParams() JSON 자동 변환 테스트 통과");
    console.log(`  - 데이터 수: ${result.data.length}, 총 행 수: ${result.totalRow}`);
  });

  test("DB.bidirectionalCursorPaginate()에서 JSON 타입이 자동 변환되어야 한다", async () => {
    const result = await DB.bidirectionalCursorPaginate<{
      id: number;
      name: string;
      metadata: { index: number; data: string; nested: { value: number } };
      score: number;
    }>(
      sql`SELECT * FROM ${sql(HELPER_TEST_TABLE)} WHERE 1=1`,
      { cursorColumn: "id", cursor: null, limit: 3, direction: "next" }
    );

    expect(result.data).toHaveLength(3);

    // 모든 결과의 metadata가 object인지 확인
    for (const row of result.data) {
      expect(typeof row.metadata).toBe("object");
      expect(row.metadata).not.toBeNull();
    }

    console.log("\n✅ DB.bidirectionalCursorPaginate() JSON 자동 변환 테스트 통과");
    console.log(`  - 데이터 수: ${result.data.length}`);
    console.log(`  - nextCursor: ${result.nextCursor}`);
  });
});
