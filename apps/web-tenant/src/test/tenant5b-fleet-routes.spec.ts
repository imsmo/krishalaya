// PC-56 TENANT-5b · W229's and W231's rules — what the fleet register and the route board may and may not say.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  FLEET_REFUSALS, actionTitleKey, confirmHref, fleetErrorKey, fleetOkKey, isVehicleAction, mechanismNoticeKey,
  rcKey, rcTone, rcYear, reeferBreach, registerHref, splitKey, todayKey, typeContradictsReefer, typeKey, unfitKey,
  unparkWarningKey,
} from '../features/logistics/fleet';
import {
  MAX_ROUTE_NAME, ROUTE_TABS, actionHref, approvalKey, boardHref, breakEvenKey, canApprove, consolidationKey,
  dayLabelKey, economicsKey, errorFor, isProposal, isRouteAction, isRouteTab, parcelsKey, parcelsValue,
  routeCostKey, routeErrorKey, routeOkKey, statusKey, statusParam, suggestKey, tabOf, tierKey, validateDraft,
  villagesOverflowKey,
} from '../features/logistics/routes';
import { LOGISTICS_NAV, currentNavKey, unbuiltCount } from '../features/logistics/nav';
import { WEEKDAY_OPTIONS, weekdayKeyOf } from '../features/logistics/weekdays';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('TENANT-5b · the RC column (W229)', () => {
  it('has a distinct sentence for every reading, including the partner\'s document', () => {
    const keys = ([
      { kind: 'valid', validUntil: null }, { kind: 'expiring', validUntil: '2026-09-01', daysLeft: 13 },
      { kind: 'expired', validUntil: '2026-01-01', daysOver: 200 }, { kind: 'unverified' },
      { kind: 'rejected' }, { kind: 'absent' }, { kind: '3pl_held' },
    ] as const).map(rcKey);
    // Seven readings, seven keys: an operator told "RC problem" has to open the record to learn whether to book an
    // RTO appointment or chase our own review desk.
    expect(new Set(keys).size).toBe(7);
    expect(rcKey({ kind: '3pl_held' })).toBe('fleet.rc.heldByPartner');
    expect(rcKey({ kind: 'absent' })).toBe('fleet.rc.absent');
  });

  it('colours an expiring RC as a warning and never as a failure', () => {
    // A vehicle with eight weeks left is legal today; painting it red teaches an operator to ignore red.
    expect(rcTone({ kind: 'valid', validUntil: null })).toBe('ok');
    expect(rcTone({ kind: 'expiring', validUntil: '2026-09-01', daysLeft: 13 })).toBe('warn');
    expect(rcTone({ kind: 'expired', validUntil: '2026-01-01', daysOver: 9 })).toBe('bad');
    expect(rcTone({ kind: 'rejected' })).toBe('bad');
    expect(rcTone({ kind: '3pl_held' })).toBe('muted');
    // A missing document is not a tick either.
    expect(rcTone({ kind: 'absent' })).toBe('warn');
    expect(rcTone({ kind: 'unverified' })).toBe('warn');
  });

  it('prints the YEAR when there is one, and nothing when there is not', () => {
    expect(rcYear({ kind: 'valid', validUntil: '2028-06-30' })).toBe('2028');
    expect(rcYear({ kind: 'valid', validUntil: null })).toBeNull();
    expect(rcYear({ kind: 'absent' })).toBeNull();
    expect(rcYear({ kind: '3pl_held' })).toBeNull();
  });
});

describe('TENANT-5b · what a vehicle is doing, and the hour the screen will not invent', () => {
  it('names the four readings the platform can support', () => {
    expect(todayKey({ kind: 'carrying', onRoad: 1, reefer: null })).toBe('fleet.today.carrying');
    expect(todayKey({ kind: 'carrying', onRoad: 1, reefer: { tempC: 4.2, isBreach: false } })).toBe('fleet.today.carryingReefer');
    expect(todayKey({ kind: 'done_today', deliveredToday: 2 })).toBe('fleet.today.doneToday');
    expect(todayKey({ kind: 'loads_next', routeName: 'Village Run', weekday: 6 })).toBe('fleet.today.loadsNext');
    expect(todayKey({ kind: 'idle' })).toBe('fleet.today.idle');
  });

  it('flags a live temperature breach, which is the one emergency on this screen', () => {
    expect(reeferBreach({ kind: 'carrying', onRoad: 1, reefer: { tempC: 11.4, isBreach: true } })).toBe(true);
    expect(reeferBreach({ kind: 'carrying', onRoad: 1, reefer: { tempC: 4.2, isBreach: false } })).toBe(false);
    // A breach on a vehicle carrying nothing is not this screen's alarm to raise.
    expect(reeferBreach({ kind: 'idle' })).toBe(false);
  });

  it('has NO key for "free at" anywhere in the dictionary', () => {
    // W229 prints "2 runs done · free 15:30". No shift model, no working-hours record, no drop-duration estimate —
    // and it is the number a dispatcher would promise a farmer.
    for (const l of LOCALES) {
      expect({ l, promises: /fleet\.today\.free|fleet\.free/.test(dict(l)) }).toEqual({ l, promises: false });
    }
  });
});

describe('TENANT-5b · the type that had no vocabulary', () => {
  it('says "not recorded" rather than leaving the cell blank', () => {
    expect(typeKey('tempo')).toBe('fleet.type.tempo');
    expect(typeKey(null)).toBe('fleet.type.unset');
    // Every vehicle on the platform carried a NULL type until this wave, because the `vehicle_type` lookup had a
    // type declared and not one value seeded.
    for (const l of LOCALES) expect(dict(l)).toContain("'fleet.type.unset':");
  });

  it('calls out a type that contradicts the reefer flag the gate actually reads', () => {
    expect(typeContradictsReefer({ typeCode: 'reefer_7mt', isRefrigerated: false })).toBe(true);
    expect(typeContradictsReefer({ typeCode: 'tempo', isRefrigerated: true })).toBe(true);
    expect(typeContradictsReefer({ typeCode: 'reefer_7mt', isRefrigerated: true })).toBe(false);
    expect(typeContradictsReefer({ typeCode: 'tempo', isRefrigerated: false })).toBe(false);
    // An unrecorded type contradicts nothing — it is a gap, not a disagreement.
    expect(typeContradictsReefer({ typeCode: null, isRefrigerated: true })).toBe(false);
  });
});

describe('TENANT-5b · saying whether the safety promise is switched on', () => {
  const clean = [{ rc: { kind: 'valid' as const, validUntil: null }, isActive: true }];
  const expiredWorking = [{ rc: { kind: 'expired' as const, validUntil: '2026-01-01', daysOver: 9 }, isActive: true }];

  it('tells a tenant that NOTHING is parking their expired-RC vehicle', () => {
    // W229 states automatic parking as settled policy. With `logistics_rc_parking` off — the shipped default — that
    // sentence describes nothing, and letting it stand is how a safety claim becomes decoration.
    expect(mechanismNoticeKey({ fitnessGate: true, rcParking: false, requireRc: false }, expiredWorking)).toBe('fleet.notice.rcNotParking');
    expect(mechanismNoticeKey({ fitnessGate: false, rcParking: true, requireRc: false }, expiredWorking)).toBe('fleet.notice.gateOff');
    expect(mechanismNoticeKey({ fitnessGate: true, rcParking: true, requireRc: false }, expiredWorking)).toBeNull();
  });

  it('mentions missing paperwork, and says nothing at all to a tenant with none of these problems', () => {
    expect(mechanismNoticeKey({ fitnessGate: true, rcParking: true, requireRc: false }, [{ rc: { kind: 'absent' }, isActive: true }])).toBe('fleet.notice.rcMissing');
    // A clean fleet does not need a lecture about a switch.
    expect(mechanismNoticeKey({ fitnessGate: false, rcParking: false, requireRc: false }, clean)).toBeNull();
    expect(mechanismNoticeKey({ fitnessGate: false, rcParking: false, requireRc: false }, [])).toBeNull();
  });

  it('does not warn about a vehicle that is already parked', () => {
    // The expired RC is real, but the vehicle is off the road — which is the outcome the rule wanted.
    expect(mechanismNoticeKey({ fitnessGate: false, rcParking: false, requireRc: false },
      [{ rc: { kind: 'expired', validUntil: '2026-01-01', daysOver: 9 }, isActive: false }])).toBeNull();
  });
});

describe('TENANT-5b · the register\'s refusals and its confirm chain (W2421–W2423)', () => {
  it('translates every fitness refusal BY NAME, matching the API\'s own verdicts', () => {
    expect(unfitKey('vehicle_parked')).toBe('fleet.unfit.parked');
    expect(unfitKey('rc_invalid')).toBe('fleet.unfit.rcInvalid');
    expect(unfitKey('not_refrigerated')).toBe('fleet.unfit.notRefrigerated');
    expect(unfitKey('rc_absent')).toBe('fleet.unfit.rcAbsent');
    expect(unfitKey('vehicle_unknown')).toBe('fleet.unfit.unknown');
    expect(unfitKey('something_new')).toBe('fleet.unfit.generic');
    expect(unfitKey(null)).toBeNull();
    // The five reasons the api's `vehicleFitness` can return all have a sentence here — checked against the api's
    // own source so a new verdict cannot arrive silently.
    const api = fs.readFileSync(path.join(__dirname, '../../../api/src/modules/logistics/domain/fleet-fitness.ts'), 'utf8');
    for (const kind of ['vehicle_unknown', 'vehicle_parked', 'rc_invalid', 'rc_absent', 'not_refrigerated']) {
      expect({ kind, inApi: api.includes(`'${kind}'`), inWeb: unfitKey(kind) !== 'fleet.unfit.generic' }).toEqual({ kind, inApi: true, inWeb: true });
    }
  });

  it('warns before putting an expired-RC vehicle back on a village road', () => {
    expect(unparkWarningKey({ kind: 'expired', validUntil: '2026-01-01', daysOver: 9 })).toBe('fleet.act.unpark.rcWarning');
    expect(unparkWarningKey({ kind: 'rejected' })).toBe('fleet.act.unpark.rcWarning');
    expect(unparkWarningKey({ kind: 'valid', validUntil: null })).toBeNull();
    expect(unparkWarningKey({ kind: 'absent' })).toBeNull();
  });

  it('carries the action and the target in the URL, so Back works and nothing is posted twice', () => {
    expect(confirmHref('register')).toBe('/logistics/vehicles?act=register');
    expect(confirmHref('park', 'v-1')).toBe('/logistics/vehicles?act=park&id=v-1');
    expect(isVehicleAction('unpark')).toBe(true);
    expect(isVehicleAction('delete')).toBe(false);
    expect(actionTitleKey('park')).toBe('fleet.act.park.title');
    expect(registerHref(false)).toBe('/logistics/vehicles');
    expect(registerHref(true)).toBe('/logistics/vehicles?active=1');
    expect(registerHref(true, 'CUR')).toBe('/logistics/vehicles?active=1&cursor=CUR');
  });

  it('names the plate-already-registered refusal, which is the one an operator causes', () => {
    expect(fleetErrorKey('VEHICLE_REG_EXISTS')).toBe('fleet.err.regExists');
    expect(fleetErrorKey('SHIPMENT_FORBIDDEN')).toBe('fleet.err.forbidden');
    expect(fleetErrorKey('WHATEVER')).toBe('fleet.err.generic');
    expect(new Set(Object.values(FLEET_REFUSALS)).size).toBe(Object.values(FLEET_REFUSALS).length);
    expect(fleetOkKey('registered')).toBe('fleet.ok.registered');
    expect(fleetOkKey('nonsense')).toBeNull();
    expect(splitKey({ own: 3, partnered: 2 })).toBe('fleet.split.mixed');
  });
});

describe('TENANT-5b · the board (W231)', () => {
  it('has a tab per state and sends the API a status it understands', () => {
    expect([...ROUTE_TABS]).toEqual(['all', 'active', 'proposed', 'inactive']);
    expect(tabOf(undefined)).toBe('all');
    expect(tabOf('nonsense')).toBe('all');
    expect(isRouteTab('proposed')).toBe(true);
    // `all` sends NOTHING rather than a fourth status the server's enum would reject.
    expect(statusParam('all')).toBeUndefined();
    expect(statusParam('proposed')).toBe('proposed');
    expect(boardHref('all')).toBe('/logistics/routes');
    expect(boardHref('proposed', 'CUR')).toBe('/logistics/routes?tab=proposed&cursor=CUR');
  });

  it('draws a proposal as a question, not as a run', () => {
    expect(isProposal('proposed')).toBe(true);
    expect(isProposal('active')).toBe(false);
    expect(new Set((['proposed', 'active', 'inactive'] as const).map(statusKey)).size).toBe(3);
  });

  it('validates the weekday key the SERVER sent before translating it', () => {
    // `t()` on an unvalidated response value is how a server string ends up rendered as a dictionary lookup.
    expect(dayLabelKey('route.day.sat', false)).toBe('route.day.sat');
    expect(dayLabelKey('route.day.saturday', false)).toBe('route.day.unknown');
    expect(dayLabelKey('anything.else', false)).toBe('route.day.unknown');
    expect(dayLabelKey(null, false)).toBe('route.day.unknown');
    // A route with no weekday runs ON DEMAND — its own sentence, not a dash that reads like missing data.
    expect(dayLabelKey(null, true)).toBe('route.day.onDemand');
    expect(dayLabelKey('route.day.sat', true)).toBe('route.day.onDemand');
  });

  it('agrees with the API about which number means which day', () => {
    const api = fs.readFileSync(path.join(__dirname, '../../../api/src/modules/logistics/domain/route-plan.ts'), 'utf8');
    // 0 = Sunday, matching delivery_routes.run_weekday's own CHECK and Date.getUTCDay(). Asserted against the
    // api's own list rather than a copy of it, so a divergence fails here instead of booking a truck on a Tuesday.
    expect(api).toContain("['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']");
    expect(WEEKDAY_OPTIONS.map((w) => w.code)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(WEEKDAY_OPTIONS.map((w) => w.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayKeyOf(6)).toBe('route.day.sat');
    expect(weekdayKeyOf(null)).toBeNull();
    expect(weekdayKeyOf(9)).toBeNull();
  });

  it('says "+N" only when there are more villages, and names a missing consolidation point', () => {
    expect(villagesOverflowKey(11)).toBe('route.villages.more');
    expect(villagesOverflowKey(0)).toBeNull();
    expect(tierKey('cluster_lead')).toBe('route.tier.cluster_lead');
    expect(tierKey(null)).toBeNull();
    // The empty cell is a MISSING COMMITMENT — the thing that stops the approval — not an absence of data.
    expect(consolidationKey(null)).toBe('route.consolidation.unset');
    expect(consolidationKey({ userId: 'u1', name: 'Dinesh Bhai M.', tierCode: 'cluster_lead' })).toBeNull();
  });
});

describe('TENANT-5b · measured or estimated, and the economics with one side', () => {
  it('keeps the word "est." on a proposal\'s number', () => {
    expect(parcelsKey({ kind: 'measured', perRun: 34, runs: 12 })).toBe('route.parcels.measured');
    expect(parcelsKey({ kind: 'estimated', perRun: 12, runs: 4 })).toBe('route.parcels.estimated');
    expect(parcelsKey({ kind: 'no_history' })).toBe('route.parcels.none');
    expect(parcelsKey({ kind: 'measured', perRun: 1, runs: 1 })).not.toBe(parcelsKey({ kind: 'estimated', perRun: 1, runs: 1 }));
    expect(parcelsValue({ kind: 'estimated', perRun: 12, runs: 4 })).toBe(12);
    // Not zero: nobody has delivered there on that day inside the window, so the honest answer is "cannot say".
    expect(parcelsValue({ kind: 'no_history' })).toBeNull();
  });

  it('never renders a per-parcel cost FOR THE ROUTE, in any locale', () => {
    expect(economicsKey({ kind: 'ad_hoc_only', adHocPerParcelMinor: '9600', parcels: 100, currencyCode: 'INR', routeCost: 'not_recorded' })).toBe('route.econ.adHoc');
    expect(economicsKey({ kind: 'no_baseline', routeCost: 'not_recorded' })).toBe('route.econ.noBaseline');
    // W231 prints "₹28/parcel vs ₹96 ad-hoc". The ad-hoc side is real; the route side is recorded nowhere on this
    // platform, and two numbers side by side read as two measurements.
    expect(routeCostKey()).toBe('route.econ.routeCostMissing');
    expect(breakEvenKey()).toBe('route.econ.breakEvenUnknown');
    for (const l of LOCALES) {
      const d = dict(l);
      for (const key of ['route.econ.routeCostMissing', 'route.econ.breakEvenUnknown']) {
        const line = d.split('\n').find((x) => x.includes(`'${key}'`)) ?? '';
        expect({ l, key, present: line.length > 0 }).toEqual({ l, key, present: true });
        // …and no locale may quietly supply the number the sentence exists to withhold.
        expect({ l, key, quotesFigure: /[₹$]\s*\d|\b\d+\s*\/\s*parcel/i.test(line) }).toEqual({ l, key, quotesFigure: false });
      }
    }
  });
});

describe('TENANT-5b · the approval (W2406–W2408)', () => {
  it('offers the button only when the server would accept it', () => {
    // A button that refuses on click is worse than an absent one with a reason — W120's pay button and W226's
    // dispatch button both follow this rule.
    expect(canApprove({ kind: 'ready' })).toBe(true);
    for (const a of [{ kind: 'needs_vehicle' }, { kind: 'needs_consolidation' }, { kind: 'needs_villages' }, { kind: 'already_active' }] as const) {
      expect(canApprove(a)).toBe(false);
    }
  });

  it('names the ONE missing commitment', () => {
    expect(approvalKey({ kind: 'ready' })).toBeNull();
    expect(approvalKey({ kind: 'needs_vehicle' })).toBe('route.approval.needsVehicle');
    expect(approvalKey({ kind: 'needs_consolidation' })).toBe('route.approval.needsConsolidation');
    expect(approvalKey({ kind: 'needs_villages' })).toBe('route.approval.needsVillages');
    expect(approvalKey({ kind: 'already_active' })).toBe('route.approval.alreadyActive');
    expect(approvalKey({ kind: 'not_proposed', status: 'inactive' })).toBe('route.approval.notProposed');
    // Four different problems, four different sentences: "incomplete" makes somebody open five fields.
    expect(new Set([
      approvalKey({ kind: 'needs_vehicle' }), approvalKey({ kind: 'needs_consolidation' }),
      approvalKey({ kind: 'needs_villages' }), approvalKey({ kind: 'already_active' }),
    ]).size).toBe(4);
  });

  it('translates the API\'s refusal REASONS, not just its code', () => {
    // The action layer prefers `details.reason` over the code, so these are the keys that actually render.
    for (const reason of ['needs_vehicle', 'needs_consolidation', 'needs_villages', 'needs_approval', 'already_active', 'not_proposed']) {
      const key = routeErrorKey(reason);
      expect({ reason, key }).toEqual({ reason, key: `route.err.${reason}` });
      for (const l of LOCALES) expect({ l, reason, has: dict(l).includes(`'route.err.${reason}':`) }).toEqual({ l, reason, has: true });
    }
    expect(routeErrorKey('ROUTE_NOT_APPROVABLE')).toBe('route.err.notApprovable');
    expect(routeErrorKey('WHATEVER')).toBe('route.err.generic');
    expect(routeOkKey('approved')).toBe('route.ok.approved');
    expect(routeOkKey('nope')).toBeNull();
    expect(actionHref('approve', 'r 1')).toBe('/logistics/routes?act=approve&id=r%201');
    expect(isRouteAction('suspend')).toBe(true);
    expect(isRouteAction('delete')).toBe(false);
  });
});

describe('TENANT-5b · the new-route form (W2402–W2405)', () => {
  const ok = { defaultName: 'Saturday Village Run — south', runWeekday: '6', villageRegionIds: [VALID_UUID] };

  it('reports EVERY invalid field at once, each naming its own', () => {
    // W2402: "every invalid field is listed with its reason, values you entered are preserved, nothing was saved."
    const errs = validateDraft({ defaultName: 'x', runWeekday: '9', villageRegionIds: [] });
    expect(errs.map((e) => e.field).sort()).toEqual(['defaultName', 'runWeekday', 'villageRegionIds']);
    expect(errorFor(errs, 'runWeekday')).toBe('route.form.err.weekday');
    expect(validateDraft(ok)).toEqual([]);
  });

  it('holds the same rules the server\'s entity holds', () => {
    // A form that passes what the API will refuse has taught the operator nothing.
    expect(validateDraft({ ...ok, defaultName: 'ab' }).map((e) => e.key)).toEqual(['route.form.err.nameShort']);
    expect(validateDraft({ ...ok, defaultName: 'a'.repeat(MAX_ROUTE_NAME + 1) }).map((e) => e.key)).toEqual(['route.form.err.nameLong']);
    expect(validateDraft({ ...ok, defaultName: 'Run <b>south</b>' }).map((e) => e.key)).toEqual(['route.form.err.namePlain']);
    expect(validateDraft({ ...ok, villageRegionIds: ['not-a-uuid'] }).map((e) => e.key)).toEqual(['route.form.err.villagesInvalid']);
    // An empty weekday is legal — a route may run on demand.
    expect(validateDraft({ ...ok, runWeekday: '' })).toEqual([]);
    expect(validateDraft({ ...ok, runWeekday: '0' })).toEqual([]);
    expect(validateDraft({ ...ok, runWeekday: '-1' }).map((e) => e.field)).toEqual(['runWeekday']);
  });

  it('says the thing being created is a PROPOSAL', () => {
    // An operator who believes they just scheduled a truck will not come back to approve it, and the Saturday will
    // pass with nobody notified.
    for (const l of LOCALES) {
      const d = dict(l);
      expect({ l, has: d.includes("'route.form.reviewProposal':") }).toEqual({ l, has: true });
      expect({ l, has: d.includes("'route.ok.created':") }).toEqual({ l, has: true });
    }
  });

  it('calls the corridor list what it is', () => {
    // W231 offers "the suggest tool maps 30 days of ad-hoc shipments into route candidates". No such tool exists; a
    // button that silently created proposals would commit vehicles on the strength of a GROUP BY.
    expect(suggestKey()).toBe('route.suggest.corridorsOnly');
    for (const l of LOCALES) expect(dict(l)).toContain("'route.suggest.corridorsOnly':");
  });
});

describe('TENANT-5b · W225\'s sub-nav, all seven entries', () => {
  it('lists every section the canon prints and marks the four with no screen', () => {
    // The canon's seven, in the canon's order — plus the ONE entry PC-56 TENANT-5c added: W241 (Freight invoices)
    // has no inbound link anywhere in the 1,955 screens (only its own chain's breadcrumbs), so the wave that built
    // the desk also gave it a way in. Every canon entry is still here, in place; nothing was hidden.
    expect(LOGISTICS_NAV.filter((i) => i.key !== 'freight').map((i) => i.key))
      .toEqual(['overview', 'shipments', 'carriers', 'vehicles', 'routes', 'zones', 'coldChain']);
    expect(LOGISTICS_NAV.filter((i) => i.built).map((i) => i.key)).toEqual(['shipments', 'vehicles', 'routes', 'freight']);
    expect(unbuiltCount()).toBe(4);
    // Shipped as unbuilt rather than hidden: an FPO who was shown the canon cannot otherwise tell "not built" from
    // "hidden from me by a permission".
    for (const i of LOGISTICS_NAV) expect(i.built === (i.href !== null)).toBe(true);
  });

  it('lights the LONGEST matching section, and respects the path BOUNDARY', () => {
    expect(currentNavKey('/logistics')).toBe('shipments');
    expect(currentNavKey('/logistics/vehicles')).toBe('vehicles');
    expect(currentNavKey('/logistics/routes/new')).toBe('routes');
    expect(currentNavKey('/logistics/events')).toBe('shipments');
    expect(currentNavKey('/orders')).toBeNull();
    // The boundary is not decoration: a prefix match without it lights "Shipments" on any route whose path merely
    // STARTS with the same letters, which is how a future `/logistics-archive` page ends up highlighting a section
    // it has nothing to do with.
    expect(currentNavKey('/logistics-archive')).toBeNull();
    expect(currentNavKey('/logistics/vehicles-old')).toBe('shipments');
  });
});

describe('TENANT-5b · i18n parity ×3', () => {
  it('has every new key in all three launch languages', () => {
    const en = dict('en');
    const keys = [...en.matchAll(/'((?:fleet|route)\.[a-zA-Z0-9_.]+)':/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(150);
    for (const l of ['hi', 'gu'] as const) {
      const d = dict(l);
      const missing = keys.filter((k) => !d.includes(`'${k}':`));
      expect({ locale: l, missing }).toEqual({ locale: l, missing: [] });
    }
  });

  it('translates the five vehicle types and the five ambassador tiers the seeds define', () => {
    const seed = fs.readFileSync(path.join(__dirname, '../../../../db/seeds/core/0005_lookup_vocabularies.sql'), 'utf8');
    for (const code of ['bike', 'tempo', 'truck', 'reefer_7mt', 'tractor_trolley']) {
      expect({ code, seeded: seed.includes(`'${code}'`) }).toEqual({ code, seeded: true });
      for (const l of LOCALES) expect({ l, code, has: dict(l).includes(`'fleet.type.${code}':`) }).toEqual({ l, code, has: true });
    }
    for (const tier of ['trainee', 'ambassador', 'senior', 'cluster_lead', 'district_coordinator']) {
      for (const l of LOCALES) expect({ l, tier, has: dict(l).includes(`'route.tier.${tier}':`) }).toEqual({ l, tier, has: true });
    }
  });
});
