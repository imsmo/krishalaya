// apps/admin-api/src/modules/compliance-ops/__tests__/compliance-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (schema apps/api builds + migrations 0003/0015 + 0034). Proves:
// work a DSR through the queue (open→in_progress→completed + audit), approve a data_export_job (approval_status
// flips + audit), and open→contain→notify→close a breach (state + audit rows + the affected-data CATEGORIES
// stored, no raw PII). Runs only when DATABASE_ADMIN_URL/DATABASE_URL is set (CI's DB job).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { DataSubjectRequestsQueueService } from '../services/data-subject-requests-queue.service';
import { TenantExportApprovalsService } from '../services/tenant-export-approvals.service';
import { BreachResponseConsoleService } from '../services/breach-response-console.service';
import { makeUser } from '../../../../test/integration-fixtures';
import { BreachNotificationIncompleteError, BreachSignOffRequiredError } from '../domain/compliance-ops.errors';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('compliance-ops (integration, real Postgres — DPDP ops + audit)', () => {
  let pool: AdminPool; let inspect: Pool;
  let dsrSvc: DataSubjectRequestsQueueService; let exportSvc: TenantExportApprovalsService; let breachSvc: BreachResponseConsoleService;
  const actor = { userId: randomUUID(), roles: ['platform_compliance_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['compliance.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  const dpo = { ...actor, userId: randomUUID(), requestId: 'itest-dpo' };   // the second person (0109: sign-off ≠ opener)
  let userId = ''; let dsrId = ''; let exportId = ''; let breachId = '';

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const audit = new AdminAuditWriter(pool);
    const repo = new ComplianceRepository(pool);
    dsrSvc = new DataSubjectRequestsQueueService(pool, audit, repo);
    exportSvc = new TenantExportApprovalsService(pool, audit, repo);
    breachSvc = new BreachResponseConsoleService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
    userId = await makeUser(inspect);   // PC-56 TEST-1: its own user (was the first user in the database — none on a fresh build)
    const d = await inspect.query(`INSERT INTO data_subject_requests (user_id, request_type, status) VALUES ($1,'access','open') RETURNING id`, [userId]);
    dsrId = d.rows[0].id;
    const e = await inspect.query(`INSERT INTO data_export_jobs (user_id, job_kind, status) VALUES ($1,'user_dpdp_export','queued') RETURNING id`, [userId]);
    exportId = e.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM data_breaches WHERE id=$1`, [breachId]).catch(() => undefined);
      await inspect.query(`DELETE FROM data_export_jobs WHERE id=$1`, [exportId]).catch(() => undefined);
      await inspect.query(`DELETE FROM data_subject_requests WHERE id=$1`, [dsrId]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('DSR: open→in_progress→completed + audit rows', async () => {
    await dsrSvc.update(actor, dsrId, { action: 'start', resolution: 'started review' });
    const out: any = await dsrSvc.update(actor, dsrId, { action: 'complete', resolution: 'access bundle provided' });
    expect(out.status).toBe('completed');
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action IN ('dpdp.dsr_in_progress','dpdp.dsr_completed')`, [dsrId]);
    expect(au.rows[0].c).toBe(2);
  });

  it('export: approve flips approval_status + audits', async () => {
    const out: any = await exportSvc.decide(actor, exportId, { decision: 'approve', reason: 'verified data-principal request' });
    expect(out.approvalStatus).toBe('approved');
    const row = await inspect.query(`SELECT approval_status, approved_by FROM data_export_jobs WHERE id=$1`, [exportId]);
    expect(row.rows[0].approval_status).toBe('approved');
    expect(row.rows[0].approved_by).toBe(actor.userId);
  });

  it('breach: open→contain→notify→close + audit; stores categories not raw PII', async () => {
    const opened: any = await breachSvc.open(actor, { severity: 'high', title: 'creds exposed', description: 'a subset of contact rows were exposed', affectedData: 'phone,email', affectedCount: 1200, detectedAt: new Date().toISOString() });
    breachId = opened.id;
    await breachSvc.update(actor, breachId, { action: 'contain', note: 'rotated keys, revoked access' });
    // PC-56 TEST-1 · since 0109 (W043: "moving to notified requires all three ticked + DPO sign-off") `notify` is no longer two
    // typed timestamps. This used to notify straight after containment; the service now refuses that BY NAME, and the test
    // proves it before walking the evidenced path: the three steps, each with its evidence, then a DPO who is NOT the person
    // who declared the breach signs off, then notify.
    const notifyDto = { action: 'notify', note: 'DPB + principals notified', regulatorNotifiedAt: new Date().toISOString(), principalsNotifiedAt: new Date().toISOString() } as const;
    await expect(breachSvc.update(actor, breachId, notifyDto)).rejects.toBeInstanceOf(BreachNotificationIncompleteError);
    await breachSvc.recordStep(actor, breachId, { step: 'board_filing', outcome: 'done', evidenceRef: 'DPB-ACK-ITEST' });
    await breachSvc.recordStep(actor, breachId, { step: 'principals_notified', outcome: 'done', evidenceRef: 'sms broadcast batch ITEST', reachedCount: 1200, channel: 'sms' });
    await breachSvc.recordStep(actor, breachId, { step: 'tenant_briefed', outcome: 'not_applicable', note: 'platform-wide incident, no single tenant affected' });
    await expect(breachSvc.update(actor, breachId, notifyDto)).rejects.toBeInstanceOf(BreachSignOffRequiredError);
    await expect(breachSvc.signOff(actor, breachId, 'self-certify')).rejects.toBeTruthy();   // the declarer cannot certify
    await breachSvc.signOff(dpo, breachId, 'evidence read, notification adequate');
    await breachSvc.update(actor, breachId, notifyDto);
    const closed: any = await breachSvc.update(actor, breachId, { action: 'close', note: 'incident closed' });
    expect(closed.status).toBe('closed');
    const row = await inspect.query(`SELECT affected_data, regulator_notified_at, principals_notified_at FROM data_breaches WHERE id=$1`, [breachId]);
    expect(row.rows[0].affected_data).toBe('phone,email');               // categories, not values
    expect(row.rows[0].regulator_notified_at).not.toBeNull();
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action LIKE 'dpdp.breach_%'`, [breachId]);
    expect(au.rows[0].c).toBe(8);   // opened + contained + 3 steps recorded + signed off + notified + closed
  });
});
