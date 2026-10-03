// apps/worker/src/jobs/index.ts · a Job = a pg-native operational task. ctx gives a client (already under the
// job's advisory lock + statement timeout) + the metrics registry. Jobs are idempotent + bounded (LIMIT/cap).
import { PoolClient } from 'pg';
import { WorkerMetrics } from '../metrics';

// PC-56 TENANT-13a: `secrets` carries key material a job needs, resolved ONCE at boot by WorkerConfig (which refuses to start in
// production without it) — never read from process.env inside a job, never a silent "disabled".
export interface JobSecrets { webhookKek: Buffer }
export interface JobCtx { client: PoolClient; metrics: WorkerMetrics; secrets?: JobSecrets }
export interface Job { name: string; intervalSec: number; run(ctx: JobCtx): Promise<void> }
