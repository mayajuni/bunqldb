import { AsyncLocalStorage } from 'node:async_hooks';
import type { SQL } from 'bun';

// 트랜잭션 타입 export
export type TxType = SQL;

// ============================================================
// 통합 DB 컨텍스트
// - 트랜잭션과 로깅 설정을 하나의 AsyncLocalStorage로 관리
// ============================================================

export interface DbContext {
  tx?: SQL; // 현재 활성화된 트랜잭션
  skipSqlLogging?: boolean; // SQL 로깅 스킵 여부
}

// 통합 컨텍스트 저장소
export const dbContextStorage = new AsyncLocalStorage<DbContext>();

// 현재 트랜잭션을 가져오거나 없으면 undefined를 반환하는 헬퍼 함수
export const getTx = () => dbContextStorage.getStore()?.tx;

// 현재 컨텍스트에서 SQL 로깅이 스킵되었는지 확인
export const isSqlLoggingSkipped = () =>
  dbContextStorage.getStore()?.skipSqlLogging ?? false;

// 현재 컨텍스트 가져오기
export const getDbContext = () => dbContextStorage.getStore();

// 기존 호환성을 위한 txStorage alias (deprecated)
export const txStorage = dbContextStorage;
