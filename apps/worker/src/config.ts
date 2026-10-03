// apps/worker/src/config.ts · the ONLY place process.env is read in the worker. Fail-closed (§4): in production
// the scheduler refuses to start without a kv_relay DB URL or with a dev/default password. The worker runs the
// outbox relay + cross-tenant sweeps, so it connects as the BYPASSRLS `kv_relay` role (migration 0018) — NEVER kv_app.
// PC-56 TENANT-13a (F-10): WEBHOOK_SIGNING_KEK is resolved HERE, once — production without it refuses to start (the old job quietly
// set a "delivery disabled" gauge and returned, so a worker that could not sign looked healthy). Outside production the documented
// development key (core/secrets envelope, identical in the API) stands in.
import { resolveKek } from './jobs/webhook/secret-envelope';
export interface WorkerEnv {
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  DATABASE_URL: string;        // kv_relay
  REDIS_URL: string;
  METRICS_PORT: number;
  TICK_INTERVAL_MS: number;
  STATEMENT_TIMEOUT_MS: number;
}

export class WorkerConfig {
  readonly env: WorkerEnv;
  /** The 32-byte KEK that opens webhook signing secrets (never logged). */
  readonly webhookKek: Buffer;
  constructor(raw: Record<string, unknown> = process.env) {
    this.env = {
      NODE_ENV: (String(raw.NODE_ENV ?? 'development') as WorkerEnv['NODE_ENV']),
      DATABASE_URL: String(raw.DATABASE_URL ?? ''),
      REDIS_URL: String(raw.REDIS_URL ?? ''),
      METRICS_PORT: Number(raw.METRICS_PORT ?? 9090),
      TICK_INTERVAL_MS: Number(raw.WORKER_TICK_INTERVAL_MS ?? 15000),
      STATEMENT_TIMEOUT_MS: Number(raw.WORKER_STATEMENT_TIMEOUT_MS ?? 120000),
    };
    this.assertProductionSecurity();
    try { this.webhookKek = resolveKek(raw.WEBHOOK_SIGNING_KEK as string | undefined, this.isProd); }
    catch (e) { throw new Error(`FATAL: insecure worker config -> ${(e as Error).message}`); }
  }
  get isProd() { return this.env.NODE_ENV === 'production'; }
  private assertProductionSecurity(): void {
    if (this.env.NODE_ENV !== 'production') return;
    const problems: string[] = [];
    const url = this.env.DATABASE_URL;
    if (!url) problems.push('DATABASE_URL must be set (kv_relay role)');
    else {
      if (/@(localhost|127\.0\.0\.1|::1)[:/]/.test(url)) problems.push('DATABASE_URL must not point at localhost in production');
      if (/:(postgres|password|dev|changeme|admin|secret)@/i.test(url)) problems.push('DATABASE_URL must use a strong, non-default password');
      if (/sslmode=disable/i.test(url)) problems.push('DATABASE_URL must require TLS (sslmode=require)');
      if (!/kv_relay/.test(url)) problems.push('worker must connect as kv_relay (the BYPASSRLS relay role), not kv_app');
    }
    if (problems.length) throw new Error(`FATAL: insecure worker config -> ${problems.join('; ')}`);
  }
}
