// modules/ai-governance/repositories/ai-inference.repository.ts · ai_inferences (append-only, PARTITIONED by
// created_at; PK (id bigserial, created_at)). tenant_id in every authenticated query (Law 1) + RLS. Inserts
// RETURNING the generated (id, created_at) so the review row can reference the composite key. Tenant timelines
// + subject lookups are KEYSET (never OFFSET) and bound created_at so PG prunes partitions (Law 8). The write
// happens in the caller's tx; reads on the replica.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { AiInference } from '../domain/ai-inference.entity';

const COLS = `id, tenant_id, model_id, subject_type, subject_id, input_ref, output, confidence, was_overridden, override_by, override_reason, created_at`;
function toDomain(r: any): AiInference {
  return AiInference.rehydrate({ id: String(r.id), tenantId: r.tenant_id, modelId: r.model_id, subjectType: r.subject_type, subjectId: r.subject_id,
    inputRef: r.input_ref ?? {}, output: r.output ?? {}, confidence: r.confidence == null ? null : Number(r.confidence),
    wasOverridden: r.was_overridden, overrideBy: r.override_by, overrideReason: r.override_reason, createdAt: r.created_at });
}
export interface InferenceListQuery { subjectType?: string; subjectId?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class AiInferenceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Insert in the caller's tx. Returns the DB-assigned (id, createdAt) for the review FK. */
  async insert(tx: TxContext, i: AiInference): Promise<{ id: string; createdAt: Date }> {
    const p = i.toProps();
    const r = await tx.query(
      `INSERT INTO ai_inferences (tenant_id, model_id, subject_type, subject_id, input_ref, output, confidence, was_overridden)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING id, created_at`,
      [p.tenantId, p.modelId, p.subjectType, p.subjectId, JSON.stringify(p.inputRef), JSON.stringify(p.output), p.confidence, p.wasOverridden]);
    return { id: String(r.rows[0].id), createdAt: r.rows[0].created_at };
  }
  // PC-56 TEST-1 · THE PARTITION BOUND IS A ONE-MILLISECOND WINDOW, NOT AN EQUALITY. `created_at` is stored to the microsecond, but the
  // value callers hold (`ai_review_queue.inference_created_at`, written from the JS Date RETURNING gave back) is truncated to the
  // millisecond — so `created_at = $2` matched NOTHING: a rejection's `markOverridden` updated zero rows (the inference was never
  // marked overridden, silently) and the resolved event carried no subject. The window keeps partition pruning (a range on the
  // partition key) and the bigint id keeps the match exact. Found by the ai-governance integration spec.
  /** Just the subject of a linked inference (for the review-resolved event), bounded by the partition key. In-tx. */
  async subjectInTx(tx: TxContext, tenantId: string, id: string, createdAt: Date | null): Promise<{ subjectType: string; subjectId: string } | null> {
    const r = createdAt
      ? await tx.query(`SELECT subject_type, subject_id FROM ai_inferences WHERE id=$1 AND created_at >= $2::timestamptz AND created_at < $2::timestamptz + interval '1 millisecond' AND tenant_id=$3`, [id, createdAt, tenantId])
      : await tx.query(`SELECT subject_type, subject_id FROM ai_inferences WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? { subjectType: r.rows[0].subject_type, subjectId: r.rows[0].subject_id } : null;
  }
  async getById(tenantId: string, id: string): Promise<AiInference | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM ai_inferences WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Lock an inference row for an override write (composite PK; created_at bounds the partition). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string, createdAt: Date): Promise<AiInference | null> {
    const r = await tx.query(`SELECT ${COLS} FROM ai_inferences WHERE id=$1 AND created_at >= $2::timestamptz AND created_at < $2::timestamptz + interval '1 millisecond' AND tenant_id=$3 FOR UPDATE`, [id, createdAt, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async markOverridden(tx: TxContext, tenantId: string, id: string, createdAt: Date, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE ai_inferences SET was_overridden=true, override_by=$4, override_reason=$5 WHERE id=$1 AND created_at >= $2::timestamptz AND created_at < $2::timestamptz + interval '1 millisecond' AND tenant_id=$3`,
      [id, createdAt, tenantId, by, reason]);
  }
  async listFor(tenantId: string, q: InferenceListQuery): Promise<AiInference[]> {
    const params: unknown[] = [tenantId]; let where = `tenant_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.subjectType) where += ` AND subject_type=${p(q.subjectType)}`;
    if (q.subjectId) where += ` AND subject_id=${p(q.subjectId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM ai_inferences WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
