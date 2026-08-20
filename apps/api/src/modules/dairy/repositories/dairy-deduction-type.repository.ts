// modules/dairy/repositories/dairy-deduction-type.repository.ts · PC-56 TENANT-6c-4 · the `milk_deduction` vocabulary.
//
// Reads `lookup_values` (type `milk_deduction`, platform rows) — the mechanism this platform already uses for every
// controlled vocabulary, including the LEDGER's own `txn_type_id` (0006). No new vocabulary table was invented, and
// `meta.destination` / `meta.unsupported_reason` are read from the same row the label comes from, so an operator's
// refusal and the operator's picker can never disagree.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { DeductionType, isKnownDestination } from '../domain/dairy-deduction';

const SELECT = `SELECT id, code, default_name, meta FROM lookup_values
                 WHERE type_code='milk_deduction' AND tenant_id IS NULL AND is_active = true AND deleted_at IS NULL`;

function toType(r: any): DeductionType {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const raw = String(meta.destination ?? 'none');
  // An UNKNOWN destination reads as `none` rather than throwing, and it keeps the row's reason. A seed row naming a
  // mechanism this build does not have is a deployment that is AHEAD of its code — refusing the whole vocabulary
  // would take down the deduction path for every type, while treating it as unsupported refuses only that line. The
  // unit suite asserts every seeded destination IS known, which is where that mistake gets caught instead.
  const destination = isKnownDestination(raw) ? raw : 'none';
  const reason = meta.unsupported_reason == null ? null : String(meta.unsupported_reason);
  return {
    id: r.id, code: String(r.code), name: String(r.default_name), destination,
    unsupportedReason: destination === 'none'
      ? (reason ?? `deduction type '${r.code}' names destination '${raw}', which this build has no mechanism for`)
      : null,
    sourceType: meta.source_type == null ? null : String(meta.source_type),
  };
}

@Injectable()
export class DairyDeductionTypeRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The whole vocabulary — small, fixed and bounded by its own type code. */
  async list(tenantId: string): Promise<DeductionType[]> {
    const r = await this.replica.forTenant(tenantId).query(`${SELECT} ORDER BY sort_order, code`);
    return r.rows.map(toType);
  }

  /** One type by code, inside the writing transaction: the pay path decides a member's money on this row. */
  async byCode(tx: TxContext, code: string): Promise<DeductionType | null> {
    const r = await tx.query(`${SELECT} AND code=$1`, [code]);
    return r.rows[0] ? toType(r.rows[0]) : null;
  }

  /** Every type in one map, for a pass over a bill's several lines (one query, not one per line). */
  async byIds(tx: TxContext, ids: string[]): Promise<Map<string, DeductionType>> {
    if (ids.length === 0) return new Map();
    const r = await tx.query(`${SELECT} AND id = ANY($1)`, [ids]);
    const out = new Map<string, DeductionType>();
    for (const row of r.rows) { const t = toType(row); out.set(t.id, t); }
    return out;
  }
}
