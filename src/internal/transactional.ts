import { dbContextStorage, getDbContext, getTx, type TxType } from './context';
import { getBaseSql } from './internal-db';

export function Transactional() {
  return (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      // 1. 이미 트랜잭션이 활성화되어 있다면, 기존 트랜잭션을 재사용합니다 (중첩 트랜잭션 / 전파)
      if (getTx()) {
        return originalMethod.apply(this, args);
      }

      // TDD 모드 체크: 환경변수가 'true'면 자동 롤백
      const isTddMode = process.env.TDD_MODE === 'true';

      // 현재 컨텍스트의 설정 가져오기 (로깅 설정 등 유지)
      const currentContext = getDbContext();

      // 2. 새로운 트랜잭션을 시작합니다 (lazy initialization)
      const baseSql = getBaseSql();
      return baseSql
        .begin(async (tx: TxType) => {
          // 3. AsyncLocalStorage에 트랜잭션 객체를 저장합니다 (기존 컨텍스트 설정 유지)
          return dbContextStorage.run({ ...currentContext, tx }, async () => {
            // 4. 원래 메소드를 실행합니다
            const result = await originalMethod.apply(this, args);

            // 5. TDD 모드에서는 강제 롤백
            if (isTddMode) {
              throw { __tddRollback: true, result };
            }

            return result;
          });
        })
        .catch((error: unknown) => {
          // TDD 모드 롤백인 경우, 결과 반환
          if (
            error &&
            typeof error === 'object' &&
            '__tddRollback' in error &&
            'result' in error
          ) {
            return (error as unknown as { __tddRollback: boolean; result: unknown })
              .result;
          }
          throw error;
        });
    };

    return descriptor;
  };
}
