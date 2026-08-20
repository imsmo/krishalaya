// modules/dairy/repositories/milk-bill-deduction-consent.repository.ts · PC-56 TENANT-6c-4 · W169's 25% rule, stored.
//
// APPEND-ONLY BY GRANT (0160: SELECT + INSERT, no UPDATE at all). What a member said about their own money is not
// editable by anybody — a change of mind is a new row, and the latest row for a bill decides.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface DeductionConsent {
  id: string;
  billId: string;
  membershipId: string;
  memberUserId: string;
  grossMinor: bigint;
  deductionsMinor: bigint;
  thresholdPct: number;
  granted: boolean;
  channel: string;
  assistedBy: string | null;
  note: string | null;
  recordedAt: Date;
}

const COLS = `id, bill_id, membership_id, member_user_id, gross_minor, deductions_minor, threshold_pct, granted, channel, assisted_by, note, recorded_at`;

const toDomain = (r: any): DeductionConsent => ({
  id: r.id, billId: r.bill_id, membershipId: r.membership_id, memberUserId: r.member_user_id,
  grossMinor: BigInt(r.gross_minor), deductionsMinor: BigInt(r.deductions_minor), thresholdPct: Number(r.threshold_pct),
  granted: r.granted === true, channel: String(r.channel), assistedBy: r.assisted_by ?? null,
  note: r.note ?? null, recordedAt: r.recorded_at,
});

@Injectable()
export class MilkBillDeductionConsentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, c: Omit<DeductionConsent, 'recordedAt'> & { tenantId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO milk_bill_deduction_consents
         (id, tenant_id, bill_id, membership_id, member_user_id, gross_minor, deductions_minor, threshold_pct, granted, channel, assisted_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [c.id, c.tenantId, c.billId, c.membershipId, c.memberUserId, c.grossMinor.toString(), c.deductionsMinor.toString(),
       c.thresholdPct, c.granted, c.channel, c.assistedBy, c.note]);
  }

  /**
   * The LATEST word on this bill, inside the writing transaction.
   *
   * Ordered by `recorded_at DESC, id DESC` — the id tiebreak matters rather than being belt-and-braces: a member
   * granting and then immediately refusing over an ambassador's phone can produce two rows in the same millisecond,
   * and uuid v7 is time-ordered, so the id breaks the tie in the same direction as the clock.
   */
  async latestForBill(tx: TxContext, tenantId: string, billId: string): Promise<DeductionConsent | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_bill_deduction_consents
        WHERE tenant_id=$1 AND bill_id=$2 AND deleted_at IS NULL
        ORDER BY recorded_at DESC, id DESC LIMIT 1`, [tenantId, billId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** The whole history for one bill — evidence, in the order it happened. */
  async listForBill(tenantId: string, billId: string): Promise<DeductionConsent[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM milk_bill_deduction_consents
        WHERE tenant_id=$1 AND bill_id=$2 AND deleted_at IS NULL ORDER BY recorded_at, id`, [tenantId, billId]);
    return r.rows.map(toDomain);
  }

  /**
   * The tenant's consent threshold, from the SETTING (0160), never a literal 25.
   *
   * Refuses rather than defaulting when the definition is missing, for 0158's reason: a missing setting means the seed
   * did not run, and inventing 100 would switch the member's protection off silently while inventing 0 would refuse
   * every bill on the platform. Both are worse than a readable failure.
   */
  async consentThresholdPct(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query(
      `SELECT (COALESCE(ts.value, d.default_value) #>> '{}')::int AS pct
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
        WHERE d.key = 'dairy.deduction_consent_pct'`, [tenantId]);
    const raw = (r.rows[0] as { pct?: number } | undefined)?.pct;
    if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 1 || Number(raw) > 100) {
      throw new Error(`dairy.deduction_consent_pct is missing or out of range for tenant ${tenantId} — refusing to guess the threshold that decides whether a member is asked`);
    }
    return Number(raw);
  }
}
