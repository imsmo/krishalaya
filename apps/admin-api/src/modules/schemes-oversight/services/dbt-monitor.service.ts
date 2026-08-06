// apps/admin-api/src/modules/schemes-oversight/services/dbt-monitor.service.ts · W076, the DBT / PFMS monitor.
//
// W076's lead line is a constraint, not a caption: "We OBSERVE and notify; the money moves government → farmer bank
// directly, never through our ledger." Nothing in this service writes a wallet entry, and `DBT_IS_OBSERVED_NOT_MOVED`
// records that as a value so the next person to reconcile these amounts against the ledger finds the reason they do
// not balance instead of "fixing" it.
//
// AND ITS RESTRICTED STATE IS A COLUMN LAW: "bank fields never shown here at all". Not masked, not gated — absent.
// `assertNoBankFields` runs over every payload on the way out, because "we didn't select it" is a fact about today's
// SQL and the failure mode is silent.
import { Injectable } from '@nestjs/common';
import { SchemesOversightRepository } from '../repositories/schemes-oversight.repository';
import { maskApplicant } from '../domain/pii-mask';
import { assertNoBankFields, CELEBRATION_NOTIFY_GAP, DBT_IS_OBSERVED_NOT_MOVED } from '../domain/dbt-safety';

/** The canon's window is 30 days ("Credits observed (30d)"). Clamped rather than free, because an unbounded window
 *  over a partitioned table is the query that takes the platform down at scale (Law 8). */
export const MAX_WINDOW_DAYS = 365;
export const DEFAULT_WINDOW_DAYS = 30;

const clampDays = (d?: number) => Math.min(Math.max(Math.floor(d ?? DEFAULT_WINDOW_DAYS), 1), MAX_WINDOW_DAYS);

@Injectable()
export class DbtMonitorService {
  constructor(private readonly repo: SchemesOversightRepository) {}

  /** The tiles. Every one of them is an OBSERVATION count, and the fourth tile the canon shows — "Celebration SMS
   *  sent 14,020" — is reported as not built rather than as 0. */
  async monitor(q: { days?: number; schemeLimit?: number }) {
    const days = clampDays(q.days);
    const [tiles, byScheme, bounces] = await Promise.all([
      this.repo.dbtTiles(days),
      this.repo.dbtByScheme(days, Math.min(Math.max(q.schemeLimit ?? 25, 1), 100)),
      this.repo.dbtBouncesByReason(days),
    ]);

    // The canon's "Aadhaar-seeding failures 184 · ambassador task queue" — the real slice of the real reason code,
    // not a separately-guessed number. Absent (null) when the bounce query returned no such reason at all, which is
    // different from zero seeding failures and is reported differently.
    const seeding = bounces.find((b) => b.reasonCode === 'aadhaar_not_seeded') ?? null;

    const payload = {
      windowDays: days,
      creditsObserved: tiles.transfers,
      amountMinor: tiles.amountMinor,      // minor-unit STRING, summed in SQL, never in JS (Law 2)
      farmers: tiles.farmers,
      lastCreditedOn: tiles.lastCreditedOn,
      byScheme: byScheme.map((r: any) => ({
        schemeCode: r.scheme_code, schemeName: r.scheme_name,
        transfers: r.transfers, amountMinor: String(r.amount_minor ?? '0'), farmers: r.farmers,
        // NULL when no instalment number was recorded — pm_kisan's "20th instalment" is a real datum and inventing a
        // 1 for a scheme that does not number its instalments would put a wrong ordinal on screen.
        latestInstalment: r.latest_instalment ?? null,
        lastCreditedOn: r.last_credited_on ?? null,
      })),
      bouncesByReason: bounces,
      aadhaarSeedingFailures: seeding ? { open: seeding.open, total: seeding.total, amountMinor: seeding.amountMinor } : null,
      // Named, not zeroed. See domain/dbt-safety.ts for the three separate things that are missing.
      celebrationNotify: CELEBRATION_NOTIFY_GAP,
      doctrine: DBT_IS_OBSERVED_NOT_MOVED,
    };
    assertNoBankFields(payload, 'dbt monitor tiles');
    return payload;
  }

  /** The credit stream, masked. A DBT row names a farmer and an amount that reached their bank; the mask is the
   *  default here for the same reason it is on W074, and the same audited unmask path serves both. */
  async recent(q: { days?: number; schemeId?: string; cursor?: { c: string; id: string }; limit: number }) {
    const days = clampDays(q.days);
    const rows = await this.repo.dbtRecent(days, q.schemeId, q.cursor, q.limit);
    const items = rows.map((r: any) => ({
      id: r.id,
      creditedOn: r.credited_on,
      instalmentNo: r.instalment_no ?? null,
      amountMinor: String(r.amount_minor ?? '0'),
      // The GOVERNMENT's transaction handle. Not a bank field: it identifies a disbursement, not an account, and it
      // is the string an operator quotes to PFMS to ask what happened.
      pfmsRef: r.pfms_ref ?? null,
      applicationId: r.application_id ?? null,
      govtAppRef: r.govt_app_ref ?? null,
      schemeCode: r.scheme_code,
      tenantName: r.tenant_name ?? null,
      farmer: r.user_id ? maskApplicant({ userId: r.user_id, fullName: r.applicant_full_name, phone: r.applicant_phone }) : null,
      // The canon's row shows "SMS gu ✓ 🎉". There is no notification record to read, so this row says so rather than
      // rendering an unticked box, which would claim we tried and failed.
      notified: null as null,
    }));
    const last = rows[rows.length - 1] as any;
    const payload = {
      windowDays: days,
      items,
      notificationStateAvailable: false as const,
      nextCursor: rows.length === q.limit && last ? Buffer.from(`${last.credited_on}|${last.id}`).toString('base64') : null,
    };
    assertNoBankFields(payload, 'dbt recent credits');
    return payload;
  }

  /** Bounced transfers — the canon's "All quiet — no bounced transfers" empty state, and its failure list. */
  async bounces(q: { days?: number; resolution?: string; limit: number }) {
    const days = clampDays(q.days);
    const rows = await this.repo.dbtBounces(days, q.resolution, q.limit);
    const payload = {
      windowDays: days,
      items: rows.map((r: any) => ({
        id: r.id,
        bouncedOn: r.bounced_on,
        reasonCode: r.reason_code,
        reasonNote: r.reason_note ?? null,
        amountMinor: String(r.amount_minor ?? '0'),
        resolution: r.resolution,
        resolvedAt: r.resolved_at ?? null,
        applicationId: r.application_id ?? null,
        schemeCode: r.scheme_code,
        tenantName: r.tenant_name ?? null,
        farmer: r.user_id ? maskApplicant({ userId: r.user_id, fullName: r.applicant_full_name, phone: r.applicant_phone }) : null,
      })),
    };
    // The check that matters most: `dbt_bounces` is the table that HAS a bank_ref, and the tenant-side reader selects
    // it with `SELECT *` two files away.
    assertNoBankFields(payload, 'dbt bounces');
    return payload;
  }
}
