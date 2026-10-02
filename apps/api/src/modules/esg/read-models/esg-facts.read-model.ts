// modules/esg/read-models/esg-facts.read-model.ts · PC-56 TENANT-9d · THE THREE FACTS this platform records for ESG, read
// where they live — and nothing else. A read model across other modules' TABLES (the 9c compliance read model's shape), never
// another module's repository. Each reader is called ONLY behind a published method (EsgService); none writes.
//
//   omov         ← coop_resolutions + coop_votes (0182's SNAPSHOT: `eligible_at_close`, the frozen ballot box) — never today's roll
//   adulteration ← milk_collections (pruned by `collected_on`, Law 8) + milk_quality_reviews, inside the method's window
//   audit_trail  ← the catalogue: kv_app's privileges on `audit_log` and every partition; hash columns; the ledger's chain
//
// NOT READ, BY DESIGN: `carbon_projects`, `carbon_enrolments`, `carbon_credits` (0015 — a sale schema the canon forbids,
// written by nothing; a count would print "0 parcels") and `labour_grievances` (no writer — zero by construction).
// Times are formatted by the DATABASE in the cooperative's zone (F-17).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { AdulterationFact, AuditTrailFact, OmovFact } from '../domain/esg-rules';

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

@Injectable()
export class EsgFactsReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** One member, one vote — from the snapshot 0182 writes at close. A resolution closed before it (`not_recorded`) is counted apart. */
  async omov(tenantId: string, zone: string): Promise<OmovFact> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH c AS (
         SELECT r.id, r.eligible_at_close, r.closed_at FROM coop_resolutions r
          WHERE r.tenant_id = $1 AND r.status = 'closed' AND r.outcome IN ('passed', 'failed') AND r.deleted_at IS NULL),
       b AS (
         SELECT v.resolution_id, v.member_user_id, count(*) AS k FROM coop_votes v JOIN c ON c.id = v.resolution_id
          WHERE v.tenant_id = $1 GROUP BY v.resolution_id, v.member_user_id),
       per AS (
         SELECT c.id, c.eligible_at_close, coalesce(sum(b.k), 0) AS ballots FROM c LEFT JOIN b ON b.resolution_id = c.id GROUP BY c.id, c.eligible_at_close)
       SELECT (SELECT count(*) FROM c) AS closed,
              (SELECT coalesce(sum(eligible_at_close), 0) FROM c) AS eligible,
              (SELECT coalesce(sum(k), 0) FROM b) AS ballots,
              (SELECT max(k) FROM b) AS max_k,
              (SELECT count(*) FROM per WHERE per.ballots > per.eligible_at_close) AS over_roll,
              (SELECT count(*) FROM coop_resolutions r WHERE r.tenant_id = $1 AND r.status = 'closed' AND r.outcome = 'not_recorded' AND r.deleted_at IS NULL) AS not_recorded,
              (SELECT to_char(max(c.closed_at) AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI') FROM c) AS as_of`, [tenantId, zone]);
    const x = r.rows[0] ?? {};
    return {
      kind: 'omov', closedWithSnapshot: n(x.closed), ballots: n(x.ballots), eligibleAtClose: n(x.eligible),
      maxBallotsPerMember: x.max_k === null || x.max_k === undefined ? null : Number(x.max_k), overRoll: n(x.over_roll),
      notRecordedCloses: n(x.not_recorded), asOf: x.as_of ?? null,
    };
  }

  /** Adulteration flags and retests inside the window (civil days in the cooperative's zone). Partition-pruned on `collected_on`. */
  async adulteration(tenantId: string, zone: string, window: { from: string; to: string; days: number }): Promise<AdulterationFact> {
    const q = this.replica.forTenant(tenantId);
    const p = await q.query(
      `SELECT count(*) AS pours,
              count(*) FILTER (WHERE c.water_flag OR jsonb_array_length(coalesce(c.adulteration_flags, '[]'::jsonb)) > 0) AS flagged,
              count(*) FILTER (WHERE c.water_flag) AS water,
              to_char(max(c.collected_on) FILTER (WHERE c.water_flag OR jsonb_array_length(coalesce(c.adulteration_flags, '[]'::jsonb)) > 0), 'YYYY-MM-DD') AS last_flag,
              to_char(max(c.created_at) AT TIME ZONE $4, 'YYYY-MM-DD"T"HH24:MI') AS as_of
         FROM milk_collections c
        WHERE c.tenant_id = $1 AND c.collected_on BETWEEN $2::date AND $3::date`, [tenantId, window.from, window.to, zone]);
    const v = await q.query(
      `SELECT count(*) AS opened, count(*) FILTER (WHERE q.retest_at IS NOT NULL) AS retested
         FROM milk_quality_reviews q
        WHERE q.tenant_id = $1 AND q.collected_on BETWEEN $2::date AND $3::date AND q.deleted_at IS NULL`, [tenantId, window.from, window.to]);
    const a = p.rows[0] ?? {}; const b = v.rows[0] ?? {};
    return {
      kind: 'adulteration', windowDays: window.days, from: window.from, to: window.to,
      pours: n(a.pours), flaggedPours: n(a.flagged), waterFlagged: n(a.water), reviewsOpened: n(b.opened), retested: n(b.retested),
      lastFlaggedDay: a.last_flag ?? null, asOf: a.as_of ?? null,
    };
  }

  /**
   * What the audit trail IS, from the catalogue at this read: kv_app's privileges on `audit_log` AND every partition (a
   * partition that inherited a write grant is how 0077's ledger leak happened), hash columns on the trail (none), and the
   * money ledger's chain columns. As of now, in the cooperative's zone.
   */
  async auditTrail(tenantId: string, zone: string): Promise<AuditTrailFact> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH rel AS (
         SELECT c.oid FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = 'public' WHERE c.relname = 'audit_log'
         UNION
         SELECT i.inhrelid FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace s ON s.oid = p.relnamespace AND s.nspname = 'public'
          WHERE p.relname = 'audit_log')
       SELECT coalesce(bool_and(has_table_privilege('kv_app', rel.oid, 'INSERT')), false) AS can_insert,
              coalesce(bool_or(has_table_privilege('kv_app', rel.oid, 'UPDATE')), false)   AS can_update,
              coalesce(bool_or(has_table_privilege('kv_app', rel.oid, 'DELETE')), false)   AS can_delete,
              coalesce(bool_or(has_table_privilege('kv_app', rel.oid, 'TRUNCATE')), false) AS can_truncate,
              count(*) AS relations,
              (SELECT coalesce(array_agg(a.attname::text ORDER BY a.attname), '{}') FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = 'public'
                WHERE c.relname = 'audit_log' AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* 'hash') AS hash_cols,
              (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = 'public'
                WHERE c.relname = 'ledger_entries' AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('prev_hash', 'entry_hash')) = 2 AS ledger_chained,
              to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS as_of
         FROM rel`, [zone]);
    const x = r.rows[0] ?? {};
    const canInsert = x.can_insert === true; const canUpdate = x.can_update === true; const canDelete = x.can_delete === true; const canTruncate = x.can_truncate === true;
    return {
      kind: 'audit_trail', appendOnly: canInsert && !canUpdate && !canDelete && !canTruncate && n(x.relations) > 0,
      canInsert, canUpdate, canDelete, canTruncate, hashColumns: Array.isArray(x.hash_cols) ? x.hash_cols.map(String) : [],
      ledgerChained: x.ledger_chained === true, asOf: x.as_of ?? null,
    };
  }
}
