// modules/dairy/repositories/dairy-deduction-instruction.repository.ts · PC-56 TENANT-6c-5 · the arrangements.
// tenant_id in EVERY query (Law 1) + RLS. What the member agreed to is append-only by GRANT (0161); the only UPDATE
// is the revocation, and it fails closed.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { DairyDeductionInstruction, DeductionChannel } from '../domain/dairy-deduction-instruction.entity';
import { DeductionInstructionNotFoundError } from '../domain/dairy.errors';

const COLS = `i.id, i.tenant_id, i.membership_id, i.type_id, lv.code AS type_code, i.source_id, i.max_per_cycle_minor,
              i.authorised_by, i.authorised_at, i.channel, i.assisted_by, i.recorded_by, i.note,
              i.is_active, i.revoked_at, i.revoked_by, i.created_at`;
const FROM = `FROM dairy_deduction_instructions i JOIN lookup_values lv ON lv.id = i.type_id`;

function toDomain(r: any): DairyDeductionInstruction {
  return DairyDeductionInstruction.rehydrate({
    id: r.id, tenantId: r.tenant_id, membershipId: r.membership_id, typeId: r.type_id, typeCode: String(r.type_code),
    sourceId: r.source_id ?? null,
    maxPerCycleMinor: r.max_per_cycle_minor === null || r.max_per_cycle_minor === undefined ? null : BigInt(r.max_per_cycle_minor),
    authorisedBy: r.authorised_by, authorisedAt: r.authorised_at, channel: String(r.channel) as DeductionChannel,
    assistedBy: r.assisted_by ?? null, recordedBy: r.recorded_by, note: r.note ?? null,
    isActive: r.is_active === true, revokedAt: r.revoked_at ?? null, revokedBy: r.revoked_by ?? null, createdAt: r.created_at,
  });
}

@Injectable()
export class DairyDeductionInstructionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, i: DairyDeductionInstruction): Promise<void> {
    const p = i.toProps();
    await tx.query(
      `INSERT INTO dairy_deduction_instructions
         (id, tenant_id, membership_id, type_id, source_id, max_per_cycle_minor, authorised_by, authorised_at,
          channel, assisted_by, recorded_by, note, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [p.id, p.tenantId, p.membershipId, p.typeId, p.sourceId,
       p.maxPerCycleMinor === null ? null : p.maxPerCycleMinor.toString(),
       p.authorisedBy, p.authorisedAt, p.channel, p.assistedBy, p.recordedBy, p.note, p.isActive]);
  }

  /**
   * ONE membership's live arrangements, INSIDE the writing transaction.
   *
   * Read in the transaction rather than off the replica because this is what decides how much of a family's fortnight
   * is withheld: an arrangement revoked ten seconds ago must not be honoured because a replica had not caught up.
   */
  async activeForMembership(tx: TxContext, tenantId: string, membershipId: string, limit = 50): Promise<DairyDeductionInstruction[]> {
    const r = await tx.query(
      `SELECT ${COLS} ${FROM}
        WHERE i.tenant_id=$1 AND i.membership_id=$2 AND i.is_active AND i.deleted_at IS NULL
        ORDER BY i.authorised_at, i.id LIMIT $3`, [tenantId, membershipId, limit]);
    return r.rows.map(toDomain);
  }

  /**
   * [PC-56 TENANT-6d-3] How many live arrangements this membership carries — the caution that a debt follows the
   * person across villages, which is correct and worth saying out loud before somebody assumes a move clears it.
   */
  async countActiveFor(tx: TxContext, tenantId: string, membershipId: string): Promise<number> {
    const r = await tx.query(
      `SELECT count(*)::int AS n FROM dairy_deduction_instructions
        WHERE tenant_id=$1 AND membership_id=$2 AND is_active AND deleted_at IS NULL`, [tenantId, membershipId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DairyDeductionInstruction | null> {
    const r = await tx.query(
      `SELECT ${COLS} ${FROM} WHERE i.id=$1 AND i.tenant_id=$2 AND i.deleted_at IS NULL FOR UPDATE OF i`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * End an arrangement, and FAIL CLOSED.
   *
   * `AND is_active` in the predicate rather than only in the aggregate: two people revoking at once must not both
   * believe they did it, and a caller told "revoked" about a row that did not move would leave the assembler still
   * honouring an arrangement the member thinks is over — money out of a family's bill on the strength of a lie.
   */
  async revoke(tx: TxContext, i: DairyDeductionInstruction): Promise<void> {
    const p = i.toProps();
    const res = await tx.query(
      `UPDATE dairy_deduction_instructions
          SET is_active = false, revoked_at=$3, revoked_by=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND is_active AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.revokedAt, p.revokedBy]);
    if (res.rowCount === 0) throw new DeductionInstructionNotFoundError(p.id);
  }

  /** A member's own list, or the desk's — history included, because a revoked arrangement is part of the answer. */
  async listFor(tenantId: string, q: { membershipId: string; includeRevoked?: boolean; limit: number }): Promise<DairyDeductionInstruction[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} ${FROM}
        WHERE i.tenant_id=$1 AND i.membership_id=$2 AND i.deleted_at IS NULL
          ${q.includeRevoked ? '' : 'AND i.is_active'}
        ORDER BY i.authorised_at DESC, i.id DESC LIMIT $3`, [tenantId, q.membershipId, q.limit]);
    return r.rows.map(toDomain);
  }

  /**
   * The tenant's ASSEMBLY cap, as a percentage — `min(assembly, consent)`, both from settings.
   *
   * Both are read here, together, because the pair is the rule: the automatic path may never build a bill that needs
   * the member's fresh consent (0161). Refuses rather than defaulting when a definition is missing, for 0158's
   * reason — a missing setting means the seed did not run, and inventing 100 would let software take a whole
   * fortnight's milk without asking anybody.
   */
  /** [PC-56 TENANT-6c-6] `SqlExecutor`, so W169's console prints the SAME two numbers the money path reads without
   *  opening a transaction for two settings. One reader of these settings, still. */
  async assemblyPct(tx: SqlExecutor, tenantId: string): Promise<{ assemblyPct: number; consentPct: number }> {
    const r = await tx.query(
      `SELECT d.key, (COALESCE(ts.value, d.default_value) #>> '{}')::int AS pct
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
        WHERE d.key IN ('dairy.deduction_assembly_max_pct','dairy.deduction_consent_pct')`, [tenantId]);
    const byKey = new Map((r.rows as Array<{ key: string; pct: number }>).map((x) => [x.key, Number(x.pct)]));
    const assembly = byKey.get('dairy.deduction_assembly_max_pct');
    const consent = byKey.get('dairy.deduction_consent_pct');
    for (const [key, v] of [['dairy.deduction_assembly_max_pct', assembly], ['dairy.deduction_consent_pct', consent]] as const) {
      if (v == null || !Number.isFinite(v) || v < 0 || v > 100) {
        throw new Error(`${key} is missing or out of range for tenant ${tenantId} — refusing to guess how much of a family's milk money software may take`);
      }
    }
    return { assemblyPct: assembly as number, consentPct: consent as number };
  }
}
