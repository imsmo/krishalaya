// apps/worker/src/registry.ts · the operational jobs this worker runs on a schedule. Each is pg-native + bounded.
// Domain-handler jobs (notification dispatch, settlement, outbox HANDLER execution) require the api business
// logic and are intentionally NOT here — see WORKER-RUNTIME.md "Deferred: domain-handler jobs".
import { Job } from './jobs/index';
import { reconZeroSumJob } from './jobs/recon-zero-sum.job';
import { reconInternalBalanceJob } from './jobs/recon-internal-balance.job';
import { ensurePartitionsJob } from './jobs/ensure-partitions.job';
import { retentionEnforcerJob } from './jobs/retention-enforcer.job';
import { idempotencyPurgeJob } from './jobs/idempotency-purge.job';
import { dpdpErasureCoolingJob } from './jobs/dpdp-erasure-cooling.job';
import { outboxGaugeJob } from './jobs/outbox-gauge.job';
import { webhookDeliveryJob } from './jobs/webhook-delivery.job';
import { scheduledReportsJob } from './jobs/scheduled-reports.job';
import { supportEscalationsJob } from './jobs/support-escalations.job';
import { pendingPlanChangeJob } from './jobs/pending-plan-change.job';

export const JOBS: Job[] = [
  reconZeroSumJob,
  // PC-56 ADMIN-6: the per-account cached-balance-vs-ledger drift check. The query has existed twice since 0006
  // (`runInternalBalanceCheck` in wallet-service and again in apps/api) and NEITHER COPY HAS EVER RUN — so the only
  // check that catches a balance a farmer is SHOWN disagreeing with the ledger has never executed. The zero-sum
  // monitor cannot substitute: a transaction's legs sum to zero whether or not every cached balance has drifted.
  reconInternalBalanceJob,
  ensurePartitionsJob,
  retentionEnforcerJob,
  idempotencyPurgeJob,
  dpdpErasureCoolingJob,
  outboxGaugeJob,
  webhookDeliveryJob, // P1-11: signed outbound webhook delivery (decrypts per-endpoint secret, HMAC, backoff)
  // PC-56 ADMIN-1e: fires the platform's scheduled reports. pg-native (bounded SQL over saas_invoices), leader-locked
  // like every job here, and AT-MOST-ONCE by design — `next_run_at` moves before the digest is produced, so a crash
  // misses a run rather than repeating it. Every firing writes a run row with the delivery truth: today that is
  // `provider_pending`, because no email provider is configured anywhere in this platform.
  scheduledReportsJob,
  // PC-56 ADMIN-2b: FIRES the support escalation chain (0097 policy → 0098 ledger). Before this job an SLA breach did
  // nothing unless somebody happened to be watching the board. Idempotent per (ticket, breach kind, step), so a re-run
  // or two replicas cannot page the same person twice for the same breach.
  supportEscalationsJob,
  // PC-56 TENANT-1d-2: APPLIES a scheduled plan downgrade on its effective date. 0126 added the pending pointer and an
  // index whose comment calls it "the worker's sweep", and there was no sweep — so a downgrade the tenant was shown a
  // date for ("takes effect 01 Aug") would never have applied, leaving them on the old plan at the old price with a
  // console still promising the change. pg-native for the reason stated in the job file: the four api-side tenancy job
  // classes are not registered anywhere, so a fifth would have been another thing that never runs.
  pendingPlanChangeJob,
];
