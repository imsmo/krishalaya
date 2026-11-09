// modules/dairy/__tests__/ops3p-route-permissions.spec.ts · PC-56 OPS-3p — THE COUNTER IS NOT THE PRICE (founder Q6-A, 2026-11-08).
// THE LAW 9 ARTEFACT, PINNED: every route of every dairy controller, read by REFLECTION (the metadata Nest itself reads — path, verb,
// `@RequirePermissions` (ALL) and `@RequireAnyPermission` (ANY)), against the one table below (brief L3). A route added, removed or
// re-gated turns this red until the table — and the report's before/after table — says so.
//   + the policy helpers (both layers read one array), the actor helpers (fail-closed), and the dairy desk template (L4).
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { isUngrantable } from '../../../core/rbac/ungrantable';
import { DESK_TEMPLATES, mappedCodes, templateOf } from '../../identity/domain/desk-templates';
import {
  DAIRY_COLLECT_ANY, DAIRY_READ_ANY, DairyPermissions, actorMayCollect, actorMayRead, canCollectDairy, canManageDairy, canReadDairy,
} from '../policies/dairy.policies';
import { BillCyclesController } from '../controllers/v1/bill-cycles.controller';
import { BillDisputesController } from '../controllers/v1/bill-disputes.controller';
import { BmcController } from '../controllers/v1/bmc.controller';
import { CollectionsController } from '../controllers/v1/collections.controller';
import { D2cController } from '../controllers/v1/d2c.controller';
import { DairyCounterController } from '../controllers/v1/dairy-counter.controller';
import { DairyInsightsController } from '../controllers/v1/dairy-insights.controller';
import { DairyQualityController } from '../controllers/v1/dairy-quality.controller';
import { DeductionInstructionsController } from '../controllers/v1/deduction-instructions.controller';
import { DiversionsController } from '../controllers/v1/diversions.controller';
import { MccController } from '../controllers/v1/mcc.controller';
import { MemberCreditsController } from '../controllers/v1/member-credits.controller';
import { MilkBillsController } from '../controllers/v1/milk-bills.controller';
import { QualityReviewsController } from '../controllers/v1/quality-reviews.controller';
import { RateCardsController } from '../controllers/v1/rate-cards.controller';

const CONTROLLERS = [BillCyclesController, BillDisputesController, BmcController, CollectionsController, D2cController, DairyCounterController,
  DairyInsightsController, DairyQualityController, DeductionInstructionsController, DiversionsController, MccController, MemberCreditsController,
  MilkBillsController, QualityReviewsController, RateCardsController];

const M = 'dairy.manage'; const SC = 'settlement.close'; const O = 'dairy.override';
const COLLECT = 'any:dairy.collect|dairy.manage';
const READ = 'any:dairy.read|dairy.collect|dairy.manage';
const NONE = 'none';   // no permission decorator: the member's own (ownership-checked in the service) or open to the tenant

/** THE L3 TABLE (after OPS-3p). `all:` = @RequirePermissions; `any:` = @RequireAnyPermission. */
const TABLE: Record<string, string> = {
  // --- the counter (dairy.collect) ---
  'POST /dairy/collections': COLLECT,
  'POST /dairy/bmc/readings': COLLECT,
  // --- the boards (dairy.read) ---
  'GET /dairy/counter/board': READ,
  'GET /dairy/quality': READ,
  'GET /dairy/bmc/monitor': READ,
  'GET /dairy/d2c/mccs/:mccId/day-summary': READ,
  // NAMED UPDATE (PC-56 OPS-3a · OPS3-B14, founder Q14-A): the counter's own centre — the active centres whose OPEN custody row names the
  // caller, and the organisation's today. A new READ; the same ANY(read, collect, manage) as the boards, checked again in the read model.
  'GET /dairy/mccs/mine': READ,
  // --- dairy.manage only, unchanged ---
  'GET /dairy/bill-cycles/console': `all:${M}`, 'GET /dairy/bill-cycles': `all:${M}`, 'GET /dairy/bill-cycles/:id': `all:${M}`,
  'POST /dairy/bill-cycles/:id/preview': `all:${M}|${SC}`, 'POST /dairy/bill-cycles/:id/approve': `all:${M}|${SC}`,
  'GET /dairy/bill-disputes': `all:${M}`, 'POST /dairy/bill-disputes/:id/resolve': `all:${M}`,
  'GET /dairy/bmc': `all:${M}`, 'GET /dairy/bmc/:id': `all:${M}`, 'POST /dairy/bmc/preview': `all:${M}`, 'POST /dairy/bmc/call/preview': `all:${M}`,
  'POST /dairy/bmc': `all:${M}`, 'POST /dairy/bmc/:id/call': `all:${M}`, 'POST /dairy/bmc/:id/band': `all:${M}`, 'POST /dairy/bmc/:id/level': `all:${M}`,
  'POST /dairy/bmc/:id/compressor': `all:${M}`, 'POST /dairy/bmc/:id/retire': `all:${M}`,
  'GET /dairy/collections': NONE,
  'POST /dairy/d2c/plans': `all:${M}`, 'GET /dairy/d2c/plans': NONE, 'POST /dairy/d2c/subscriptions': NONE, 'GET /dairy/d2c/subscriptions/mine': NONE,
  'POST /dairy/d2c/subscriptions/:id/pause': NONE, 'POST /dairy/d2c/subscriptions/:id/resume': NONE, 'POST /dairy/d2c/subscriptions/:id/cancel': NONE,
  'GET /dairy/d2c/deliveries': NONE, 'POST /dairy/d2c/deliveries/:id/delivered': `all:${M}`, 'POST /dairy/d2c/deliveries/:id/skipped': `all:${M}`,
  'POST /dairy/d2c/deliveries/:id/failed': `all:${M}`, 'GET /dairy/d2c/statement': NONE,
  'GET /dairy/insights': `all:${M}`, 'POST /dairy/insights/export': `all:${M}`,
  'POST /dairy/deduction-instructions': NONE, 'DELETE /dairy/deduction-instructions/:id': NONE, 'GET /dairy/deduction-instructions': NONE,
  'POST /dairy/diversions/preview': `all:${M}`, 'GET /dairy/diversions': `all:${M}`, 'GET /dairy/diversions/:id/notice': `all:${M}`,
  'POST /dairy/diversions': `all:${M}`, 'POST /dairy/diversions/:id/approve': `all:${O}`, 'POST /dairy/diversions/:id/cancel': `all:${M}`,
  'POST /dairy/mccs': `all:${M}`, 'GET /dairy/mccs/console': `all:${M}`, 'POST /dairy/mccs/preview': `all:${M}`, 'GET /dairy/mccs': NONE,
  'GET /dairy/mccs/:id': NONE, 'POST /dairy/mccs/:id/active': `all:${M}`, 'POST /dairy/mccs/:id/operator': `all:${M}`,
  'POST /dairy/mccs/:id/operator/release': `all:${M}`, 'POST /dairy/mccs/:id/shift-window': `all:${M}`, 'GET /dairy/mccs/:id/custody': `all:${M}`,
  'POST /dairy/mccs/memberships': `all:${M}`,
  'GET /dairy/mccs/memberships/list': NONE,   // box=mine is the member's own; box=mcc|all checked in the service: DAIRY_READ_ANY (pinned below)
  'POST /dairy/mccs/memberships/:id/move': `all:${M}`, 'POST /dairy/mccs/memberships/:id/move/preview': `all:${M}`,
  'GET /dairy/mccs/memberships/:id/route': NONE, 'GET /dairy/mccs/memberships/:id': NONE,
  'POST /dairy/member-credits': `all:${M}`, 'GET /dairy/member-credits': `all:${M}`, 'GET /dairy/member-credits/types': `all:${M}`,
  'GET /dairy/member-credits/:id': `all:${M}`,
  'POST /dairy/milk-bills/generate': `all:${M}`, 'GET /dairy/milk-bills': NONE, 'GET /dairy/milk-bills/:id': NONE,
  'POST /dairy/milk-bills/:id/preview': `all:${M}`, 'POST /dairy/milk-bills/:id/approve': `all:${M}|${SC}`, 'POST /dairy/milk-bills/:id/dispute': NONE,
  'POST /dairy/milk-bills/:id/deduction-consent': NONE, 'GET /dairy/milk-bills/:id/deduction-consent': NONE, 'GET /dairy/milk-bills/:id/disputes': NONE,
  'POST /dairy/milk-bills/:id/void': `all:${M}`, 'POST /dairy/milk-bills/:id/pay': `all:${M}`,
  'GET /dairy/quality-reviews': `all:${M}`, 'GET /dairy/quality-reviews/:id': `all:${M}`, 'POST /dairy/quality-reviews/:id/retest': `all:${M}`,
  'POST /dairy/quality-reviews/:id/decide': `all:${M}`,
  'POST /dairy/rate-cards': `all:${M}`, 'POST /dairy/rate-cards/:id/approve': `all:${M}`, 'GET /dairy/rate-cards': NONE, 'GET /dairy/rate-cards/:id': NONE,
};

function actual(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const C of CONTROLLERS) {
    const base = String(Reflect.getMetadata(PATH_METADATA, C) ?? '');
    for (const name of Object.getOwnPropertyNames(C.prototype)) {
      if (name === 'constructor') continue;
      const h = (C.prototype as unknown as Record<string, unknown>)[name];
      if (typeof h !== 'function') continue;
      const p = Reflect.getMetadata(PATH_METADATA, h); const m = Reflect.getMetadata(METHOD_METADATA, h);
      if (p === undefined || m === undefined) continue;
      const sub = String(p) === '/' ? '' : `/${String(p).replace(/^\//, '')}`;
      const key = `${RequestMethod[m as number]} /${base}${sub}`;
      const all: string[] = Reflect.getMetadata(PERMISSIONS_KEY, h) ?? Reflect.getMetadata(PERMISSIONS_KEY, C) ?? [];
      const any: string[] = Reflect.getMetadata(ANY_PERMISSIONS_KEY, h) ?? Reflect.getMetadata(ANY_PERMISSIONS_KEY, C) ?? [];
      expect({ key, both: all.length > 0 && any.length > 0 }).toEqual({ key, both: false });
      out[key] = all.length ? `all:${all.join('|')}` : any.length ? `any:${any.join('|')}` : NONE;
    }
  }
  return out;
}

const ctx = (...p: string[]) => ({ permissions: new Set(p) }) as never;

describe('PC-56 OPS-3p · the dairy route-permission table (founder Q6-A; the Law 9 artefact)', () => {
  it('every dairy controller route carries exactly the permission the L3 table names — no route missing, none extra', () => {
    const got = actual();
    expect(Object.keys(got).sort()).toEqual(Object.keys(TABLE).sort());
    for (const k of Object.keys(TABLE)) expect({ k, gate: got[k] }).toEqual({ k, gate: TABLE[k] });
  });

  it('the money and settings acts stay dairy.manage ALONE — never reachable by dairy.collect or dairy.read', () => {
    const got = actual();
    const moneyAndSettings = [
      'POST /dairy/rate-cards', 'POST /dairy/rate-cards/:id/approve',
      'POST /dairy/milk-bills/generate', 'POST /dairy/milk-bills/:id/preview', 'POST /dairy/milk-bills/:id/approve', 'POST /dairy/milk-bills/:id/pay',
      'POST /dairy/milk-bills/:id/void', 'POST /dairy/mccs/memberships', 'POST /dairy/quality-reviews/:id/decide', 'POST /dairy/quality-reviews/:id/retest',
      'POST /dairy/bmc/:id/band', 'POST /dairy/bmc/:id/level', 'POST /dairy/bmc/:id/compressor', 'POST /dairy/bmc/:id/retire', 'POST /dairy/bmc',
      'POST /dairy/mccs', 'GET /dairy/mccs/:id/custody', 'POST /dairy/bill-cycles/:id/preview', 'POST /dairy/bill-cycles/:id/approve',
    ];
    for (const k of moneyAndSettings) {
      expect({ k, startsAll: got[k]?.startsWith(`all:${M}`) }).toEqual({ k, startsAll: true });
      expect({ k, collect: /dairy\.(collect|read)/.test(got[k] ?? '') }).toEqual({ k, collect: false });
    }
    // dairy.override (L5) gates exactly one route, unchanged
    expect(Object.entries(got).filter(([, v]) => v.includes(O)).map(([k]) => k)).toEqual(['POST /dairy/diversions/:id/approve']);
  });

  it('the any-of sets — one source for the decorator AND the service; neither names a pricing, billing or deciding code', () => {
    expect([...DAIRY_COLLECT_ANY]).toEqual(['dairy.collect', 'dairy.manage']);
    expect([...DAIRY_READ_ANY]).toEqual(['dairy.read', 'dairy.collect', 'dairy.manage']);
    expect([DairyPermissions.Collect, DairyPermissions.Read, DairyPermissions.Manage, DairyPermissions.Override]).toEqual(['dairy.collect', 'dairy.read', 'dairy.manage', 'dairy.override']);
    expect(Object.isFrozen(DAIRY_COLLECT_ANY) && Object.isFrozen(DAIRY_READ_ANY)).toBe(true);
    // ctx helpers
    expect([canCollectDairy(ctx('dairy.collect')), canCollectDairy(ctx('dairy.manage')), canCollectDairy(ctx('dairy.read')), canCollectDairy(ctx())]).toEqual([true, true, false, false]);
    expect([canReadDairy(ctx('dairy.read')), canReadDairy(ctx('dairy.collect')), canReadDairy(ctx('dairy.manage')), canReadDairy(ctx('dairy.override'))]).toEqual([true, true, true, false]);
    expect([canManageDairy(ctx('dairy.collect')), canManageDairy(ctx('dairy.read')), canManageDairy(ctx('dairy.collect', 'dairy.read'))]).toEqual([false, false, false]);
    // actor helpers: absent means false (fail-closed); canManage keeps every act it had
    expect([actorMayCollect({ canManage: true }), actorMayCollect({ canManage: false }), actorMayCollect({ canManage: false, canCollect: true })]).toEqual([true, false, true]);
    expect([actorMayRead({ canManage: false }), actorMayRead({ canManage: false, canRead: true }), actorMayRead({ canManage: false, canCollect: true }), actorMayRead({ canManage: true })]).toEqual([false, true, true, true]);
    expect((actorMayCollect as (a: unknown) => boolean)({ canManage: false, canRead: true })).toBe(false);
    // grantable: neither is on the one ungrantable list (L7)
    expect([isUngrantable('dairy.collect'), isUngrantable('dairy.read')]).toEqual([false, false]);
  });

  it('the services check the same helpers (source): the pour and the reading via actorMayCollect; the boards and the roll via actorMayRead', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    expect(read('services/milk-collection.service.ts')).toMatch(/async record\([^)]*\) \{\n[^\n]*\n\s+if \(!actorMayCollect\(actor\)\) throw new DairyForbiddenError/);
    expect(read('services/bmc-reading.service.ts')).toMatch(/async record\(tenantId: string, actor: DairyActor, input: BmcReadingInput\) \{\n\s+if \(!actorMayCollect\(actor\)\)/);
    expect(read('read-models/dairy-bmc.read-model.ts')).toMatch(/if \(!actorMayRead\(actor\)\) throw new DairyForbiddenError/);
    expect(read('services/d2c.service.ts')).toMatch(/shiftSummary\([^)]*\) \{\n[^\n]*\n\s+if \(!actorMayRead\(actor\)\)/);
    expect(read('services/dairy-membership.service.ts')).toMatch(/\(q\.box === 'mcc' \|\| q\.box === 'all'\) && !actorMayRead\(actor\)/);
    // enrolment stays manage
    expect(read('services/dairy-membership.service.ts')).toMatch(/async create\([^)]*\) \{\n\s+if \(!actor\.canManage\) throw/);
  });

  it('L4 · the dairy desk template carries dairy.collect + dairy.read and NEVER dairy.manage; the rate-card guarantee is now built', () => {
    const t = templateOf('dairy')!;
    expect(t.labels.map((l) => [l.label, l.verdict.kind === 'mapped' ? l.verdict.code : 'refused'])).toEqual([
      ['dairy.collections', 'dairy.collect'], ['dairy.quality', 'dairy.read'], ['bmc.monitor', 'dairy.collect']]);
    expect(mappedCodes(t).sort()).toEqual(['dairy.collect', 'dairy.read']);
    expect(DESK_TEMPLATES.flatMap(mappedCodes)).not.toContain('dairy.manage');
    expect(t.guarantees.find((g) => g.key === 'rate_cards_checker')).toMatchObject({ built: true });
  });
});
