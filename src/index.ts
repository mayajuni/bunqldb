// Public API

// Types
export type { SqlLogger, SqlLoggingOptions } from './types';

// Case converter helpers
export { snakeToCamel, toCamelCase, toCamelCaseArray } from './helpers/case-converter';

// DB helpers
export {
  cursorCondition,
  DB,
  type DbQueryOptions,
  empty,
  limit,
  offset,
  orderBy,
} from './helpers/db-helpers';

// Internal DB (public exports only)
export type { DbType } from './internal/internal-db';
export {
  getBaseSql,
  getDbType,
  isDbConnected,
  isSqlLoggingEnabled,
  resetConnection,
  setSqlLogging,
  sql,
  withSkippedSqlLogging,
} from './internal/internal-db';

// Transactional decorator
export { Transactional } from './internal/transactional';
