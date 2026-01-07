// Public API

// Types
export type { DbConfig, SqlLogger, SqlLoggingOptions } from "./types";

// Case converter helpers
export {
  snakeToCamel,
  toCamelCase,
  toCamelCaseArray,
} from "./helpers/case-converter";

// DB helpers
export {
  cursorCondition,
  DB,
  /** @deprecated sql.silent 체이닝 사용을 권장합니다. */
  type DbQueryOptions,
  empty,
  limit,
  offset,
  orderBy,
} from "./helpers/db-helpers";

// Internal DB (public exports only)
export type { DbType, ExtendedSQL } from "./internal/internal-db";
export {
  configureDb,
  getBaseSql,
  getDbType,
  isDateStringsEnabled,
  isDbConnected,
  isSqlLoggingEnabled,
  resetConnection,
  sql,
} from "./internal/internal-db";

// Transactional decorator
export { Transactional } from "./internal/transactional";
