// apps/worker/src/main.ts · worker-runtime host. Boots fail-closed (WorkerConfig), connects as kv_relay, exposes
// /metrics + /healthz, and runs the scheduler loop: every tick, each DUE job runs under its Postgres advisory
// leader-lock (N replicas are safe), timed + metered, with failures isolated. Graceful shutdown drains the pool.
import 'dotenv/config'; // load apps/worker/.env into process.env BEFORE WorkerConfig reads it (local dev; no-ops in prod where env is injected)
import { WorkerConfig } from './config';
import { makePool, withClient } from './db';
import { WorkerMetrics } from './metrics';
import { startMetricsServer } from './metrics-server';
import { tick } from './runtime/runner';
import { tryAdvisoryLock, advisoryUnlock } from './runtime/leader-lock';
import { JOBS } from './registry';
import { Job } from './jobs/index';

async function bootstrap() {
  const cfg = new WorkerConfig();                       // throws in prod on insecure config
  const pool = makePool(cfg);
  const metrics = new WorkerMetrics();
  const server = startMetricsServer(metrics, cfg.env.METRICS_PORT);
  const byName = new Map<string, Job>(JOBS.map((j) => [j.name, j]));
  const lastRun = new Map<string, number>();
  let stopping = false;

  // eslint-disable-next-line no-console
  console.log(`[worker] runtime up (${cfg.env.NODE_ENV}); ${JOBS.length} jobs; metrics on :${cfg.env.METRICS_PORT}`);

  const loop = async () => {
    if (stopping) return;
    await tick(JOBS, lastRun, {
      now: () => Date.now(),
      // hold the lock on a DEDICATED connection for the duration of the job, then release
      withLock: async (key, fn) => withClient(pool, cfg.env.STATEMENT_TIMEOUT_MS, async (c) => {
        const got = await tryAdvisoryLock(c, key);
        if (!got) return false;
        try { await fn(); return true; } finally { await advisoryUnlock(c, key); }
      }),
      run: async (name) => {
        const job = byName.get(name)!;
        await withClient(pool, cfg.env.STATEMENT_TIMEOUT_MS, (client) => job.run({ client, metrics, secrets: { webhookKek: cfg.webhookKek } }));
      },
      record: (name, ms, ok) => { metrics.observe('worker_job', ms, { job: name, ok: String(ok) }); if (!ok) metrics.inc('worker_job_failures', { job: name }); },
      log: (level, msg, meta) => console[level === 'error' ? 'error' : 'log'](`[worker] ${msg}`, meta ? JSON.stringify(meta) : ''),
    });
  };

  const timer = setInterval(() => { void loop(); }, cfg.env.TICK_INTERVAL_MS);
  void loop(); // run once immediately on boot

  const shutdown = () => { stopping = true; clearInterval(timer); server.close(); void pool.end(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => { console.error('[worker] fatal', err); process.exit(1); });
