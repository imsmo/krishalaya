// modules/catalogue/jobs/certificate-expiry-alerts.job.ts
// Worker job (kv_relay): flip verified certificates whose valid_until has passed → expired. Claims across tenants
// (FOR UPDATE SKIP LOCKED), bounded per tick; each expire() is idempotent (skips a cert no longer verified) and
// emits catalogue.certificate_expired to the outbox in its own tx (as kv_app, the certificate's organisation's transaction).
//
// PC-56 STORE-5b · D1 (survey C-5 / F-10) — THE CLOCK IS SCHEDULED AT LAST. It was "NOT a DI provider — apps/worker instantiates it": nothing
// ever did. `CertificateExpiryClock` below is a provider-registered `ScheduledJob` (the 5a ReviewPromptsClock shape; catalogue.module.ts
// registers it) at the registry table's cadence (`core/jobs/clock-cadence.ts` row `certificate-expiry`, every 24 h). FLAG-INDEPENDENT: expiry
// is a fact — a lapsed certificate is expired whether or not its organisation publishes certificates. THE BADGE: no listing is mutated and
// nothing needs to consume `catalogue.certificate_expired` (it keeps its publisher): the badge rule (`listings/read-models/certified.sql.ts`)
// reads the certificate at READ time, and the public read already says "expired" the day validity passes — this clock makes the ROW agree.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { CertificateRepository } from '../repositories/certificate.repository';
import { CertificateService } from '../services/certificate.service';

export const CERTIFICATE_EXPIRY_JOB = 'certificate-expiry';

export class CertificateExpiryAlertsJob {
  constructor(private readonly systemPool: Pool, private readonly repo: CertificateRepository, private readonly certs: CertificateService) {}

  async run(limit = 200, now: Date = new Date()): Promise<{ expired: number; failed: number }> {
    const client = await this.systemPool.connect();
    let due: Array<{ id: string; tenantId: string }> = [];
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as any) as any, tenantId: '', userId: 'system' };   // eslint-disable-line @typescript-eslint/no-explicit-any
      due = await this.repo.findDueToExpire(tx, now, limit);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }

    let expired = 0, failed = 0;
    for (const d of due) { try { await this.certs.expire(d.tenantId, d.id); expired++; } catch { failed++; } }
    return { expired, failed };
  }
}

/** PC-56 STORE-5b: the expiry job as a registered `ScheduledJob` — the interval is the registry table's (`cadenceOf('certificate-expiry')`,
 *  never a literal here); `tick` is the testable seam (the live spec passes the relay pool). */
export class CertificateExpiryClock implements ScheduledJob {
  readonly name = CERTIFICATE_EXPIRY_JOB;
  private readonly log = new Logger(CertificateExpiryClock.name);
  constructor(readonly intervalMs: number, private readonly repo: CertificateRepository, private readonly certs: CertificateService) {}
  tick(pool: Pool, now: Date = new Date()): Promise<{ expired: number; failed: number }> {
    return new CertificateExpiryAlertsJob(pool, this.repo, this.certs).run(undefined, now);
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.tick(pool);
    if (r.expired + r.failed > 0) this.log.log(`${this.name}: ${r.expired} certificate(s) expired, ${r.failed} failed`);
  }
}
