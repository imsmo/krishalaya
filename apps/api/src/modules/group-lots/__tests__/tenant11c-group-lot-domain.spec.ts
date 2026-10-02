// modules/group-lots/__tests__/tenant11c-group-lot-domain.spec.ts · PC-56 TENANT-11c — the pure rules and the static gates (unit
// project, no database): the lifecycle guards (extend once ≤ 48 h, ready below target needs a reason, withdraw until listed, the
// ONE fee cap, auto-ready at target), the money legs (balanced, merged, keyed by the lot), the lot's share of a mixed order, the
// pledge display (short name, mask, producer-role KYC), the per-lot coordinator rule, the controller surface, the module's
// registrations, the handlers' use of the relay transaction, and 0188 + the seeds as text.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { AUDITOR_READ_ACT_KEY, auditorVerdict } from '../../../core/auth/auditor-read-only.guard';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import { GroupLot, MAX_FEE_BPS } from '../domain/group-lot.entity';
import { parseQtyMilli, settleShares } from '../domain/settle';
import { holdKey, holdLegs, lotProceeds, settleKey, settleLegs } from '../domain/group-lot-money';
import { decodeCursor, encodeCursor } from '../domain/cursor';
import { indiaDateTime, maskPhone, percentText, pledgerKyc, shortName } from '../domain/display';
import { coordinatesLot, groupLotActor } from '../policies/group-lot.policies';
import { CreateGroupLotSchema, PledgeSchema } from '../dto/group-lot.dto';
import { GroupLotsController } from '../controllers/v1/group-lots.controller';
import { GroupLotOrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { GroupLotSaleSettledHandler } from '../events/handlers/sale-settled.handler';

const H = 3600_000;
const make = (over: Partial<{ deadline: string; fee: number; target: string }> = {}) => GroupLot.create({
  id: 'g1', tenantId: 't1', coordinatorUserId: 'coord', productId: 'p1', targetQuantity: over.target ?? '100', unitCode: 'quintal',
  pledgeDeadline: over.deadline ?? new Date(Date.now() + 24 * H).toISOString(), coordinationFeeBps: over.fee ?? 50,
});

describe('A2 / A5 / A7 · the lifecycle guards', () => {
  it('reaching the target makes the lot READY by itself; below it, by hand only with a reason', () => {
    const g = make();
    expect(g.applyPledge(parseQtyMilli('40'), new Date())).toEqual({ autoReady: false });
    expect(() => g.markReady(new Date(), null)).toThrow(expect.objectContaining({ code: 'GROUP_LOT_READY_REASON_REQUIRED' }));
    const h = make();
    expect(h.applyPledge(parseQtyMilli('100'), new Date())).toEqual({ autoReady: true });
    expect(h.status).toBe('ready');
    const k = make(); k.applyPledge(parseQtyMilli('86'), new Date());
    k.markReady(new Date(), 'list at 86 qtl — still the pooled tier');
    expect(k.toProps()).toMatchObject({ status: 'ready', readyReason: 'list at 86 qtl — still the pooled tier' });
  });
  it('extend ONCE, at most 48 h past the current deadline, only while pledging', () => {
    const base = Date.now() + 24 * H;
    const g = make({ deadline: new Date(base).toISOString() });
    expect(() => g.extend(new Date(base + 49 * H).toISOString(), new Date())).toThrow(expect.objectContaining({ code: 'GROUP_LOT_EXTENSION_TOO_LONG' }));
    expect(() => g.extend(new Date(base - H).toISOString(), new Date())).toThrow(expect.objectContaining({ code: 'GROUP_LOT_DEADLINE_INVALID' }));
    g.extend(new Date(base + 48 * H).toISOString(), new Date());
    expect(g.toProps()).toMatchObject({ extendedOnce: true, originalDeadline: new Date(base).toISOString(), pledgeDeadline: new Date(base + 48 * H).toISOString() });
    expect(() => g.extend(new Date(base + 50 * H).toISOString(), new Date())).toThrow(expect.objectContaining({ code: 'GROUP_LOT_ALREADY_EXTENDED' }));
  });
  it('a pledge is a promise, not a lock: withdraw while pledging or ready, never once listed', () => {
    const g = make(); g.applyPledge(parseQtyMilli('30.5'), new Date());
    g.withdrawPledge(parseQtyMilli('10.25'));
    expect(g.toProps().pledgedQuantity).toBe('20.250');
    g.markReady(new Date(), 'enough for a truck');
    g.withdrawPledge(parseQtyMilli('0.25'));
    g.markListed('l1', new Date());
    expect(() => g.withdrawPledge(parseQtyMilli('1'))).toThrow(expect.objectContaining({ code: 'GROUP_LOT_WITHDRAW_CLOSED' }));
  });
  it('listed → sold records the order, the proceeds and the hold; only sold → settled after', () => {
    const g = make(); g.applyPledge(parseQtyMilli('100'), new Date());
    expect(() => g.markSold({ orderId: 'o', grossMinor: 1n, holdTxnId: 't', now: new Date() })).toThrow(expect.objectContaining({ code: 'GROUP_LOT_ILLEGAL_TRANSITION' }));
    g.markListed('l1', new Date());
    g.markSold({ orderId: 'o1', grossMinor: 1_250_000n, holdTxnId: 'tx1', now: new Date() });
    expect(g.serialize()).toMatchObject({ status: 'sold', saleOrderId: 'o1', grossProceedsMinor: '1250000', listingId: 'l1' });
    g.markSettled('tx2', new Date());
    expect(g.status).toBe('settled');
  });
  it('F-27e · the fee cap is ONE value — 2000 bps (20 %) — in the entity and the DTO', () => {
    expect(MAX_FEE_BPS).toBe(2000);
    expect(() => make({ fee: 2001 })).toThrow(expect.objectContaining({ code: 'GROUP_LOT_FEE_INVALID' }));
    expect(make({ fee: 2000 }).coordinationFeeBps).toBe(2000);
    const body = { productId: '00000000-0000-7000-8000-000000000001', targetQuantity: '100', unitCode: 'quintal', pledgeDeadline: new Date(Date.now() + H).toISOString() };
    expect(CreateGroupLotSchema.safeParse({ ...body, coordinationFeeBps: 2001 }).success).toBe(false);
    expect(CreateGroupLotSchema.safeParse({ ...body, coordinationFeeBps: 2000 }).success).toBe(true);
  });
  it('F-27f · a pledge quantity is a decimal STRING (≤ 3 dp), never a JS number; farmerUserId is optional (self)', () => {
    expect(PledgeSchema.safeParse({ quantity: 12.5 }).success).toBe(false);
    expect(PledgeSchema.safeParse({ quantity: '12.5' }).success).toBe(true);
    expect(PledgeSchema.safeParse({ quantity: '12.5555' }).success).toBe(false);
    expect(parseQtyMilli('0.1') + parseQtyMilli('0.2')).toBe(300n);   // the float 0.1 + 0.2 = 0.30000000000000004 cannot happen
  });
  it('a lot cannot be created with a past deadline or a zero target', () => {
    expect(() => make({ deadline: new Date(Date.now() - 1000).toISOString() })).toThrow(expect.objectContaining({ code: 'GROUP_LOT_DEADLINE_INVALID' }));
    expect(() => make({ target: '0' })).toThrow(expect.objectContaining({ code: 'GROUP_LOT_TARGET_INVALID' }));
  });
});

describe('A2 / A3 · the money — balanced, keyed by the lot, never typed', () => {
  it('hold = coordinator Main → coordinator Hold, keyed gl-hold:<lot>', () => {
    expect(holdKey('L')).toBe('gl-hold:L');
    const legs = holdLegs('coord', 1250000n);
    expect(legs.reduce((a, l) => a + l.amountMinor, 0n)).toBe(0n);
    expect(legs.map((l) => [l.account.accountCode, l.amountMinor])).toEqual([['main', -1250000n], ['hold', 1250000n]]);
  });
  it('settle = Hold −gross → each pledger +share, coordinator +fee; a coordinator who pledged gets ONE merged leg; Σ = 0', () => {
    expect(settleKey('L')).toBe('gl-settle:L');
    const r = settleShares({ grossMinor: 1_000_003n, coordinationFeeBps: 50, pledges: [{ id: 'a', qtyMilli: 18000n }, { id: 'b', qtyMilli: 12000n }, { id: 'c', qtyMilli: 12000n }] });
    expect(r.coordinationFeeMinor).toBe(5000n);
    const shares = [{ farmerUserId: 'suresh', shareMinor: r.shares[0].shareMinor }, { farmerUserId: 'meera', shareMinor: r.shares[1].shareMinor }, { farmerUserId: 'coord', shareMinor: r.shares[2].shareMinor }];
    const legs = settleLegs('coord', 1_000_003n, r.coordinationFeeMinor, shares);
    expect(legs.reduce((a, l) => a + l.amountMinor, 0n)).toBe(0n);
    expect(legs.filter((l) => l.account.userId === 'coord' && l.account.accountCode === 'main')).toHaveLength(1);
    expect(legs.find((l) => l.account.userId === 'coord' && l.account.accountCode === 'main')!.amountMinor).toBe(r.shares[2].shareMinor + 5000n);
    expect(() => settleLegs('coord', 1_000_004n, r.coordinationFeeMinor, shares)).toThrow(/parts .* ≠ gross/);
  });
  it('remainder paise go largest-pledge first and the parts sum to the net exactly', () => {
    const r = settleShares({ grossMinor: 100n, coordinationFeeBps: 0, pledges: [{ id: 's', qtyMilli: 1000n }, { id: 'b', qtyMilli: 2000n }] });
    expect(r.shares).toEqual([{ id: 's', shareMinor: 33n }, { id: 'b', shareMinor: 67n }]);
  });
  it('the lot\'s proceeds: the whole settled amount for a lot-only order; a floor pro-rata by line total for a mixed one', () => {
    expect(lotProceeds(950000n, 1000000n, 1000000n)).toBe(950000n);
    expect(lotProceeds(950000n, 750000n, 1000000n)).toBe(712500n);
    expect(lotProceeds(10n, 1n, 3n)).toBe(3n);
    expect(lotProceeds(0n, 1n, 1n)).toBe(0n);
  });
});

describe('A6 / F-19 / F-25 / F-23 · display, cursor, the per-lot coordinator', () => {
  it('short name + the 1b mask; KYC from the first PRODUCER role only; percent; India time', () => {
    expect(shortName('Suresh Bhai Bhatt')).toBe('Suresh B.');
    expect(maskPhone('+919612345402')).toBe('+91 96••• ••402');
    expect(pledgerKyc([{ roleCode: 'labour_worker', kycStatus: 'verified' }, { roleCode: 'farmer', kycStatus: 'pending' }])).toEqual({ kycStatus: 'pending', kycRole: 'farmer' });
    expect(pledgerKyc([{ roleCode: 'labour_worker', kycStatus: 'verified' }])).toEqual({ kycStatus: null, kycRole: null });
    expect(percentText(8650)).toBe('86%');
    expect(indiaDateTime('2026-07-13T06:30:00.000Z')).toBe('13/07/2026 12:00');
  });
  it('the cursor round-trips every microsecond digit and refuses a hand-edited one', () => {
    const c = encodeCursor('2026-07-13 12:00:00.473406+05:30', '01900000-0000-7000-8000-000000000001')!;
    expect(decodeCursor(c)).toEqual({ c: '2026-07-13 12:00:00.473406+05:30', id: '01900000-0000-7000-8000-000000000001' });
    expect(decodeCursor(Buffer.from("x'; drop|y").toString('base64url'))).toBeUndefined();
  });
  it('group_lot.coordinate alone does NOT reach another coordinator\'s lot; this lot\'s coordinator and manage do', () => {
    const ambassador = groupLotActor({ userId: 'amb', permissions: new Set(['group_lot.coordinate']) } as never);
    expect(coordinatesLot(ambassador, { coordinatorUserId: 'kavita' })).toBe(false);
    expect(coordinatesLot({ userId: 'kavita', canManage: false }, { coordinatorUserId: 'kavita' })).toBe(true);
    expect(coordinatesLot(groupLotActor({ userId: 'admin', permissions: new Set(['group_lot.manage']) } as never), { coordinatorUserId: 'kavita' })).toBe(true);
  });
});

describe('the surface + the auditor gate + the registrations', () => {
  const NAME: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT' };
  const base = String(Reflect.getMetadata(PATH_METADATA, GroupLotsController));
  const routes = Object.getOwnPropertyNames(GroupLotsController.prototype).filter((h) => h !== 'constructor').map((h) => {
    const fn = (GroupLotsController.prototype as any)[h];
    const sub = String(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
    return { label: `${NAME[Reflect.getMetadata(METHOD_METADATA, fn)]} /${[base, sub].filter((x) => x && x !== '/').join('/')}`, perms: Reflect.getMetadata(PERMISSIONS_KEY, fn), act: Reflect.getMetadata(AUDITOR_READ_ACT_KEY, fn), m: NAME[Reflect.getMetadata(METHOD_METADATA, fn)] };
  });
  it('every act the brief names exists; the old typed-gross settle is gone', () => {
    expect(routes.map((r) => r.label).sort()).toEqual([
      'DELETE /group-lots/:id/pledges/me', 'GET /group-lots', 'GET /group-lots/:id', 'GET /group-lots/lookups', 'POST /group-lots', 'POST /group-lots/:id/cancel',
      'POST /group-lots/:id/extend', 'POST /group-lots/:id/list', 'POST /group-lots/:id/nudge', 'POST /group-lots/:id/pledges', 'POST /group-lots/:id/ready',
      'POST /group-lots/:id/settle/confirm', 'POST /group-lots/:id/settle/prepare', 'POST /group-lots/:id/settle/refuse',
    ].sort());
    expect(routes.find((r) => r.label === 'POST /group-lots/:id/settle')).toBeUndefined();
  });
  it('GET lookups is declared BEFORE GET :id (no shadow); no route is gated role-wide by group_lot.coordinate', () => {
    const names = Object.getOwnPropertyNames(GroupLotsController.prototype);
    expect(names.indexOf('lookups')).toBeLessThan(names.indexOf('get'));
    for (const r of routes) expect(r.perms ?? []).not.toContain('group_lot.coordinate');
  });
  it('every non-GET is refused for an auditor', () => {
    const mutating = routes.filter((r) => r.m !== 'GET');
    expect(mutating).toHaveLength(11);
    for (const r of mutating) { expect(r.act).toBeUndefined(); expect(auditorVerdict(['auditor'], r.m, r.act as never)).toBe('refused'); }
  });
  it('the module registers both consumers; the listings duplicate is gone and unwired', () => {
    const mod = fs.readFileSync(path.join(__dirname, '../group-lots.module.ts'), 'utf8');
    expect(mod).toMatch(/this\.registry\.register\(this\.orderCompleted\)/);
    expect(mod).toMatch(/this\.registry\.register\(this\.saleSettled\)/);
    const listings = path.join(__dirname, '../../listings');
    for (const f of ['controllers/group-lots.controller.ts', 'controllers/v1/group-lots.controller.ts', 'services/group-lot.service.ts', 'services/group-lot-pledge.service.ts',
      'repositories/group-lot.repository.ts', 'repositories/group-lot-pledge.repository.ts', 'domain/group-lot.entity.ts', 'domain/group-lot-pledge.entity.ts',
      'domain/group-lot.state.ts', 'dto/create-group-lot.dto.ts', 'dto/create-group-lot-pledge.dto.ts', 'dto/query-group-lot.dto.ts', 'dto/query-group-lot-pledge.dto.ts']) {
      expect(fs.existsSync(path.join(listings, f))).toBe(false);
    }
    expect(fs.readFileSync(path.join(listings, 'listings.module.ts'), 'utf8')).not.toMatch(/GroupLot(Service|Repository|PledgeService|sController)\b/);
  });
  it('hop 1 never queries the relay transaction (it only enqueues on it); hop 2 never receives it', async () => {
    const relayTx = { query: jest.fn() };
    const svc = { onOrderCompleted: jest.fn(async () => 1), recordSale: jest.fn(async () => 'recorded') };
    await new GroupLotOrderCompletedHandler(svc as never).handle({ id: '1', tenantId: 't', aggregateType: 'order', aggregateId: 'o', eventType: 'orders.order_completed', payload: {} } as never, relayTx as never);
    await new GroupLotSaleSettledHandler(svc as never).handle({ id: '2', tenantId: 't', aggregateType: 'group_lot', aggregateId: 'L', eventType: 'group_lot.sale_settled', payload: { groupLotId: 'L', orderId: 'o' } } as never);
    expect(svc.onOrderCompleted.mock.calls).toEqual([['t', 'o', relayTx]]);
    expect(svc.recordSale.mock.calls).toEqual([['t', 'L', 'o']]);
    expect(relayTx.query).not.toHaveBeenCalled();
  });
  it('the four notices are mapped into the notification spine', () => {
    const map = Object.fromEntries(NOTIFICATION_EVENT_MAP.map((e) => [e.outboxType, e]));
    for (const t of ['group_lot.deadline_extended', 'group_lot.cancelled', 'group_lot.nudge', 'group_lot.settled']) expect(map[t]).toMatchObject({ eventCode: t, recipientKeys: ['recipientUserIds'] });
    expect(map['group_lot.sale_settled']).toBeUndefined();   // internal hop, not a notice
  });
});

describe('0188 + seeds · as text', () => {
  const root = path.join(__dirname, '../../../../../../db');
  const mig = fs.readFileSync(path.join(root, 'migrations/0188_group_lot_truth.sql'), 'utf8');
  const s4 = fs.readFileSync(path.join(root, 'seeds/core/0004_roles_permissions.sql'), 'utf8');
  const s5 = fs.readFileSync(path.join(root, 'seeds/core/0005_lookup_vocabularies.sql'), 'utf8');
  const s7 = fs.readFileSync(path.join(root, 'seeds/core/0007_notification_events_templates.sql'), 'utf8');
  const s22 = fs.readFileSync(path.join(root, 'seeds/core/0022_ui_messages_group_lots.sql'), 'utf8');
  it('every new table: RLS ENABLE + FORCE, the 0175 split, admin realm; REVOKE ALL from kv_relay; no grant to kv_relay', () => {
    for (const t of ['group_lot_settlements', 'group_lot_settlement_lines', 'group_lot_consents']) {
      expect(mig).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      expect(mig).toContain(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      expect(mig).toMatch(new RegExp(`ON ${t} FOR INSERT WITH CHECK \\(tenant_id = current_tenant_id\\(\\)\\)`));
      expect(mig).toMatch(new RegExp(`ON ${t} FOR ALL TO kv_admin`));
      expect(mig).toMatch(new RegExp(`REVOKE ALL ON ${t} FROM kv_app, kv_relay, kv_readonly`));
    }
    expect(mig.split(';').filter((s) => /GRANT[^;]*TO kv_relay/.test(s))).toEqual([]);
    expect(mig).toMatch(/REVOKE INSERT, UPDATE, DELETE ON group_lots FROM kv_relay;/);
  });
  it('maker ≠ checker is a TRIGGER (one wall, no shadowing CHECK); the settlement is born with no money', () => {
    expect(mig).toMatch(/CREATE TRIGGER trg_gls_moves BEFORE INSERT OR UPDATE OR DELETE ON group_lot_settlements/);
    expect(mig).toMatch(/NEW\.confirmed_by = OLD\.prepared_by OR NEW\.confirmed_by = OLD\.coordinator_user_id/);
    expect(mig).not.toMatch(/CONSTRAINT ck_gls_checker/);
    expect(mig).toMatch(/GRANT UPDATE \(status, confirmed_by, confirmed_at, confirm_reason, settlement_txn_id, refused_by, refused_at, refuse_reason\) ON group_lot_settlements TO kv_app;/);
  });
  it('the vocabulary + the verb live in BOTH the migration and the seeds; ambassador loses coordinate; manage is tenant_admin\'s', () => {
    for (const code of ['group_lot_hold', 'group_lot_settle', 'target_missed', 'coordinator_withdrew']) { expect(mig).toContain(`'${code}'`); expect(s5).toContain(`'${code}'`); }
    expect(mig).toContain("'group_lot.settle_approve'"); expect(s4).toContain("'group_lot.settle_approve'");
    expect(mig).toMatch(/r\.code = 'ambassador' AND rp\.permission_code = 'group_lot\.coordinate'/);
    expect(mig).toMatch(/r\.code = 'fpo_coordinator' AND rp\.permission_code = 'group_lot\.manage'/);
    const grant = s4.slice(s4.indexOf('[PC-56 TENANT-11c] group lots (0188)'), s4.indexOf('ON CONFLICT DO NOTHING', s4.indexOf('[PC-56 TENANT-11c] group lots (0188)')));
    expect(grant).toMatch(/\('tenant_admin','fpo_coordinator'\) AND p\.code IN \('group_lot\.coordinate'\)/);
    expect(grant).toMatch(/\('tenant_admin'\) AND p\.code IN \('group_lot\.manage','group_lot\.settle_approve'\)/);
    expect(grant).not.toContain("'ambassador'");
  });
  it('24 notice templates (4 events × push/inapp × en/hi/gu) above the version backfill; the reason words in three languages', () => {
    const before = s7.slice(0, s7.indexOf('-- NOTE (TENANT-6d-1): the block above sits BEFORE this backfill on purpose.'));
    for (const ev of ['group_lot.deadline_extended', 'group_lot.cancelled', 'group_lot.nudge', 'group_lot.settled']) {
      for (const ch of ['push', 'inapp']) for (const l of ['en', 'hi', 'gu']) expect(before).toContain(`('${ev}','${ch}','${l}',NULL,`);
    }
    for (const c of ['target_missed', 'coordinator_withdrew', 'quality']) for (const l of ['en', 'hi', 'gu']) expect(s22).toContain(`('group_lot.cancel_reason.${c}','${l}',`);
    expect(fs.readFileSync(path.join(root, 'scripts/seed.js'), 'utf8')).toContain("'core/0022_ui_messages_group_lots.sql'");
  });
});
