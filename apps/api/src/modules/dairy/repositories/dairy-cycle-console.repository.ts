// modules/dairy/repositories/dairy-cycle-console.repository.ts · PC-56 TENANT-6c-6 · W169's register, read.
//
// Two reads nothing on this platform could do before, and one that existed and was UNREACHABLE:
//
//   • **one cycle's bills, biggest first, with the member named.** `MilkBillRepository.listFor` has accepted a
//     `cycleId` since 0157 — and `QueryBillsSchema` never exposed it and `MilkBillService.list` never passed it, so
//     the fortnight W169 is a register OF could not be listed by any client (this programme's own defect list: a
//     parameter that exists and is unreachable, as W002's risk filter was). It also orders by `created_at`, and W169
//     sorts on Gross with the arrow already drawn descending — the register's whole point is who is owed the most.
//   • **the member's 30-day average**, for W169's *"13.6 L/day this cycle · 30d avg 14.2"*. One grouped query for the
//     page's members, not one per row: 50 rows is 50 round trips otherwise, and the index this rides
//     (`idx_milkcoll_member`) plus RANGE partitioning on `collected_on` prunes it to the month (Law 8).
//   • **the accrual for an OPEN cycle** is deliberately NOT here: TENANT-6a's `DairyCounterRepository.accrual` already
//     measures exactly that, over any window, and two mechanisms for "what has this cooperative accrued" is how two
//     dairy screens come to disagree about the same fortnight.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

/** One row of the register, exactly as the console needs it — money as strings, litres as the numeric mapper's text. */
export interface CycleBillRow {
  id: string;
  membershipId: string;
  memberUserId: string | null;
  memberName: string | null;
  memberCode: string;
  mccCode: string | null;
  totalLitres: string;
  grossMinor: string;
  deductionsMinor: string;
  netMinor: string;
  status: string;
  disputeWindowEnds: Date | null;
  previewedAt: Date | null;
  openDisputes: number;
  /**
   * The member's LATEST word on this bill's deductions, and whether it was about THESE figures.
   *
   * [PC-56 TENANT-6c-6, found live] Without this the row's *"needs the member's consent"* warning was computed from
   * the threshold alone, so a bill the member had already consented to kept its warning while the tile's count (which
   * does read the consents) said zero. One screen, two answers, about whose money is stuck.
   */
  consentGranted: boolean | null;
  consentMatchesFigures: boolean;
  /** Deduction lines rolled up by TYPE id — the canon itemises *"feed credit + loan EMI"* on the row itself. */
  byTypeId: Array<{ typeId: string; amountMinor: string; lines: number; applied: number }>;
  createdAt: Date;
}

export interface CycleBillPage { rows: CycleBillRow[]; nextCursor: { gross: string; id: string } | null }

@Injectable()
export class DairyCycleConsoleRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * One cycle's bills, GROSS first (the canon's default sort), keyset-paginated on `(gross_minor, id)`.
   *
   * Keyset rather than OFFSET because a 13-page register of a fortnight that is still being previewed changes under
   * the operator's feet, and OFFSET 300 on a partitioned money table is the query that gets slower every cycle.
   * `(gross_minor, id)` is unique because `id` is, so no row can be skipped or repeated at a page boundary — the same
   * ruling every keyset list on this platform has made since ADMIN-1.
   */
  async bills(tenantId: string, cycleId: string, q: { limit: number; cursor?: { gross: string; id: string } | null; direction?: 'desc' | 'asc' }): Promise<CycleBillPage> {
    const desc = (q.direction ?? 'desc') === 'desc';
    const params: unknown[] = [tenantId, cycleId, q.limit + 1];
    let keyset = '';
    if (q.cursor) {
      params.push(q.cursor.gross, q.cursor.id);
      // Tuple comparison, so the second key only decides ties on the first. `<` for the descending page and `>` for
      // the ascending one — one predicate, not two code paths that can disagree about a boundary row.
      keyset = ` AND (b.gross_minor, b.id) ${desc ? '<' : '>'} ($4::bigint, $5::uuid)`;
    }
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT b.id, b.membership_id, b.total_litres, b.gross_minor, b.deductions_minor, b.net_minor, b.status,
              b.dispute_window_ends, b.previewed_at, b.created_at,
              m.member_code, m.farmer_user_id, mc.code AS mcc_code, u.full_name AS member_name,
              latest.granted AS consent_granted,
              (latest.gross_minor = b.gross_minor AND latest.deductions_minor = b.deductions_minor) AS consent_matches,
              (SELECT count(*) FROM milk_bill_disputes d
                WHERE d.tenant_id = b.tenant_id AND d.bill_id = b.id AND d.status = 'open' AND d.deleted_at IS NULL)::int AS open_disputes,
              (SELECT jsonb_agg(jsonb_build_object('typeId', t.type_id, 'amountMinor', t.amount_minor::text,
                                                   'lines', t.lines, 'applied', t.applied)
                                ORDER BY t.amount_minor DESC, t.type_id)
                 FROM (SELECT dd.type_id,
                              sum(dd.amount_minor)::bigint                                  AS amount_minor,
                              count(*)::int                                                 AS lines,
                              count(*) FILTER (WHERE dd.status = 'applied')::int            AS applied
                         FROM milk_bill_deductions dd
                        WHERE dd.tenant_id = b.tenant_id AND dd.bill_id = b.id AND dd.deleted_at IS NULL
                        GROUP BY dd.type_id) t) AS by_type
         FROM milk_bills b
         JOIN dairy_memberships m ON m.id = b.membership_id AND m.tenant_id = b.tenant_id AND m.deleted_at IS NULL
         LEFT JOIN mcc_centres mc ON mc.id = m.mcc_id AND mc.tenant_id = m.tenant_id
         LEFT JOIN users u ON u.id = m.farmer_user_id AND u.deleted_at IS NULL
         -- The LATEST consent row, exactly as MilkBillService.assertConsented reads it (recorded_at DESC, id DESC).
         -- NOT an EXISTS(granted): a member who granted and then changed their mind is a BLOCKED bill, and the
         -- register has to say the same thing the payment will.
         LEFT JOIN LATERAL (
           SELECT c.granted, c.gross_minor, c.deductions_minor
             FROM milk_bill_deduction_consents c
            WHERE c.tenant_id = b.tenant_id AND c.bill_id = b.id AND c.deleted_at IS NULL
            ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1) latest ON true
        WHERE b.tenant_id = $1 AND b.cycle_id = $2 AND b.deleted_at IS NULL${keyset}
        ORDER BY b.gross_minor ${desc ? 'DESC' : 'ASC'}, b.id ${desc ? 'DESC' : 'ASC'}
        LIMIT $3`, params);

    const all = r.rows.map((x: any): CycleBillRow => ({
      id: x.id,
      membershipId: x.membership_id,
      memberUserId: x.farmer_user_id ?? null,
      // The name AS RECORDED. W169 draws *"Suresh B."*, and abbreviating a surname to an initial is a rule that works
      // in Latin script and mangles the Gujarati and Hindi names this cooperative's register is mostly made of —
      // Rule Zero rejects a display rule that degrades by language. A payout register is also the one screen where
      // the cooperative must be certain whose money it is; the member CODE is masked (W168's rule, reused), which is
      // the identifier a shoulder-surfer could actually use at a counter.
      memberName: x.member_name ?? null,
      memberCode: String(x.member_code),
      mccCode: x.mcc_code ?? null,
      totalLitres: String(x.total_litres),
      grossMinor: String(x.gross_minor),
      deductionsMinor: String(x.deductions_minor),
      netMinor: String(x.net_minor),
      status: String(x.status),
      disputeWindowEnds: x.dispute_window_ends ?? null,
      previewedAt: x.previewed_at ?? null,
      openDisputes: Number(x.open_disputes ?? 0),
      consentGranted: x.consent_granted === null || x.consent_granted === undefined ? null : Boolean(x.consent_granted),
      consentMatchesFigures: x.consent_matches === true,
      byTypeId: Array.isArray(x.by_type) ? x.by_type.map((t: any) => ({
        typeId: String(t.typeId), amountMinor: String(t.amountMinor), lines: Number(t.lines ?? 0), applied: Number(t.applied ?? 0),
      })) : [],
      createdAt: x.created_at,
    }));

    const rows = all.slice(0, q.limit);
    const last = rows[rows.length - 1];
    // `limit + 1` was asked for, so "there is another page" is MEASURED rather than guessed from a full page — a
    // register of exactly 50 bills must not offer a second page that is empty.
    return { rows, nextCursor: all.length > q.limit && last ? { gross: last.grossMinor, id: last.id } : null };
  }

  /**
   * Each of these memberships' pours over the 30 days ending at `to`, with the DAY COUNT beside the litres.
   *
   * The day count is the point: W169 prints a *"30d avg"* and dividing a family's month by 30 when they poured on
   * four days prints a number that makes every other row look wrong. The average is over days they actually poured,
   * and the caller says so on the screen.
   */
  async avg30d(tenantId: string, membershipIds: string[], to: string): Promise<Map<string, { litresMilli: bigint; days: number }>> {
    const out = new Map<string, { litresMilli: bigint; days: number }>();
    if (membershipIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      // `weight_kg` × 1000 is this platform's milli-LITRE: TENANT-6a stated the convention on the counter board and
      // `MilkBillService.generate` writes the bill's `total_litres` from the same `weight_kg` sum, so this average is
      // in the same unit as the row it sits beside. (A density conversion — milk is ~1.03 kg/L — is named and not
      // built anywhere on this platform; inventing one HERE would make this average disagree with every bill.)
      `SELECT c.membership_id,
              (sum(c.weight_kg) * 1000)::bigint          AS litres_milli,
              count(DISTINCT c.collected_on)::int        AS days
         FROM milk_collections c
        WHERE c.tenant_id = $1 AND c.membership_id = ANY($2::uuid[])
          AND c.collected_on > ($3::date - INTERVAL '30 days') AND c.collected_on <= $3::date
        GROUP BY c.membership_id`, [tenantId, membershipIds, to]);
    for (const x of r.rows as any[]) {
      out.set(String(x.membership_id), { litresMilli: BigInt(String(x.litres_milli ?? '0')), days: Number(x.days ?? 0) });
    }
    return out;
  }

  /**
   * The cycle-wide totals the register's foot needs — over EVERY bill in the cycle, not the page.
   *
   * A page total printed as a cycle total is the defect this programme has caught three times (a count derived from a
   * loop is right only where the bound was never hit), so both exist and each is labelled.
   */
  async totals(tenantId: string, cycleId: string): Promise<{ bills: number; grossMinor: string; deductionsMinor: string; netMinor: string; litresMilli: bigint; needingConsent: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int                                    AS bills,
              coalesce(sum(gross_minor), 0)::bigint            AS gross_minor,
              coalesce(sum(deductions_minor), 0)::bigint       AS deductions_minor,
              coalesce(sum(net_minor), 0)::bigint              AS net_minor,
              (coalesce(sum(total_litres), 0) * 1000)::bigint  AS litres_milli
         FROM milk_bills
        WHERE tenant_id = $1 AND cycle_id = $2 AND deleted_at IS NULL`, [tenantId, cycleId]);
    const x = (r.rows[0] ?? {}) as any;
    return {
      bills: Number(x.bills ?? 0),
      grossMinor: String(x.gross_minor ?? '0'),
      deductionsMinor: String(x.deductions_minor ?? '0'),
      netMinor: String(x.net_minor ?? '0'),
      litresMilli: BigInt(String(x.litres_milli ?? '0')),
      // Counted in the same pass it belongs to rather than derived from the page: a register showing 50 of 312 bills
      // cannot tell an operator how many of the OTHER 262 will refuse to pay for want of a fresh consent.
      needingConsent: await this.consentBlocked(tenantId, cycleId),
    };
  }

  /**
   * Bills whose deductions cross this tenant's consent line and have no fresh consent on file — the count that
   * predicts a failed payday.
   *
   * The threshold is read from the SAME setting the money path reads (0160), in one statement, so the number on the
   * screen and the refusal at `pay()` cannot disagree. 6c-4 made `pay()` refuse; without this, an operator discovers
   * that 41 bills will not pay by pressing pay 312 times.
   *
   * THE LATEST ROW DECIDES, not any granting row. `assertConsented` reads `latestForBill` (recorded_at DESC, id DESC)
   * and refuses when THAT row is a refusal or does not match the current figures — so a member who granted and then
   * changed their mind is a blocked bill. An `EXISTS (… granted)` here would have counted that bill as ready and put a
   * number on the screen the payment path contradicts, which is the defect class this programme keeps finding.
   */
  private async consentBlocked(tenantId: string, cycleId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH pct AS (
         SELECT (COALESCE(ts.value, d.default_value) #>> '{}')::int AS v
           FROM setting_definitions d
           LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
          WHERE d.key = 'dairy.deduction_consent_pct')
       SELECT count(*)::int AS n
         FROM milk_bills b, pct
         LEFT JOIN LATERAL (
           SELECT c.granted, c.gross_minor, c.deductions_minor
             FROM milk_bill_deduction_consents c
            WHERE c.tenant_id = b.tenant_id AND c.bill_id = b.id AND c.deleted_at IS NULL
            ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1) latest ON true
        WHERE b.tenant_id = $1 AND b.cycle_id = $2 AND b.deleted_at IS NULL
          AND b.status NOT IN ('paid', 'voided')
          AND b.deductions_minor > 0
          AND b.deductions_minor * 100 > b.gross_minor * pct.v
          AND (latest.granted IS NULL OR latest.granted = false
               OR latest.gross_minor <> b.gross_minor OR latest.deductions_minor <> b.deductions_minor)`,
      [tenantId, cycleId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }
}
