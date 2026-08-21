// modules/dairy/__tests__/tenant6d6-diversion.spec.ts · PC-56 TENANT-6d-6 · W170's playbook step 2.
//
// *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"*, and
// *"playbook overrides are operator + dairy lead together."*
//
// THE FINDING THIS WAVE IS ABOUT — and it is a sentence in TENANT-6d-3's own header:
//
//   *"`milk_collections.mcc_id` (0009) is stamped at the counter from the membership's route AT THAT MOMENT. A pour
//   knows where it happened."*
//
// It was true. It was true ONLY because no pour could ever happen anywhere else — and it was stated as a fact when it
// was an assumption. A diversion falsifies it: 87 families carry their evening milk to Bhesan and every row says
// Vanthali. **And there is a second, narrower bug in the same line**, which the diversion did not cause: `collectedOn`
// is a parameter while the route read was the CURRENT one, so a pour entered on Monday for Saturday — after the member
// moved on Sunday — carried the new centre. 6d-3 repaired three READS to answer as-of and left the WRITE reading today.
//
// So a pour's centre is MEASURED now, and this spec is mostly about the four answers `pourPlace` can give and the two
// signatures a diversion needs before one of them is possible.
import { fakeNoticeVars } from '../../../../test/helpers/notice-vars';
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DIVERSION_REFUSALS, MAX_DAYS_AHEAD, MAX_REASON, MIN_REASON, approveVerdict, assertDay, cancelVerdict,
  daysBetween, diversionNoteKey, diversionState, isLive, pourPlace, requestVerdict, unionPickupGapKey,
} from '../domain/dairy-diversion';
import { DIVERSION_FLAG } from '../domain/dairy-diversion.flags';
import { playbook } from '../domain/bmc';
import { DairyPermissions } from '../policies/dairy.policies';
import { PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { DiversionsController } from '../controllers/v1/diversions.controller';
import { DairyDiversionService } from '../services/dairy-diversion.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';
import { DairyBmcReadModel } from '../read-models/dairy-bmc.read-model';
import { DairyCounterReadModel } from '../read-models/dairy-counter.read-model';
import { DiversionRefusedError, PourNotAtThisCentreError } from '../domain/dairy.errors';
import {
  CancelDiversionSchema, PreviewDiversionSchema, QueryDiversionsSchema, RequestDiversionSchema,
} from '../dto/diversion.dto';

const VANTHALI = 'mcc-vanthali';
const BHESAN = 'mcc-bhesan';
const TODAY = '2026-08-21';

/** `pourPlace`'s input with the ordinary defaults, so each case states only the thing it is about. */
const place = (o: Partial<Parameters<typeof pourPlace>[0]>) => pourPlace({
  routeMccId: VANTHALI, enteredMccId: null, diversion: null, earliestRouteMccId: VANTHALI, ...o,
});

const req = (over: Record<string, unknown> = {}) => requestVerdict({
  canManage: true, from: { id: VANTHALI, isActive: true }, to: { id: BHESAN, isActive: true },
  divertedOn: TODAY, today: TODAY, alreadyDiverted: false, reason: 'power cut, DG will not hold the evening', ...over,
} as never);

const mig = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/migrations/0166_dairy_shift_diversions.sql'), 'utf8');
const seed = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/seeds/core/0004_roles_permissions.sql'), 'utf8');

describe('PC-56 TENANT-6d-6 · where a pour may be recorded', () => {
  it('records an unnamed centre as the member\'s OWN route for that day', () => {
    // The overwhelming majority of rows a cooperative will ever write, and the one this wave must not make harder.
    expect(place({ routeMccId: VANTHALI, enteredMccId: null, diversion: null }))
      .toEqual({ verdict: 'own_centre', mccId: VANTHALI, diversionId: null });
    // Naming the member's own centre explicitly is the same answer — a counter that sends what it knows is not wrong.
    expect(place({ routeMccId: VANTHALI, enteredMccId: VANTHALI, diversion: null }))
      .toEqual({ verdict: 'own_centre', mccId: VANTHALI, diversionId: null });
    expect(place({ routeMccId: VANTHALI, enteredMccId: '   ', diversion: null }).verdict).toBe('own_centre');
  });

  it('accepts another village ONLY under a live diversion, and stamps its id', () => {
    const p = place({ routeMccId: VANTHALI, enteredMccId: BHESAN, diversion: { id: 'div-1', toMccId: BHESAN } });
    expect(p).toEqual({ verdict: 'diverted', mccId: BHESAN, diversionId: 'div-1' });
  });

  it('REFUSES another village with no diversion — the whole point of the rule', () => {
    // Without this, an operator can record any member's milk at any centre and nothing in the platform objects.
    expect(place({ routeMccId: VANTHALI, enteredMccId: BHESAN, diversion: null }))
      .toEqual({ verdict: 'not_permitted', mccId: null, diversionId: null });
    // A diversion that sends the shift SOMEWHERE ELSE does not authorise this centre either.
    expect(place({ routeMccId: VANTHALI, enteredMccId: BHESAN, diversion: { id: 'div-1', toMccId: 'mcc-third' } }).verdict)
      .toBe('not_permitted');
  });

  it('NEVER falls back to today\'s routing, whatever the history is missing', () => {
    // The behaviour this wave removes, in both of its forms. With no route rows at all a pour is unattributable...
    expect(place({ routeMccId: null, earliestRouteMccId: null }))
      .toEqual({ verdict: 'no_route', mccId: null, diversionId: null });
    // ...and a NAMED centre is refused even when a diversion exists, because a diversion is keyed to a route and there
    // is none. Accepting it on the earliest route's authority would be authorising something nobody signed.
    expect(place({ routeMccId: null, enteredMccId: BHESAN, diversion: { id: 'd', toMccId: BHESAN } }).verdict)
      .toBe('not_permitted');
    // Strip the history entirely and the refusal CHANGES ITS REASON but not its answer: with no route row ever
    // recorded the platform cannot say the centre was wrong, only that the member has no route — so it says that.
    // Both verdicts carry `mccId: null`, which is what the writer refuses on; the distinction is what the screen
    // prints, and printing "not permitted at Bhesan" to a member who has never been routed anywhere is a lie.
    expect(place({ routeMccId: null, enteredMccId: BHESAN, diversion: { id: 'd', toMccId: BHESAN }, earliestRouteMccId: null }))
      .toEqual({ verdict: 'no_route', mccId: null, diversionId: null });
  });

  it('answers a pour that PREDATES the route history from the earliest recorded route', () => {
    // The case the live suite found: a cooperative onboarding onto this platform enrols its members today and then
    // enters LAST fortnight's pours. Refusing all of them would make the commonest migration path impossible — and the
    // earliest route is still read from the HISTORY, not from the mutable current column.
    expect(place({ routeMccId: null, earliestRouteMccId: VANTHALI }))
      .toEqual({ verdict: 'before_record', mccId: VANTHALI, diversionId: null });
    // With NO route rows at all it stays unattributable.
    expect(place({ routeMccId: null, earliestRouteMccId: null }))
      .toEqual({ verdict: 'no_route', mccId: null, diversionId: null });
    // A named centre that AGREES with the earliest route is the counter sending what it knows — accepted, as on any
    // ordinary day. (Every fixture in this repository that predates the field does exactly this.)
    expect(place({ routeMccId: null, enteredMccId: VANTHALI, earliestRouteMccId: VANTHALI }))
      .toEqual({ verdict: 'before_record', mccId: VANTHALI, diversionId: null });
    // One that DIFFERS is refused: a diversion is keyed to a route and there is none for that day, so nobody could
    // have signed it.
    expect(place({ routeMccId: null, enteredMccId: BHESAN, earliestRouteMccId: VANTHALI }))
      .toEqual({ verdict: 'not_permitted', mccId: null, diversionId: null });
  });

  it('resolves the route AS OF THE POUR\'S DAY and the diversion for the POUR\'S SHIFT', () => {
    // The two calls that make this true, asserted on the source: `collectedOn` is what both lookups are keyed by. A
    // backdated entry that read the CURRENT route is the narrower half of this wave's finding.
    const svc = fs.readFileSync(path.join(__dirname, '../services/milk-collection.service.ts'), 'utf8');
    expect(svc).toContain('this.routes.asOf(tx, tenantId, membership.id, dto.collectedOn)');
    expect(svc).toContain('this.diversions.liveFor(tx, tenantId, routeMccId, dto.collectedOn, dto.shift as MilkShift)');
    // AND THE INFERENCE IS GONE, not merely unused: this is the line that made the old claim true by accident.
    // Comment lines are stripped first — the service's own header QUOTES the old line to explain why it went, and an
    // assertion that could not tell code from prose would fail on the explanation.
    const code = svc.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toContain('mccId: membership.toProps().mccId');
    // The quality review carries the SAME centre — a committee sent to the wrong counter cannot find the sample.
    expect(svc).toContain('membershipId: membership.id, mccId: place.mccId');
  });

  it('refuses a pour at another village through the service, with both centres named', async () => {
    const harness = (routeMccId: string | null, diversion: unknown = null) => {
      const memberships = { getById: jest.fn(async () => ({ id: 'mem-1', defaultAnimalType: 'buffalo', farmerUserId: 'f1', toProps: () => ({ mccId: routeMccId }) })) };
      const routes = {
        asOf: jest.fn(async () => (routeMccId === null ? null : { mccId: routeMccId })),
        // No route rows at all in the gap case: the pour is genuinely unattributable.
        earliest: jest.fn(async () => null),
      };
      const diversions = { liveFor: jest.fn(async () => diversion) };
      const repo = { insert: jest.fn() };
      const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
      const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
      const svc = new MilkCollectionService(uow as never, { write: jest.fn() } as never, idem as never,
        { inc: jest.fn(), observe: jest.fn() } as never, repo as never,
        { resolveActive: jest.fn(async () => ({ id: 'card', hasBonusSlabs: false, priceMinor: () => 100n, bonusMinor: () => 0n })) } as never,
        memberships as never, { priorReviews90d: jest.fn(async () => 0), insert: jest.fn() } as never,
        { isEnabled: jest.fn(async () => false) } as never, routes as never, diversions as never, fakeNoticeVars());
      return { svc, repo, routes, diversions };
    };
    const dto = { membershipId: 'mem-1', shift: 'evening', collectedOn: '2026-08-21', weightKg: '10.000', fatPct: '6.40', snfPct: '8.90', waterFlag: false, adulterationFlags: [] };

    const away = harness(VANTHALI);
    await expect(away.svc.record('t1', { userId: 'op', canManage: true } as never, 'k1', { ...dto, mccId: BHESAN } as never))
      .rejects.toBeInstanceOf(PourNotAtThisCentreError);
    expect(away.repo.insert).not.toHaveBeenCalled();
    // The route was resolved for the POUR's day, not for today.
    expect(away.routes.asOf).toHaveBeenCalledWith(expect.anything(), 't1', 'mem-1', '2026-08-21');

    const gap = harness(null);
    await expect(gap.svc.record('t1', { userId: 'op', canManage: true } as never, 'k2', dto as never))
      .rejects.toBeInstanceOf(PourNotAtThisCentreError);
    expect(gap.diversions.liveFor).not.toHaveBeenCalled();   // nothing to divert FROM

    // And under a live diversion the pour is accepted, at the receiving centre, carrying the authority.
    const ok = harness(VANTHALI, { id: 'div-1', toMccId: BHESAN });
    await ok.svc.record('t1', { userId: 'op', canManage: true } as never, 'k3', { ...dto, mccId: BHESAN } as never);
    const [, written] = ok.repo.insert.mock.calls[0] as unknown as [unknown, { toProps: () => Record<string, unknown> }];
    expect(written.toProps()).toMatchObject({ mccId: BHESAN, diversionId: 'div-1' });
  });
});

describe('PC-56 TENANT-6d-6 · asking for a diversion', () => {
  it('allows one for today, with two real centres and a reason', () => {
    expect(req()).toEqual({ allowed: true, refusals: [] });
  });

  it('REFUSES a backdated diversion — an authority that arrives after the act is not an authority', () => {
    expect(req({ divertedOn: '2026-08-20' }).refusals).toEqual(['IN_THE_PAST']);
    // Tomorrow is fine; a month ahead is a membership move, not a diversion.
    expect(req({ divertedOn: '2026-08-22' }).allowed).toBe(true);
    expect(req({ divertedOn: '2026-08-28' }).allowed).toBe(true);            // exactly MAX_DAYS_AHEAD
    expect(req({ divertedOn: '2026-08-29' }).refusals).toEqual(['TOO_FAR_AHEAD']);
    expect(MAX_DAYS_AHEAD).toBe(7);
  });

  it('REFUSES a diversion to the same centre, to a dead centre, and to a centre that is not ours', () => {
    expect(req({ to: { id: VANTHALI, isActive: true } }).refusals).toEqual(['SAME_CENTRE']);
    expect(req({ to: { id: BHESAN, isActive: false } }).refusals).toEqual(['TO_INACTIVE']);
    expect(req({ to: null }).refusals).toEqual(['TO_NOT_FOUND']);
    expect(req({ from: null }).refusals).toEqual(['FROM_NOT_FOUND']);
    // The SENDING centre may be inactive — a centre switched off mid-shift is a reason to divert, not a blocker.
    expect(req({ from: { id: VANTHALI, isActive: false } }).allowed).toBe(true);
  });

  it('REFUSES a second live diversion of the same centre-shift-day', () => {
    // `uq_dairy_diversion_live` refuses it in the database too; this refusal is what an operator reads instead of a
    // constraint name.
    expect(req({ alreadyDiverted: true }).refusals).toEqual(['ALREADY_DIVERTED']);
  });

  it('REQUIRES a reason, and the edge agrees with the domain about its bounds', () => {
    expect(req({ reason: '' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(req({ reason: '  x  ' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(req({ reason: 'x'.repeat(MAX_REASON) }).allowed).toBe(true);
    expect(req({ reason: 'x'.repeat(MAX_REASON + 1) }).refusals).toEqual(['REASON_TOO_LONG']);
    expect(MIN_REASON).toBe(3);
    expect(RequestDiversionSchema.safeParse({ fromMccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', toMccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', shift: 'evening', reason: 'x'.repeat(MAX_REASON) }).success).toBe(true);
    expect(RequestDiversionSchema.safeParse({ fromMccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', toMccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', shift: 'evening', reason: 'x'.repeat(MAX_REASON + 1) }).success).toBe(false);
    expect(CancelDiversionSchema.safeParse({ reason: 'xx' }).success).toBe(false);
    // The confirm step's body accepts a BLANK reason: the screen must show the object and the refusal before anybody
    // has typed anything.
    expect(PreviewDiversionSchema.safeParse({ fromMccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', toMccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', shift: 'evening' }).success).toBe(true);
    expect(QueryDiversionsSchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('lists every reason at once, in the order a screen should read them', () => {
    const v = req({ canManage: false, to: { id: BHESAN, isActive: false }, divertedOn: '2026-08-19', reason: '' });
    expect(v.refusals).toEqual(['NO_MANAGE', 'TO_INACTIVE', 'IN_THE_PAST', 'REASON_REQUIRED']);
  });
});

describe('PC-56 TENANT-6d-6 · the second signature', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    requestedBy: 'operator', approvedAt: null, cancelledAt: null, divertedOn: TODAY, ...over,
  });
  const app = (over: Record<string, unknown> = {}) => approveVerdict({
    canOverride: true, row: row(), actorUserId: 'lead', today: TODAY, poursAlreadyIn: 0, ...over,
  } as never);

  it('needs the DAIRY LEAD\'s verb, not the operator\'s and not the treasurer\'s', () => {
    expect(app()).toEqual({ allowed: true, refusals: [] });
    expect(app({ canOverride: false }).refusals).toEqual(['NO_OVERRIDE']);
    // The verb exists and is dairy's SECOND — deliberately not `settlement.close`, which is a money permission a
    // cooperative may have given to somebody with no business moving milk.
    expect(DairyPermissions.Override).toBe('dairy.override');
    expect(DairyPermissions.Override).not.toBe(DairyPermissions.SettlementClose);
  });

  it('REFUSES the person who asked for it', () => {
    expect(app({ actorUserId: 'operator' }).refusals).toEqual(['MAKER_IS_CHECKER']);
    // Ordered FIRST among the state refusals: "somebody else must press this" is the more useful sentence when both
    // are true (TENANT-6c-6's ruling on the cycle's own second signature).
    expect(app({ actorUserId: 'operator', row: row({ approvedAt: '2026-08-21T10:00:00Z' }) }).refusals)
      .toEqual(['MAKER_IS_CHECKER', 'ALREADY_APPROVED']);
  });

  it('REFUSES to sign what is over, cancelled, already signed, or already poured', () => {
    expect(app({ row: null }).refusals).toEqual(['NOT_FOUND']);
    expect(app({ row: row({ cancelledAt: '2026-08-21T09:00:00Z' }) }).refusals).toEqual(['ALREADY_CANCELLED']);
    expect(app({ row: row({ approvedAt: '2026-08-21T09:00:00Z' }) }).refusals).toEqual(['ALREADY_APPROVED']);
    expect(app({ row: row({ divertedOn: '2026-08-20' }) }).refusals).toEqual(['IN_THE_PAST']);
    // Signing after the milk is in is signing a decision the counter has already had to make without it.
    expect(app({ poursAlreadyIn: 12 }).refusals).toEqual(['POURS_ALREADY_IN']);
  });

  it('lets either verb CALL IT OFF — while no milk has been taken under it', () => {
    const c = (over: Record<string, unknown> = {}) => cancelVerdict({
      canManage: true, row: { approvedAt: null, cancelledAt: null }, poursUnderIt: 0, reason: 'DG held after all', ...over,
    } as never);
    expect(c()).toEqual({ allowed: true, refusals: [] });
    // A SIGNED diversion may still be called off — the evening changed its mind and no milk has moved.
    expect(c({ row: { approvedAt: '2026-08-21T10:00:00Z', cancelledAt: null } }).allowed).toBe(true);
    // But not once pours cite it: those rows would name a cancelled authority, and 0166's trigger would refuse the next.
    expect(c({ poursUnderIt: 3 }).refusals).toEqual(['POURS_ALREADY_IN']);
    expect(c({ row: { approvedAt: null, cancelledAt: '2026-08-21T11:00:00Z' } }).refusals).toEqual(['ALREADY_CANCELLED']);
    expect(c({ reason: '' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(c({ canManage: false }).refusals).toEqual(['NO_MANAGE']);
  });

  it('calls a request a request until it is signed', () => {
    expect(diversionState({ approvedAt: null, cancelledAt: null })).toBe('requested');
    expect(diversionState({ approvedAt: '2026-08-21T10:00:00Z', cancelledAt: null })).toBe('live');
    // Cancelled wins over signed: a called-off diversion is not live whatever else is true of it.
    expect(diversionState({ approvedAt: '2026-08-21T10:00:00Z', cancelledAt: '2026-08-21T11:00:00Z' })).toBe('cancelled');
    expect(isLive({ approvedAt: null, cancelledAt: null })).toBe(false);
    expect(isLive({ approvedAt: '2026-08-21T10:00:00Z', cancelledAt: null })).toBe(true);
    expect(isLive({ approvedAt: '2026-08-21T10:00:00Z', cancelledAt: '2026-08-21T11:00:00Z' })).toBe(false);
  });

  it('reaches every refusal it declares', () => {
    const seen = new Set<string>();
    const add = (v: { refusals: readonly string[] }) => v.refusals.forEach((r) => seen.add(r));
    add(req({ canManage: false })); add(req({ from: null })); add(req({ to: null }));
    add(req({ to: { id: BHESAN, isActive: false } })); add(req({ to: { id: VANTHALI, isActive: true } }));
    add(req({ divertedOn: '2026-08-01' })); add(req({ divertedOn: '2026-09-30' }));
    add(req({ alreadyDiverted: true })); add(req({ reason: '' })); add(req({ reason: 'x'.repeat(MAX_REASON + 1) }));
    add(app({ canOverride: false })); add(app({ row: null })); add(app({ actorUserId: 'operator' }));
    add(app({ row: row({ approvedAt: 'x' }) })); add(app({ row: row({ cancelledAt: 'x' }) })); add(app({ poursAlreadyIn: 1 }));
    expect([...DIVERSION_REFUSALS].filter((c) => !seen.has(c))).toEqual([]);
  });
});

describe('PC-56 TENANT-6d-6 · the service, and what it will not claim', () => {
  // `dbToday` is deliberately SETTABLE, and one test sets it to a day the process clock cannot be on. A harness whose
  // fake `current_date` returns the real today proves nothing about where the day came from: the mutation pass showed
  // the "takes TODAY from the database" test passing against a service that read `new Date()` instead, because the two
  // values were identical on the day the suite ran. (The same trap as TENANT-6d-5's `silentHours: 12` collision.)
  const harness = (over: Record<string, unknown> = {}, dbToday: string = TODAY) => {
    const centre = (id: string, isActive = true) => ({ toProps: () => ({ id, code: id === VANTHALI ? 'MCC-VNT' : 'MCC-BHE', defaultName: id === VANTHALI ? 'Vanthali' : 'Bhesan', isActive }) });
    const centres = { getById: jest.fn(async (_t: string, id: string) => centre(id)) };
    const repo = {
      pendingOrLive: jest.fn(async () => null),
      affectedMembers: jest.fn(async () => 87),
      insert: jest.fn(async (_tx: unknown, i: Record<string, unknown>) => ({
        ...i, requestedAt: '2026-08-21T12:00:00Z', approvedBy: null, approvedAt: null,
        cancelledBy: null, cancelledAt: null, cancelReason: null,
      })),
      forUpdate: jest.fn(async () => ({
        id: 'div-1', tenantId: 't1', fromMccId: VANTHALI, toMccId: BHESAN, divertedOn: TODAY, shift: 'evening',
        reason: 'power cut', requestedBy: 'operator', requestedAt: '2026-08-21T12:00:00Z',
        approvedBy: null, approvedAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null,
      })),
      approve: jest.fn(), cancel: jest.fn(), poursAt: jest.fn(async () => 0), poursUnder: jest.fn(async () => 0),
      list: jest.fn(async () => []),
      ...over,
    };
    const audit = { write: jest.fn() };
    const outbox = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn(async () => ({ rows: [{ d: dbToday }] })) })) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
    // [PC-56 TENANT-6d-8] The notice's flag and its words. OFF here, because this suite is about the DIVERSION: with
    // the notice enabled every act would also queue an announcement, and 6d-6's assertions about what is written are
    // clearer when only the diversion writes. `tenant6d8-notice.spec.ts` is where the flag is ON.
    const flags = { isEnabled: jest.fn(async () => false) };
    const svc = new DairyDiversionService(uow as never, outbox as never, idem as never,
      { inc: jest.fn(), observe: jest.fn() } as never, audit as never, repo as never, centres as never,
      flags as never, fakeNoticeVars(),
      // [PC-56 TENANT-6d-8] Communication's public service, for the delivery report. Never reached in this suite (the
      // notice flag is off), and present so the collaborator list is the real one.
      { deliveryReportFor: jest.fn() } as never);
    return { svc, repo, audit, outbox, flags };
  };
  const operator = { userId: 'operator', canManage: true, canOverride: false };
  const lead = { userId: 'lead', canManage: true, canOverride: true };

  it('takes TODAY from the database, never from the process clock', async () => {
    // The database says a day in MARCH. Nothing in this process can be on it, so the only way the answer can be March
    // is that the service asked Postgres — an assertion against the real today would be true either way.
    const h = harness({}, '2026-03-04');
    const p = await h.svc.preview('t1', operator as never, { fromMccId: VANTHALI, toMccId: BHESAN, shift: 'evening', reason: 'power cut here' });
    // A tablet in the wrong timezone would otherwise divert the wrong evening — TENANT-6c-1's ruling, applied again.
    expect(p.divertedOn).toBe('2026-03-04');
    expect(p.divertedOn).not.toBe(new Date().toISOString().slice(0, 10));
    expect(p.allowed).toBe(true);
  });

  it('REFUSES to record a request the verdict refused, and writes nothing', async () => {
    // The verdict is not advisory. Without this the ONLY thing standing between an unreasoned diversion and the table
    // is the DTO's `min(1)` — and TENANT-6d-4 spent a whole wave on what happens when a rule lives only in a DTO.
    const h = harness();
    await expect(h.svc.request('t1', operator as never, 'idem-1',
      { fromMccId: VANTHALI, toMccId: BHESAN, divertedOn: TODAY, shift: 'evening', reason: 'no' }, null))
      .rejects.toBeInstanceOf(DiversionRefusedError);
    expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
    // And the same for a centre diverted to ITSELF, which no reason can make sensible.
    await expect(h.svc.request('t1', operator as never, 'idem-2',
      { fromMccId: VANTHALI, toMccId: VANTHALI, divertedOn: TODAY, shift: 'evening', reason: 'power cut, DG will not hold' }, null))
      .rejects.toBeInstanceOf(DiversionRefusedError);
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it('counts the affected members even when the request is refused', async () => {
    // *"87 pourers"* is the size of the decision a dairy lead is making, and hiding it until the form is perfect would
    // hide how big the decision is.
    const h = harness();
    const p = await h.svc.preview('t1', operator as never, { fromMccId: VANTHALI, toMccId: BHESAN, shift: 'evening', reason: '' });
    expect(p.allowed).toBe(false);
    expect(p.refusals).toEqual(['REASON_REQUIRED']);
    expect(p.affectedMembers).toBe(87);
    // [PC-56 TENANT-6d-8] With the notice flag OFF this cooperative announces the diversion itself, and the confirm
    // screen says so rather than implying the platform will. A BOOLEAN here and a `NoticeState` on the row: a preview
    // asks what WILL happen, a row records what DID.
    expect(p.noticeEnabled).toBe(false);
    expect(p.fromCode).toBe('MCC-VNT');
    expect(p.toName).toBe('Bhesan');
  });

  it('writes nothing on a preview', async () => {
    const h = harness();
    await h.svc.preview('t1', operator as never, { fromMccId: VANTHALI, toMccId: BHESAN, shift: 'evening', reason: 'x' });
    expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
  });

  it('records the request with its reason, its count, and NOBODY notified', async () => {
    const h = harness();
    const r = await h.svc.request('t1', operator as never, 'k1', {
      fromMccId: VANTHALI, toMccId: BHESAN, shift: 'evening', reason: '  power cut, DG will not hold  ',
    }, '10.0.0.1');
    expect(r.state).toBe('requested');
    expect(r.affectedMembers).toBe(87);
    // A REQUEST tells nobody, whatever the flag says: nothing has been authorised, and announcing it would move 87
    // families on one person's word.
    expect(r.notice).toBe('not_signed');
    const [, entry] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(entry.action).toBe('dairy.diversion.requested');
    expect(entry.entityType).toBe('dairy_shift_diversion');
    expect(entry.reason).toBe('power cut, DG will not hold');     // trimmed once, where it is stored
    expect(entry.newValue).toMatchObject({ fromMccId: VANTHALI, toMccId: BHESAN, affectedMembers: 87 });
    const [, ev] = h.outbox.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
    expect(ev.eventType).toBe('dairy.diversion_requested');
    // The count travels on the event so TENANT-6d-7's notice fans out over exactly these members.
    expect(ev.payload.affectedMembers).toBe(87);
  });

  it('REFUSES to sign its own request, and writes nothing on the way to the refusal', async () => {
    const h = harness();
    await expect(h.svc.approve('t1', { userId: 'operator', canManage: true, canOverride: true } as never, 'k2', 'div-1', null))
      .rejects.toBeInstanceOf(DiversionRefusedError);
    expect(h.repo.approve).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('REFUSES to sign without the override verb', async () => {
    const h = harness();
    await expect(h.svc.approve('t1', operator as never, 'k2', 'div-1', null)).rejects.toBeInstanceOf(DiversionRefusedError);
    expect(h.repo.approve).not.toHaveBeenCalled();
  });

  it('signs it, audits both hands, and says who asked', async () => {
    const h = harness();
    const r = await h.svc.approve('t1', lead as never, 'k3', 'div-1', null);
    expect(r.state).toBe('live');
    expect(r.approvedBy).toBe('lead');
    const [, entry] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
    expect(entry.action).toBe('dairy.diversion.approved');
    // BOTH NAMES on the row an auditor reads: who asked, and who allowed it.
    expect(entry.newValue).toMatchObject({ approvedBy: 'lead', requestedBy: 'operator' });
    const [, ev] = h.outbox.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
    expect(ev.eventType).toBe('dairy.diversion_approved');
    expect(ev.payload).toMatchObject({ requestedBy: 'operator', approvedBy: 'lead', affectedMembers: 87 });
  });

  it('REFUSES to sign once the milk is in', async () => {
    const h = harness({ poursAt: jest.fn(async () => 42) });
    await expect(h.svc.approve('t1', lead as never, 'k4', 'div-1', null)).rejects.toBeInstanceOf(DiversionRefusedError);
  });

  it('REFUSES to cancel a diversion that pours already cite', async () => {
    const h = harness({ poursUnder: jest.fn(async () => 5) });
    await expect(h.svc.cancel('t1', operator as never, 'k5', 'div-1', 'never mind', null))
      .rejects.toBeInstanceOf(DiversionRefusedError);
    expect(h.repo.cancel).not.toHaveBeenCalled();
  });

  it('never writes a membership route — a diversion is not a transfer', () => {
    // The strongest form of this assertion available at unit level: the service cannot touch the route table because it
    // does not have it. TENANT-6d-3's history stays untouched, so a family's card and record survive a warm evening.
    const src = fs.readFileSync(path.join(__dirname, '../services/dairy-diversion.service.ts'), 'utf8');
    expect(src).not.toContain('DairyMembershipRouteRepository');
    expect(src).not.toContain('dairy_membership_routes');
    expect(DairyDiversionService.prototype.preview.length).toBe(3);   // tenantId, actor, dto — no idempotency key
  });
});

describe('PC-56 TENANT-6d-6 · the playbook, the board, and the notice', () => {
  it('marks step 2 BUILT for a cooperative that has the act switched on — and step 3 never', () => {
    const t = { divertDeci: 75, condemnDeci: 80 };
    const off = playbook(69, t, { divert: false });
    const on = playbook(69, t, { divert: true });
    expect(off.map((p) => p.built)).toEqual([false, false, false]);
    // TENANT-6d-1 shipped all three as `built: false`, honestly. Only the second one changes.
    expect(on.map((p) => p.built)).toEqual([false, true, false]);
    expect(on[1].step).toBe('divert_next_shift');
    expect(on[2].step).toBe('test_before_pooling');
    // The default is OFF, so a caller that forgets the capability cannot accidentally promise the act.
    expect(playbook(69, t).map((p) => p.built)).toEqual([false, false, false]);
    // And the DUE arithmetic is untouched by any of it.
    expect(on.map((p) => p.due)).toEqual([true, false, false]);
    expect(playbook(80, t, { divert: true }).map((p) => p.due)).toEqual([true, true, true]);
  });

  it('names the two figures a diversion makes disagree on purpose', () => {
    expect(diversionNoteKey({ divertedIn: 3, divertedOut: 0 })).toBe('dairy.counter.diversion.in');
    expect(diversionNoteKey({ divertedIn: 0, divertedOut: 87 })).toBe('dairy.counter.diversion.out');
    expect(diversionNoteKey({ divertedIn: 3, divertedOut: 87 })).toBe('dairy.counter.diversion.both');
    // No diversion, no badge: the ordinary evening stays quiet.
    expect(diversionNoteKey({ divertedIn: 0, divertedOut: 0 })).toBeNull();
  });

  it('names the union pickup as NOT BUILT — and the notice is no longer among the gaps', () => {
    // W170 promises *"route notice to 87 pourers, Gujarati voice"*. 6d-6 counted them and named the notice as a gap
    // (`noticeGapKey`); **TENANT-6d-8 sends it**, so that key is gone and the screen prints a notice STATE instead
    // (`dairy.diversion.notice.*`, see tenant6d8-notice.spec.ts). Step 3 still has no union, no pickup and no batch
    // test on this platform, and still says so.
    expect(unionPickupGapKey()).toBe('dairy.bmc.playbook.unionPickupUnbuilt');
  });

  it('counts the affected members from the ROUTE HISTORY as of that day', () => {
    const repo = fs.readFileSync(path.join(__dirname, '../repositories/dairy-diversion.repository.ts'), 'utf8');
    const q = repo.slice(repo.indexOf('async affectedMembers'), repo.indexOf('async poursAt'));
    // Not `dairy_memberships.mcc_id` — that is today's routing, and TENANT-6d-3's whole argument is that a member who
    // moved last week is not on tonight's list.
    expect(q).toContain('FROM dairy_membership_routes r');
    expect(q).toContain('r.valid_from <= $3::date');
    expect(q).toContain('r.valid_to IS NULL OR r.valid_to >= $3::date');
    expect(q).not.toContain('m.mcc_id = $2');
    // Only ACTIVE memberships: a member who left in July is not carrying milk anywhere in August.
    expect(q).toContain('m.is_active = true');
  });

  it('keeps whole days as strings, lexicographically', () => {
    expect(() => assertDay('2026-08-21')).not.toThrow();
    expect(() => assertDay('2026-02-30')).toThrow();
    expect(() => assertDay('21-08-2026')).toThrow();
    expect(daysBetween('2026-08-21', '2026-08-28')).toBe(7);
    expect(daysBetween('2026-08-28', '2026-08-21')).toBe(-7);
    // Across a DST-less UTC boundary and a month end, because these are strings and not clocks.
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
  });
});

describe('PC-56 TENANT-6d-6 · the migration, the seed, and the routes', () => {
  it('keeps one live diversion per centre-shift-day, and history for the rest', () => {
    const m = mig();
    const idx = m.slice(m.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_dairy_diversion_live'), m.indexOf('idx_dairy_diversion_live'));
    expect(idx).toContain('(tenant_id, from_mcc_id, diverted_on, shift)');
    // PARTIAL: a cancelled diversion is history and must stay, while a second live one would make "where does this
    // member pour tonight" a question with two answers.
    expect(idx).toContain('WHERE cancelled_at IS NULL AND deleted_at IS NULL');
  });

  it('puts maker ≠ checker in the DATABASE, not only in the service', () => {
    const m = mig();
    expect(m).toContain('CONSTRAINT ck_dairy_diversion_maker_ne_checker CHECK (approved_by IS NULL OR approved_by <> requested_by)');
    expect(m).toContain('CONSTRAINT ck_dairy_diversion_not_self CHECK (from_mcc_id <> to_mcc_id)');
    // Both ends or neither, three times over — a half-written approval is an authority nobody can read.
    expect(m).toContain('CHECK ((approved_by IS NULL) = (approved_at IS NULL))');
    expect(m).toContain('CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL))');
  });

  it('is APPEND-ONLY for the application role except its two endings', () => {
    const m = mig();
    expect(m).toContain('REVOKE UPDATE ON dairy_shift_diversions FROM kv_app;');
    const grant = m.slice(m.indexOf('GRANT UPDATE (approved_by'), m.indexOf('REVOKE INSERT, UPDATE, DELETE'));
    for (const c of ['approved_by', 'approved_at', 'cancelled_by', 'cancelled_at', 'cancel_reason']) {
      expect(grant).toContain(c);
    }
    // The columns an auditor reads to judge whether milk was moved properly are NOT grantable.
    for (const c of ['from_mcc_id', 'to_mcc_id', 'diverted_on', 'requested_by']) {
      expect(grant).not.toContain(c);
    }
    // `reason` on its own is NOT grantable while `cancel_reason` is — a substring check cannot tell those apart, so the
    // boundary is asserted rather than assumed. (The first version of this test passed for the wrong reason.)
    expect(/(^|[ (,])reason[ ,)]/.test(grant)).toBe(false);
    expect(grant).toContain('cancel_reason');
    expect(m).toContain('REVOKE INSERT, UPDATE, DELETE ON dairy_shift_diversions FROM kv_relay;');
    expect(m).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('makes a stamped diversion_id impossible to fake, in plpgsql', () => {
    const m = mig();
    const fn = m.slice(m.indexOf('CREATE OR REPLACE FUNCTION assert_collection_diversion'), m.indexOf('DROP TRIGGER IF EXISTS trg_collection_diversion'));
    // The one thing this column exists to prove: the exception was authorised for THIS shift, at THIS centre, on THIS
    // day — and by a signed, uncancelled decision.
    expect(fn).toContain('d.approved_at IS NULL OR d.cancelled_at IS NOT NULL');
    expect(fn).toContain('d.diverted_on <> NEW.collected_on OR d.shift <> NEW.shift OR d.to_mcc_id <> NEW.mcc_id');
    expect(fn).toContain('tenant_id = NEW.tenant_id');
    expect(m).toContain('BEFORE INSERT OR UPDATE OF diversion_id, mcc_id, shift, collected_on ON milk_collections');
  });

  it('adds dairy\'s second verb in BOTH the seed and the migration', () => {
    // The seed states the desired matrix for a fresh install; the migration is the only thing that can change state a
    // previous seed already wrote. 0159's ruling, and they are not two mechanisms for one fact.
    expect(seed()).toContain("('dairy.override','Approve dairy playbook overrides (divert a shift)','M16')");
    expect(seed()).toMatch(/'tenant_admin'\) AND p\.code IN \('dairy\.manage','dairy\.override'\)/);
    const m = mig();
    expect(m).toContain("INSERT INTO permissions (code, default_name, module_code)");
    expect(m).toContain("'dairy.override'");
    expect(m).toContain("FROM roles r WHERE r.code = 'tenant_admin'");
  });

  it('catalogues the notice as CRITICAL and unmutable, with the voice channel first', () => {
    const m = mig();
    const ev = m.slice(m.indexOf("INSERT INTO notification_events"), m.indexOf('166.6'));
    expect(ev).toContain("'dairy.shift_diverted'");
    // A member who is not told that tonight's collection has moved village carries their milk to a locked door.
    expect(ev).toContain("'critical'");
    expect(ev).toContain('false, false)');
    // *"Gujarati voice"* — the canon's own word, and the people who need it most have no smartphone.
    expect(ev).toContain('"ivr","sms","push"');
  });

  it('flags the act OFF by default and says what does NOT depend on it', () => {
    const m = mig();
    const block = m.slice(m.indexOf("('dairy_shift_diversion'"), m.indexOf('166.5'));
    expect(block).toContain('false, 100');
    // Doubled quote: this is SQL, and `member''s` is how a literal apostrophe is written in it.
    expect(block).toMatch(/the counter accepts a pour ONLY at the member''s own route for that day/);
    expect(DIVERSION_FLAG).toBe('dairy_shift_diversion');
  });

  it('declares preview before every parameterised POST, and gates approve on the OVERRIDE verb', () => {
    const proto = DiversionsController.prototype as unknown as Record<string, unknown>;
    const posts = Object.getOwnPropertyNames(proto)
      .filter((mm) => mm !== 'constructor')
      .filter((mm) => Reflect.getMetadata(METHOD_METADATA, proto[mm] as never) === RequestMethod.POST)
      .map((mm) => Reflect.getMetadata(PATH_METADATA, proto[mm] as never) as string);
    expect(posts).toContain('preview');
    expect(posts.indexOf('preview')).toBeLessThan(posts.findIndex((p) => p.includes(':')));
    // THE ROUTE AND THE SERVICE AGREE: `dairy.override` on the decorator, `NO_OVERRIDE` from the verdict. The same rule
    // said twice, and the second one is what a screen can print in Gujarati.
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.approve as never)).toEqual([DairyPermissions.Override]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.request as never)).toEqual([DairyPermissions.Manage]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.cancel as never)).toEqual([DairyPermissions.Manage]);
    expect(Reflect.getMetadata('feature_flag', DiversionsController)).toEqual(['dairy', DIVERSION_FLAG]);
  });
});

/* =========================================================================================================== */
/* THE TWO SCREENS, AND THE WRITE THAT MUST FAIL CLOSED.                                                        */
/*                                                                                                              */
/* Everything above this line is the rule. These are the three places the rule can be true and the product still */
/* wrong: a monitor that ASSUMES the act is switched on and draws a button whose route answers 404, a board that  */
/* computes both sides of a diversion and then drops them before the screen reads the row, and a signature write  */
/* that reports success on a row it did not touch. The mutation pass found all three unguarded — the read models  */
/* because this wave's spec had no harness for them (TENANT-6d-5's lesson, one wave later, in the same module).   */
/* =========================================================================================================== */
describe('PC-56 TENANT-6d-6 · the screens, and the write that fails closed', () => {
  const bmcHarness = (divert: boolean) => {
    const replica = { forTenant: () => ({
      query: jest.fn(async (sql: string) => (sql.includes('SELECT now()')
        ? { rows: [{ n: new Date('2026-08-21T10:30:00Z') }] }
        : { rows: [{ ev: 1, sms: 1, crit_ev: 1, crit_ivr: 1 }] })),
    }) };
    const units = {
      monitor: jest.fn(async () => []),
      thresholds: jest.fn(async () => ({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 })),
      windowCounts: jest.fn(async () => ({ readings: 0, breaches: 0, units: 0 })),
      series: jest.fn(async () => []),
    };
    // PER FLAG, not one boolean for all of them: a harness that answers `true` to every flag cannot see a read model
    // that asks about the wrong one, and this monitor now asks about two.
    const flags = { isEnabled: jest.fn(async (f: string) => (f === DIVERSION_FLAG ? divert : true)) };
    return new DairyBmcReadModel(replica as never, units as never, { listRules: jest.fn(async () => []) } as never,
      flags as never, { inc: jest.fn(), observe: jest.fn() } as never);
  };

  it('READS whether the override is switched on for THIS cooperative, rather than assuming it', async () => {
    const on = await bmcHarness(true).view('t1', { userId: 'desk', canManage: true } as never, {});
    expect(on.diversionEnabled).toBe(true);
    // The default state of every cooperative on the day 0166 ships (Law 10: flags default OFF). The monitor must say
    // the playbook's second step is not available here — not offer a button whose route is not mounted.
    const off = await bmcHarness(false).view('t1', { userId: 'desk', canManage: true } as never, {});
    expect(off.diversionEnabled).toBe(false);
  });

  const boardHarness = (sides: Map<string, { divertedIn: number; divertedOut: number }>) => {
    const row = {
      mccId: 'm1', code: 'MCC-VNT', name: 'Vanthali', analyzerModel: 'Lactoscan SP', analyzerSerial: 'LS-412',
      pours: 0, pourers: 0, weightMilliKg: 0n, fatCentiPctWeighted: 0n, snfCentiPctWeighted: 0n,
      amountMinor: 0n, flags: 0, membershipsEnrolled: 87, shiftWindow: null,
    };
    const repo = {
      today: jest.fn(async () => TODAY),
      membershipCycleMix: jest.fn(async () => [{ paymentCycle: 'fortnightly', members: 87 }]),
      centreShiftRows: jest.fn(async () => [row, { ...row, mccId: 'm2', code: 'MCC-BHE', name: 'Bhesan', pours: 87, pourers: 87 }]),
      bmcForCentres: jest.fn(async () => []),
      flagsForDay: jest.fn(async () => []),
      accrual: jest.fn(async () => ({ amountMinor: 0n, membersWithPours: 0, cardsWithBonusRules: 0 })),
      billsInWindow: jest.fn(async () => 0),
      currencyCode: jest.fn(async () => 'INR'),
    };
    const diversions = { sidesFor: jest.fn(async () => sides) };
    const rm = new DairyCounterReadModel(repo as never, { findByWindow: jest.fn(async () => null) } as never,
      diversions as never, { forTenant: () => ({ query: jest.fn(async () => ({ rows: [], rowCount: 0 })) }) } as never,
      { inc: jest.fn(), observe: jest.fn() } as never);
    return { rm, diversions };
  };

  it('carries BOTH SIDES of the diversion onto the row the screen reads', async () => {
    // The evening W170 describes: Vanthali's roll is empty and Bhesan's is 87 pours long, and without these two
    // figures that reads as one broken counter and one impossible one.
    const h = boardHarness(new Map([['m1', { divertedIn: 0, divertedOut: 87 }], ['m2', { divertedIn: 87, divertedOut: 0 }]]));
    const board = await h.rm.board('t1', { shift: 'evening' });
    expect(board.centres.map((c) => [c.mccId, c.divertedIn, c.divertedOut])).toEqual([['m1', 0, 87], ['m2', 87, 0]]);
    // Asked for the DAY AND SHIFT being shown — a diversion is per shift, and the morning was ordinary.
    expect(h.diversions.sidesFor).toHaveBeenCalledWith('t1', TODAY, 'evening');
    // NOT ASSERTED HERE, AND WHY: `sidesFor`'s SQL also excludes unsigned and cancelled diversions, and no test can
    // tell whether it does. A pour cites a diversion only when that diversion is signed and live (the trigger), and a
    // diversion that pours cite cannot be cancelled (the service, asserted above) — so any row that filter removes
    // carries zero pours and removing it changes no number. It is defence-in-depth behind two guards that ARE tested,
    // recorded as an equivalent mutant rather than given a test that would only look like evidence.
    // A centre with no diversion carries zeroes, not nulls: the board's arithmetic never has a hole in it.
    const quiet = await boardHarness(new Map()).rm.board('t1', { shift: 'evening' });
    expect(quiet.centres.every((c) => c.divertedIn === 0 && c.divertedOut === 0)).toBe(true);
  });

  it('FAILS CLOSED on a signature or a cancellation that touched no row', async () => {
    // The eleventh and twelfth writers in this repository to refuse a zero-row UPDATE. A row that moved between the
    // verdict and the write means somebody else signed or called it off; reporting success would publish an authority
    // that does not exist and 87 families' milk would move on it.
    const repo = new DairyDiversionRepository({ forTenant: () => ({ query: jest.fn() }) } as never);
    const sent: string[] = [];
    const tx = { query: jest.fn(async (sql: string) => { sent.push(sql); return { rows: [], rowCount: 0 }; }) };
    await expect(repo.approve(tx as never, 't1', 'div-1', 'lead', new Date('2026-08-21T12:00:00Z')))
      .rejects.toThrow(/was not approved/);
    await expect(repo.cancel(tx as never, 't1', 'div-1', 'operator', new Date('2026-08-21T12:00:00Z'), 'DG held after all'))
      .rejects.toThrow(/was not cancelled/);
    // And the predicates that make a zero-row update MEAN that: neither ending may be applied twice.
    expect(sent[0]).toMatch(/approved_at IS NULL[\s\S]*cancelled_at IS NULL/);
    expect(sent[1]).toMatch(/cancelled_at IS NULL/);
  });

  it('asks for a SIGNED diversion when authorising a pour, and an unsigned one only when refusing a second', async () => {
    // Two lookups that differ by ONE predicate, and getting them the wrong way round has opposite failure modes: a
    // counter authorised by an unsigned request (milk moves on nobody's signature), or a second request refused
    // because a cancelled one exists. Asserted on the statement the repository actually sends, because the live suite
    // cannot separate them — `assert_collection_diversion()` refuses an unsigned authority too, so a pour is rejected
    // either way and the mutation pass reported the missing predicate as unguarded. Two guards, one of them untested,
    // is how the surviving one becomes load-bearing without anybody deciding that.
    const repo = new DairyDiversionRepository({ forTenant: () => ({ query: jest.fn() }) } as never);
    const seen: string[] = [];
    const x = { query: jest.fn(async (sql: string) => { seen.push(sql); return { rows: [], rowCount: 0 }; }) };
    await repo.liveFor(x as never, 't1', VANTHALI, TODAY, 'evening');
    await repo.pendingOrLive(x as never, 't1', VANTHALI, TODAY, 'evening');
    // The PREDICATE, not the statement: `approved_at` is a selected column in both, and a search over the whole SQL
    // would have found it either way. (TENANT-6d-5's `toContain` on a string that appears twice, one wave later.)
    const where = (sql: string) => sql.slice(sql.indexOf('WHERE'));
    expect(where(seen[0])).toMatch(/approved_at IS NOT NULL/);
    expect(where(seen[0])).toMatch(/cancelled_at IS NULL/);
    // The uniqueness question is about the SLOT, not the signature: a pending request holds it too, which is what
    // `uq_dairy_diversion_live` indexes.
    expect(where(seen[1])).not.toMatch(/approved_at/);
    expect(where(seen[1])).toMatch(/cancelled_at IS NULL/);
  });
});
