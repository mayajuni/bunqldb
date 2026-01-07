import type { SQL } from 'bun';
import {
  sql as bunSql,
  resetConnection,
  withSkippedSqlLogging,
} from '../internal/internal-db';
import { toCamelCase, toCamelCaseArray } from './case-converter';

// ============================================================
// 타입 정의
// ============================================================

/**
 * DB 쿼리 실행 옵션
 * @deprecated sql.silent 체이닝 사용을 권장합니다.
 * @example
 * // 기존 방식 (호환성 유지)
 * await DB.many(sql`SELECT ...`, { logging: false });
 * // 새로운 방식 (권장)
 * await DB.many(sql.silent`SELECT ...`);
 */
export interface DbQueryOptions {
  logging?: boolean; // false일 경우 SQL 로깅 비활성화 (기본값: true)
}

// ============================================================
// 내부 헬퍼 함수
// ============================================================

async function executeQuery(
  query: Promise<Record<string, unknown>[]> | SQL,
): Promise<Record<string, unknown>[]> {
  return (await query) as Record<string, unknown>[];
}

/**
 * camelCase 컬럼명 추출
 */
function getCamelColumn(column: string): string {
  const actualColumn = column.includes('.') ? column.split('.')[1] : column;
  return actualColumn.replace(/[_-]+(.)/g, (_, chr) => chr.toUpperCase());
}

// ============================================================
// SQL 템플릿 헬퍼 (템플릿 리터럴 조합용)
// ============================================================

/**
 * SQL 조각을 생성하는 헬퍼
 * Bun SQL의 템플릿 리터럴 조합을 위한 유틸리티
 */
export const sql = bunSql;

/**
 * 빈 SQL 조각 (조건부 조합용) - 지연 초기화
 */
export function empty(): Promise<Record<string, unknown>[]> | SQL {
  return bunSql``;
}

/**
 * 커서 조건 조각 생성
 */
export function cursorCondition(
  column: string,
  cursor: unknown,
  isDesc: boolean,
): Promise<Record<string, unknown>[]> | SQL {
  if (cursor === null || cursor === undefined) return empty();

  const operator = isDesc ? '<' : '>';
  return bunSql`AND ${bunSql.unsafe(column)} ${bunSql.unsafe(operator)} ${cursor}`;
}

/**
 * ORDER BY 조각 생성
 */
export function orderBy(
  column: string,
  direction: 'ASC' | 'DESC' = 'ASC',
): Promise<Record<string, unknown>[]> | SQL {
  return bunSql`ORDER BY ${bunSql.unsafe(column)} ${bunSql.unsafe(direction)}`;
}

/**
 * LIMIT 조각 생성
 */
export function limit(n: number): Promise<Record<string, unknown>[]> | SQL {
  return bunSql`LIMIT ${n}`;
}

/**
 * OFFSET 조각 생성
 */
export function offset(n: number): Promise<Record<string, unknown>[]> | SQL {
  return bunSql`OFFSET ${n}`;
}

// ============================================================
// DB 클래스 (Public API) - Bun SQL 전용
// ============================================================

/**
 * MySQL/PostgreSQL 호환 DB 헬퍼 클래스 (Bun SQL 전용)
 * - Bun SQL tagged template literal 지원
 * - 쿼리 결과를 camelCase로 자동 변환
 * - DATABASE_URL에서 DB 타입 자동 감지
 */
export class DB {
  /**
   * 데이터베이스 연결 종료
   */
  static close(): void {
    resetConnection();
  }

  /**
   * 여러 행을 조회하고 camelCase로 변환합니다.
   * @example
   * const users = await DB.many(sql`SELECT * FROM users`);
   * // 로깅 비활성화 (방법 1: 기존 방식)
   * const users = await DB.many(sql`SELECT * FROM users`, { logging: false });
   * // 로깅 비활성화 (방법 2: 체이닝 방식)
   * const users = await DB.many(sql.silent`SELECT * FROM users`);
   */
  static async many<T = any>(
    query: Promise<Record<string, unknown>[]> | SQL,
    options?: DbQueryOptions,
  ): Promise<T[]> {
    const executeFn = async () => {
      const result = await executeQuery(query);
      if (!Array.isArray(result)) return [];
      return toCamelCaseArray<T>(result);
    };

    if (options?.logging === false) {
      return withSkippedSqlLogging(executeFn);
    }

    return executeFn();
  }

  /**
   * 단일 행을 조회하고 camelCase로 변환합니다.
   * 결과가 없으면 undefined를 반환합니다.
   * @example
   * const user = await DB.maybeOne(sql`SELECT * FROM users WHERE id = ${id}`);
   * // 로깅 비활성화 (방법 1: 기존 방식)
   * const user = await DB.maybeOne(sql`SELECT * FROM users WHERE id = ${id}`, { logging: false });
   * // 로깅 비활성화 (방법 2: 체이닝 방식)
   * const user = await DB.maybeOne(sql.silent`SELECT * FROM users WHERE id = ${id}`);
   */
  static async maybeOne<T = any>(
    query: Promise<Record<string, unknown>[]> | SQL,
    options?: DbQueryOptions,
  ): Promise<T | undefined> {
    const executeFn = async () => {
      const result = await executeQuery(query);
      if (!Array.isArray(result) || result.length === 0) return undefined;
      return toCamelCase<T>(result[0]);
    };

    if (options?.logging === false) {
      return withSkippedSqlLogging(executeFn);
    }

    return executeFn();
  }

  /**
   * INSERT 쿼리를 실행하고 생성된 ID를 반환합니다.
   * - MySQL: lastInsertRowid 자동 반환
   * - PostgreSQL: RETURNING 절 필요
   * @example
   * // MySQL
   * const id = await DB.insert(sql`
   *   INSERT INTO users (name, email) VALUES (${name}, ${email})
   * `);
   *
   * // PostgreSQL
   * const id = await DB.insert(sql`
   *   INSERT INTO users (name, email) VALUES (${name}, ${email})
   *   RETURNING id
   * `);
   *
   * // 로깅 비활성화 (방법 1: 기존 방식)
   * const id = await DB.insert(sql`INSERT INTO users ...`, { logging: false });
   * // 로깅 비활성화 (방법 2: 체이닝 방식)
   * const id = await DB.insert(sql.silent`INSERT INTO users ...`);
   */
  static async insert(
    query: Promise<Record<string, unknown>[]> | SQL,
    options?: DbQueryOptions,
  ): Promise<number> {
    const executeFn = async () => {
      const result = await query;

      // MySQL: lastInsertRowid 반환 (Bun SQL)
      if (result && typeof result === 'object' && 'lastInsertRowid' in result) {
        const lastInsertRowid = (result as { lastInsertRowid: number | bigint })
          .lastInsertRowid;
        if (typeof lastInsertRowid === 'bigint') return Number(lastInsertRowid);
        if (typeof lastInsertRowid === 'number') return lastInsertRowid;
      }

      // PostgreSQL: RETURNING 결과 (배열)
      if (Array.isArray(result) && result.length > 0) {
        const firstValue = Object.values(result[0])[0];

        // number, bigint, string(숫자형) 모두 처리
        if (typeof firstValue === 'number') return firstValue;
        if (typeof firstValue === 'bigint') return Number(firstValue);
        if (typeof firstValue === 'string') {
          const parsed = Number(firstValue);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
      }

      return 0;
    };

    if (options?.logging === false) {
      return withSkippedSqlLogging(executeFn);
    }

    return executeFn();
  }

  /**
   * UPDATE 쿼리를 실행하고 영향받은 행 수를 반환합니다.
   * - MySQL: affectedRows 반환
   * - PostgreSQL: count 반환
   * @example
   * const affected = await DB.update(sql`UPDATE users SET name = ${name} WHERE id = ${id}`);
   * // 로깅 비활성화 (방법 1: 기존 방식)
   * const affected = await DB.update(sql`UPDATE users ...`, { logging: false });
   * // 로깅 비활성화 (방법 2: 체이닝 방식)
   * const affected = await DB.update(sql.silent`UPDATE users ...`);
   */
  static async update(
    query: Promise<Record<string, unknown>[]> | SQL,
    options?: DbQueryOptions,
  ): Promise<number> {
    const executeFn = async () => {
      const result = (await query) as unknown as {
        affectedRows?: number;
        count?: number;
      };

      // MySQL: affectedRows
      if (typeof result?.affectedRows === 'number') return result.affectedRows;

      // PostgreSQL: count
      if (typeof result?.count === 'number') return result.count;

      return 0;
    };

    if (options?.logging === false) {
      return withSkippedSqlLogging(executeFn);
    }

    return executeFn();
  }

  /**
   * DELETE 쿼리를 실행하고 영향받은 행 수를 반환합니다.
   * - MySQL: affectedRows 반환
   * - PostgreSQL: count 반환
   * @example
   * const deleted = await DB.delete(sql`DELETE FROM users WHERE id = ${id}`);
   * // 로깅 비활성화 (방법 1: 기존 방식)
   * const deleted = await DB.delete(sql`DELETE FROM users ...`, { logging: false });
   * // 로깅 비활성화 (방법 2: 체이닝 방식)
   * const deleted = await DB.delete(sql.silent`DELETE FROM users ...`);
   */
  static async delete(
    query: Promise<Record<string, unknown>[]> | SQL,
    options?: DbQueryOptions,
  ): Promise<number> {
    const executeFn = async () => {
      const result = (await query) as unknown as {
        affectedRows?: number;
        count?: number;
      };

      // MySQL: affectedRows
      if (typeof result?.affectedRows === 'number') return result.affectedRows;

      // PostgreSQL: count
      if (typeof result?.count === 'number') return result.count;

      return 0;
    };

    if (options?.logging === false) {
      return withSkippedSqlLogging(executeFn);
    }

    return executeFn();
  }

  // ============================================================
  // 페이징 메서드 (기존 호환 - manyPaging/manyPagingParams)
  // ============================================================

  /**
   * limit/offset 기반 페이지네이션 (기존 호환)
   * @example
   * const result = await DB.manyPaging<User>(10, 0, sql`SELECT * FROM users WHERE 1=1`);
   */
  static async manyPaging<T = any>(
    limit: number,
    start: number,
    query: Promise<Record<string, unknown>[]> | SQL,
  ): Promise<{
    data: T[];
    totalRow: number;
  }> {
    if (limit === undefined || limit === 0) limit = 10;
    if (start === undefined || start <= 0) start = 0;

    // 카운트 쿼리
    const countQuery = bunSql`SELECT COUNT(1) as cnt FROM (${query}) as tab`;
    const countResult = (await countQuery) as Array<{ cnt: string | number }>;
    const totalRow = Number(countResult[0]?.cnt ?? 0);

    // 데이터 쿼리
    const dataQuery = bunSql`${query} LIMIT ${limit} OFFSET ${start}`;
    const dataResult = await executeQuery(dataQuery);
    const data = toCamelCaseArray<T>(dataResult);

    return { data, totalRow };
  }

  /**
   * params 객체 기반 페이지네이션 (기존 호환)
   * @example
   * const result = await DB.manyPagingParams<User>(
   *   { page: 1, row: 10 },
   *   sql`SELECT * FROM users WHERE 1=1`
   * );
   */
  static async manyPagingParams<T = any>(
    params: { row?: number | string; page?: number | string },
    query: Promise<Record<string, unknown>[]> | SQL,
  ): Promise<{
    data: T[];
    totalRow: number;
  }> {
    if (
      params.row === undefined ||
      params.row === '' ||
      params.page === undefined ||
      params.page === ''
    ) {
      const data = await DB.many<T>(query);
      return { data, totalRow: data.length };
    }

    const start = (Number(params.page) - 1) * Number(params.row);
    const paging = await DB.manyPaging<T>(Number(params.row), start, query);

    paging.data.forEach((item, index) => {
      (item as Record<string, unknown>).pagingIndex = paging.totalRow - start - index;
    });

    return paging;
  }

  // ============================================================
  // 페이징 메서드 (템플릿 리터럴 기반)
  // ============================================================

  /**
   * offset 기반 페이지네이션
   * @example
   * const result = await DB.paginate<User>(
   *   sql`SELECT * FROM users WHERE status = ${'active'}`,
   *   { page: 1, row: 10 }
   * );
   */
  static async paginate<T = any>(
    baseQuery: Promise<Record<string, unknown>[]> | SQL,
    options: { page?: number | string; row?: number | string } = {},
  ): Promise<{
    data: T[];
    totalRow: number;
  }> {
    const page = Number(options.page) || 1;
    const row =
      options.row !== undefined && options.row !== '' ? Number(options.row) : 10;
    const offsetValue = (page - 1) * row;

    // 카운트 쿼리
    const countQuery = bunSql`SELECT COUNT(1) as cnt FROM (${baseQuery}) as subquery`;
    const countResult = (await countQuery) as Array<{ cnt: string | number }>;
    const totalRow = Number(countResult[0]?.cnt ?? 0);

    // 전체 조회 (row가 0이면)
    if (row === 0) {
      const dataResult = await executeQuery(baseQuery);
      return { data: toCamelCaseArray<T>(dataResult), totalRow };
    }

    // 데이터 쿼리 (템플릿 리터럴 조합)
    const dataQuery = bunSql`${baseQuery} LIMIT ${row} OFFSET ${offsetValue}`;
    const dataResult = await executeQuery(dataQuery);
    const data = toCamelCaseArray<T>(dataResult);

    // pagingIndex 추가
    data.forEach((item, index) => {
      (item as Record<string, unknown>).pagingIndex = totalRow - offsetValue - index;
    });

    return { data, totalRow };
  }

  /**
   * 커서 기반 페이지네이션
   * @example
   * const result = await DB.cursorPaginate<User>(
   *   sql`SELECT * FROM users WHERE status = ${'active'}`,
   *   { cursorColumn: 'user_seq', cursor: null, limit: 10, isDesc: true }
   * );
   */
  static async cursorPaginate<T = any>(
    baseQuery: Promise<Record<string, unknown>[]> | SQL,
    options: {
      cursorColumn: string;
      cursor: string | number | Date | null;
      limit?: number;
      isDesc?: boolean;
    },
  ): Promise<{
    data: T[];
    nextCursor: string | number | Date | null;
  }> {
    const { cursorColumn, cursor, limit: limitValue = 10, isDesc = true } = options;
    const direction = isDesc ? 'DESC' : 'ASC';
    const operator = isDesc ? '<' : '>';

    // 템플릿 리터럴 조합으로 쿼리 구성
    let query = baseQuery;

    if (cursor !== null && cursor !== undefined) {
      query = bunSql`${query} AND ${bunSql.unsafe(cursorColumn)} ${bunSql.unsafe(operator)} ${cursor}`;
    }

    query = bunSql`${query} ORDER BY ${bunSql.unsafe(cursorColumn)} ${bunSql.unsafe(direction)} LIMIT ${
      limitValue + 1
    }`;

    const result = await executeQuery(query);
    const items = toCamelCaseArray<T>(result);

    // 다음 페이지 존재 여부 확인
    const hasNextPage = items.length > limitValue;
    if (hasNextPage) items.pop();

    // 다음 커서 계산
    const camelColumn = getCamelColumn(cursorColumn);
    const nextCursor = hasNextPage
      ? ((items[items.length - 1] as Record<string, unknown>)[camelColumn] as
          | string
          | number
          | Date)
      : null;

    return { data: items, nextCursor };
  }

  /**
   * 양방향 커서 페이지네이션
   */
  static async bidirectionalCursorPaginate<T = any>(
    baseQuery: Promise<Record<string, unknown>[]> | SQL,
    options: {
      cursorColumn: string;
      cursor: string | number | Date | null;
      limit?: number;
      direction?: 'next' | 'prev';
    },
  ): Promise<{
    data: T[];
    nextCursor: string | number | Date | null;
    prevCursor: string | number | Date | null;
  }> {
    const {
      cursorColumn,
      cursor,
      limit: limitValue = 10,
      direction: dir = 'next',
    } = options;
    const isDesc = dir === 'next';
    const sqlDirection = isDesc ? 'DESC' : 'ASC';
    const operator = isDesc ? '<' : '>';

    // 템플릿 리터럴 조합으로 쿼리 구성
    let query = baseQuery;

    if (cursor !== null && cursor !== undefined) {
      query = bunSql`${query} AND ${bunSql.unsafe(cursorColumn)} ${bunSql.unsafe(operator)} ${cursor}`;
    }

    query = bunSql`${query} ORDER BY ${bunSql.unsafe(cursorColumn)} ${bunSql.unsafe(sqlDirection)} LIMIT ${
      limitValue + 1
    }`;

    const result = await executeQuery(query);
    let items = toCamelCaseArray<T>(result);

    // 다음 페이지 존재 여부 확인
    const hasMore = items.length > limitValue;
    if (hasMore) items.pop();

    // direction이 'prev'인 경우 결과를 뒤집어서 반환
    if (dir === 'prev') items = items.reverse();

    // 커서 계산
    const camelColumn = getCamelColumn(cursorColumn);

    const nextCursor =
      hasMore && dir === 'next'
        ? ((items[items.length - 1] as Record<string, unknown>)[camelColumn] as
            | string
            | number
            | Date)
        : null;

    const prevCursor =
      items.length > 0 && dir === 'prev'
        ? ((items[0] as Record<string, unknown>)[camelColumn] as string | number | Date)
        : null;

    return { data: items, nextCursor, prevCursor };
  }
}
