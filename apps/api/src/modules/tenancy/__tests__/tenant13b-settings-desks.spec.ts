// modules/tenancy/__tests__/tenant13b-settings-desks.spec.ts · PC-56 TENANT-13b — the pure rules and the static walls (no infra).
//   • next midnight IST, the platform floor, trust-affecting, the proposal machine, the reason;
//   • the gate in the service: a trust-affecting key never reaches a write (mocked repos — the mutation "let a money key write
//     directly" turns this red without a database);
//   • F-15: every WIRED key's consumer file still reads it (the file is opened);
//   • F-18: the one ungrantable list — the override path refuses exactly it, the web mirror equals it, every desk-template code is a
//     real permission a route reads, and refused labels are never minted;
//   • 0192 / seeds: the eight registries revoked from kv_app AND kv_relay; RLS ENABLE + FORCE + the 0175 split on every new table;
//     every member-notice key has a name in en / hi / gu.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  floorProblem, isFloorLocked, isTrustAffecting, istStamp, nextMidnightIst, noticeValue, proposalReasonProblem,
} from '../domain/setting-governance';
import { assertProposalMove, canMoveProposal } from '../domain/setting-proposal.state';
import { UNWIRED_SETTINGS, WIRED_SETTINGS } from '../domain/setting-consumers';
import { TenantSettingsService } from '../services/tenant-settings.service';
import { UNGRANTABLE_PERMISSIONS } from '../../../core/rbac/ungrantable';
import { DESK_TEMPLATES, allMappedCodes, allRefusedLabels, mappedCodes } from '../../identity/domain/desk-templates';
import { codeVerdict, permissionDiff, reasonProblem, seasonWindow } from '../../identity/domain/desk-rules';
import { UserTenantRoleService } from '../../identity/services/user-tenant-role.service';

const SRC = path.join(__dirname, '..', '..', '..');
const REPO = path.join(SRC, '..', '..', '..');
const MIG = fs.readFileSync(path.join(REPO, 'db', 'migrations', '0192_settings_desks.sql'), 'utf8');

describe('TENANT-13b · when a confirmed setting takes effect', () => {
  it('next 00:00 Asia/Kolkata strictly after the instant', () => {
    expect(nextMidnightIst(new Date('2026-10-03T14:30:00Z')).toISOString()).toBe('2026-10-03T18:30:00.000Z');   // 20:00 IST → 00:00 IST next day
    expect(nextMidnightIst(new Date('2026-10-03T18:29:59Z')).toISOString()).toBe('2026-10-03T18:30:00.000Z');   // 23:59:59 IST
    expect(nextMidnightIst(new Date('2026-10-03T18:30:00Z')).toISOString()).toBe('2026-10-04T18:30:00.000Z');   // exactly 00:00 IST → the NEXT one
    expect(nextMidnightIst(new Date('2026-12-31T19:00:00Z')).toISOString()).toBe('2027-01-01T18:30:00.000Z');   // 00:30 IST on 1 Jan
    expect(istStamp(new Date('2026-10-03T18:30:00Z'))).toBe('2026-10-04 00:00');
  });
  it('the database computes the same instant (0192 next_midnight_ist)', () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION next_midnight_ist\(ts timestamptz\)[\s\S]*\(\(\(ts AT TIME ZONE 'Asia\/Kolkata'\)::date \+ 1\)::timestamp\) AT TIME ZONE 'Asia\/Kolkata'/);
    expect(MIG).toMatch(/NEW\.effective_at <> next_midnight_ist\(NEW\.confirmed_at\)/);
  });
});

describe('TENANT-13b · the platform floor and the gate', () => {
  const refund = { tenantMin: 0, tenantMax: 1_000_000 };
  it('refuses above the ceiling, below the floor, the wrong enum, a non-number', () => {
    expect(floorProblem(refund, 2_000_000)).toEqual({ code: 'above_ceiling', ceiling: 1_000_000 });
    expect(floorProblem({ tenantMin: 3300, tenantMax: 10000 }, 0)).toEqual({ code: 'below_floor', floor: 3300 });
    expect(floorProblem({ tenantMin: 'fortnightly', tenantMax: 'fortnightly' }, 'monthly')).toEqual({ code: 'only_value', only: 'fortnightly' });
    expect(floorProblem(refund, '5')).toEqual({ code: 'number_required' });
    expect(floorProblem(refund, 500_000)).toBeNull();
    expect(floorProblem({ tenantMin: null, tenantMax: null }, 9e15)).toBeNull();
    expect(isFloorLocked({ tenantMin: 6, tenantMax: 6 })).toBe(true);
    expect(isFloorLocked(refund)).toBe(false);
  });
  it('trust-affecting = money_path | security | member notice', () => {
    expect(isTrustAffecting({ riskClass: 'money_path', memberNotice: false })).toBe(true);
    expect(isTrustAffecting({ riskClass: 'security', memberNotice: false })).toBe(true);
    expect(isTrustAffecting({ riskClass: 'ordinary', memberNotice: true })).toBe(true);
    expect(isTrustAffecting({ riskClass: 'ordinary', memberNotice: false })).toBe(false);
  });
  it('a proposal reason is 20–500', () => {
    expect(proposalReasonProblem('')).toBe('required');
    expect(proposalReasonProblem('too short')).toBe('too_short');
    expect(proposalReasonProblem('x'.repeat(501))).toBe('too_long');
    expect(proposalReasonProblem('a reason that is long enough')).toBeNull();
  });
  it('the proposal machine: proposed → confirmed | refused | expired; confirmed → applied | expired; terminal states are terminal', () => {
    expect(canMoveProposal('proposed', 'confirmed')).toBe(true);
    expect(canMoveProposal('proposed', 'applied')).toBe(false);
    expect(canMoveProposal('confirmed', 'applied')).toBe(true);
    expect(canMoveProposal('confirmed', 'refused')).toBe(false);
    for (const t of ['refused', 'expired', 'applied'] as const) expect(() => assertProposalMove(t, 'confirmed')).toThrow(expect.objectContaining({ code: 'SETTING_PROPOSAL_CLOSED' }));
  });
  it('notice values are formatted per unit', () => {
    expect(noticeValue('governance.quorum_bp', 3300)).toEqual({ text: '33%' });
    expect(noticeValue('disputes.refund_checker_threshold_minor', 500000)).toEqual({ text: '₹5,000' });
    expect(noticeValue('settlements.cycle_length', 'fortnightly')).toEqual({ messageKey: 'setting.value.fortnightly' });
  });

  it('THE GATE: a money / security / member-notice key never reaches a write from PUT (409 PROPOSAL_REQUIRED)', async () => {
    const writes: string[] = [];
    const def = (key: string, riskClass: string, memberNotice = false) => ({ key, valueType: 'int', scope: 'tenant', riskClass, memberNotice, tenantMin: null, tenantMax: null, deprecatedAt: null, defaultValue: 1 });
    const defs = { findDefinition: jest.fn(async (_t: string, k: string) => ({
      'disputes.refund_checker_threshold_minor': def(k, 'money_path'), 'governance.quorum_bp': def(k, 'security'),
      'dairy.dispute_window_hours': def(k, 'money_path', true), 'plans.usage_alert_threshold_pct': def(k, 'ordinary'),
    } as Record<string, unknown>)[k] ?? null) };
    const repo = {
      effectiveTx: jest.fn(async () => ({ value: 90, isDefault: true })),
      upsertSettingTx: jest.fn(async (_tx: unknown, _t: string, k: string) => { writes.push(k); }),
      insertHistoryTx: jest.fn(async () => 'h'),
    };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
    const svc = new TenantSettingsService(uow as never, { write: jest.fn() } as never, idem as never, { inc: jest.fn(), observe: jest.fn() } as never,
      { write: jest.fn() } as never, defs as never, repo as never, {} as never);
    const actor = { userId: 'u', canManage: true };
    for (const k of ['disputes.refund_checker_threshold_minor', 'governance.quorum_bp', 'dairy.dispute_window_hours']) {
      await expect(svc.put('t', actor, 'k', { key: k, value: 5 }, null)).rejects.toMatchObject({ code: 'PROPOSAL_REQUIRED', httpStatus: 409 });
    }
    expect(writes).toEqual([]);
    await svc.put('t', actor, 'k', { key: 'plans.usage_alert_threshold_pct', value: 80 }, null);
    expect(writes).toEqual(['plans.usage_alert_threshold_pct']);
    await expect(svc.put('t', { userId: 'u', canManage: false }, 'k', { key: 'plans.usage_alert_threshold_pct', value: 80 }, null)).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });
});

describe('TENANT-13b · F-15 — a wired key is read by its consumer; nothing is in both lists', () => {
  it.each(Object.entries(WIRED_SETTINGS))('%s is still read by its consumer', (k, c) => {
    const text = fs.readFileSync(path.join(SRC, c.file), 'utf8');
    expect({ k, file: c.file, reads: text.includes(c.marker) }).toEqual({ k, file: c.file, reads: true });
  });
  it('the two lists are disjoint, and the six named unwired keys are unwired', () => {
    for (const k of Object.keys(WIRED_SETTINGS)) expect(UNWIRED_SETTINGS[k]).toBeUndefined();
    for (const k of ['listing.approval_required', 'order.auto_confirm_hours', 'review.enabled', 'payout.min_threshold_minor', 'delivery.free_above_minor', 'order.quality_window_hours']) {
      expect(UNWIRED_SETTINGS[k]).toBe('no_consumer');
    }
  });
});

describe('TENANT-13b · F-18 — one ungrantable list, real template codes', () => {
  it('the override path refuses exactly the one list (checker codes and the keys of the house included)', async () => {
    const svc = new UserTenantRoleService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    for (const code of UNGRANTABLE_PERMISSIONS) {
      await expect(svc.setStaffOverride('t', 'a', new Set(['*', code]), { userTenantRoleId: 'x', permissionCode: code, isGranted: true }, null))
        .rejects.toMatchObject({ httpStatus: 403 });
    }
    for (const c of ['payout.approve', 'group_lot.settle_approve', 'labour.wages.approve', 'notification.templates.approve', 'tenant.settings', 'desk.manage']) expect(UNGRANTABLE_PERMISSIONS.has(c)).toBe(true);
    expect(UNGRANTABLE_PERMISSIONS.has('listing.approve')).toBe(false);   // canon's moderation desk carries it; QC no-self-review is its separation
  });
  it('the web mirror is the same list', () => {
    const web = fs.readFileSync(path.join(REPO, 'apps', 'web-tenant', 'src', 'features', 'team', 'permissions.ts'), 'utf8');
    const block = web.slice(web.indexOf('UNGRANTABLE_PERMISSIONS = new Set<string>(['), web.indexOf(']);', web.indexOf('UNGRANTABLE_PERMISSIONS')));
    const codes = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...UNGRANTABLE_PERMISSIONS].sort());
  });
  it('a desk carries a code only when the admins hold it and it is not on the list', () => {
    const known = new Set(['support.handle', 'payout.approve', 'ledger.read']); const adm = new Set(['support.handle', 'payout.approve']);
    expect(codeVerdict('support.handle', adm, known)).toBe('grantable');
    expect(codeVerdict('payout.approve', adm, known)).toBe('ungrantable');
    expect(codeVerdict('ledger.read', adm, known)).toBe('not_held');
    expect(codeVerdict('kyc.verify', adm, known)).toBe('unknown');
    expect(permissionDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(reasonProblem('short')).toBe('too_short');
  });
  it('every mapped template code is read by a route in apps/api (not just present in permissions)', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) files.push(p);
    } };
    walk(SRC);
    const readers = files.filter((f) => !/desk-templates\.ts$|ungrantable\.ts$/.test(f)).map((f) => fs.readFileSync(f, 'utf8'))
      .filter((t) => /RequirePermissions|permissions\.has\(|Permissions\s*=\s*\{/.test(t)).join('\n');
    for (const c of allMappedCodes()) expect({ c, read: readers.includes(`'${c}'`) }).toEqual({ c, read: true });
    for (const l of allRefusedLabels()) expect(allMappedCodes()).not.toContain(l);
  });
  it('the seven templates in canon order, each with at least one real code; the lookup in 0192 matches', () => {
    expect(DESK_TEMPLATES.map((t) => t.code)).toEqual(['verification', 'support', 'moderation', 'dairy', 'finance', 'content', 'labour']);
    for (const t of DESK_TEMPLATES) {
      expect(mappedCodes(t).length).toBeGreaterThan(0);
      expect(MIG).toMatch(new RegExp(`\\('${t.code}',\\s+\\d, ARRAY\\[${t.labels.map((l) => `'${l.label.replace('.', '\\.')}'`).join(', ')}\\]\\)`));
    }
  });
  it('the labour season is the crop season in IST', () => {
    expect(seasonWindow(new Date('2026-10-03T06:00:00Z'))).toMatchObject({ season: 'kharif', from: new Date('2026-05-31T18:30:00Z'), to: new Date('2026-10-31T18:30:00Z') });
    expect(seasonWindow(new Date('2027-02-01T06:00:00Z'))).toMatchObject({ season: 'rabi', from: new Date('2026-10-31T18:30:00Z'), to: new Date('2027-03-31T18:30:00Z') });
    expect(seasonWindow(new Date('2027-04-15T06:00:00Z')).season).toBe('zaid');
  });
});

describe('TENANT-13b · A6 / Law 9 — who can write what (route-enumeration shape: every non-test source file in apps/api and apps/worker)', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['__tests__', 'node_modules', 'test', 'dist'].includes(e.name)) walk(p); }
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) files.push(p);
  } };
  walk(SRC); walk(path.join(REPO, 'apps', 'worker', 'src'));
  const writers = (table: string) => files.filter((f) => new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i').test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(REPO, f));
  it.each(['setting_definitions', 'platform_setting_values', 'integration_providers', 'features', 'feature_flags', 'feature_flag_changes', 'roles', 'languages'])(
    'no apps/api or worker code writes %s (admin-api, as kv_admin, is its writer — 0192 revokes kv_app and kv_relay)', (t) => {
      expect(writers(t)).toEqual([]);
    });
  it('exactly ONE file writes tenant_settings — the governance repository, called only by the gated service', () => {
    expect(writers('tenant_settings')).toEqual(['apps/api/src/modules/tenancy/repositories/setting-governance.repository.ts']);
    const callers = files.filter((f) => /upsertSettingTx\(/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(REPO, f)).sort();
    expect(callers).toEqual(['apps/api/src/modules/tenancy/repositories/setting-governance.repository.ts', 'apps/api/src/modules/tenancy/services/tenant-settings.service.ts']);
  });
  it('desk permissions and desks are written only by the desk repository', () => {
    expect(writers('desk_permissions')).toEqual(['apps/api/src/modules/identity/repositories/desk.repository.ts']);
    expect(writers('desks')).toEqual(['apps/api/src/modules/identity/repositories/desk.repository.ts']);
  });
});

describe('TENANT-13b · 0192 walls and seeds', () => {
  it('F-17: the eight registries are revoked from kv_app and kv_relay; kv_relay loses tenant_settings writes', () => {
    for (const t of ['setting_definitions', 'platform_setting_values', 'integration_providers', 'features', 'feature_flags', 'feature_flag_changes', 'roles', 'languages']) {
      expect(MIG).toMatch(new RegExp(`REVOKE INSERT, UPDATE, DELETE ON ${t}\\s+FROM kv_app, kv_relay;`));
    }
    expect(MIG).toMatch(/REVOKE INSERT, UPDATE, DELETE ON tenant_settings FROM kv_relay;/);
  });
  it('RLS ENABLE + FORCE and the 0175 split on every new tenant table; the triggers', () => {
    for (const t of ['tenant_setting_proposals', 'tenant_setting_history']) {
      expect(MIG).toMatch(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`));
      expect(MIG).toMatch(new RegExp(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`));
    }
    expect(MIG).toMatch(/FOREACH t IN ARRAY ARRAY\['desks', 'desk_permissions', 'desk_members', 'desk_change_proposals'\]/);
    expect(MIG).toMatch(/\[SETTING_CHECKER_IS_MAKER\]/);
    expect(MIG).toMatch(/\[DESK_CHECKER_IS_MAKER\]/);
    expect(MIG).toMatch(/CREATE TRIGGER trg_tenant_settings_gate BEFORE INSERT OR UPDATE OR DELETE ON tenant_settings/);
  });
  it('every member-notice key has a name in en / hi / gu (seed core/0024) and the notice has copy in all three', () => {
    const m = MIG.match(/UPDATE setting_definitions SET member_notice = true\s+WHERE key IN \(([\s\S]*?)\);/)!;
    const keys = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(keys.length).toBeGreaterThanOrEqual(7);
    const seed = fs.readFileSync(path.join(REPO, 'db', 'seeds', 'core', '0024_ui_messages_settings.sql'), 'utf8');
    for (const k of keys) for (const l of ['en', 'hi', 'gu']) expect({ k, l, named: seed.includes(`('setting.name.${k}','${l}',`) }).toEqual({ k, l, named: true });
    const s7 = fs.readFileSync(path.join(REPO, 'db', 'seeds', 'core', '0007_notification_events_templates.sql'), 'utf8');
    for (const ch of ['push', 'inapp']) for (const l of ['en', 'hi', 'gu']) expect(s7).toContain(`('tenant.setting_effective','${ch}','${l}',`);
    const order = fs.readFileSync(path.join(REPO, 'db', 'scripts', 'seed.js'), 'utf8');
    expect(order).toContain(`'core/0024_ui_messages_settings.sql'`);
  });
});
