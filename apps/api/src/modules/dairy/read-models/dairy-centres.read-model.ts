// modules/dairy/read-models/dairy-centres.read-model.ts · W171 (MCC centres) composed · PC-56 TENANT-6d-2.
//
// W171: *"3 collection centres · 312 memberships (member_code = card/QR at the counter) · payment cycles per member
// preference: daily | weekly | fortnightly | monthly."*
//
// THE BOARD SAYS FOUR KINDS OF THING, and the wave's whole argument is about keeping them apart:
//   1. **what the centre IS** — its code, village, capacity and analyzer, which have been real since 0009;
//   2. **who is HOLDING it** — the custody record 0163 adds, with a masked phone, and a stated gap when the stored
//      operator is not a member of this cooperative at all;
//   3. **when it is OPEN** — the hours TENANT-6a refused to invent, now recorded per shift, and still refused for a
//      centre that has not recorded them;
//   4. **what does not ADD UP** — the footer's tick, earned by comparing the board's own counts against an
//      independent total, and the preference panel's `pending` rows, where members have chosen a cadence no cycle has
//      opened for yet.
//
// THE PERMISSION IS CHECKED HERE, FIRST. TENANT-6c-6 shipped a console that trusted `actor.canManage` as passed by its
// caller; a read-model is reachable from anything and must not take a permission claim on trust.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { maskPhone } from '../../../shared/utils/phone';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { MccConsoleRepository } from '../repositories/mcc-console.repository';
import { DairyForbiddenError } from '../domain/dairy.errors';
import { cOfDeci } from '../domain/bmc';
import {
  CustodyVerdict, PreferenceRow, Reconciliation, ShiftWindows, TankCondition,
  centreTank, custodyDays, custodyVerdict, preferenceMix, preferencesHonoured, reconcile, shiftWindows,
} from '../domain/mcc-console';
import { DairyActor } from '../services/mcc-centre.service';

export const CENTRES_CONSOLE_FLAG = 'dairy_centres_console';

/** One centre, as W171's table row shows it. */
export interface CentreRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** *"1,200 L"* — the centre's own capacity per shift, as stored. Null when nobody has recorded one. */
  capacityLitresShift: string | null;
  /** *"Lactoscan SP"*, and the serial MASKED — a device serial is not a figure a browse screen should export. */
  analyzer: { model: string | null; serialMasked: string | null };
  /** *"108"* — active memberships routed here. */
  members: number;
  /** Who is holding the milk, and since when. */
  custody: CustodyVerdict & {
    /** Null whenever the platform will not stand behind the name — including a stored operator outside the tenant. */
    operatorName: string | null;
    /** `+9198****4321`, by the platform's ONE masking rule (`shared/utils/phone`). */
    operatorPhoneMasked: string | null;
    days: number | null;
  };
  /** The hours, per shift — null for a shift this centre has never recorded. */
  hours: ShiftWindows;
  /** *"active · BMC warm"*: the tank's condition, judged by TENANT-6d-1's own band arithmetic. */
  tank: { condition: TankCondition; unitId: string | null; tempC: string | null; bandMaxC: string | null; ageMinutes: number | null };
}

export interface CentresView {
  /** The DATABASE's clock. A custody's age and a reading's age are both measured against it, never against a browser. */
  now: string;
  centres: CentreRow[];
  /** W171's footer: *"3 centres · 312 memberships total ✓"* — a check, not a caption. */
  reconciliation: Reconciliation;
  /** W171's preference panel, told from the cycles that exist. */
  preferences: PreferenceRow[];
  /** *"their choice, honoured"* — as a fact, with the preferences still waiting on a cycle. */
  honoured: { all: boolean; pending: string[] };
  /** How many centres need somebody to walk to the tank right now (LIVE breaches only — 6d-1's badge rule). */
  tanksNeedingAttention: number;
  /** How many centres have recorded no hours at all: TENANT-6a's refusal, counted. */
  hoursUnrecorded: number;
  /** How many centres name an operator the platform cannot verify, or none at all. */
  custodyGaps: { unrecorded: number; nobody: number; disagrees: number };
  /**
   * WHAT THIS BOARD STILL CANNOT DO, named rather than omitted.
   *
   * `transferBuilt` is W171's other sentence — *"the membership moves centres without losing history"*. It is false
   * here, deliberately: the move is TENANT-6d-3, because doing it safely requires fixing a read that already exists
   * (TENANT-6c-6's register prints a bill's centre from the membership's CURRENT `mcc_id`, so the first transfer would
   * silently re-attribute every closed fortnight). A screen offering the move today would be offering the defect.
   */
  gaps: { transferBuilt: false; shiftWindowHistory: false; reliefOperator: false };
}

@Injectable()
export class DairyCentresReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly console: MccConsoleRepository,
    private readonly units: BmcUnitRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async view(tenantId: string, actor: DairyActor, q: { includeInactive?: boolean; limit?: number } = {}): Promise<CentresView> {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return timed(this.metrics, 'dairy.centres_console', { tenant: tenantId }, async () => {
      const x = this.replica.forTenant(tenantId);
      const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);

      const [nowRow, rows, tanks, total, counts, cycles, thresholds] = await Promise.all([
        x.query(`SELECT now() AS n`),
        this.console.board(x, tenantId, q.includeInactive === true, limit),
        this.console.tanks(x, tenantId),
        this.console.membershipTotal(x, tenantId),
        this.console.preferenceCounts(x, tenantId),
        this.console.cyclesByPreference(x, tenantId),
        // The silence threshold is the TENANT's (0162), and the board must judge a gap by exactly the number the
        // monitor judges it by — two screens disagreeing about whether a sensor is silent is two screens disagreeing
        // about whether anybody should walk to the tank.
        this.units.thresholds(x, tenantId),
      ]);
      const now = (nowRow.rows[0] as { n: Date }).n;

      // One tank per centre for the status column. The WARMEST live one wins when a centre has several, for the reason
      // 6d-1's focus rule gives: a board that showed the coolest of three tanks would hide the one losing the milk.
      const byMcc = new Map<string, typeof tanks[number]>();
      for (const t of tanks) {
        const held = byMcc.get(t.mccId);
        if (!held) { byMcc.set(t.mccId, t); continue; }
        const a = t.lastTempDeci; const b = held.lastTempDeci;
        if (a !== null && (b === null || a > b)) byMcc.set(t.mccId, t);
      }

      const centres: CentreRow[] = rows.map((r) => {
        const cust = custodyVerdict({ operatorUserId: r.operatorUserId }, r.custodyOperatorUserId !== null && r.custodyAssignedAt !== null
          ? { operatorUserId: r.custodyOperatorUserId, assignedAt: r.custodyAssignedAt } : null);
        const t = byMcc.get(r.id);
        const tank = centreTank(t ? { id: t.unitId, ...t } : null, now, thresholds.silenceMinutes);
        // A NAME IS PRINTED ONLY FOR A CUSTODY THE PLATFORM STANDS BEHIND. `disagrees` names nobody by design, and
        // `unrecorded` has a name only if the join produced one — which it does not when the stored operator holds no
        // active role in this cooperative.
        const nameable = cust.state === 'held' || cust.state === 'unrecorded';
        return {
          id: r.id, code: r.code, name: r.name, isActive: r.isActive,
          capacityLitresShift: r.capacityLitresShift,
          analyzer: { model: r.analyzerModel, serialMasked: maskSerial(r.analyzerSerial) },
          members: r.members,
          custody: {
            ...cust,
            operatorName: nameable ? r.operatorName : null,
            operatorPhoneMasked: nameable && r.operatorPhone ? maskPhone(r.operatorPhone) : null,
            days: custodyDays(cust.since, now),
          },
          hours: shiftWindows(r),
          tank: {
            condition: tank.condition, unitId: tank.unitId,
            tempC: tank.tempDeci === null ? null : cOfDeci(tank.tempDeci),
            bandMaxC: tank.band === null ? null : cOfDeci(tank.band.maxDeci),
            ageMinutes: tank.telemetry?.ageMinutes ?? null,
          },
        };
      });

      const preferences = preferenceMix(counts, cycles);
      return {
        now: now.toISOString(),
        centres,
        reconciliation: reconcile(centres.map((c) => c.members), total),
        preferences,
        honoured: preferencesHonoured(preferences),
        tanksNeedingAttention: centres.filter((c) => c.tank.condition === 'above_band' || c.tank.condition === 'below_min').length,
        hoursUnrecorded: centres.filter((c) => c.hours.morning === null && c.hours.evening === null).length,
        custodyGaps: {
          unrecorded: centres.filter((c) => c.custody.state === 'unrecorded').length,
          nobody: centres.filter((c) => c.custody.state === 'nobody').length,
          disagrees: centres.filter((c) => c.custody.state === 'disagrees').length,
        },
        gaps: { transferBuilt: false, shiftWindowHistory: false, reliefOperator: false },
      };
    });
  }

  /** Is the screen switched on for this tenant? The controller asks; the flag guard is the enforcement. */
  async enabled(tenantId: string): Promise<boolean> {
    return this.flags.isEnabled(CENTRES_CONSOLE_FLAG, { tenantId });
  }
}

/**
 * *"s/n LS-…412"* — the canon's own masking, and this file's only local rule.
 *
 * A device serial identifies a specific analyzer in a specific village. The board needs enough of it to match against
 * a service engineer's paperwork and no more; the full string is what turns a screen anybody with `dairy.manage` can
 * open into an equipment inventory. Last four, prefixed, so two Lactoscans at one cooperative are still telling apart.
 */
function maskSerial(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  return t.length <= 4 ? t : `…${t.slice(-4)}`;
}
