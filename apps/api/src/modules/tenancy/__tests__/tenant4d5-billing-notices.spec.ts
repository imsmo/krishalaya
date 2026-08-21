// PC-56 TENANT-4d-5 · the platform learns to tell a tenant. The recipient rule, the money words, the seven
// events, and the three defects in 4d-4's paid→roll path that this wave makes load-bearing.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BILLING_RECIPIENT_PERMISSION, MAX_BILLING_RECIPIENTS, NOTICE_EVENT_CODES, NOTICE_VARIABLES,
  NOTIFIED_BILLING_EVENTS, isNotifiedBillingEvent, moneyText, paidNoticeApplies, recipientVerdict,
  retryAndNotifyVerdict,
} from '../domain/billing-notice';
import { mechanismLines } from '../domain/billing-grace';
import { TenancyEventType } from '../domain/tenancy.events';
import { SaasInvoice } from '../domain/saas-invoice.entity';
import { Subscription } from '../domain/subscription.entity';
import { BillingNoticeService } from '../services/billing-notice.service';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const REPO = path.join(__dirname, '../../../../../..');
const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const raw = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const migration = () => fs.readFileSync(path.join(REPO, 'db/migrations/0149_billing_notifications.sql'), 'utf8');
const sqlOnly = () => migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · WHO hears about a tenant\'s own bill', () => {
  it('is the holders of the SAME permission the billing console requires', async () => {
    // Not a role: `roles` is a platform table with no tenant_id (0142 learned that against a real database), so
    // hardcoding `tenant_admin` would miss an FPO that grants billing to a finance clerk AND would block a
    // white-label that names its roles differently — Rule Zero.
    expect(BILLING_RECIPIENT_PERMISSION).toBe('tenant.settings');
    const { TenancyPermissions } = await import('../policies/tenancy.policies');
    expect(BILLING_RECIPIENT_PERMISSION).toBe(TenancyPermissions.ManageTenant);
  });

  it('dedupes a person holding two roles, and keeps the caller\'s order', () => {
    // TENANT-4d-1 established that a member is a PERSON: two roles must not consume two seats, and here must
    // not consume two SMS. The order is the reader's (ORDER BY user_id) because NotificationService derives its
    // idempotency key per (dedupeKey, user, channel) — an unstable list would make a relay retry a SECOND send.
    const v = recipientVerdict(['u2', 'u1', 'u2', 'u1', 'u3'], true);
    expect(v).toEqual({ kind: 'notify', userIds: ['u2', 'u1', 'u3'], truncated: false });
  });

  it('reports a truncation instead of silently sending the first twenty', () => {
    const many = Array.from({ length: MAX_BILLING_RECIPIENTS + 5 }, (_, i) => `u${i}`);
    const v = recipientVerdict(many, true);
    expect(v.kind).toBe('notify');
    if (v.kind !== 'notify') throw new Error('unreachable');
    expect(v.userIds).toHaveLength(MAX_BILLING_RECIPIENTS);
    expect(v.truncated).toBe(true);
    // Exactly at the ceiling is NOT a truncation — an off-by-one here would log a warning on every tenant with
    // twenty billing managers for ever.
    expect(recipientVerdict(many.slice(0, MAX_BILLING_RECIPIENTS), true)).toEqual({
      kind: 'notify', userIds: many.slice(0, MAX_BILLING_RECIPIENTS), truncated: false });
  });

  it('distinguishes "nobody holds it" from "notices are off" — they are DIFFERENT facts', () => {
    // A tenant with nobody holding tenant.settings has a finding: there is no person on the platform who could
    // act on a bill. Collapsing it into the flag verdict would make it read as a configuration choice.
    expect(recipientVerdict([], true)).toEqual({ kind: 'nobody_holds_permission' });
    expect(recipientVerdict(['u1'], false)).toEqual({ kind: 'notifications_off' });
    expect(recipientVerdict([], false)).toEqual({ kind: 'notifications_off' });
    expect(recipientVerdict(['', 'u1', ''], true)).toEqual({ kind: 'notify', userIds: ['u1'], truncated: false });
  });

  it('asks the question with the SAME four clauses RoleCacheService uses, and imports the suspension rule', () => {
    const src = read('repositories', 'billing-recipients.repository.ts');
    expect(src).toContain('role_permissions');                      // role permissions
    expect(src).toContain('spo.is_granted');                        // ∪ per-staff grants
    expect(src).toContain('NOT d.is_granted');                      // − per-staff denies
    expect(src).toContain('memberSuspendedSql');                    // − members this tenant suspended
    // The predicate is IMPORTED, not retyped. member-suspension.sql.ts's own header is the standing argument:
    // "six copies of one predicate is six chances for the seventh site to be written without it." This is the
    // seventh site, and a suspended member being SMSed about an invoice they cannot open is a disclosure.
    expect(src).toContain("from '../../../shared/sql/member-suspension.sql'");
    expect(src).not.toMatch(/tenant_member_suspensions\s+kvs/);     // i.e. not hand-rolled here
    // Bounded, and bounded at ceiling+1 so "at the limit" is distinguishable from "truncated".
    expect(src).toContain('MAX_BILLING_RECIPIENTS + 1');
    expect(src).toContain('ORDER BY e.user_id');
    // Tx-bound, never the replica: a recipient list resolved off a lagging replica could drop a bill's only
    // warning, and it must be atomic with the outbox row it travels in.
    expect(src).not.toContain('READ_REPLICA');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · the money, in words, exactly', () => {
  it('divides by the CURRENCY\'S OWN exponent — never a hardcoded 100', () => {
    // A hardcoded ÷100 is the shape that blocks a country. JPY has no minor unit; KWD has three.
    expect(moneyText(795400n, 'INR', 2)).toBe('INR 7,954.00');
    expect(moneyText(7954n, 'JPY', 0)).toBe('JPY 7,954');
    expect(moneyText(7954000n, 'KWD', 3)).toBe('KWD 7,954.000');
    expect(moneyText(5n, 'INR', 2)).toBe('INR 0.05');
    expect(moneyText(0n, 'INR', 2)).toBe('INR 0.00');
  });

  it('groups, signs, and never floats — including figures beyond a double\'s integer range', () => {
    expect(moneyText(123456789012n, 'INR', 2)).toBe('INR 1,234,567,890.12');
    expect(moneyText(-551600n, 'INR', 2)).toBe('INR -5,516.00');
    // 9,007,199,254,740,993 paise is Number.MAX_SAFE_INTEGER + 2: a float would round it and the platform bills
    // in bigint minor units precisely so it does not have to.
    expect(moneyText(9007199254740993n, 'INR', 2)).toBe('INR 90,071,992,547,409.93');
  });

  it('uses the ISO CODE, not a symbol — because one payload is rendered in three scripts', () => {
    // The same body is rendered for recipients in en/hi/gu off ONE payload. '₹' is not the right glyph in every
    // script the platform ships and a per-recipient symbol needs locale data the payload cannot carry; 'INR' is
    // unambiguous in all three and needs none.
    expect(moneyText(100n, 'inr', 2)).toBe('INR 1.00');
    expect(moneyText(100n, 'INR', 2)).not.toContain('₹');
  });

  it('THROWS on an impossible exponent rather than guessing 2', () => {
    expect(() => moneyText(1n, 'XXX', -1)).toThrow();
    expect(() => moneyText(1n, 'XXX', 5)).toThrow();
    expect(() => moneyText(1n, 'XXX', 1.5)).toThrow();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · the seven events that had no subscriber', () => {
  it('names all seven, and only events that exist', () => {
    expect(NOTIFIED_BILLING_EVENTS).toHaveLength(7);
    const known = new Set(Object.values(TenancyEventType) as string[]);
    for (const e of NOTIFIED_BILLING_EVENTS) expect(known.has(e)).toBe(true);
    expect(NOTIFIED_BILLING_EVENTS).toEqual(expect.arrayContaining([
      'tenancy.saas_invoice_issued', 'tenancy.saas_invoice_paid', 'tenancy.saas_invoice_overdue',
      'tenancy.subscription_grace_started', 'tenancy.subscription_renewed',
      'tenancy.trial_ending', 'tenancy.usage_limit_alert',
    ]));
  });

  it('is an ALLOW-LIST — the other tenancy events pass through unenriched', () => {
    // Enriching "everything that passes through flush()" would silently start notifying people the moment
    // somebody added a catalog row for tenant_setting_changed. That must be a decision, not a side effect.
    expect(isNotifiedBillingEvent(TenancyEventType.TenantSettingChanged)).toBe(false);
    expect(isNotifiedBillingEvent(TenancyEventType.SubscriptionExpired)).toBe(false);
    expect(isNotifiedBillingEvent(TenancyEventType.PlanCreated)).toBe(false);
    expect(isNotifiedBillingEvent(TenancyEventType.SubscriptionGraceStarted)).toBe(true);
  });

  it('has a MAP ROW per event, pointing at recipientUserIds — the row ADMIN-6b warned about', () => {
    for (const [outboxType, eventCode] of Object.entries(NOTICE_EVENT_CODES)) {
      const row = NOTIFICATION_EVENT_MAP.find((r) => r.outboxType === outboxType);
      expect(row).toBeDefined();
      expect(row?.eventCode).toBe(eventCode);
      // "a map row pointing at a payload with no recipient is the shape of fix that looks done and changes
      // nothing" — the map file's own words. The recipient key must be the one the emitter actually writes.
      expect(row?.recipientKeys).toEqual(['recipientUserIds']);
    }
    expect(Object.keys(NOTICE_EVENT_CODES).sort()).toEqual([...NOTIFIED_BILLING_EVENTS].sort());
  });

  it('a part-payment gets no receipt — the receipt belongs to the SETTLEMENT', () => {
    // saas_invoice_paid fires on every movement in the paid arithmetic, and 0146 made issued → partially_paid
    // reachable and common. A message per instalment is not a receipt.
    expect(paidNoticeApplies({ status: 'paid' })).toBe(true);
    expect(paidNoticeApplies({ status: 'partially_paid' })).toBe(false);
    expect(paidNoticeApplies({})).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
/**
 * **THE TEST THAT STOPS A TEMPLATE SENDING A HOLE.**
 *
 * `NotificationTemplate.render()` documents its own choice: "Missing keys render as '' (never leak '{{x}}' to a
 * user)". Correct for a user-facing string, and it means a body referencing a key the payload does not carry
 * sends "Invoice  for  is due on ." — rendered, dispatched, recorded as `sent`, nothing fails anywhere. 0122
 * made variables declarable so a typo is refusable at AUTHORING time; this is the emitter's half of the promise.
 */
describe('TENANT-4d-5 · every {{token}} in 0149 is a variable the emitter actually sends', () => {
  const TOKEN = /\{\{\s*([a-zA-Z0-9_.]{1,64})\s*\}\}/g;

  /** Every seeded (event_code, template text) pair from 0149's notification_templates INSERT. */
  const templateRows = (): Array<{ event: string; channel: string; lang: string; text: string }> => {
    const sql = migration();
    const start = sql.indexOf('INSERT INTO notification_templates');
    const end = sql.indexOf('ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = sql.slice(start, end);
    const rows: Array<{ event: string; channel: string; lang: string; text: string }> = [];
    const rowRe = /\('(saas\.[a-z_]+)','([a-z]+)','([a-z]{2})',NULL,([\s\S]*?),NULL,true\)/g;
    for (let m = rowRe.exec(block); m; m = rowRe.exec(block)) {
      rows.push({ event: m[1], channel: m[2], lang: m[3], text: m[4] });
    }
    return rows;
  };

  it('parsed the migration at all (a regex that matches nothing would pass every assertion below)', () => {
    const rows = templateRows();
    // 7 events × inapp × 3 languages = 21, plus 6 SMS rows and 9 email rows.
    expect(rows.length).toBe(36);
    const langs = new Set(rows.map((r) => r.lang));
    expect([...langs].sort()).toEqual(['en', 'gu', 'hi']);
    // Law 7, and 0129's ruling: English-only breaks the promise on day one. Every (event, channel) in three.
    const byPair = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = `${r.event}|${r.channel}`;
      if (!byPair.has(k)) byPair.set(k, new Set());
      byPair.get(k)!.add(r.lang);
    }
    for (const [pair, ls] of byPair) expect({ pair, langs: [...ls].sort() }).toEqual({ pair, langs: ['en', 'gu', 'hi'] });
  });

  it('references NO variable the payload does not carry', () => {
    for (const r of templateRows()) {
      const declared = NOTICE_VARIABLES[r.event];
      expect(declared).toBeDefined();
      const used = [...r.text.matchAll(TOKEN)].map((m) => m[1]);
      for (const u of used) {
        // If this fails, a tenant is about to read a sentence with a gap in it where a figure should be.
        expect({ row: `${r.event}/${r.channel}/${r.lang}`, variable: u, declared })
          .toEqual({ row: `${r.event}/${r.channel}/${r.lang}`, variable: u, declared: expect.arrayContaining([u]) });
      }
    }
  });

  it('declares NO variable no template uses — a dead declaration is a lie to the authoring UI', () => {
    const used = new Set<string>();
    for (const r of templateRows()) for (const m of r.text.matchAll(TOKEN)) used.add(`${r.event}|${m[1]}`);
    for (const [event, vars] of Object.entries(NOTICE_VARIABLES)) {
      for (const v of vars) expect(`${event}|${v}`).toBe(used.has(`${event}|${v}`) ? `${event}|${v}` : `UNUSED: ${event}|${v}`);
    }
  });

  it('declares the same variables to the DATABASE as to the code, in both directions', () => {
    const sql = migration();
    const start = sql.indexOf('INSERT INTO notification_event_variables');
    const block = sql.slice(start, sql.indexOf('ON CONFLICT (event_code, name) DO NOTHING', start));
    const inDb = new Set<string>();
    for (const m of block.matchAll(/\('(saas\.[a-z_]+)',\s*'([a-zA-Z0-9_]+)'/g)) inDb.add(`${m[1]}|${m[2]}`);
    const inCode = new Set<string>();
    for (const [e, vs] of Object.entries(NOTICE_VARIABLES)) for (const v of vs) inCode.add(`${e}|${v}`);
    expect([...inDb].sort()).toEqual([...inCode].sort());
    // Every one is required: each body below is a complete sentence, not a headline plus optional detail, so an
    // absent variable is a hole rather than a shorter message.
    expect(block).not.toContain('false)');
  });

  it('never prints minor units at a tenant', () => {
    // "You owe {{totalMinor}}" tells an FPO it owes 795400. The one seeded precedent hedges with "(minor
    // units)", which is honest and unreadable; a bill may not be either.
    for (const r of templateRows()) {
      expect(r.text).not.toContain('Minor');
      expect(r.text).not.toContain('minor units');
      expect(r.text).not.toContain('{{totalMinor}}');
      expect(r.text).not.toContain('{{paidMinor}}');
      expect(r.text).not.toContain('{{outstandingMinor}}');
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · 0149\'s own promises', () => {
  it('feeds 0122\'s send-time gate — an unversioned template resolves to NOTHING, silently', () => {
    const sql = sqlOnly();
    expect(sql).toContain('INSERT INTO notification_template_versions');
    expect(sql).toContain("'approved'");
    expect(sql).toContain('SET serving_version_id = v.id');
    // Both statements must cover the same rows this file seeds, or a subset of the copy is dead on arrival.
    const versionInsert = sql.slice(sql.indexOf('INSERT INTO notification_template_versions'));
    expect(versionInsert).toContain("t.event_code LIKE 'saas.%' AND t.tenant_id IS NULL");
    expect(sql.slice(sql.indexOf('SET serving_version_id'))).toContain("t.event_code LIKE 'saas.%'");
  });

  it('makes the three pre-loss-of-service notices non-opt-out-able, and none of the seven critical', () => {
    const sql = sqlOnly();
    const catalog = sql.slice(sql.indexOf('INSERT INTO notification_events'), sql.indexOf('ON CONFLICT (code) DO NOTHING'));
    const rows = [...catalog.matchAll(/\('(saas\.[a-z_]+)',\s*'[^']*',\s*'([a-z]+)',\s*'(\[[^\]]*\])',\s*(true|false),\s*(true|false)\)/g)]
      .map((m) => ({ code: m[1], priority: m[2], channels: JSON.parse(m[3]) as string[], optOut: m[4] === 'true' }));
    expect(rows).toHaveLength(7);
    // 'critical' BYPASSES quiet hours (channel-resolution.ts). No billing fact is worth waking an FPO
    // administrator at 02:00, and quiet-hours suppression of the SMS while the in-app notice lands is right.
    for (const r of rows) expect({ code: r.code, priority: r.priority }).toEqual({ code: r.code, priority: 'important' });
    // A tenant who could switch off the only warning before their organisation's platform stopped working has
    // been handed a trap dressed as user choice.
    const mandatory = rows.filter((r) => !r.optOut).map((r) => r.code).sort();
    expect(mandatory).toEqual(['saas.grace_started', 'saas.invoice_overdue', 'saas.trial_ending']);
    // inapp FIRST everywhere: applyRoutinePolicy treats the first non-passive channel as primary for routine
    // tiers, so ordering it first means a later re-tiering cannot silently promote a costed SMS.
    for (const r of rows) expect({ code: r.code, first: r.channels[0] }).toEqual({ code: r.code, first: 'inapp' });
    // The costed channel is spent only where the tenant is about to LOSE something.
    expect(rows.filter((r) => r.channels.includes('sms')).map((r) => r.code).sort()).toEqual(mandatory);
    // W118: "at 90% of any limit you get a console + email notice".
    expect(rows.find((r) => r.code === 'saas.usage_limit_alert')?.channels).toEqual(['inapp', 'email']);
  });

  it('adds the currency foreign key 0002 omitted, VALIDATED', () => {
    const sql = sqlOnly();
    expect(sql).toContain('ADD CONSTRAINT fk_saas_invoices_currency FOREIGN KEY (currency_code) REFERENCES currencies(code)');
    // NOT VALID would let a deployment carrying an unformattable invoice pass quietly. That row is a document
    // somebody may be asked to pay, so the migration must fail and name it.
    expect(sql).not.toMatch(/fk_saas_invoices_currency[\s\S]{0,120}NOT VALID/);
  });

  it('grants SELECT only, to both roles that run the resolver', () => {
    const sql = sqlOnly();
    // 0146 defect 8 is the standing lesson: kv_relay had ZERO privileges on the table its own handler consumes
    // into, because 0079's audit was a grep and the grep was wrong.
    expect(sql).toMatch(/GRANT SELECT ON user_tenant_roles, role_permissions, staff_permission_overrides, tenant_member_suspensions, currencies TO kv_app, kv_relay;/);
    expect(sql).toContain('GRANT SELECT ON users TO kv_relay;');
    // A notice plane that could WRITE to an identity table is a privilege escalation wearing a helpful face.
    for (const verb of ['GRANT INSERT', 'GRANT UPDATE', 'GRANT DELETE', 'GRANT ALL']) expect(sql).not.toContain(verb);
  });

  /**
   * **DEFECT 10 · 0122 COULD NOT APPLY TO ANY DATABASE, SO 0123–0149 NEVER RAN ANYWHERE.**
   *
   * 0122's own backfill inserts `lifecycle = 'approved'` with an `approved_at` and no `approved_by_admin_id`,
   * which its own `ck_ntv_approval_pair` forbids. Migrations 0086/0101/0112/0114/0119 all seed ACTIVE
   * `notification_templates` rows before it, so the backfill always had a row to fail on — proven against PG16,
   * which aborts on `moderation.decision_notice`. And `db/scripts/migrate.js` wraps each file in ONE
   * transaction and `return`s on failure, so the file rolled back whole and the chain STOPPED THERE, while
   * shipped code (`NotificationTemplateRepository.resolve()`) joins a table and a column that therefore did not
   * exist — every notification send on the platform, OTP included, erroring at the database.
   *
   * Amending 0122 does not break Law 9: Law 9 protects APPLIED migrations, and `schema_migrations` gets a row
   * only after a COMMIT this file never reached.
   */
  it('0122 is amended so a PLATFORM-approved version needs no admin approver, and only that', () => {
    const m0122 = fs.readFileSync(path.join(REPO, 'db/migrations/0122_template_versions_and_variables.sql'), 'utf8');
    const sql = m0122.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toContain('(tenant_id IS NULL AND approved_by_admin_id IS NULL AND approved_at IS NOT NULL)');
    // The rule is NARROWED, not removed: a TENANT-authored version still needs both halves of its approval,
    // because there a named human really did click approve and a half-record is evidence of nothing.
    expect(sql).toContain('(approved_by_admin_id IS NULL) = (approved_at IS NULL)');
    // And the amendment is documented in the file it changes, with the proof, not only in the wave's notes.
    expect(m0122).toContain('AMENDED BY PC-56 TENANT-4d-5');
    expect(m0122).toContain('ck_ntv_approval_pair');
    // The runner semantics that make it fatal rather than cosmetic — asserted so a future reader cannot
    // downgrade this to "one migration had a bad constraint".
    const runner = fs.readFileSync(path.join(REPO, 'db/scripts/migrate.js'), 'utf8');
    expect(runner).toContain("await client.query('BEGIN')");
    expect(runner).toMatch(/ROLLBACK[\s\S]{0,400}return;/);
  });

  /**
   * **DEFECT 10b · THE GRANT ABOVE WAS A LIE UNTIL THE REVOKE — 0147's FINDING, TWICE MORE.**
   * 0018's `ALTER DEFAULT PRIVILEGES` hands roles privileges no GRANT names. The probe for this wave executed
   * `INSERT INTO role_permissions` as kv_app and it SUCCEEDED, and `UPDATE users SET email=…` as kv_relay and
   * it SUCCEEDED. The first is privilege escalation from the request tier through RBAC; the second lets the
   * BYPASSRLS relay redirect any notification on the platform to an address of its choosing.
   */
  it('REVOKES the writes 0018 handed out — on the RBAC tables and on the relay\'s view of users', () => {
    const sql = sqlOnly();
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON role_permissions, permissions, currencies FROM kv_app, kv_relay;');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON users, user_tenant_roles, staff_permission_overrides, tenant_member_suspensions FROM kv_relay;');
    // staff_permission_overrides is NOT revoked from kv_app: identity's RoleRepository writes it from the
    // tenant realm, and it is the per-person grant path an FPO uses for a finance clerk. Revoking it would
    // have broken the very case the recipient rule exists to include.
    expect(sql).not.toMatch(/REVOKE[^\n]*staff_permission_overrides[^\n]*kv_app/);
    // …and kv_app keeps its write on users: a person changing their own email is what the column is for.
    expect(sql).not.toMatch(/REVOKE[^\n]*\busers\b[^\n]*kv_app/);
  });

  it('ships the flag OFF, and gates the RECIPIENT rather than the send', () => {
    const sql = sqlOnly();
    expect(sql).toContain("'saas_billing_notifications'");
    const ins = sql.slice(sql.indexOf("'saas_billing_notifications'"));
    expect(ins).toContain('false');
    const svc = read('services', 'billing-notice.service.ts');
    expect(svc).toContain("BILLING_NOTIFICATIONS_FLAG = 'saas_billing_notifications'");
    // The map rows register at module init and cannot be unregistered per tenant, so the flag decides whether a
    // recipient exists at all — making DomainEventFanoutHandler's own fail-closed rule the kill switch.
    expect(svc).toContain('tenantId }');
  });

  it('writes NO automated notice to the operator\'s dunning table — the decision, pinned', () => {
    // `saas_invoice_dunning_attempts.actor_user_id` is NOT NULL and its channel list includes *call*: the table
    // models a HUMAN chasing a debt. An automated notice has no actor, and a system uuid there would be a status
    // recording an act nobody performed. The `notifications` delivery log is the record, in more detail.
    for (const f of ['services/billing-notice.service.ts', 'services/saas-invoice.service.ts',
                     'jobs/saas-billing-cycle.job.ts', 'jobs/trial-expiry.job.ts',
                     'jobs/usage-limit-alerts.job.ts', 'events/handlers/saas-invoice-paid.handler.ts']) {
      expect({ f, hit: read(...f.split('/')).includes('saas_invoice_dunning_attempts') }).toEqual({ f, hit: false });
    }
    // …and the cost of that decision is named in the migration rather than left to be discovered.
    expect(migration()).toContain('UNDER-REPORT contact');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · the events now carry their evidence', () => {
  const inv = (over: Record<string, unknown> = {}) => SaasInvoice.create({
    id: 'i1', tenantId: 't1', subscriptionId: 's1', invoiceNo: 'KRI-202607-0001', currencyCode: 'INR',
    lineItems: [{ desc: 'Subscription renewal', qty: 1, unitMinor: 674000n, totalMinor: 674000n }],
    taxMinor: 121400n, dueDate: '2026-07-31', periodTag: '202607', taxBp: 1800, ...over,
  });

  it('the ISSUED event names the currency — without it the figure cannot be divided', () => {
    const i = inv();
    i.issue();
    const e = i.pullEvents().find((x) => x.type === TenancyEventType.SaasInvoiceIssued);
    expect(e?.payload).toMatchObject({ invoiceNo: 'KRI-202607-0001', totalMinor: '795400', currencyCode: 'INR', dueDate: '2026-07-31' });
  });

  it('the OVERDUE event finally says HOW MUCH and BY WHEN — and quotes the REMAINDER', () => {
    // It emitted { invoiceId, tenantId, invoiceNo }: a verdict with no evidence, so the only consumer it could
    // ever have had had nothing to put in the sentence. 0146 made part-payment reachable, so quoting the total
    // would overstate the debt of exactly the tenant who has already paid some of it.
    const i = inv();
    i.issue();
    i.pullEvents();
    i.applyPaidTotal(300000n, new Date('2026-07-20T00:00:00Z'), false);
    i.pullEvents();
    expect(i.markOverdue()).toBe(true);
    const e = i.pullEvents().find((x) => x.type === TenancyEventType.SaasInvoiceOverdue);
    expect(e?.payload).toMatchObject({
      invoiceNo: 'KRI-202607-0001', currencyCode: 'INR', dueDate: '2026-07-31',
      totalMinor: '795400', paidMinor: '300000', outstandingMinor: '495400',
    });
  });

  it('the PAID event names the currency and the invoice, so a receipt can be filed', () => {
    const i = inv();
    i.issue();
    i.pullEvents();
    expect(i.applyPaidTotal(795400n, new Date('2026-07-25T00:00:00Z'), false)).toBe(true);
    const e = i.pullEvents().find((x) => x.type === TenancyEventType.SaasInvoicePaid);
    expect(e?.payload).toMatchObject({ status: 'paid', currencyCode: 'INR', invoiceNo: 'KRI-202607-0001', periodTag: '202607' });
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
/**
 * **THE THREE DEFECTS IN 4d-4's PAID→ROLL PATH, WHICH THIS WAVE MAKES LOAD-BEARING.**
 *
 * Three headers claimed "a re-delivered paid event finds the period already rolled and `rollPeriod` returns
 * false". No code implemented it. And 4d-5 registers a SECOND handler (the notification fanout) on the same
 * event in the same transaction, which is exactly what turns a rare re-delivery into a routine one.
 */
describe('TENANT-4d-5 · rollPeriod is idempotent, and an upgrade does not buy a month', () => {
  const sub = (over: Partial<Parameters<typeof Subscription.rehydrate>[0]> = {}) => Subscription.rehydrate({
    id: 's1', tenantId: 't1', planId: 'p1', status: 'active', billingCycle: 'monthly',
    priceMinor: 99900n, currencyCode: 'INR', discountPct: 0,
    currentPeriodStart: new Date('2026-06-20T00:00:00Z'), currentPeriodEnd: new Date('2026-07-20T00:00:00Z'),
    cancelAtPeriodEnd: false, cancelledAt: null, createdAt: new Date('2026-06-20T00:00:00Z'),
    graceUntil: null, graceStartedAt: null, ...over,
  });

  it('rolls ONCE and refuses the replay — the old code granted a free period per re-delivery', () => {
    const s = sub();
    const now = new Date('2026-07-22T00:00:00Z');
    expect(s.rollPeriod(now)).toBe(true);
    expect(s.toProps().currentPeriodEnd.toISOString().slice(0, 10)).toBe('2026-08-20');
    // The relay is explicitly at-least-once and quarantines an event whose handler set throws.
    expect(s.rollPeriod(now)).toBe(false);
    expect(s.rollPeriod(new Date('2026-07-23T00:00:00Z'))).toBe(false);
    expect(s.toProps().currentPeriodEnd.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('refuses a period that has not ended — paying a mid-cycle upgrade is not a renewal', () => {
    const s = sub({ currentPeriodEnd: new Date('2026-08-20T00:00:00Z') });
    expect(s.rollPeriod(new Date('2026-07-22T00:00:00Z'))).toBe(false);
    expect(s.pullEvents()).toEqual([]);
    expect(s.toProps().currentPeriodEnd.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('still starts the new period where the old one ENDED, not at `now`', () => {
    // A tenant who paid four days late must not lose four days of every subsequent period, compounding.
    const s = sub();
    expect(s.rollPeriod(new Date('2026-07-24T00:00:00Z'))).toBe(true);
    expect(s.toProps().currentPeriodStart.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(s.toProps().currentPeriodEnd.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('closes a grace window and returns past_due to active on the roll', () => {
    const s = sub({ status: 'past_due', graceUntil: '2026-07-27', graceStartedAt: new Date('2026-07-20T00:00:00Z') });
    expect(s.rollPeriod(new Date('2026-07-25T00:00:00Z'))).toBe(true);
    expect(s.toProps().status).toBe('active');
    expect(s.toProps().graceUntil).toBeNull();
    expect(s.toProps().graceStartedAt).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · BillingNoticeService, behaviourally', () => {
  const build = (opts: { enabled?: boolean; holders?: string[]; units?: number | null } = {}) => {
    const calls: string[] = [];
    const recipients = {
      holdersOfBillingPermission: async () => { calls.push('holders'); return opts.holders ?? ['u1', 'u2']; },
      minorUnits: async () => { calls.push('units'); return opts.units === undefined ? 2 : opts.units; },
    };
    const flags = { isEnabled: async () => opts.enabled ?? true };
    const metrics: string[] = [];
    const svc = new BillingNoticeService(recipients as never, flags as never,
      { inc: (k: string, t?: Record<string, string>) => metrics.push(`${k}:${t?.reason ?? t?.event ?? ''}`) } as never);
    return { svc, calls, metrics };
  };
  const issued = { v: 1, invoiceId: 'i1', tenantId: 't1', invoiceNo: 'KRI-202607-0001', totalMinor: '795400', currencyCode: 'INR', dueDate: '2026-07-31' };

  it('attaches the recipients and the formatted amount', async () => {
    const { svc } = build();
    const out = await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceIssued, issued);
    expect(out.recipientUserIds).toEqual(['u1', 'u2']);
    expect(out.amountText).toBe('INR 7,954.00');
    // The original payload is not mutated — the caller writes what it is given.
    expect(issued).not.toHaveProperty('recipientUserIds');
  });

  it('FLAG OFF means no recipient KEY AT ALL, and never even asks who they are', async () => {
    const { svc, calls } = build({ enabled: false });
    const out = await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceIssued, issued);
    expect(out).not.toHaveProperty('recipientUserIds');
    expect(out).not.toHaveProperty('amountText');
    // "Configured not to send" would still resolve the list. Provably inert means holding no address at all.
    expect(calls).toEqual([]);
  });

  it('nobody holding tenant.settings is recorded as its own reason, not as a failure', async () => {
    const { svc, metrics } = build({ holders: [] });
    const out = await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceIssued, issued);
    expect(out).not.toHaveProperty('recipientUserIds');
    expect(metrics.some((m) => m === 'tenancy.notice.no_recipient:nobody_holds_permission')).toBe(true);
  });

  it('an unformattable amount DROPS THE NOTICE rather than sending a sentence with a hole', async () => {
    // render() turns a missing variable into '', so keeping the recipients would send "Invoice KRI-202607-0001
    // for  is due on 2026-07-31" — dispatched, and logged as sent.
    for (const bad of [{ ...issued, currencyCode: undefined }, { ...issued, currencyCode: 'rupees' },
                       { ...issued, totalMinor: '79.54' }, { ...issued, totalMinor: 795400 }]) {
      const { svc } = build();
      expect(await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceIssued, bad as never))
        .not.toHaveProperty('recipientUserIds');
    }
    // …and a currency the platform holds no minor_units for (0002 shipped no FK; 0149 adds one).
    const { svc, metrics } = build({ units: null });
    expect(await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceIssued, issued)).not.toHaveProperty('recipientUserIds');
    expect(metrics.some((m) => m === 'tenancy.notice.no_recipient:amount_unformattable')).toBe(true);
  });

  it('the OVERDUE notice quotes the outstanding remainder, not the invoice total', async () => {
    const { svc } = build();
    const out = await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceOverdue, {
      v: 1, invoiceNo: 'KRI-202607-0001', currencyCode: 'INR', dueDate: '2026-07-31',
      totalMinor: '795400', paidMinor: '300000', outstandingMinor: '495400',
    });
    expect(out.amountText).toBe('INR 4,954.00');
  });

  it('a part-payment is skipped, and a non-billing event is untouched', async () => {
    const { svc, calls } = build();
    const partial = { v: 1, status: 'partially_paid', invoiceNo: 'X', currencyCode: 'INR', totalMinor: '1' };
    expect(await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoicePaid, partial)).toBe(partial);
    const other = { v: 1, key: 'branding.logo' };
    expect(await svc.enrich({} as never, 't1', TenancyEventType.TenantSettingChanged, other)).toBe(other);
    expect(calls).toEqual([]);
  });

  it('the events with no money attach recipients and no amount', async () => {
    const { svc, calls } = build();
    const out = await svc.enrich({} as never, 't1', TenancyEventType.SubscriptionGraceStarted,
      { v: 1, subscriptionId: 's1', tenantId: 't1', graceUntil: '2026-08-07', periodEnd: '2026-07-31' });
    expect(out.recipientUserIds).toEqual(['u1', 'u2']);
    expect(out).not.toHaveProperty('amountText');
    expect(calls).not.toContain('units');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · the two producers 0148 named', () => {
  it('usage-limit-alerts.job.ts now IMPORTS the constant it has always referenced', async () => {
    // TS2304: Cannot find name 'DEFAULT_ALERT_THRESHOLD_PCT'. Invisible because tsconfig.json includes only
    // main/app.module/core/shared/listings plus their transitive imports, and an unwired job is imported by
    // nothing. AN UNWIRED FILE IS ALSO AN UNTYPECHECKED FILE.
    // RAW, not comment-stripped, and there is a lesson in why. The `strip` helper this file inherits removes
    // /* … */ blocks, and this job's header quotes tsconfig globs — `src/core/**`, `src/shared/**` — whose `/*`
    // opens a block comment the regex then closes at the first `*/` it finds, which is the end of the JSDoc
    // further down. Comment-stripping SWALLOWED THE IMPORT SECTION. An assertion about an import statement has
    // no business being comment-sensitive anyway.
    const src = raw('jobs', 'usage-limit-alerts.job.ts');
    expect(src).toContain("import { DEFAULT_ALERT_THRESHOLD_PCT } from '../domain/plan-usage'");
    expect(src).toContain('DEFAULT_ALERT_THRESHOLD_PCT / 100');
    // The behavioural half the 4d-1 source-text assertion could never give: the class LOADS and the default
    // resolves to W118's own number.
    const { UsageLimitAlertsJob } = await import('../jobs/usage-limit-alerts.job');
    const { DEFAULT_ALERT_THRESHOLD_PCT } = await import('../domain/plan-usage');
    expect(DEFAULT_ALERT_THRESHOLD_PCT).toBe(90);
    expect(typeof UsageLimitAlertsJob).toBe('function');
  });

  it('both are REGISTERED, which is what makes them typechecked', () => {
    const mod = read('tenancy.module.ts');
    expect(mod).toContain('TrialExpiryCadenceJob');
    expect(mod).toContain('UsageLimitAlertsCadenceJob');
    expect(mod).toContain('this.jobRegistry.register(this.trialExpiryCadenceJob)');
    expect(mod).toContain('this.jobRegistry.register(this.usageLimitAlertsCadenceJob)');
    expect(mod).toContain('this.config.jobs.tenantNotices.enabled');
    // Two distinct registry names: ScheduledJobRegistry throws on a duplicate, and an operator reading a log
    // wants to know which of the two failed.
    const cadence = read('jobs', 'tenant-notices.cadence-job.ts');
    expect(cadence).toContain("name = 'tenancy-trial-expiry'");
    expect(cadence).toContain("name = 'tenancy-usage-limit-alerts'");
  });

  it('the trial job emits ONE enriched event per trial, and counts the silent ones', async () => {
    const { TrialExpiryJob } = await import('../jobs/trial-expiry.job');
    const inserted: unknown[][] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO outbox_events')) inserted.push(params ?? []);
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const subs = { findTrialsEnding: async () => [Subscription.rehydrate({
      id: 's9', tenantId: 't9', planId: 'p1', status: 'trialing', billingCycle: 'monthly', priceMinor: 0n,
      currencyCode: 'INR', discountPct: 0, currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-08-21T00:00:00Z'), cancelAtPeriodEnd: false, cancelledAt: null,
      createdAt: new Date('2026-08-01T00:00:00Z'), graceUntil: null, graceStartedAt: null })] };
    const notice = { enrich: async (_tx: unknown, _t: string, _e: string, p: Record<string, unknown>) => ({ ...p, recipientUserIds: ['u1'] }) };
    const r = await new TrialExpiryJob(subs as never, notice as never)
      .run({ connect: async () => client } as never, 10, 3, new Date('2026-08-18T00:00:00Z'));
    expect(r).toEqual({ notified: 1, silent: 0 });
    const payload = JSON.parse(String(inserted[0][3]));
    expect(payload).toMatchObject({ subscriptionId: 's9', trialEndsOn: '2026-08-21', recipientUserIds: ['u1'],
      dedupeKey: 'trial_ending:s9:2026-08-21' });

    // …and a tenant with notices off still gets the FACT in the outbox, carrying no recipient. The event is not
    // conditional on anyone hearing about it; only the hearing is.
    inserted.length = 0;
    const quiet = { enrich: async (_tx: unknown, _t: string, _e: string, p: Record<string, unknown>) => p };
    const r2 = await new TrialExpiryJob(subs as never, quiet as never)
      .run({ connect: async () => client } as never, 10, 3, new Date('2026-08-18T00:00:00Z'));
    expect(r2).toEqual({ notified: 0, silent: 1 });
    expect(JSON.parse(String(inserted[0][3]))).not.toHaveProperty('recipientUserIds');
  });

  it('the usage job honours its date guard and enriches each (tenant, metric) row', async () => {
    const { UsageLimitAlertsJob } = await import('../jobs/usage-limit-alerts.job');
    const mk = (priorRun: boolean) => {
      const inserted: unknown[][] = [];
      const client = {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes('FROM ops_job_runs')) return { rows: priorRun ? [{ x: 1 }] : [], rowCount: priorRun ? 1 : 0 };
          if (sql.includes('FROM subscriptions')) return { rows: [{ tenant_id: 't9', limit_code: 'members', limit_value: '5000', used_value: '4600' }], rowCount: 1 };
          if (sql.includes('INSERT INTO outbox_events')) inserted.push(params ?? []);
          return { rows: [], rowCount: 0 };
        },
        release: () => undefined,
      };
      return { client, inserted };
    };
    const notice = { enrich: async (_tx: unknown, _t: string, _e: string, p: Record<string, unknown>) => ({ ...p, recipientUserIds: ['u1'] }) };

    const a = mk(false);
    const r = await new UsageLimitAlertsJob(notice as never).run({ connect: async () => a.client } as never, 10, 0.9, new Date('2026-08-18T00:00:00Z'));
    expect(r).toEqual({ alerted: 1, silent: 0, skipped: false });
    expect(JSON.parse(String(a.inserted[0][2]))).toMatchObject({ metricCode: 'members', used: '4600', limit: '5000', pct: 92, recipientUserIds: ['u1'] });

    // A second run on the same date must not re-spam — and must not emit anything at all.
    const b = mk(true);
    expect(await new UsageLimitAlertsJob(notice as never).run({ connect: async () => b.client } as never, 10, 0.9, new Date('2026-08-18T00:00:00Z')))
      .toEqual({ alerted: 0, silent: 0, skipped: true });
    expect(b.inserted).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · a channel with no address is not a send', () => {
  it('records no_address and never calls the gateway', async () => {
    const { NotificationService } = await import('../../communication/services/notification.service');
    const { NotificationEvent } = await import('../../communication/domain/notification-event.entity');
    const { NotificationTemplate } = await import('../../communication/domain/notification-template.entity');
    const inserted: Array<{ channel: string; status: string }> = [];
    const dispatched: string[] = [];
    const svc = new NotificationService(
      { run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { write: async () => undefined } as never,
      { inc: () => undefined } as never,
      { providerCode: 'fake', dispatch: async (i: { channel: string }) => { dispatched.push(i.channel); return { status: 'accepted' as const }; } } as never,
      { providerCode: 'fake', send: async () => ({ sent: 1, invalidTokens: [] }) } as never,
      { activeTokensForUser: async () => [{ token: 'tok', platform: 'android' }], deactivate: async () => 1 } as never,
      { getByCode: async () => NotificationEvent.rehydrate({ code: 'saas.usage_limit_alert', defaultName: 'x', priority: 'important', defaultChannels: ['inapp', 'email'], userCanOptOut: true, batchable: false }) } as never,
      { resolve: async (_t: unknown, e: string, ch: string) => NotificationTemplate.rehydrate({ id: `t-${ch}`, eventCode: e, channel: ch as never, languageCode: 'en', tenantId: null, subject: 's', body: 'b', providerTemplateRef: null, isActive: true, versionId: 'v1', versionNo: 1 }) } as never,
      { listForUser: async () => [], mapForUsers: async () => new Map() } as never,
      { getForUser: async () => null, mapForUsers: async () => new Map() } as never,
      {
        // The recipient has an in-app inbox and NO email address — the ordinary case on a phone-first platform,
        // and exactly the case W118's promised "email notice" lands in. [PC-56 TENANT-6d-7] The address question is
        // now answered for the whole recipient set at once, by the same `addressableOn` rule, from this one row.
        profilesFor: async (_tx: unknown, ids: readonly string[]) =>
          new Map(ids.map((id) => [id, { languageCode: 'en', hasEmail: false, hasPhone: true }])),
        contactableOn: async (_tx: unknown, _u: string, channel: string) => channel !== 'email',
        insert: async (_tx: unknown, n: { toProps(): { channel: string }; status: string }) => { inserted.push({ channel: n.toProps().channel, status: n.status }); },
      } as never,
      { isEnabled: async () => false } as never,
    );
    await svc.fanout({} as never, { tenantId: 't1', eventCode: 'saas.usage_limit_alert', recipients: ['u1'], payload: { pct: 92 }, dedupeKey: 'd1' });
    expect(inserted).toEqual([{ channel: 'inapp', status: 'sent' }, { channel: 'email', status: 'failed' }]);
    // The gateway would have answered 'accepted' — it takes the REQUEST, not the address — and the delivery log
    // would have said the notice went out.
    expect(dispatched).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · W120\'s fourth sentence, derived', () => {
  it('is notify_only when notices are on, and never `exists`', () => {
    expect(retryAndNotifyVerdict({ notificationsEnabled: true })).toBe('notify_only');
    expect(retryAndNotifyVerdict({ notificationsEnabled: false })).toBe('no_notification');
    const on = mechanismLines({ graceEnabled: true, cadenceEnabled: true, notificationsEnabled: true });
    expect(on.retryAndNotify).toBe('notify_only');
    // Not derived-from-a-constant: the source must not hardcode either verdict at the call site any more.
    const src = read('domain', 'billing-grace.ts');
    expect(src).toContain('retryAndNotify: retryAndNotifyVerdict(');
    expect(src).not.toContain("retryAndNotify: 'no_notification'");
  });

  it('reaches the screen through the read model and the flag the emitter reads', () => {
    const ctrl = read('controllers', 'v1', 'saas-invoices.controller.ts');
    expect(ctrl).toContain('BILLING_NOTIFICATIONS_FLAG');
    expect(ctrl).toContain('notificationsEnabled');
    const rm = read('read-models', 'billing-console.read-model.ts');
    // A caller that forgets a flag must get the CONSERVATIVE screen, never the reassuring one.
    expect(rm).toContain('notificationsEnabled: false }');
  });

  it('has its sentence in all three launch languages', () => {
    for (const lang of ['en', 'hi', 'gu']) {
      const f = fs.readFileSync(path.join(REPO, `apps/web-tenant/src/i18n/${lang}.ts`), 'utf8');
      expect({ lang, has: f.includes("'bill.gap.notifyOnly'") }).toEqual({ lang, has: true });
    }
    const web = fs.readFileSync(path.join(REPO, 'apps/web-tenant/src/features/billing/invoices.ts'), 'utf8');
    expect(web).toContain("if (v === 'notify_only') return 'bill.gap.notifyOnly';");
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · one notification mechanism, not two', () => {
  it('the tenancy module does NOT call the notification service directly', () => {
    // A tenancy-side handler calling NotificationService.fanout would be a second mechanism over one consumable
    // resource — the shape 0146 found on payments and 0148 found on the billing clock. The platform has ONE
    // spine: map row → DomainEventFanoutHandler → catalog → templates → delivery log.
    // Comment-stripped: this file's own header ARGUES about NotificationService at length, and an assertion
    // about prose would be an assertion about the argument rather than about the code.
    const svc = read('services', 'billing-notice.service.ts');
    expect(svc).not.toContain('NotificationService');
    expect(svc).not.toContain('notification.service');
    for (const f of ['services/saas-invoice.service.ts', 'services/subscription.service.ts',
                     'jobs/trial-expiry.job.ts', 'jobs/usage-limit-alerts.job.ts']) {
      expect({ f, hit: read(...f.split('/')).includes('modules/communication') }).toEqual({ f, hit: false });
    }
  });

  it('both emitting services enrich at their ONE flush choke point', () => {
    for (const f of ['saas-invoice.service.ts', 'subscription.service.ts']) {
      const src = read('services', f);
      expect(src).toContain('await this.notice.enrich(tx, tenantId, e.type,');
      // Enriched per EVENT, not per flush: a flush carrying a notifiable and a non-notifiable event must attach
      // recipients to the first and not the second.
      expect(src).toContain('for (const e of events) {');
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
/**
 * MUTATION SURVIVORS (round 1) — and every one of them says the same thing: **SOURCE-TEXT ASSERTIONS DO NOT
 * HOLD BEHAVIOUR.**
 *
 *   • removing the suspension clause from the resolver's SQL survived, because `toContain('memberSuspendedSql')`
 *     still matched the IMPORT after the only USE was deleted;
 *   • reading inactive roster rows survived for the same reason;
 *   • `.catch(() => false)` → `.catch(() => true)` on the flag read survived — nothing exercised a flag that
 *     throws, so the notice plane could have failed OPEN;
 *   • three mutants of `contactableOn` survived, because the only test of it was through a FAKE repository;
 *   • and reverting W118's threshold to 0.8 survived because this file's own header quotes the expression
 *     `DEFAULT_ALERT_THRESHOLD_PCT / 100` in prose, so a raw-text assertion matched the comment. **That is
 *     exactly the trap TENANT-4d-1 fell into on this same line**, one layer removed, and it is why the
 *     replacement below reads the value that reaches the database instead of the characters in the file.
 */
describe('TENANT-4d-5 · behaviourally, not textually', () => {
  const capturingTx = () => {
    const sqls: string[] = [];
    const params: unknown[][] = [];
    return { sqls, params, tx: { query: async (sql: string, p?: unknown[]) => { sqls.push(sql); params.push(p ?? []); return { rows: [], rowCount: 0 }; } } };
  };

  it('the resolver EXECUTES all four clauses, with the tenant and the permission bound', async () => {
    const { BillingRecipientsRepository } = await import('../repositories/billing-recipients.repository');
    const c = capturingTx();
    await new BillingRecipientsRepository().holdersOfBillingPermission(c.tx as never, 't-1');
    expect(c.sqls).toHaveLength(1);
    const sql = c.sqls[0];
    // role permissions ∪ per-staff grants − per-staff denies − suspended members, in the executed statement.
    expect(sql).toContain('role_permissions rp');
    expect(sql).toContain('spo.is_granted');
    expect(sql).toContain('NOT d.is_granted');
    // The suspension anti-join must be IN THE SQL, not merely imported at the top of the file.
    expect(sql).toContain('tenant_member_suspensions');
    expect(sql).toContain('kvs.lifted_at IS NULL');
    // Only a LIVE roster row: an ex-employee whose role was deactivated must not keep receiving the bill.
    expect(sql).toContain('utr.is_active');
    expect(sql).toContain('utr.deleted_at IS NULL');
    // Stable order (idempotent re-delivery) and a bounded read.
    expect(sql).toContain('ORDER BY e.user_id');
    expect(sql).toContain('LIMIT $3');
    expect(c.params[0]).toEqual(['t-1', 'tenant.settings', MAX_BILLING_RECIPIENTS + 1]);
  });

  it('a flag read that THROWS notifies nobody — the notice plane fails CLOSED', async () => {
    const recipients = { holdersOfBillingPermission: async () => ['u1'], minorUnits: async () => 2 };
    const svc = new BillingNoticeService(
      recipients as never,
      { isEnabled: async () => { throw new Error('flag store unreachable'); } } as never,
      { inc: () => undefined } as never);
    const out = await svc.enrich({} as never, 't1', TenancyEventType.SaasInvoiceOverdue,
      { v: 1, invoiceNo: 'X', currencyCode: 'INR', outstandingMinor: '100', dueDate: '2026-07-31' });
    // Law 12 says degrade, never die — and for a SEND, degrading means going quiet, not shouting. An unreadable
    // flag that failed open would start messaging every tenant on the platform the moment the flag store hiccups.
    expect(out).not.toHaveProperty('recipientUserIds');
  });

  it('contactableOn reads the RIGHT column per channel, and asks nothing for inapp or push', async () => {
    const { NotificationRepository } = await import('../../communication/repositories/notification.repository');
    const repo = new NotificationRepository({ forTenant: () => { throw new Error('the replica must not be used'); } } as never);

    // inapp needs no address; push has its own device check in deliverPush. Neither may cost a query, and
    // routing push through here would DOUBLE-check it while bypassing the token lookup that records no_device.
    for (const ch of ['inapp', 'push'] as const) {
      const c = capturingTx();
      expect(await repo.contactableOn(c.tx as never, 'u1', ch)).toBe(true);
      expect(c.sqls).toEqual([]);
    }

    const answer = (row: { has_email: boolean; has_phone: boolean } | undefined) => ({
      query: async () => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 }),
    });
    // email answers on email…
    expect(await repo.contactableOn(answer({ has_email: false, has_phone: true }) as never, 'u1', 'email')).toBe(false);
    expect(await repo.contactableOn(answer({ has_email: true, has_phone: false }) as never, 'u1', 'email')).toBe(true);
    // …and sms/whatsapp/ivr answer on phone. Asserted with the two columns DISAGREEING, so a mutant that reads
    // the wrong one cannot pass on a row where both happen to be true.
    for (const ch of ['sms', 'whatsapp', 'ivr'] as const) {
      expect(await repo.contactableOn(answer({ has_email: false, has_phone: true }) as never, 'u1', ch)).toBe(true);
      expect(await repo.contactableOn(answer({ has_email: true, has_phone: false }) as never, 'u1', ch)).toBe(false);
    }
    // No live user row → NOT contactable. Fail closed: never dispatch to an id we cannot see.
    expect(await repo.contactableOn(answer(undefined) as never, 'ghost', 'email')).toBe(false);
    expect(await repo.contactableOn(answer(undefined) as never, 'ghost', 'sms')).toBe(false);
  });

  it('the usage job sends W118\'s 90% to the DATABASE, whatever the comments say', async () => {
    const { UsageLimitAlertsJob } = await import('../jobs/usage-limit-alerts.job');
    const seen: unknown[][] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM subscriptions')) { seen.push(params ?? []); return { rows: [], rowCount: 0 }; }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    await new UsageLimitAlertsJob({ enrich: async (_t: unknown, _x: string, _e: string, p: unknown) => p } as never)
      .run({ connect: async () => client } as never, 10, undefined, new Date('2026-08-18T00:00:00Z'));
    // $2 is the threshold the finder compares `used_value` against. 0.9, not 0.8 — a tenant told 90 must not
    // hear at 80, and this reads the bound parameter rather than the characters in the source file.
    expect(seen).toHaveLength(1);
    expect(seen[0][1]).toBeCloseTo(0.9, 10);
  });
});
