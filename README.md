# bunqldb

Bun의 내장 SQL 클라이언트(`Bun.sql`)를 기반으로 한 **MySQL/PostgreSQL 호환** 데이터베이스 모듈입니다.
**연결 풀링(Connection Pooling)**, **트랜잭션 관리(Transaction Management)**, **템플릿 리터럴 기반 동적 쿼리** 기능을 제공합니다.

## 설치

```bash
bun add bunqldb
```

## 주요 특징

- **MySQL/PostgreSQL 호환**: DATABASE_URL에서 DB 타입 자동 감지
- **Lazy Initialization**: 첫 쿼리 실행 시점에 연결 (환경변수 설정 후 안전하게 사용 가능)
- **AsyncLocalStorage 기반 트랜잭션**: `@Transactional` 데코레이터로 간편한 트랜잭션 관리
- **템플릿 리터럴 재할당 방식**: 문자열+배열 대신 깔끔한 동적 쿼리 구성
- **자동 camelCase 변환**: snake_case 컬럼을 camelCase로 자동 변환
- **dateStrings 옵션**: Date 객체를 MySQL 형식 문자열로 반환 가능
- **자동 재연결**: DB 서버 재기동 시 자동으로 재연결 시도

---

## 1. 설정 (Configuration)

`.env` 파일에 다음 중 하나의 방식으로 설정을 추가하세요.

### 방법 A: Connection String (추천)
```bash
# PostgreSQL
DATABASE_URL=postgres://username:password@localhost:5432/mydb

# MySQL
DATABASE_URL=mysql://username:password@localhost:3306/mydb
```

### 방법 B: 개별 파라미터
```bash
DB_HOST=localhost
DB_PORT=5432  # PostgreSQL: 5432, MySQL: 3306 (DATABASE_URL에서 자동 감지)
DB_USER=username
DB_PASSWORD=password
DB_NAME=mydb
```

### DB 타입 확인
```typescript
import { getDbType } from "bunqldb";

const dbType = getDbType(); // 'mysql' | 'postgres'
```

---

## 2. 기본 사용법 (Basic Usage)

```typescript
import { sql, DB } from "bunqldb";

// 1. 조회
const users = await sql`SELECT * FROM users`;

// 2. 파라미터 바인딩 (SQL Injection 방지)
const id = 1;
const user = await sql`SELECT * FROM users WHERE id = ${id}`;

// 3. INSERT with RETURNING (PostgreSQL)
const [newUser] = await sql`
  INSERT INTO users (name, email) 
  VALUES (${name}, ${email}) 
  RETURNING id, name, email
`;

// 4. DB 헬퍼 사용 (camelCase 자동 변환)
const users = await DB.many<User>(sql`SELECT * FROM users`);
const user = await DB.maybeOne<User>(sql`SELECT * FROM users WHERE id = ${id}`);
```

---

## 3. 템플릿 리터럴 재할당 방식 (핵심)

**동적 쿼리를 구성할 때 문자열+배열 대신 템플릿 리터럴 재할당을 사용합니다.**

### ✅ 올바른 방법 (템플릿 리터럴 재할당)

```typescript
import { sql, DB } from "bunqldb";

// 기본 쿼리 시작
let query = sql`SELECT * FROM users WHERE 1=1`;

// 조건부 필터 추가
if (status) {
  query = sql`${query} AND status = ${status}`;
}

if (name) {
  query = sql`${query} AND name LIKE ${`%${name}%`}`;
}

if (minAge) {
  query = sql`${query} AND age >= ${minAge}`;
}

// ORDER BY, LIMIT 추가
query = sql`${query} ORDER BY ${sql('created_at')} DESC`;
query = sql`${query} LIMIT ${limit}`;

// 실행
const result = await DB.many<User>(query);
```

### ❌ 사용 금지 (문자열 + 배열 방식)

```typescript
// 가독성이 떨어지고 파라미터 인덱스 관리가 어려움
// 또한 DB별 파라미터 문법이 다름 (PostgreSQL: $1, MySQL: ?)
let query = 'SELECT * FROM users WHERE 1=1';
const params: unknown[] = [];

if (status) {
  params.push(status);
  query += ` AND status = $${params.length}`; // PostgreSQL 전용!
}

// 문자열 기반 raw SQL은 지원하지 않음 - 템플릿 리터럴 사용
```

### 장점

1. **파라미터 자동 관리**: 인덱스(`$1`, `$2`) 신경 쓸 필요 없음
2. **SQL Injection 자동 방지**: 템플릿 리터럴이 자동으로 파라미터화
3. **가독성**: 실제 SQL과 거의 동일하게 읽힘
4. **Bun SQL 공식 지원 패턴**: 공식 문서에서 권장하는 방식

---

## 4. DB 헬퍼 클래스

### DB 클래스 메서드 목록

| 메서드 | 반환 타입 | 설명 |
|--------|----------|------|
| `DB.many<T>(query)` | `T[]` | 여러 행 조회 (camelCase 자동 변환) |
| `DB.maybeOne<T>(query)` | `T \| undefined` | 단일 행 조회 (없으면 undefined) |
| `DB.insert(query)` | `number` | INSERT 후 생성된 ID 반환 |
| `DB.update(query)` | `number` | UPDATE 후 영향받은 행 수 반환 |
| `DB.delete(query)` | `number` | DELETE 후 영향받은 행 수 반환 |
| `DB.paginate<T>(query, options)` | `{ data: T[], totalRow: number }` | offset 기반 페이지네이션 |
| `DB.cursorPaginate<T>(query, options)` | `{ data: T[], nextCursor }` | 커서 기반 페이지네이션 |
| `DB.bidirectionalCursorPaginate<T>(query, options)` | `{ data: T[], nextCursor, prevCursor }` | 양방향 커서 페이지네이션 |
| `DB.manyPaging<T>(limit, start, query)` | `{ data: T[], totalRow: number }` | limit/offset 기반 페이징 (레거시) |
| `DB.manyPagingParams<T>(params, query)` | `{ data: T[], totalRow: number }` | params 객체 기반 페이징 (레거시) |
| `DB.close()` | `void` | 데이터베이스 연결 종료 |

### 기본 CRUD 메서드

```typescript
import { sql, DB } from "bunqldb";

// 여러 행 조회 (camelCase 자동 변환)
const users = await DB.many<User>(sql`SELECT * FROM users`);

// 단일 행 조회 (없으면 undefined)
const user = await DB.maybeOne<User>(sql`SELECT * FROM users WHERE seq = ${seq}`);

// INSERT (생성된 ID 반환)
// MySQL: lastInsertRowid 자동 반환 (RETURNING 불필요)
const id = await DB.insert(sql`
  INSERT INTO users (name, email) VALUES (${name}, ${email})
`);

// PostgreSQL: RETURNING 절 필요
const id = await DB.insert(sql`
  INSERT INTO users (name, email) VALUES (${name}, ${email})
  RETURNING seq
`);

// UPDATE (영향받은 행 수 반환)
// MySQL: affectedRows, PostgreSQL: count
const count = await DB.update(sql`UPDATE users SET name = ${name} WHERE seq = ${seq}`);

// DELETE (영향받은 행 수 반환)
// MySQL: affectedRows, PostgreSQL: count
const count = await DB.delete(sql`DELETE FROM users WHERE seq = ${seq}`);
```

### SQL 로깅 제어

SQL 로깅을 제어하는 방법은 두 가지가 있습니다.

#### 방법 1: sql.silent / sql.verbose 체이닝 (권장)

```typescript
// 기본: 전역 설정에 따름
const users = await sql`SELECT * FROM users`;

// sql.silent: 전역 설정과 무관하게 로깅하지 않음
const users = await sql.silent`SELECT * FROM users`;
const user = await DB.many(sql.silent`SELECT * FROM users`);

// sql.verbose: 전역 설정과 무관하게 항상 로깅
const users = await sql.verbose`SELECT * FROM users`;
```

#### 방법 2: 옵션 파라미터 (기존 방식, 호환성 유지)

```typescript
// DB 헬퍼 메서드에서 옵션으로 로깅 비활성화
const users = await DB.many(sql`SELECT * FROM users`, { logging: false });
const user = await DB.maybeOne(sql`SELECT * FROM users WHERE id = ${id}`, { logging: false });
const id = await DB.insert(sql`INSERT INTO users ...`, { logging: false });
```

#### 동작 매트릭스

| 전역 설정 | `sql` | `sql.verbose` | `sql.silent` |
|-----------|-------|---------------|--------------|
| `enabled: true` | 로깅 O | 로깅 O | 로깅 X |
| `enabled: false` | 로깅 X | 로깅 O | 로깅 X |

### 페이징 메서드

```typescript
// offset 기반 페이징
const result = await DB.paginate<User>(
  sql`SELECT * FROM users WHERE status = ${'active'} ORDER BY seq DESC`,
  { page: 1, row: 10 }
);
// 반환: { data: User[], totalRow: number }

// row=0이면 전체 조회
const all = await DB.paginate<User>(
  sql`SELECT * FROM users ORDER BY seq`,
  { page: 1, row: 0 }
);

// 커서 기반 페이징
const result = await DB.cursorPaginate<User>(
  sql`SELECT * FROM users WHERE status = ${'active'}`,
  { cursorColumn: 'seq', cursor: null, limit: 10, isDesc: true }
);
// 반환: { data: User[], nextCursor: number | null }

// 양방향 커서 페이징
const result = await DB.bidirectionalCursorPaginate<User>(
  sql`SELECT * FROM users WHERE 1=1`,
  { cursorColumn: 'seq', cursor: null, limit: 10, direction: 'next' }
);
// 반환: { data: User[], nextCursor: number | null, prevCursor: number | null }
```

---

## 5. SQL 조각 헬퍼

### 기본 헬퍼

```typescript
import { sql } from "bunqldb";

// 동적 테이블/컬럼명
await sql`SELECT * FROM ${sql('users')}`;
await sql`SELECT * FROM ${sql('public.users')}`;

// 동적 ORDER BY (sql.unsafe는 신중하게!)
const orderDir = 'DESC';
query = sql`${query} ORDER BY ${sql('created_at')} ${sql.unsafe(orderDir)}`;

// IN 절
const ids = [1, 2, 3];
await sql`SELECT * FROM users WHERE id IN ${sql(ids)}`;

// 객체로 INSERT
const user = { name: 'Alice', email: 'alice@test.com' };
await sql`INSERT INTO users ${sql(user)}`;
```

### 쿼리 조합 헬퍼 함수

```typescript
import { sql, empty, orderBy, limit, offset, cursorCondition } from "bunqldb";

// 조건부 빈 조각
const ageFilter = minAge ? sql`AND age >= ${minAge}` : empty();
await sql`SELECT * FROM users WHERE 1=1 ${ageFilter}`;

// ORDER BY 조각 생성
let query = sql`SELECT * FROM users WHERE 1=1`;
query = sql`${query} ${orderBy('created_at', 'DESC')}`;
// → SELECT * FROM users WHERE 1=1 ORDER BY created_at DESC

// LIMIT, OFFSET 조각 생성
query = sql`${query} ${limit(10)} ${offset(20)}`;
// → ... LIMIT 10 OFFSET 20

// 커서 조건 조각 생성 (커서 페이지네이션용)
const cursor = 100;
const isDesc = true;
query = sql`SELECT * FROM users WHERE 1=1 ${cursorCondition('seq', cursor, isDesc)}`;
// → SELECT * FROM users WHERE 1=1 AND seq < 100
```

### SQL 조각 헬퍼 함수 목록

| 함수 | 설명 | 예시 |
|------|------|------|
| `sql(identifier)` | 동적 테이블/컬럼명 (이스케이프 처리) | `sql('users')`, `sql('public.users')` |
| `sql(array)` | IN 절용 배열 | `sql([1, 2, 3])` |
| `sql(object)` | INSERT용 객체 | `sql({ name: 'Alice', email: 'a@b.com' })` |
| `sql.unsafe(str)` | Raw SQL 삽입 (주의!) | `sql.unsafe('DESC')` |
| `sql.silent` | 로깅 비활성화 체이닝 | `sql.silent\`SELECT ...\`` |
| `sql.verbose` | 강제 로깅 체이닝 | `sql.verbose\`SELECT ...\`` |
| `empty()` | 빈 SQL 조각 (조건부 조합용) | `condition ? sql\`AND x\` : empty()` |
| `orderBy(column, direction)` | ORDER BY 조각 | `orderBy('created_at', 'DESC')` |
| `limit(n)` | LIMIT 조각 | `limit(10)` |
| `offset(n)` | OFFSET 조각 | `offset(20)` |
| `cursorCondition(column, cursor, isDesc)` | 커서 조건 조각 | `cursorCondition('seq', 100, true)` |

### 유틸리티 함수 목록

| 함수 | 설명 |
|------|------|
| `configureDb(config)` | DB 설정 (로깅, dateStrings) |
| `isSqlLoggingEnabled()` | SQL 로깅 활성화 여부 확인 |
| `isDateStringsEnabled()` | dateStrings 옵션 활성화 여부 확인 |
| `getDbType()` | 현재 DB 타입 반환 ('mysql' \| 'postgres') |
| `getBaseSql()` | Bun SQL 인스턴스 반환 (수동 트랜잭션용) |
| `isDbConnected()` | DB 연결 상태 확인 |
| `resetConnection()` | DB 연결 초기화 |

### Case Converter 함수 목록

| 함수 | 설명 |
|------|------|
| `snakeToCamel(str)` | snake_case → camelCase 변환 |
| `toCamelCase(obj)` | 객체 키를 camelCase로 변환 |
| `toCamelCaseArray(arr)` | 배열 내 객체들의 키를 camelCase로 변환 |

---

## 6. 트랜잭션 (Transaction)

### @Transactional 데코레이터 (권장)

```typescript
import { sql, Transactional } from "bunqldb";

class UserService {
  @Transactional()
  static async transferMoney(fromId: number, toId: number, amount: number) {
    // 이 안의 모든 DB 작업은 하나의 트랜잭션
    await sql`UPDATE accounts SET balance = balance - ${amount} WHERE user_id = ${fromId}`;
    await sql`UPDATE accounts SET balance = balance + ${amount} WHERE user_id = ${toId}`;
    // 에러 발생 시 자동 롤백
  }
}
```

### 수동 트랜잭션 (sql.begin)

```typescript
import { getBaseSql, sql } from "bunqldb";

const baseSql = getBaseSql();

await baseSql.begin(async (tx) => {
  await tx`INSERT INTO users (name) VALUES (${'Alice'})`;
  await tx`INSERT INTO logs (action) VALUES (${'user_created'})`;
  // 에러 발생 시 자동 롤백
});
```

### Savepoint (부분 롤백)

```typescript
await baseSql.begin(async (tx) => {
  await tx`INSERT INTO users (name) VALUES (${'Alice'})`;

  try {
    await tx.savepoint(async (sp) => {
      await sp`INSERT INTO risky_table (data) VALUES (${'test'})`;
      throw new Error('롤백 필요');
    });
  } catch {
    // savepoint만 롤백, 외부 트랜잭션은 유지
  }

  // Alice는 커밋됨
});
```

---

## 7. DB 설정 (configureDb)

`configureDb`를 사용하면 SQL 로깅과 날짜 형식을 한 번에 설정할 수 있습니다.

### 통합 설정

```typescript
import { configureDb } from "bunqldb";
import type { SqlLogger } from "bunqldb";

// 앱 시작 시 한 번만 설정
configureDb({
  logging: { enabled: true },
  dateStrings: true,
});
```

### dateStrings 옵션

`dateStrings` 옵션은 DB에서 조회한 날짜 컬럼의 반환 형식을 결정합니다.

```typescript
import { configureDb, DB, sql } from "bunqldb";

// DB에 저장된 값: '2025-12-05 04:23:18'

// dateStrings: false (기본값) - Date 객체로 반환
configureDb({ dateStrings: false });
const result1 = await DB.maybeOne(sql`SELECT created_at FROM users WHERE id = 1`);
console.log(result1.createdAt);
// → Date 객체: Fri Dec 05 2025 04:23:18 GMT+0900
// → JSON 직렬화 시: "2025-12-04T19:23:18.000Z" (UTC로 변환됨)

// dateStrings: true - DB 형식 문자열로 반환
configureDb({ dateStrings: true });
const result2 = await DB.maybeOne(sql`SELECT created_at FROM users WHERE id = 1`);
console.log(result2.createdAt);
// → 문자열: "2025-12-05 04:23:18" (원본 그대로)
// → JSON 직렬화 시: "2025-12-05 04:23:18"
```

#### DATE 타입 vs DATETIME/TIMESTAMP 타입

`dateStrings: true`일 때, **DATE 타입**(시간 없음)과 **DATETIME/TIMESTAMP 타입**(시간 있음)을 자동으로 구분합니다.

```typescript
configureDb({ dateStrings: true });

// MySQL: DATE, DATETIME 타입
// PostgreSQL: DATE, TIMESTAMP 타입
const result = await DB.maybeOne(sql`
  SELECT birth_date, created_at FROM users WHERE id = 1
`);

console.log(result.birthDate);  // "2023-07-01" (날짜만)
console.log(result.createdAt);  // "2023-07-01 14:30:00" (날짜+시간)
```

> **참고**: 시간이 `00:00:00`인 경우 날짜만 반환됩니다. 실제로 자정 시간을 저장한 DATETIME/TIMESTAMP도 동일하게 동작합니다.

#### 타임존 처리

`dateStrings: true`는 **서버 타임존에 관계없이** DB에 저장된 값을 그대로 반환합니다.

```typescript
// 서버가 한국(KST), 미국(EDT), UTC 어디에 있든
// DB에 '2025-12-05 14:30:00'이 저장되어 있으면
// 항상 "2025-12-05 14:30:00"을 반환합니다.
configureDb({ dateStrings: true });
const result = await DB.maybeOne(sql`SELECT created_at FROM users WHERE id = 1`);
console.log(result.createdAt);  // "2025-12-05 14:30:00" (타임존 변환 없음)
```

**언제 `dateStrings: true`를 사용하나요?**
- API 응답에서 시간대 변환 없이 DB 저장 값 그대로 반환하고 싶을 때
- 프론트엔드에서 ISO 8601 형식 대신 원본 형식을 기대할 때
- 서버 타임존이 달라도 일관된 날짜 형식이 필요할 때

### SQL 로깅 설정

```typescript
import { configureDb } from "bunqldb";
import type { SqlLogger } from "bunqldb";

// 기본 console 로거 사용
configureDb({
  logging: { enabled: true },
});

// 커스텀 로거 사용
const myLogger: SqlLogger = {
  info: (msg) => console.log('[SQL]', msg),
  error: (msg) => console.error('[SQL ERROR]', msg),
};

configureDb({ 
  logging: { enabled: true, logger: myLogger },
});

// 로깅 비활성화
configureDb({ logging: { enabled: false } });
```

### 설정 상태 확인

```typescript
import { isSqlLoggingEnabled, isDateStringsEnabled } from "bunqldb";

console.log(isSqlLoggingEnabled()); // true | false
console.log(isDateStringsEnabled()); // true | false
```

---

## 8. DAO 작성 예시

```typescript
// src/modules/user/dao/user.dao.ts
import { sql, DB, getDbType } from 'bunqldb';
import type { User, UserPagingDto, UserInsertDto } from '../type/user.type';

export class UserDao {
  static async findAll(dto: UserPagingDto) {
    let query = sql`
      SELECT seq, name, email, status, created_at
      FROM users
      WHERE is_delete = 'N'
    `;

    if (dto.keyword) {
      query = sql`${query} AND name LIKE ${`%${dto.keyword}%`}`;
    }

    if (dto.status) {
      query = sql`${query} AND status = ${dto.status}`;
    }

    query = sql`${query} ORDER BY seq DESC`;

    return DB.paginate<User>(query, { page: dto.page, row: dto.row });
  }

  static async findOne(seq: number) {
    return DB.maybeOne<User>(sql`
      SELECT * FROM users WHERE seq = ${seq} AND is_delete = 'N'
    `);
  }

  static async insert(dto: UserInsertDto) {
    // MySQL: RETURNING 없이 사용
    // PostgreSQL: RETURNING seq 추가 필요
    return DB.insert(sql`
      INSERT INTO users (name, email, insert_seq, insert_date)
      VALUES (${dto.name}, ${dto.email}, ${dto.insertSeq}, NOW())
      ${getDbType() === 'postgres' ? sql`RETURNING seq` : sql``}
    `);
  }

  static async softDelete(seq: number, updateSeq: number) {
    return DB.update(sql`
      UPDATE users 
      SET is_delete = 'Y', update_seq = ${updateSeq}, update_date = NOW()
      WHERE seq = ${seq}
    `);
  }
}
```

---

## 9. 모듈 구조

```
bunqldb/
  ├── src/
  │   ├── index.ts          # Public API
  │   ├── types.ts          # 공통 타입 (DbConfig, SqlLogger, SqlLoggingOptions)
  │   ├── helpers/          # 헬퍼 유틸리티
  │   │   ├── case-converter.ts
  │   │   └── db-helpers.ts
  │   └── internal/         # 내부 구현 (직접 import 금지)
  │       ├── context.ts
  │       ├── internal-db.ts
  │       └── transactional.ts
  └── test/                 # 테스트
      ├── config-unit.test.ts
      ├── config.test.ts
      ├── db-helpers.test.ts
      └── transaction.test.ts
```

**중요**: `internal/` 폴더의 파일들은 직접 import하지 마세요. 항상 패키지 루트에서 import하세요.

---

## 10. 자동 재연결 (Auto Reconnect)

Bun SQL은 내부적으로 연결 풀을 관리하며, PostgreSQL 서버가 재기동되거나 연결이 끊어지면 쿼리 실행 시 자동으로 재연결합니다.

### 연결 상태 확인

```typescript
import { isDbConnected } from "bunqldb";

if (!isDbConnected()) {
  console.log("데이터베이스 연결이 끊어졌습니다.");
}
```

### 자동 연결 관리

별도의 재연결 로직이 필요하지 않습니다. Bun이 Lazy Connection 방식으로 쿼리 실행 시점에 자동으로 연결을 관리합니다.

```typescript
import { sql } from "bunqldb";

// Bun이 자동으로 연결 관리
const users = await sql`SELECT * FROM users`;
```

---

## 11. MySQL/PostgreSQL 차이점

| 기능 | MySQL | PostgreSQL |
|------|-------|------------|
| **INSERT ID 반환** | `lastInsertRowid` 자동 반환 | `RETURNING` 절 필요 |
| **UPDATE 행 수** | `affectedRows` | `count` |
| **DELETE 행 수** | `affectedRows` | `count` |
| **AUTO_INCREMENT** | `AUTO_INCREMENT` | `SERIAL` / `IDENTITY` |
| **TRUNCATE RESTART** | `TRUNCATE TABLE` | `TRUNCATE TABLE ... RESTART IDENTITY` |

### DB 타입에 따른 분기 처리

```typescript
import { getDbType } from "bunqldb";

const isMySQL = () => getDbType() === 'mysql';

// INSERT 예시
if (isMySQL()) {
  // MySQL: RETURNING 없이 사용
  const id = await DB.insert(sql`
    INSERT INTO users (name) VALUES (${name})
  `);
} else {
  // PostgreSQL: RETURNING 사용
  const id = await DB.insert(sql`
    INSERT INTO users (name) VALUES (${name})
    RETURNING seq
  `);
}
```

---

## 12. 테스트 실행

```bash
# MySQL 환경 테스트
bun run test:mysql

# PostgreSQL 환경 테스트
bun run test:postgres

# 전체 테스트 (MySQL + PostgreSQL)
bun run test:all

# 개별 테스트 파일 실행
bun --env-file=.env.test.mysql test test/db-helpers.test.ts
bun --env-file=.env.test.mysql test test/config.test.ts

# 단위 테스트 (DB 연결 불필요)
bun test test/config-unit.test.ts
```

## 라이선스

MIT
