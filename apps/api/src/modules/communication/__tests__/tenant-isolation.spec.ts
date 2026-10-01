// modules/communication/__tests__/tenant-isolation.spec.ts · scoping SQL contract (CI gate).
// notifications: every read binds user_id (inbox) or provider_msg_ref (webhook); lists are KEYSET (no OFFSET);
// point updates bind (id, created_at) for partition pruning; the mark-read read locks FOR UPDATE + binds
// user_id (no IDOR). templates resolve tenant-override-then-platform (tenant_id=$ OR tenant_id IS NULL).
// preferences + quiet hours are always filtered by user_id. The catalog is global (no tenant scoping).
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { Notification } from '../domain/notification.entity';

function fakeReplica() {
  // [PC-56 TENANT-8b] the inbox asks the delivery log's retention row for its window first; answer it, then nothing.
  const exec = { query: jest.fn(async (...a: [sql: string, params?: unknown[]]) => (/data_retention_policies/.test(a[0]) ? { rows: [{ since: new Date('2026-04-01T00:00:00Z') }], rowCount: 1 } : { rows: [], rowCount: 0 })) };
  return { provider: { forTenant: () => exec } as any, exec };
}
const notif = () => Notification.queue({ id: 'n1', tenantId: 'tenantA', userId: 'u1', eventCode: 'order.delivered', channel: 'inapp', templateId: null, languageCode: 'en', payload: {} });

describe('notifications isolation', () => {
  it('inbox list binds user_id, is IN-APP ONLY (F-9), pruned on created_at, keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new NotificationRepository(provider).inbox('u1', 'tenantA', { limit: 50 });
    const [sql, params] = exec.query.mock.calls[1];
    expect(sql).toMatch(/n\.user_id = \$1 AND n\.channel = 'inapp' AND n\.created_at >= \$2/); expect(sql).toMatch(/ORDER BY n\.created_at DESC, n\.id DESC/);
    expect(sql).not.toMatch(/OFFSET/i); expect(params![0]).toBe('u1');
  });
  it('mark-read read binds id + user_id + created_at and locks FOR UPDATE (anti-IDOR, one partition)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const at = new Date('2026-09-30T10:00:00Z');
    await new NotificationRepository(fakeReplica().provider).getForUserUpdate(tx as any, 'u1', 'n1', at);
    const [sql, params] = tx.query.mock.calls[0];
    // [PC-56 TENANT-8b] a ONE-MILLISECOND range on the partition key — a JS Date is ms, the column µs (see AT()).
    expect(sql).toMatch(/id=\$1 AND user_id=\$2 AND created_at >= \$3::timestamptz AND created_at < \$3::timestamptz \+ interval '1 millisecond'/); expect(sql).toMatch(/FOR UPDATE/); expect(params).toEqual(['n1', 'u1', at]);
  });
  it('update binds (id, created_at) for partition pruning and only delivery columns', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const n = notif(); n.markSent('ref', 5);
    await new NotificationRepository(fakeReplica().provider).update(tx as any, n);
    const [sql] = tx.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND created_at >= \$2::timestamptz AND created_at < \$2::timestamptz \+ interval '1 millisecond'/);
    expect(sql).toMatch(/SET status=\$3, sent_at=\$4, read_at=\$5, provider_msg_ref=\$6, cost_minor=\$7/);
    expect(sql).not.toMatch(/payload|user_id\s*=/);            // never rewrites content/owner
  });
  it('insert writes tenant_id + user_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new NotificationRepository(fakeReplica().provider).insert(tx as any, notif());
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO notifications/);
    expect(tx.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['tenantA', 'u1']));
  });
});

describe('templates resolution (tenant override → platform default)', () => {
  it('resolve prefers the tenant row, falls back to the platform (NULL) row', async () => {
    const { provider, exec } = fakeReplica();
    await new NotificationTemplateRepository(provider).resolve('tenantA', 'order.delivered', 'push', 'en');
    const [sql, params] = exec.query.mock.calls[0];
    // Aliased in PC-56 ADMIN-11b: the words now come from the serving VERSION rather than the mutable row, so the
    // table is `t` and the isolation clause is `t.tenant_id`. The assertion is strengthened rather than relaxed —
    // the join and the lifecycle filter are asserted too, because those are the two things that were missing and
    // whose absence let a rejected template keep sending.
    expect(sql).toMatch(/t\.tenant_id=\$4 OR t\.tenant_id IS NULL/);
    expect(sql).toMatch(/ORDER BY t\.tenant_id NULLS LAST/);
    expect(sql).toMatch(/JOIN notification_template_versions v/);
    expect(sql).toMatch(/v\.id = t\.serving_version_id AND v\.lifecycle = 'approved'/);
    // The body must NOT be read from the template row: that column is what the old upsert rewrote in place.
    expect(sql).toMatch(/v\.body AS body/);
    expect(sql).not.toMatch(/t\.body/);
    expect(params).toEqual(['order.delivered', 'push', 'en', 'tenantA']);
  });
  // [PC-56 TENANT-8a] `listFor` read `t.body` — the row, not the serving version — and printed as live words that never
  // sent (F-1). It is gone; W180's `index` reads the words' SOURCE from the serving versions and pages on the slot.
  it('index scopes to tenant + platform, keyset on the slot (no OFFSET), and never reads the row body', async () => {
    const { provider, exec } = fakeReplica();
    exec.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await new NotificationTemplateRepository(provider).index('tenantA', { limit: 50, cursor: { e: 'order.delivered', c: 'sms', l: 'gu' } });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/\(tenant_id IS NULL OR tenant_id = \$1\)/); expect(sql).not.toMatch(/OFFSET/i);
    expect(sql).toMatch(/\(s\.event_code, s\.channel, s\.language_code\) > \(\$2, \$3, \$4\)/);
    expect(sql).toMatch(/o\.tenant_id = \$1/);
    expect(sql).not.toMatch(/\bt\.body|\bo\.body|\bp\.body/);
    expect(params).toEqual(['tenantA', 'order.delivered', 'sms', 'gu', 50]);
  });
});

describe('preferences + quiet hours are user-scoped', () => {
  it('preference list binds user_id', async () => {
    const { provider, exec } = fakeReplica();
    await new NotificationPreferenceRepository(provider).listForUser('u1');
    expect(exec.query.mock.calls[0][0]).toMatch(/WHERE user_id=\$1/);
  });
  it('quiet hours read binds user_id', async () => {
    const { provider, exec } = fakeReplica();
    await new QuietHoursRepository(provider).getForUser('u1');
    expect(exec.query.mock.calls[0][0]).toMatch(/WHERE user_id=\$1/);
  });
});
