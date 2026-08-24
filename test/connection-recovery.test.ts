/**
 * 끊긴 연결에서 되살아나는지 확인한다.
 *
 * DB 앞에 TCP 프록시를 두고, FIN/RST 없이 침묵시킨다 — 노트북 절전·VPN 끊김·경로 장애에서
 * 실제로 일어나는 모습이다. 소켓은 살아 있는 것처럼 보여서 드라이버는 죽은 커넥션에 쿼리를
 * 실어 보내고 타임아웃까지 기다린 뒤 실패한다.
 *
 * 유휴 시간을 조절해서 막을 수 있는 문제가 아니다. 같은 환경에서 35초를 놀려도, 서버가
 * 커넥션을 끊어도(pg_terminate_backend) 재연결은 멀쩡했다. 오직 이 "침묵" 만 실패한다.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureDb, resetConnection, sql } from "../src";

const UPSTREAM_URL = process.env.DATABASE_URL;
const PROXY_PORT = 55396;

let server: { stop: (closeActiveConnections?: boolean) => void } | null = null;
let blackhole = false;
let originalUrl: string | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DB 앞에 서서, blackhole 이면 양쪽으로 아무것도 보내지 않는 프록시. */
function startProxy(upstreamHost: string, upstreamPort: number) {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: PROXY_PORT,
    socket: {
      open(client) {
        (client as any).pending = [];
        Bun.connect({
          hostname: upstreamHost,
          port: upstreamPort,
          socket: {
            data(_s, d) {
              if (!blackhole) client.write(d);
            },
            close() {
              if (!blackhole) client.end();
            },
            error() {
              /* 업스트림 오류는 프록시가 삼킨다 — 테스트가 보려는 것은 침묵이다 */
            },
          },
        }).then((up) => {
          (client as any).up = up;
          for (const chunk of (client as any).pending) up.write(chunk);
          (client as any).pending = [];
        });
      },
      data(client, d) {
        if (blackhole) return;
        const up = (client as any).up;
        if (up) up.write(d);
        else (client as any).pending.push(Buffer.from(d));
      },
      close(client) {
        (client as any).up?.end?.();
      },
      error() {
        /* 클라이언트 오류도 마찬가지 */
      },
    },
  });
}

const describeOrSkip = UPSTREAM_URL?.startsWith("postgres") ? describe : describe.skip;

describeOrSkip("끊긴 연결 복구", () => {
  beforeAll(() => {
    const url = new URL(UPSTREAM_URL as string);
    server = startProxy(url.hostname, Number(url.port || 5432));

    originalUrl = process.env.DATABASE_URL;
    url.hostname = "127.0.0.1";
    url.port = String(PROXY_PORT);
    process.env.DATABASE_URL = url.toString();

    resetConnection();
    // 침묵을 빨리 알아채도록 짧게 잡는다(테스트를 오래 끌지 않으려는 목적).
    configureDb({ pool: { idleTimeout: 3 } });
  });

  afterAll(() => {
    blackhole = false;
    server?.stop(true);
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
    resetConnection();
    configureDb({ pool: {} });
  });

  test("연결이 침묵해도 읽기는 새 연결로 되살아난다", async () => {
    await sql`SELECT 1 as ok`;

    blackhole = true;
    setTimeout(() => {
      blackhole = false;
    }, 1000);

    const rows = (await sql`SELECT 42 as answer`) as Array<{ answer: number }>;
    expect(rows[0]?.answer).toBe(42);
  }, 30_000);

  test("쓰기는 되살리지 않는다 — 두 번 들어가면 안 되기 때문", async () => {
    await sql`CREATE TABLE IF NOT EXISTS bunqldb_recovery_probe (id serial primary key, tag text)`;
    await sql`DELETE FROM bunqldb_recovery_probe`;

    blackhole = true;
    setTimeout(() => {
      blackhole = false;
    }, 1000);

    let failed = false;
    try {
      await sql`INSERT INTO bunqldb_recovery_probe (tag) VALUES ('write')`;
    } catch {
      failed = true;
    }

    await sleep(500);
    const rows = (await sql`
      SELECT count(*)::int as n FROM bunqldb_recovery_probe WHERE tag = 'write'`) as Array<{
      n: number;
    }>;

    // 실패했다면 행이 없어야 하고, 어떤 경우에도 두 번 들어가서는 안 된다.
    expect(rows[0]?.n).toBeLessThanOrEqual(1);
    if (failed) expect(rows[0]?.n).toBe(0);

    await sql`DROP TABLE bunqldb_recovery_probe`;
  }, 30_000);
});
