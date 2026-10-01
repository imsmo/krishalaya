// modules/audit/__tests__/tenant9c-auditor.spec.ts · PC-56 TENANT-9c · THE AUDITOR REALM's pure rules, pinned — and pinned
// against 0181's own text where the two must agree (the read-log vocabulary, the auditor's five codes, the money verb).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MASK, isPiiKey, maskDiff, maskEntry } from '../domain/audit-diff-mask';
import {
  AUDITOR_REFUSED_BY_NAME, MAX_EXPORT_WINDOW_DAYS, MAX_LIVE_WINDOW_DAYS, READ_PURPOSES, UNSIGNED_NOTE, addDays, daysInclusive,
  fiscalQuarterOf, fiscalYearLabel, fiscalYearOf, isCivilDay, resolveWindow, roleSetOf, spanOf,
} from '../domain/auditor-realm';
import {
  AUDITOR_DATASETS, LedgerExportParamsSchema, PackExportParamsSchema, TrailExportParamsSchema, ledgerNotes, packNotes, trailNotes, trailRow, NOT_RECORDED,
} from '../domain/auditor-exports';
import { packRows } from '../domain/auditor-pack';
import { actorRoleFor } from '../../../core/audit/audit.writer';
import { wire } from '../services/audit.service';

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0181_auditor_realm.sql'), 'utf8');
const SEED = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'seeds', 'core', '0004_roles_permissions.sql'), 'utf8');

describe('F-9 · diffs are MASKED by default', () => {
  it('the vocabulary: whole keys and words, both spellings', () => {
    for (const k of ['phone', 'ownerPhone', 'owner_phone', 'email', 'buyerGstin', 'pan', 'aadhaar_last4', 'payeeVpa', 'upi_id', 'dob', 'line1Address', 'account_number', 'accountNo', 'fullName', 'owner_name', 'display_name', 'holderName', 'nomineeName', 'otp',
      // caught ONLY by the compound rules (not whole keys) — pinned after the mutation pass found them unasserted
      'bankAccountNumber', 'payout_account_no', 'farmOwnerName', 'payeeName']) {
      expect([k, isPiiKey(k)]).toEqual([k, true]);
    }
    for (const k of ['name', 'status', 'amountMinor', 'span', 'company', 'reason', 'roleCode', 'accountCode', 'panchayat']) {
      expect([k, isPiiKey(k)]).toEqual([k, false]);
    }
  });
  it('nested objects and arrays are walked; the masked paths are reported; empty values are not "masked"', () => {
    const r = maskDiff({ status: 'verified', owner: { phone: '+919876543210', name: 'Anand FPO' }, contacts: [{ email: 'a@b.in' }, { email: '' }], note: null });
    expect(r.value).toEqual({ status: 'verified', owner: { phone: MASK, name: 'Anand FPO' }, contacts: [{ email: MASK }, { email: '' }], note: null });
    expect(r.maskedPaths).toEqual(['owner.phone', 'contacts[0].email']);
  });
  it('a PII key holding an object is masked whole (never a partial walk of a person)', () => {
    expect(maskDiff({ address: { line1: 'x', pin: '388001' } }).value).toEqual({ address: MASK });
  });
  it('both halves, union of fields, sorted', () => {
    const m = maskEntry({ phone: '1', status: 'a' }, { status: 'b', email: 'x@y' });
    expect(m).toEqual({ oldValue: { phone: MASK, status: 'a' }, newValue: { status: 'b', email: MASK }, maskedFields: ['email', 'phone'] });
  });
  it('the wire is masked unless it is the recorded reveal; actor_role NULL is "not recorded"', () => {
    const row = { id: '7', actorUserId: 'u', actorRole: null, action: 'x', entityType: null, entityId: null, oldValue: { phone: '9' }, newValue: null, reason: null, requestId: null, createdAt: new Date('2026-10-01T00:00:00Z'), cursorTs: '2026-10-01T00:00:00.000000Z' };
    expect(wire(row as never)).toMatchObject({ oldValue: { phone: MASK }, masked: true, maskedFields: ['phone'], actorRoleRecorded: false });
    expect(wire(row as never, true)).toMatchObject({ oldValue: { phone: '9' }, masked: false, maskedFields: [] });
    expect(wire({ ...row, actorRole: 'auditor' } as never).actorRoleRecorded).toBe(true);
  });
  it('a deeply nested value is cut, not walked forever', () => {
    let v: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) v = { n: v };
    expect(JSON.stringify(maskDiff(v).value)).toContain(MASK);
  });
});

describe('F-9 · actor_role written AT WRITE TIME', () => {
  it('explicit wins; the caller\'s role set; system off-request; never a guess about someone else', () => {
    expect(actorRoleFor({ actorRole: 'x' }, undefined)).toBe('x');
    expect(actorRoleFor({ actorUserId: 'u' }, undefined)).toBe('system');
    expect(actorRoleFor({ actorUserId: 'u' }, { userId: '', roles: [] })).toBe('system');
    expect(actorRoleFor({ actorUserId: 'u' }, { userId: 'u', roles: ['tenant_admin', 'farmer', 'farmer'] })).toBe('farmer+tenant_admin');
    expect(actorRoleFor({ actorUserId: null }, { userId: 'u', roles: ['auditor'] })).toBe('auditor');
    expect(actorRoleFor({ actorUserId: 'v' }, { userId: 'u', roles: ['auditor'] })).toBe('not_the_caller');
    expect(actorRoleFor({ actorUserId: 'u' }, { userId: 'u', roles: [] })).toBe('no_role');
    expect(actorRoleFor({ actorUserId: 'u' }, { userId: 'u', roles: ['farmer'], impersonation: {} as never })).toBe('act_as:farmer');
    expect(actorRoleFor({ actorRole: 'r'.repeat(300) }, undefined).length).toBe(200);
  });
  it('the read log records the same role-set shape, never empty', () => {
    expect(roleSetOf(['b', 'a', 'a'])).toBe('a+b');
    expect(roleSetOf([])).toBe('no_role');
    expect(roleSetOf(undefined)).toBe('no_role');
  });
});

describe('F-9 / F-17 · windows in the cooperative\'s days, bounded', () => {
  it('civil days are real days', () => {
    expect(isCivilDay('2026-02-28')).toBe(true);
    expect(isCivilDay('2026-02-29')).toBe(false);
    expect(isCivilDay('2028-02-29')).toBe(true);
    expect(isCivilDay('2026-13-01')).toBe(false);
    expect(isCivilDay('2026-00-10')).toBe(false);
    expect(isCivilDay('2026-1-01')).toBe(false);
    expect(isCivilDay(20260101)).toBe(false);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInclusive('2026-04-01', '2026-04-01')).toBe(1);
    expect(daysInclusive('2026-04-01', '2026-07-01')).toBe(92);
  });
  it('the default is the 92 days ending today, no earlier than the fiscal year\'s first day', () => {
    expect(resolveWindow(undefined, undefined, '2026-10-01', 92)).toEqual({ ok: true, from: '2026-07-02', to: '2026-10-01', days: 92, defaulted: true });
    expect(resolveWindow(undefined, undefined, '2026-04-20', 92, '2026-04-01')).toEqual({ ok: true, from: '2026-04-01', to: '2026-04-20', days: 20, defaulted: true });
    expect(resolveWindow(undefined, undefined, '2026-10-01', 92, '2026-04-01')).toMatchObject({ from: '2026-07-02' });
    expect(resolveWindow(undefined, undefined, '2026-10-01', 92, '2026-10-02')).toMatchObject({ from: '2026-07-02' });
  });
  it('a window wider than the bound is REFUSED, never clipped; order and dates are judged', () => {
    expect(resolveWindow('2026-04-01', '2026-07-01', '2026-10-01', 92)).toEqual({ ok: true, from: '2026-04-01', to: '2026-07-01', days: 92, defaulted: false });
    expect(resolveWindow('2026-04-01', '2026-07-02', '2026-10-01', 92)).toEqual({ ok: false, code: 'WINDOW_TOO_WIDE', maxDays: 92 });
    expect(resolveWindow('2026-05-02', '2026-05-01', '2026-10-01', 92)).toEqual({ ok: false, code: 'WINDOW_ORDER', maxDays: 92 });
    expect(resolveWindow('2026-02-30', undefined, '2026-10-01', 92)).toEqual({ ok: false, code: 'DATE_INVALID', maxDays: 92 });
    expect(resolveWindow(undefined, 'x', '2026-10-01', 92)).toEqual({ ok: false, code: 'DATE_INVALID', maxDays: 92 });
    expect(resolveWindow('2026-09-01', undefined, '2026-10-01', 92)).toMatchObject({ ok: true, from: '2026-09-01', to: '2026-10-01', defaulted: true });
    // a single day is a window (pinned after the mutation pass: `start >= end` survived)
    expect(resolveWindow('2026-07-13', '2026-07-13', '2026-10-01', 92)).toEqual({ ok: true, from: '2026-07-13', to: '2026-07-13', days: 1, defaulted: false });
    expect(MAX_LIVE_WINDOW_DAYS).toBe(92);
    expect(MAX_EXPORT_WINDOW_DAYS).toBe(366);
  });
});

describe('F-17 · the fiscal year is DECLARED data, never an assumed April', () => {
  it('April–March (India, 0181)', () => {
    expect(fiscalYearOf('2026-07-13', 4)).toEqual({ declared: true, startMonth: 4, start: '2026-04-01', end: '2027-03-31', startYear: 2026, endYear: 2027 });
    expect(fiscalYearOf('2026-03-31', 4)).toMatchObject({ start: '2025-04-01', end: '2026-03-31' });
    expect(fiscalYearOf('2026-04-01', 4)).toMatchObject({ start: '2026-04-01' });
    expect(fiscalYearLabel(fiscalYearOf('2026-07-13', 4))).toBe('2026-27');
  });
  it('July–June (a Bangladeshi cooperative) and January (a calendar year)', () => {
    expect(fiscalYearOf('2026-06-30', 7)).toMatchObject({ start: '2025-07-01', end: '2026-06-30' });
    expect(fiscalYearOf('2026-07-01', 7)).toMatchObject({ start: '2026-07-01', end: '2027-06-30' });
    expect(fiscalYearOf('2026-07-01', 1)).toMatchObject({ start: '2026-01-01', end: '2026-12-31' });
    expect(fiscalYearLabel(fiscalYearOf('2026-07-01', 1))).toBe('2026');
    expect(fiscalYearOf('2027-02-15', 12)).toMatchObject({ start: '2026-12-01', end: '2027-11-30' });
  });
  it('undeclared → refused by name', () => {
    for (const m of [null, undefined, 0, 13, 4.5]) expect(fiscalYearOf('2026-07-13', m as never)).toEqual({ declared: false, code: 'FY_NOT_DECLARED' });
    expect(fiscalYearOf('nope', 4)).toEqual({ declared: false, code: 'FY_NOT_DECLARED' });
    expect(fiscalYearLabel({ declared: false, code: 'FY_NOT_DECLARED' })).toBeNull();
    expect(fiscalQuarterOf('2026-07-13', null)).toEqual({ declared: false, code: 'FY_NOT_DECLARED' });
  });
  it('quarters: Q1 is the year\'s first three months, whatever month that starts', () => {
    expect(fiscalQuarterOf('2026-04-01', 4)).toEqual({ declared: true, q: 1, start: '2026-04-01', end: '2026-06-30' });
    expect(fiscalQuarterOf('2026-07-13', 4)).toEqual({ declared: true, q: 2, start: '2026-07-01', end: '2026-09-30' });
    expect(fiscalQuarterOf('2027-01-05', 4)).toEqual({ declared: true, q: 4, start: '2027-01-01', end: '2027-03-31' });
    expect(fiscalQuarterOf('2026-12-31', 4)).toEqual({ declared: true, q: 3, start: '2026-10-01', end: '2026-12-31' });
    expect(fiscalQuarterOf('2026-08-01', 7)).toEqual({ declared: true, q: 1, start: '2026-07-01', end: '2026-09-30' });
    expect(fiscalQuarterOf('2027-06-30', 7)).toEqual({ declared: true, q: 4, start: '2027-04-01', end: '2027-06-30' });
    expect(fiscalQuarterOf('2026-12-02', 12)).toEqual({ declared: true, q: 1, start: '2026-12-01', end: '2027-02-28' });
  });
});

describe('F-9 · the read log', () => {
  it('the purposes are 0181\'s vocabulary, in its order', () => {
    const block = MIGRATION.slice(MIGRATION.indexOf('INSERT INTO audit_read_purposes'), MIGRATION.indexOf('ON CONFLICT (code) DO NOTHING;', MIGRATION.indexOf('INSERT INTO audit_read_purposes')));
    const codes = [...block.matchAll(/\('([a-z_]+)',/g)].map((m) => m[1]);
    expect(codes).toEqual([...READ_PURPOSES]);
  });
  it('the span is the first and last row returned', () => {
    expect(spanOf([])).toEqual({ first: null, last: null, count: 0 });
    expect(spanOf(['9', '8', '7'])).toEqual({ first: '9', last: '7', count: 3 });
  });
  it('the table is partitioned, FORCE\'d, append-only by grant AND trigger, tenant_id NOT NULL', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE audit_read_log \([\s\S]*tenant_id\s+uuid\s+NOT NULL[\s\S]*\) PARTITION BY RANGE \(created_at\);/);
    expect(MIGRATION).toMatch(/GRANT SELECT, INSERT ON audit_read_log TO kv_app;/);
    expect(MIGRATION).not.toMatch(/GRANT[^;]*UPDATE[^;]*audit_read_log/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER trg_arl_append_only BEFORE UPDATE OR DELETE ON audit_read_log/);
    expect(MIGRATION).toMatch(/FORCE ROW LEVEL SECURITY/);
  });
});

describe('F-12 · the wall on audit_log', () => {
  it('no INSERT policy admits a NULL tenant; the old ALL policy is dropped on the parent and every partition', () => {
    expect(MIGRATION).toMatch(/CREATE POLICY al_insert ON %I FOR INSERT WITH CHECK \(tenant_id = current_tenant_id\(\)\)/);
    expect(MIGRATION).toMatch(/DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' \|\| r\.rel/);
    expect(MIGRATION).toMatch(/inhparent = 'audit_log'::regclass/);
    const policies = MIGRATION.match(/CREATE POLICY al_\w+ ON %I[^;]*/g) ?? [];
    for (const p of policies) expect(p).not.toMatch(/tenant_id IS NULL/);
  });
});

describe('F-8 / F-18 · the permissions, as rows (0181 AND seed 0004)', () => {
  it('the auditor holds EXACTLY five reads — in the migration and in the seed', () => {
    expect(MIGRATION).toMatch(/r\.code = 'auditor'\s+AND p\.code IN \('audit\.read', 'ledger\.read', 'kyc\.read', 'governance\.read', 'report\.view'\)/);
    expect(MIGRATION).toMatch(/AND rp\.permission_code NOT IN \('audit\.read', 'ledger\.read', 'kyc\.read', 'governance\.read', 'report\.view'\)/);
    expect(SEED).toMatch(/r\.code='auditor'\s+AND p\.code IN \('ledger\.read','report\.view','audit\.read','kyc\.read','governance\.read'\)\)/);
  });
  it('the credit note\'s money verb is tenant_admin\'s only', () => {
    expect(MIGRATION).toMatch(/\(r\.code = 'tenant_admin' AND p\.code IN \('payments\.credit_note\.issue', 'kyc\.read', 'governance\.read'\)\)/);
    expect(SEED).toMatch(/\(r\.code IN \('tenant_admin'\) AND p\.code IN \('payments\.credit_note\.issue','kyc\.read','governance\.read'\)\)/);
    const grants = SEED.match(/p\.code IN \([^)]*payments\.credit_note\.issue[^)]*\)/g) ?? [];
    expect(grants.length).toBe(1);
  });
  it('credit-note issue reads the new verb and nothing else', () => {
    const svc = fs.readFileSync(path.join(__dirname, '..', '..', 'payments', 'services', 'credit-note.service.ts'), 'utf8');
    const ctl = fs.readFileSync(path.join(__dirname, '..', '..', 'payments', 'controllers', 'v1', 'invoices.controller.ts'), 'utf8');
    expect(svc).toMatch(/if \(!actor\.canIssue\) throw new CreditNoteForbiddenError\('payments\.credit_note\.issue'\)/);
    expect(svc).not.toMatch(/actor\.canFinance|canFinance: boolean/);
    expect(ctl).toMatch(/canIssue: canIssueCreditNote\(ctx\)/);
  });
});

describe('F-11 · the three files', () => {
  it('the datasets and their bounds', () => {
    expect([...AUDITOR_DATASETS]).toEqual(['audit.trail', 'ledger.entries', 'compliance.pack']);
    expect(TrailExportParamsSchema.safeParse({ from: '2026-04-01', to: '2027-03-31' }).success).toBe(true);
    expect(TrailExportParamsSchema.safeParse({ from: '2026-04-01', to: '2027-04-02' }).success).toBe(false);
    expect(LedgerExportParamsSchema.safeParse({ from: '2026-05-01', to: '2026-04-01' }).success).toBe(false);
    expect(LedgerExportParamsSchema.safeParse({ from: '2026-04-01', to: '2026-04-01', extra: 1 }).success).toBe(false);
    expect(PackExportParamsSchema.safeParse({ section: 'gst', from: '2026-04-01', to: '2026-06-30' }).success).toBe(true);
    expect(PackExportParamsSchema.safeParse({ section: 'gst', from: '2026-04-01', to: '2026-07-02' }).success).toBe(false);
    expect(PackExportParamsSchema.safeParse({ section: 'esg', from: '2026-04-01', to: '2026-06-30' }).success).toBe(false);
  });
  it('every receipt opens with the UNSIGNED note — never the word "signed" for a file', () => {
    const w = { from: '2026-04-01', to: '2026-06-30', zone: 'Asia/Kolkata' };
    for (const notes of [trailNotes({ ...w, empty: false }), ledgerNotes({ ...w, truncated: false, cap: 10 }), ...(['gst', 'ledger', 'schemes', 'privacy'] as const).map((s) => packNotes(s, w))]) {
      expect(notes[0]).toBe(UNSIGNED_NOTE);
      expect(notes.join(' ')).not.toMatch(/\bsigned export\b|platform signature verified|\bverifiable\b/i);
    }
    expect(UNSIGNED_NOTE).toMatch(/^unsigned — no signing key/);
    expect(ledgerNotes({ ...w, truncated: true, cap: 10 }).join(' ')).toMatch(/TRUNCATED at 10/);
    expect(ledgerNotes({ ...w, truncated: false, cap: 10 }).join(' ')).toMatch(/WITHHELD/);
    expect(trailNotes({ ...w, empty: true }).join(' ')).toMatch(/no audit rows/);
    expect(packNotes('gst', w).join(' ')).toMatch(/does NOT tie to the gst_payable/);
  });
  it('a trail row prints "not recorded" for a role nobody wrote', () => {
    const r = trailRow({ id: '1', createdAt: 'x', action: 'a', entityType: null, entityId: null, actorUserId: null, actorRole: null, reason: null, oldValue: null, newValue: { status: 'b' }, maskedFields: ['phone', 'email'] });
    expect(r[6]).toBe(NOT_RECORDED);
    expect(r[8]).toBeNull();
    expect(r[9]).toBe('{"status":"b"}');
    expect(r[10]).toBe('phone;email');
  });
  it('the pack rows carry the cooperative\'s currency and never a platform tie', () => {
    const gst = packRows('gst', { gst: { invoices: 2, taxableMinor: '100', taxMinor: '18', totalMinor: '118', bySupplyType: [{ supplyType: 'intra', invoices: 2, taxMinor: '18' }, { supplyType: 'inter', invoices: 0, taxMinor: '0' }, { supplyType: 'unknown', invoices: 0, taxMinor: '0' }], withIrn: 0, taxBasisIncomplete: 1, creditNotes: 1, creditNoteTotalMinor: '10', creditNoteTaxMinor: '1' }, currency: 'BDT' });
    expect(gst.find((r) => r[1] === 'taxable_value')).toEqual(['gst', 'taxable_value', '100', 'BDT minor', 'Σ taxable_minor']);
    expect(gst.find((r) => r[1] === 'tax_intra')?.[4]).toBe('intra-state: CGST + SGST');
    expect(gst.find((r) => r[1] === 'tax_inter')?.[4]).toBe('inter-state: IGST');
    expect(gst.find((r) => r[1] === 'tax_unknown')?.[4]).toBe('supply type not recorded');
    const ledger = packRows('ledger', { zeroSum: { checked: 3, foot: 2, notFoot: 0, incomplete: 1 }, accounts: [{ accountCode: 'main', entryCount: 4, balance: { equal: false, driftMinor: '5' }, chain: { kind: 'intact' }, headMatches: null }], txns: 3, currency: 'INR' });
    expect(ledger.find((r) => r[1] === 'platform_account_chains')?.[2]).toBe('withheld');
    expect(ledger.find((r) => r[1] === 'account_main_balance_equals_sum')?.[2]).toBe('no (drift 5)');
    expect(ledger.find((r) => r[1] === 'account_main_head_matches')?.[2]).toBe('not judged');
    const priv = packRows('privacy', { privacy: { members: 3, consents: [{ purposeCode: 'marketing', granted: 1, withdrawn: 1, never: 1 }], requests: [{ requestType: 'erasure', status: 'open', n: 2 }] }, currency: 'INR' });
    expect(priv.map((r) => r[1])).toEqual(['members', 'consent_marketing_granted', 'consent_marketing_withdrawn', 'consent_marketing_never', 'dsr_erasure_open']);
    const sch = packRows('schemes', { schemes: { applications: 3, byStatus: [{ status: 'submitted', n: 3 }] }, currency: 'INR' });
    expect(sch).toEqual([['schemes', 'applications', 3, 'count', 'scheme_applications created in the window'], ['schemes', 'status_submitted', 3, 'count', 'by current status']]);
  });
  it('the canon elements refused by name are a closed list (the page reads it)', () => {
    expect(AUDITOR_REFUSED_BY_NAME).toContain('platformSignature');
    expect(AUDITOR_REFUSED_BY_NAME).toContain('sharedChain');
    expect(AUDITOR_REFUSED_BY_NAME).toContain('retry');
    expect(new Set(AUDITOR_REFUSED_BY_NAME).size).toBe(AUDITOR_REFUSED_BY_NAME.length);
  });
});
