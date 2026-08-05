// modules/ambassadors/repositories/aeps-event.repository.ts · PC-54 W54-13 `aeps-service-events` over 0071.
// THE LAW (0071 header + Appendix 3): this table is a LOG ONLY — AePS cash moves in the BANK's systems via
// NPCI; nothing here ever touches the platform ledger. Masked fields only (last4s — never raw Aadhaar,
// never fingerprint material, Law 10). Partitioned hot table: reads pin occurred_at.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface AepsEventInput {
  tenantId: string; ambassadorId: string; customerUserId?: string; serviceKind: string; bankName?: string;
  accountLast4?: string; aadhaarLast4?: string; amountMinor?: string; balanceAfterMinor?: string;
  status: string; exceptionCode?: string; attemptNo: number; deviceCertified: boolean; npciRrn?: string; escalationNote?: string;
}
const toRow = (x: any) => ({
  id: String(x.id), ambassadorId: x.ambassador_id, customerUserId: x.customer_user_id, serviceKind: x.service_kind,
  bankName: x.bank_name, accountLast4: x.account_last4, aadhaarLast4: x.aadhaar_last4,
  amountMinor: x.amount_minor != null ? String(x.amount_minor) : null, balanceAfterMinor: x.balance_after_minor != null ? String(x.balance_after_minor) : null,
  status: x.status, exceptionCode: x.exception_code, attemptNo: x.attempt_no, deviceCertified: x.device_certified,
  npciRrn: x.npci_rrn, escalationNote: x.escalation_note, occurredAt: new Date(x.occurred_at).toISOString(),
  syncedAt: x.synced_at ? new Date(x.synced_at).toISOString() : null,
});

@Injectable()
export class AepsEventRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, e: AepsEventInput): Promise<void> {
    await tx.query(
      `INSERT INTO aeps_service_events (tenant_id, ambassador_id, customer_user_id, service_kind, bank_name, account_last4, aadhaar_last4,
         amount_minor, balance_after_minor, status, exception_code, attempt_no, device_certified, npci_rrn, escalation_note, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())`,
      [e.tenantId, e.ambassadorId, e.customerUserId ?? null, e.serviceKind, e.bankName ?? null, e.accountLast4 ?? null, e.aadhaarLast4 ?? null,
       e.amountMinor ?? null, e.balanceAfterMinor ?? null, e.status, e.exceptionCode ?? null, e.attemptNo, e.deviceCertified, e.npciRrn ?? null, e.escalationNote ?? null]);
  }
  async listForAmbassador(tenantId: string, ambassadorId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM aeps_service_events WHERE tenant_id=$1 AND ambassador_id=$2 AND occurred_at >= now() - interval '90 days'
        ORDER BY occurred_at DESC, id DESC LIMIT $3`, [tenantId, ambassadorId, Math.min(limit, 200)]);
    return r.rows.map(toRow);
  }
  async list(tenantId: string, q: { status?: string; exceptionCode?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM aeps_service_events WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR exception_code=$3)
          AND occurred_at >= now() - interval '90 days' ORDER BY occurred_at DESC, id DESC LIMIT $4`,
      [tenantId, q.status ?? null, q.exceptionCode ?? null, Math.min(q.limit, 200)]);
    return r.rows.map(toRow);
  }
}
