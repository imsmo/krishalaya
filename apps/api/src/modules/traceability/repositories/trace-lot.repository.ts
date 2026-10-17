// modules/traceability/repositories/trace-lot.repository.ts · trace_lots. tenant_id in every (authenticated)
// query (Law 1) + RLS. No version → mutations lock FOR UPDATE. Keyset lists. The PUBLIC scan does NOT go through
// here — it calls the SECURITY DEFINER trace_scan() function (db/migrations/0028), the only RLS-bypass path.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { TraceLot } from '../domain/trace-lot.entity';
import { US_SQL } from '../../../shared/pagination/us-keyset';

const COLS = `id, tenant_id, listing_id, qr_token, farmer_user_id, parcel_id, crop_season_id, declared_inputs, certificate_ids, blockchain_anchor, created_at, ${US_SQL('created_at')} AS created_us`;
function toDomain(r: any): TraceLot {
  return TraceLot.rehydrate({ id: r.id, tenantId: r.tenant_id, listingId: r.listing_id, qrToken: r.qr_token, farmerUserId: r.farmer_user_id, parcelId: r.parcel_id,
    cropSeasonId: r.crop_season_id, declaredInputs: (r.declared_inputs ?? []) as unknown[], certificateIds: (r.certificate_ids ?? []) as unknown[], blockchainAnchor: r.blockchain_anchor, createdAt: r.created_at, createdAtUs: r.created_us ?? null });
}
export interface LotListQuery { box: 'mine' | 'all'; farmerUserId?: string; listingId?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class TraceLotRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, l: TraceLot): Promise<void> {
    const p = l.toProps();
    await tx.query(`INSERT INTO trace_lots (id, tenant_id, listing_id, qr_token, farmer_user_id, parcel_id, crop_season_id, declared_inputs, certificate_ids, blockchain_anchor, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$5)`,
      [p.id, p.tenantId, p.listingId, p.qrToken, p.farmerUserId, p.parcelId, p.cropSeasonId, JSON.stringify(p.declaredInputs), JSON.stringify(p.certificateIds), p.blockchainAnchor]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<TraceLot | null> {
    const r = await tx.query(`SELECT ${COLS} FROM trace_lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<TraceLot | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM trace_lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Find the lot for a listing (used by the order/shipment fanout to attach journey events). In-tx. */
  async findByListing(tx: TxContext, tenantId: string, listingId: string): Promise<TraceLot | null> {
    const r = await tx.query(`SELECT ${COLS} FROM trace_lots WHERE tenant_id=$1 AND listing_id=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE`, [tenantId, listingId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, l: TraceLot): Promise<void> {
    const p = l.toProps();
    await tx.query(`UPDATE trace_lots SET declared_inputs=$3::jsonb, certificate_ids=$4::jsonb, blockchain_anchor=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, JSON.stringify(p.declaredInputs), JSON.stringify(p.certificateIds), p.blockchainAnchor]);
  }
  async listFor(tenantId: string, q: LotListQuery): Promise<TraceLot[]> {
    const params: unknown[] = [tenantId]; let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.box === 'mine' && q.farmerUserId) where += ` AND farmer_user_id=${p(q.farmerUserId)}`;
    if (q.listingId) where += ` AND listing_id=${p(q.listingId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }   // PC-56 HOTFIX-7 · B24: the µs keyset
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM trace_lots WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** PUBLIC scan — PC-56 STORE-5b · B10 / D8: the SECURITY DEFINER `trace_scan_v3` (migration 0219; 0217's `trace_scan_v2` is no longer
   *  called): NULL for an unknown token; `{live:false, wasLive}` for a lot whose organisation is not live; otherwise the organisation, product,
   *  place, events (hashes, versions, allow-listed meta), the seal and the lot's certificates, with `lotId` / `tenantId` for the service (it
   *  strips both). qr_token is the capability. */
  async scan(tx: TxContext, qrToken: string): Promise<Record<string, unknown> | null> {
    const r = await tx.query(`SELECT trace_scan_v3($1) AS provenance`, [qrToken]);
    return r.rows[0]?.provenance ?? null;
  }

  /** PC-56 STORE-5b · D1 / B19: the lot's certificates — the ONE link (trace_lot_certificates). Only a certificate of THIS organisation is
   *  linked (the JOIN refuses a foreign or unknown id — it is dropped, never an error that names another organisation's id). */
  async linkCertificates(tx: TxContext, tenantId: string, lotId: string, certificateIds: readonly string[]): Promise<number> {
    if (!certificateIds.length) return 0;
    const r = await tx.query(
      `INSERT INTO trace_lot_certificates (tenant_id, trace_lot_id, certificate_id)
       SELECT $1, $2, c.id FROM certificates c WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.id = ANY($3::uuid[])
       ON CONFLICT (trace_lot_id, certificate_id) DO NOTHING`, [tenantId, lotId, [...new Set(certificateIds)]]);
    return r.rowCount ?? 0;
  }

  /** PC-56 STORE-5b · D3 — THE SEAL CLOCK'S CANDIDATES (the runner's kv_relay pool, read only): organisations with at least one lot whose chain
   *  head is not what its seal stamps (never sealed, or events added since). Bounded. */
  async tenantsDueForSeal(relay: { query: TxContext['query'] }, limit: number): Promise<string[]> {
    const r = await relay.query(
      `SELECT DISTINCT l.tenant_id FROM trace_lots l
         CROSS JOIN LATERAL (SELECT e.event_hash FROM trace_events e WHERE e.trace_lot_id = l.id AND e.tenant_id = l.tenant_id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) h
        WHERE l.deleted_at IS NULL AND (l.anchored_at IS NULL OR l.blockchain_anchor IS DISTINCT FROM h.event_hash)
        LIMIT $1`, [limit]);
    return r.rows.map((x: { tenant_id: string }) => x.tenant_id);
  }

  /** PC-56 STORE-5b · D3 — SEAL one organisation's lots (as kv_app, the tenant's own transaction): every lot whose chain head differs from its
   *  seal (or that was never sealed) is stamped with the head, the instant and the number of events it covers. Bounded per run; a lot whose
   *  head moves after this tick is re-sealed by the next one. Returns what was sealed (for the audit). */
  async sealDue(tx: TxContext, tenantId: string, limit: number): Promise<Array<{ id: string; anchor: string; eventCount: number }>> {
    const r = await tx.query(
      `WITH cand AS (
         SELECT l.id, h.event_hash, (SELECT count(*)::int FROM trace_events e2 WHERE e2.trace_lot_id = l.id AND e2.tenant_id = l.tenant_id) AS n
           FROM trace_lots l
           CROSS JOIN LATERAL (SELECT e.event_hash FROM trace_events e WHERE e.trace_lot_id = l.id AND e.tenant_id = l.tenant_id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) h
          WHERE l.tenant_id = $1 AND l.deleted_at IS NULL AND h.event_hash IS NOT NULL
            AND (l.anchored_at IS NULL OR l.blockchain_anchor IS DISTINCT FROM h.event_hash)
          ORDER BY l.created_at, l.id
          LIMIT $2)
       UPDATE trace_lots l SET blockchain_anchor = cand.event_hash, anchored_at = now(), anchored_event_count = cand.n, updated_at = now()
         FROM cand WHERE l.id = cand.id AND l.tenant_id = $1
       RETURNING l.id, l.blockchain_anchor, l.anchored_event_count`, [tenantId, limit]);
    return r.rows.map((x: { id: string; blockchain_anchor: string; anchored_event_count: number }) => ({ id: x.id, anchor: x.blockchain_anchor, eventCount: Number(x.anchored_event_count) }));
  }
}
