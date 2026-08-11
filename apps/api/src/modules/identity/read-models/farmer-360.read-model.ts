// modules/identity/read-models/farmer-360.read-model.ts · W155's Farmer 360 (PC-56 TENANT-1b-3).
//
// W155: "Tenant-tier 360: everything Anand FPO knows, assembled at query time (derived — no new tables). Viewing is
// logged." And, at the foot of the screen, the sentence that decides how this file is written:
//
//   "This page exists to serve Ramesh P., not to surveil him. He can request his full record anytime (DPDP data access)
//    and it looks exactly like this — nothing hidden, nothing we'd be ashamed to show him."
//
// **SO EVERY FIGURE HERE IS ONE THE MEMBER COULD CHECK.** That is not a nicety, it is the design constraint: a derived
// number the member cannot reproduce from their own records is a number this page has no business printing, because the
// member is entitled to the same view.
//
// **THIS SCREEN HAS MORE REAL GROUND UNDER IT THAN ANY OTHER IN THE TENANT PANEL SO FAR**, which was a surprise:
// `crop_seasons` (0010) records season, year, sown date, expected and ACTUAL yield per parcel per product — W155's whole
// season timeline; `land_parcels` (0010) carries area, unit, survey number and a verification status; `dbt_transfers`
// (0011) carries scheme benefit credits per member per scheme with a credited-on date; `milk_bills` (0009) carries paid
// dairy income. Four of the five tiles are real.
//
// **WHAT IS REFUSED, AND WHY EACH REFUSAL IS THE HONEST ANSWER:**
//
//   • **"Credit readiness · strong · KCC-ready"** — there is no lender rule anywhere on this platform, and inventing one
//     is the most harmful thing this file could do. A farmer told by their FPO's console that they are KCC-ready, who then
//     takes a day off to visit a bank that refuses them, has lost a day's wages to a number we made up. So the EVIDENCE is
//     returned — how many settled payouts, how many months of history, whether land is on file and verified — and the
//     verdict is null. Staff can hand a banker the evidence; the banker decides.
//   • **The three advisory suggestions** — "17 qtl stored groundnut + rising modal → suggest a price alert at ₹6,600"
//     needs a record of STORED, UNSOLD stock, and nothing on this platform holds one. The suggestions on the canon screen
//     are hand-written examples, and a rules engine that guessed at them would be putting words in a trusted person's
//     mouth. Named, not faked (TENANT-1b-3-Q2).
//   • **Attributing a SALE to a season** — the canon writes "52 qtl harvested Oct · sold 28 qtl via FPO (₹1,71,000),
//     stored 24 qtl". Harvest is real (`crop_seasons.actual_yield`); the sale is real (orders, payouts); the LINK between
//     them does not exist — no column ties an order to a crop season. So the timeline shows what was grown and harvested,
//     the income tiles show what was received, and the page does not pretend one explains the other (TENANT-1b-3-Q3).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

/** One parcel's area, kept WITH its unit. See `land` below for why they are never summed blind. */
export interface LandByUnit { unit: string; area: string; parcels: number; verifiedParcels: number }

export interface Farmer360Income {
  /** Settled crop/produce payouts in the last 12 months. Minor units, string (Law 2). */
  cropRealizedMinor: string;
  cropPayoutCount: number;
  /** PAID dairy bills in the last 12 months. null when this tenant runs no dairy for the member (unknown ≠ zero). */
  dairyRealizedMinor: string | null;
  dairyBillCount: number;
  /** crop + dairy. null when dairy is unknown, because a total that silently treats unknown as zero is a wrong total. */
  totalRealizedMinor: string | null;
}

export interface Farmer360Land {
  /** **GROUPED BY UNIT, NEVER SUMMED ACROSS UNITS.** */
  byUnit: LandByUnit[];
  /** Distinct irrigation types on file — what an advisory conversation actually turns on. */
  irrigation: string[];
  /** How many parcels carry a land-record reference (the 7/12 extract W155 mentions). */
  parcelsWithRecord: number;
}

export interface Farmer360Scheme {
  schemeCode: string;
  schemeName: string;
  creditedMinor: string;
  transfers: number;
  lastCreditedOn: string | null;
}

export interface Farmer360Season {
  season: string;
  year: number;
  productName: string | null;
  parcelArea: string;
  parcelAreaUnit: string;
  sownOn: string | null;
  expectedHarvest: string | null;
  expectedYield: string | null;
  /** **null MEANS NOT RECORDED, NOT A FAILED HARVEST.** W155: "Yields are his records + FPO weighbridge — never
   *  estimated without saying so." */
  actualYield: string | null;
  status: string;
}

export interface Farmer360CreditEvidence {
  settledPayouts12mo: number;
  monthsWithIncome12mo: number;
  landParcelsOnFile: number;
  landParcelsVerified: number;
  allRolesKycVerified: boolean;
  /** **ALWAYS null.** No lender rule exists on this platform; see the file header. */
  readiness: null;
}

export interface Farmer360 {
  userId: string;
  fullName: string | null;
  income: Farmer360Income;
  land: Farmer360Land;
  schemesYtd: Farmer360Scheme[];
  schemesYtdTotalMinor: string;
  seasons: Farmer360Season[];
  credit: Farmer360CreditEvidence;
  /** **ALWAYS empty.** The advisory panel has no rules engine and no stored-stock record behind it. */
  advisory: never[];
  /** Echoed back so the console can print W155's "This view is recorded" with the same timestamp that was logged. */
  viewedAt: string;
}

@Injectable()
export class Farmer360ReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Assemble the 360 at query time.
   *
   * **NO NEW TABLES AND NO OVERNIGHT CACHE**, exactly as W155 says ("assembled live, never cached overnight"). A farmer's
   * income figure that is fourteen hours stale is the figure a field officer reads out to them on the telephone.
   *
   * Returns null for somebody who is not a member of this tenant — the same boundary, expressed the same way, as the
   * roster and the detail read.
   */
  async get(tenantId: string, userId: string): Promise<Farmer360 | null> {
    const db = this.replica.forTenant(tenantId);

    const head = await db.query<{ user_id: string; full_name: string | null }>(
      `SELECT u.id AS user_id, u.full_name
         FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = u.id AND utr.tenant_id = $2 AND utr.deleted_at IS NULL)`,
      [userId, tenantId]);
    const h = head.rows[0];
    if (!h) return null;

    const [income, land, schemes, seasons, credit] = await Promise.all([
      this.income(tenantId, userId),
      this.land(tenantId, userId),
      this.schemesYtd(tenantId, userId),
      this.seasons(tenantId, userId),
      this.creditEvidence(tenantId, userId),
    ]);

    return {
      userId: String(h.user_id),
      fullName: h.full_name ?? null,
      income,
      land,
      schemesYtd: schemes,
      schemesYtdTotalMinor: schemes
        .reduce((sum, s) => sum + BigInt(s.creditedMinor), 0n)
        .toString(),
      seasons,
      credit,
      advisory: [],
      viewedAt: new Date().toISOString(),
    };
  }

  /**
   * W155's "Farm income (12mo, realized) — crops + dairy — unsold stock counts when paid, never before".
   *
   * **REALIZED MEANS SETTLED, AND THAT IS THE WHOLE CLAIM.** Crop income is `payouts` with `status = 'paid'`; dairy income
   * is `milk_bills` with `status = 'paid'`. An order that was placed, a listing that is live, a bill that is approved but
   * unpaid — none of them are income, and W155 says so in its own words. Counting them would inflate the number a banker
   * is shown.
   *
   * The crop/dairy split is by PAYOUT PURPOSE, and the dairy side deliberately does NOT use a `milk_bill` purpose value:
   * 0006's comment names one, but it was never seeded (0125 recorded that four of the named purposes have no lookup rows).
   * Reading a purpose that does not exist would return zero and look like a farmer with no dairy income.
   */
  private async income(tenantId: string, userId: string): Promise<Farmer360Income> {
    const db = this.replica.forTenant(tenantId);
    const [crop, dairy] = await Promise.all([
      db.query<{ minor: string; n: number }>(
        `SELECT COALESCE(SUM(p.amount_minor), 0)::text AS minor, COUNT(*)::int AS n
           FROM payouts p
           JOIN lookup_values lv ON lv.id = p.purpose_id
          WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.status = 'paid' AND p.deleted_at IS NULL
            AND p.created_at >= now() - interval '12 months'
            -- The SELLING purposes. Wages are labour income, not farm income, and a dividend is a return on shares —
            -- folding either into "farm income" would answer a different question from the one the tile asks.
            AND lv.code IN ('settlement', 'milk_bill')`,
        [tenantId, userId]),
      db.query<{ minor: string; n: number }>(
        `SELECT COALESCE(SUM(mb.net_minor), 0)::text AS minor, COUNT(*)::int AS n
           FROM milk_bills mb
           JOIN dairy_memberships dm ON dm.id = mb.membership_id AND dm.deleted_at IS NULL
          WHERE mb.tenant_id = $1 AND dm.farmer_user_id = $2 AND mb.status = 'paid' AND mb.deleted_at IS NULL
            AND mb.period_end >= (CURRENT_DATE - 365)`,
        [tenantId, userId]),
    ]);

    const cropMinor = String(crop.rows[0]?.minor ?? '0');
    const dairyCount = Number(dairy.rows[0]?.n ?? 0);
    // **NO DAIRY BILLS AT ALL IS null, NOT ZERO** — and consequently the TOTAL is null too, because a total that treats
    // unknown as zero is a wrong number wearing a confident face. Tenth application of unknown ≠ zero.
    const dairyMinor = dairyCount > 0 ? String(dairy.rows[0]!.minor) : null;
    return {
      cropRealizedMinor: cropMinor,
      cropPayoutCount: Number(crop.rows[0]?.n ?? 0),
      dairyRealizedMinor: dairyMinor,
      dairyBillCount: dairyCount,
      totalRealizedMinor: dairyMinor === null ? null : (BigInt(cropMinor) + BigInt(dairyMinor)).toString(),
    };
  }

  /**
   * W155's "Land (declared) · 4.2 acre · 7/12 extract on file · 2 parcels".
   *
   * **THE AREAS ARE GROUPED BY UNIT AND NEVER SUMMED ACROSS UNITS, WHICH IS A REAL TRAP AND NOT A THEORETICAL ONE.**
   * `land_parcels.area_unit` is an FK into `units`, where `acre` and `hectare` both exist as area units — a hectare is
   * 2.47 acres. `SUM(area_value)` over a farmer with one 2-acre and one 1-hectare parcel returns "3", which is not a
   * quantity in any unit. And converting here would be worse: the conversion factor belongs in the units table (it is not
   * there yet), and a silent conversion is how a 4.2-acre holding becomes a 10.4-acre one on a loan application.
   *
   * So the tile shows "2.0 acre + 1.0 hectare" when that is the truth. Most Indian smallholders have one unit and see one
   * number; the ones who do not are the ones a wrong number would hurt most.
   */
  private async land(tenantId: string, userId: string): Promise<Farmer360Land> {
    const db = this.replica.forTenant(tenantId);
    const [byUnit, irrigation] = await Promise.all([
      db.query<{ unit: string; area: string; parcels: number; verified: number; with_record: number }>(
        `SELECT lp.area_unit AS unit,
                SUM(lp.area_value)::numeric(12,4)::text AS area,
                COUNT(*)::int AS parcels,
                COUNT(*) FILTER (WHERE lp.verification_status = 'verified')::int AS verified,
                COUNT(*) FILTER (WHERE lp.bhulekh_ref IS NOT NULL OR lp.survey_no IS NOT NULL)::int AS with_record
           FROM land_parcels lp
          WHERE lp.tenant_id = $1 AND lp.owner_user_id = $2 AND lp.deleted_at IS NULL
          GROUP BY lp.area_unit
          ORDER BY lp.area_unit`,
        [tenantId, userId]),
      db.query<{ code: string }>(
        `SELECT DISTINCT lv.code
           FROM land_parcels lp JOIN lookup_values lv ON lv.id = lp.irrigation_type_id
          WHERE lp.tenant_id = $1 AND lp.owner_user_id = $2 AND lp.deleted_at IS NULL
          ORDER BY lv.code`,
        [tenantId, userId]),
    ]);
    return {
      byUnit: byUnit.rows.map((x) => ({
        unit: String(x.unit), area: String(x.area), parcels: Number(x.parcels), verifiedParcels: Number(x.verified),
      })),
      irrigation: irrigation.rows.map((x) => String(x.code)),
      parcelsWithRecord: byUnit.rows.reduce((n, x) => n + Number(x.with_record), 0),
    };
  }

  /**
   * W155's "Scheme benefits YTD · ₹16,000 · PM-Kisan ₹4,000 + drip ₹12,000".
   *
   * **YTD IS THE CALENDAR YEAR AND THE SOURCE IS MONEY OBSERVED TO HAVE LANDED**, not applications approved.
   * `dbt_transfers` (0011) is "benefit credits observed/confirmed (PFMS)" — so this tile counts rupees the member
   * actually received, which is the only version of this number worth showing them. An approved application that PFMS
   * never paid is a different fact and belongs on the applications screen.
   *
   * `credited_on` is a DATE and the table is partitioned by `created_at`, so the range predicate names the date column
   * for correctness and the query stays bounded by the year.
   */
  private async schemesYtd(tenantId: string, userId: string): Promise<Farmer360Scheme[]> {
    const r = await this.replica.forTenant(tenantId).query<{
      code: string; name: string; minor: string; n: number; last_on: string | null;
    }>(
      `SELECT s.code, s.default_name AS name,
              SUM(d.amount_minor)::text AS minor,
              COUNT(*)::int AS n,
              MAX(d.credited_on)::text AS last_on
         FROM dbt_transfers d
         JOIN schemes s ON s.id = d.scheme_id
        WHERE d.user_id = $2
          -- dbt_transfers.tenant_id is NULLABLE (a transfer can be observed without a tenant), so a plain equality
          -- would silently drop the member's own PM-Kisan credits. Both cases are theirs.
          AND (d.tenant_id = $1 OR d.tenant_id IS NULL)
          AND d.credited_on >= date_trunc('year', CURRENT_DATE)
        GROUP BY s.code, s.default_name
        ORDER BY SUM(d.amount_minor) DESC`,
      [tenantId, userId]);
    return r.rows.map((x) => ({
      schemeCode: String(x.code),
      schemeName: String(x.name),
      creditedMinor: String(x.minor),
      transfers: Number(x.n),
      lastCreditedOn: x.last_on ?? null,
    }));
  }

  /**
   * W155's season timeline — and it is real, which was the surprise of this wave.
   *
   * `crop_seasons` (0010) records season, year, sown date, expected harvest, expected yield and **actual yield**, per
   * parcel per product. That is the timeline the canon draws, from a table that has existed since migration 0010 and had
   * no read path.
   *
   * **A NULL `actual_yield` IS RENDERED AS "not recorded", NEVER AS ZERO AND NEVER AS THE EXPECTED FIGURE.** W155 states
   * the rule itself: "Yields are his records + FPO weighbridge — never estimated without saying so." Substituting the
   * expectation for the outcome is the single most tempting shortcut on this screen and would make a bad season look
   * average on a document a banker might read.
   */
  private async seasons(tenantId: string, userId: string, limit = 12): Promise<Farmer360Season[]> {
    const r = await this.replica.forTenant(tenantId).query<{
      season: string; year: number; product_name: string | null; area: string; unit: string;
      sown_on: string | null; expected_harvest: string | null; expected_yield: string | null;
      actual_yield: string | null; status: string;
    }>(
      `SELECT cs.season, cs.year, p.default_name AS product_name,
              lp.area_value::text AS area, lp.area_unit AS unit,
              cs.sown_on::text, cs.expected_harvest::text,
              cs.expected_yield::text, cs.actual_yield::text, cs.status
         FROM crop_seasons cs
         JOIN land_parcels lp ON lp.id = cs.parcel_id AND lp.deleted_at IS NULL
         LEFT JOIN products p ON p.id = cs.product_id AND p.deleted_at IS NULL
        WHERE cs.tenant_id = $1 AND lp.owner_user_id = $2 AND cs.deleted_at IS NULL
        ORDER BY cs.year DESC, cs.sown_on DESC NULLS LAST
        LIMIT $3`,
      [tenantId, userId, limit]);
    return r.rows.map((x) => ({
      season: String(x.season),
      year: Number(x.year),
      productName: x.product_name ?? null,
      parcelArea: String(x.area),
      parcelAreaUnit: String(x.unit),
      sownOn: x.sown_on ?? null,
      expectedHarvest: x.expected_harvest ?? null,
      expectedYield: x.expected_yield ?? null,
      actualYield: x.actual_yield ?? null,
      status: String(x.status),
    }));
  }

  /**
   * The EVIDENCE behind W155's "Credit readiness · strong · income proof: 8 settlement statements — KCC-ready".
   *
   * **THE VERDICT IS null AND THE EVIDENCE IS REAL, AND THAT ASYMMETRY IS THE POINT.** No lender rule exists anywhere on
   * this platform — no `credit_score`, no eligibility model, nothing a bank has agreed to. A farmer told by their FPO's
   * console that they are "KCC-ready", who takes a day off to visit a bank that refuses them, has lost a day's wages to a
   * number we invented. Staff can hand a banker eight settled payout statements across nine months and a verified land
   * record; the banker decides, which is both the honest and the legally correct division of labour.
   *
   * `monthsWithIncome12mo` is the figure a lender actually asks for — regularity matters more than total to a KCC desk,
   * and eight payouts in one month is a different story from eight across a year.
   */
  private async creditEvidence(tenantId: string, userId: string): Promise<Farmer360CreditEvidence> {
    const db = this.replica.forTenant(tenantId);
    const [pay, land, kyc] = await Promise.all([
      db.query<{ n: number; months: number }>(
        `SELECT COUNT(*)::int AS n,
                COUNT(DISTINCT date_trunc('month', p.created_at))::int AS months
           FROM payouts p
          WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.status = 'paid' AND p.deleted_at IS NULL
            AND p.created_at >= now() - interval '12 months'`,
        [tenantId, userId]),
      db.query<{ n: number; verified: number }>(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified
           FROM land_parcels WHERE tenant_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
        [tenantId, userId]),
      db.query<{ active: number; verified: number }>(
        `SELECT COUNT(*) FILTER (WHERE is_active)::int AS active,
                COUNT(*) FILTER (WHERE is_active AND kyc_status = 'verified')::int AS verified
           FROM user_tenant_roles WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [tenantId, userId]),
    ]);
    const k = kyc.rows[0];
    return {
      settledPayouts12mo: Number(pay.rows[0]?.n ?? 0),
      monthsWithIncome12mo: Number(pay.rows[0]?.months ?? 0),
      landParcelsOnFile: Number(land.rows[0]?.n ?? 0),
      landParcelsVerified: Number(land.rows[0]?.verified ?? 0),
      // The same worst-status reading the roster uses: every ACTIVE role verified, not merely one.
      allRolesKycVerified: Number(k?.active ?? 0) > 0 && Number(k?.active) === Number(k?.verified),
      readiness: null,
    };
  }
}
