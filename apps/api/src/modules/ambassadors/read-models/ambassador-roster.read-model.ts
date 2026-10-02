// modules/ambassadors/read-models/ambassador-roster.read-model.ts · PC-56 TENANT-10a · W159 (`/people/ambassadors`).
//
// THE ROSTER PRINTED A RAW USER ID (F-16). Each row now carries what the canon's columns ask, from the tables that
// record it — and nothing they do not:
//   • Ambassador — the member's short name + the 1b MASKED phone (the full number never crosses the wire);
//   • Tier — the `ambassador_tier` lookup CODE the profile points at (null = no tier set);
//   • Cluster (villages) — the admin_regions the profile names, by their recorded name ([] when none is set);
//   • Onboarded (30d) — referrals this ambassador referred that were ACTIVATED in the last 30 days (0184's activated_at);
//   • Owed — SUM of this ambassador's UNPAID earnings, minor units as a string (Law 2);
//   • Last active — `last_activity_at`, which has a writer since this wave (A9).
// The KPI tiles are one aggregate (`summary`). "Uncovered villages" needs the cooperative's own village set, which no
// table records — it is returned as `null` with its reason, never as a zero.
//
// SCALE: one round trip per page; the per-row aggregates are correlated subqueries bounded by the tenant's ambassadors
// (an FPO has tens, a district federation hundreds), and the keyset is never OFFSET. Two sort orders: newest (µs cursor)
// and Owed ▾ (`owed|id` cursor).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { SqlExecutor } from '../../../core/database/unit-of-work';
import { decodeAmountCursor, decodeCursor, encodeAmountCursor, encodeCursor } from '../domain/cursor';
import { maskPhone, shortName } from '../domain/display';

export const ROSTER_SORTS = ['recent', 'owed'] as const;
export type RosterSort = (typeof ROSTER_SORTS)[number];
export const INACTIVE_DAYS = 60;

export interface RosterQuery { id?: string; tier?: string; inactive?: boolean; activeOnly?: boolean; sort: RosterSort; cursor?: string; limit: number }
export interface RosterRow {
  id: string; userId: string; displayName: string | null; phoneMasked: string;
  tierId: string | null; tierCode: string | null;
  clusterRegionIds: string[]; clusterRegions: Array<{ id: string; name: string }>; clusterRegionNames: string[];
  mentorAmbassadorId: string | null; trainingCompletedAt: string | null; kioskEnabled: boolean; aepsEnabled: boolean;
  monthlyStipendMinor: string; owedMinor: string; onboarded30d: number; lastActivityAt: string | null; isActive: boolean; createdAt: string;
}
export interface RosterSummary {
  activeCount: number; villagesCovered: number; uncoveredVillages: null; uncoveredReason: 'tenant_village_set_not_recorded';
  owedThisWeekMinor: string; owedAsOf: string; onboarded30d: number; newMembers30d: number; kioskCount: number; aepsCount: number;
  tierCounts: Record<string, number>; inactive60d: number; total: number;
}
export interface MemberCandidate { userId: string; displayName: string | null; phoneMasked: string; isMember: boolean; ambassadorId: string | null }

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

@Injectable()
export class AmbassadorRosterReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  private filters(q: Pick<RosterQuery, 'id' | 'tier' | 'inactive' | 'activeOnly'>, p: (v: unknown) => string): string {
    let w = `a.tenant_id = $1 AND a.deleted_at IS NULL`;
    if (q.id) w += ` AND a.id = ${p(q.id)}::uuid`;
    if (q.activeOnly) w += ` AND a.is_active`;
    if (q.tier) w += ` AND a.tier_id IN (SELECT lv.id FROM lookup_values lv WHERE lv.type_code = 'ambassador_tier' AND lv.code = ${p(q.tier)})`;
    // "inactive 60d": active profiles whose last recorded act (or, never having acted, their enrolment) is older than 60 days.
    if (q.inactive) w += ` AND a.is_active AND COALESCE(a.last_activity_at, a.created_at) < now() - make_interval(days => ${p(INACTIVE_DAYS)})`;
    return w;
  }

  async roster(tenantId: string, q: RosterQuery): Promise<{ items: RosterRow[]; nextCursor: string | null; total: number }> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = this.filters(q, p);
    let keyset = 'true';
    if (q.sort === 'owed') {
      const c = decodeAmountCursor(q.cursor);
      if (c) { const ca = p(c.amount), ci = p(c.id); keyset = `(pg.owed_minor < ${ca}::bigint OR (pg.owed_minor = ${ca}::bigint AND pg.id < ${ci}::uuid))`; }
    } else {
      const c = decodeCursor(q.cursor);
      if (c) { const cc = p(c.c), ci = p(c.id); keyset = `(pg.created_at < ${cc}::timestamptz OR (pg.created_at = ${cc}::timestamptz AND pg.id < ${ci}::uuid))`; }
    }
    const order = q.sort === 'owed' ? 'pg.owed_minor DESC, pg.id DESC' : 'pg.created_at DESC, pg.id DESC';
    const lp = p(q.limit);
    const db = this.replica.forTenant(tenantId);
    const r = await db.query<any>(
      `WITH pg AS (
         SELECT a.id, a.user_id, a.cluster_region_ids, a.tier_id, a.mentor_ambassador_id, a.training_completed_at, a.kiosk_enabled, a.aeps_enabled,
                a.monthly_stipend_minor, a.last_activity_at, a.is_active, a.created_at, a.created_at::text AS created_at_raw,
                COALESCE((SELECT SUM(e.amount_minor) FROM ambassador_earnings e WHERE e.tenant_id = a.tenant_id AND e.ambassador_id = a.id AND e.payout_id IS NULL), 0)::bigint AS owed_minor
           FROM ambassador_profiles a WHERE ${where}
       )
       SELECT pg.*, pg.owed_minor::text AS owed_text, u.full_name, u.phone, lv.code AS tier_code,
              (SELECT count(*)::int FROM referrals rf WHERE rf.tenant_id = $1 AND rf.referrer_user_id = pg.user_id AND rf.deleted_at IS NULL
                  AND rf.activated_at >= now() - interval '30 days') AS onboarded_30d,
              COALESCE((SELECT json_agg(json_build_object('id', ar.id, 'name', ar.default_name) ORDER BY ar.default_name)
                          FROM admin_regions ar WHERE ar.id::text IN (SELECT jsonb_array_elements_text(pg.cluster_region_ids))), '[]'::json) AS clusters
         FROM pg JOIN users u ON u.id = pg.user_id
         LEFT JOIN lookup_values lv ON lv.id = pg.tier_id
        WHERE ${keyset}
        ORDER BY ${order}
        LIMIT ${lp}`, params);
    const countParams: unknown[] = [tenantId];
    const cp = (v: unknown) => { countParams.push(v); return `$${countParams.length}`; };
    const c = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ambassador_profiles a WHERE ${this.filters(q, cp)}`, countParams);
    const items: RosterRow[] = r.rows.map((x: any) => {
      const clusters = (x.clusters ?? []) as Array<{ id: string; name: string }>;
      return {
        id: x.id, userId: x.user_id, displayName: shortName(x.full_name), phoneMasked: maskPhone(x.phone ?? ''),
        tierId: x.tier_id, tierCode: x.tier_code ?? null,
        clusterRegionIds: (x.cluster_region_ids ?? []) as string[], clusterRegions: clusters, clusterRegionNames: clusters.map((k) => k.name),
        mentorAmbassadorId: x.mentor_ambassador_id, trainingCompletedAt: iso(x.training_completed_at), kioskEnabled: x.kiosk_enabled, aepsEnabled: x.aeps_enabled,
        monthlyStipendMinor: String(x.monthly_stipend_minor), owedMinor: x.owed_text, onboarded30d: Number(x.onboarded_30d ?? 0),
        lastActivityAt: iso(x.last_activity_at), isActive: x.is_active, createdAt: iso(x.created_at) as string,
        _raw: x.created_at_raw,
      } as RosterRow & { _raw: string };
    });
    const last = items[items.length - 1] as (RosterRow & { _raw: string }) | undefined;
    const nextCursor = items.length === q.limit && last
      ? (q.sort === 'owed' ? encodeAmountCursor(last.owedMinor, last.id) : encodeCursor(last._raw, last.id))
      : null;
    for (const it of items) delete (it as Partial<RosterRow & { _raw: string }>)._raw;
    return { items, nextCursor, total: Number(c.rows[0]?.n ?? 0) };
  }

  /** One roster row (the detail page names the person exactly as the roster does). */
  async row(tenantId: string, id: string): Promise<RosterRow | null> {
    return (await this.roster(tenantId, { id, sort: 'recent', limit: 1 })).items[0] ?? null;
  }

  /** W159's four KPI tiles + the tier tabs' counts, in one read. */
  async summary(tenantId: string): Promise<RosterSummary> {
    const db = this.replica.forTenant(tenantId);
    const r = await db.query<any>(
      `SELECT
         (SELECT count(*)::int FROM ambassador_profiles a WHERE a.tenant_id = $1 AND a.deleted_at IS NULL) AS total,
         (SELECT count(*)::int FROM ambassador_profiles a WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.is_active) AS active_count,
         (SELECT count(DISTINCT x.region)::int FROM ambassador_profiles a, jsonb_array_elements_text(a.cluster_region_ids) AS x(region)
           WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.is_active) AS villages_covered,
         (SELECT COALESCE(SUM(e.amount_minor), 0)::text FROM ambassador_earnings e WHERE e.tenant_id = $1 AND e.payout_id IS NULL) AS owed,
         (SELECT count(*)::int FROM referrals rf WHERE rf.tenant_id = $1 AND rf.deleted_at IS NULL AND rf.activated_at >= now() - interval '30 days'
             AND EXISTS (SELECT 1 FROM ambassador_profiles a WHERE a.tenant_id = $1 AND a.user_id = rf.referrer_user_id AND a.deleted_at IS NULL)) AS onboarded_30d,
         (SELECT count(*)::int FROM (SELECT utr.user_id FROM user_tenant_roles utr WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL
             GROUP BY utr.user_id HAVING min(utr.created_at) >= now() - interval '30 days') m) AS new_members_30d,
         (SELECT count(*)::int FROM ambassador_profiles a WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.is_active AND a.kiosk_enabled) AS kiosk_count,
         (SELECT count(*)::int FROM ambassador_profiles a WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.is_active AND a.aeps_enabled) AS aeps_count,
         (SELECT count(*)::int FROM ambassador_profiles a WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.is_active
             AND COALESCE(a.last_activity_at, a.created_at) < now() - make_interval(days => $2)) AS inactive_60d,
         (SELECT COALESCE(json_object_agg(t.code, t.n), '{}'::json) FROM (
             SELECT lv.code, count(*)::int AS n FROM ambassador_profiles a JOIN lookup_values lv ON lv.id = a.tier_id
              WHERE a.tenant_id = $1 AND a.deleted_at IS NULL GROUP BY lv.code) t) AS tier_counts,
         now()::text AS as_of`, [tenantId, INACTIVE_DAYS]);
    const x = r.rows[0] ?? {};
    return {
      activeCount: Number(x.active_count ?? 0), villagesCovered: Number(x.villages_covered ?? 0),
      uncoveredVillages: null, uncoveredReason: 'tenant_village_set_not_recorded',
      owedThisWeekMinor: String(x.owed ?? '0'), owedAsOf: new Date(x.as_of ?? Date.now()).toISOString(),
      onboarded30d: Number(x.onboarded_30d ?? 0), newMembers30d: Number(x.new_members_30d ?? 0),
      kioskCount: Number(x.kiosk_count ?? 0), aepsCount: Number(x.aeps_count ?? 0),
      tierCounts: (x.tier_counts ?? {}) as Record<string, number>, inactive60d: Number(x.inactive_60d ?? 0), total: Number(x.total ?? 0),
    };
  }

  /** The recruit form's member lookup: who this phone belongs to, masked, and whether they can be recruited. */
  async memberByPhone(tenantId: string, phoneE164: string, exec?: SqlExecutor): Promise<MemberCandidate | null> {
    const db = exec ?? this.replica.forTenant(tenantId);
    const r = await db.query<any>(
      `SELECT u.id, u.full_name, u.phone,
              EXISTS (SELECT 1 FROM user_tenant_roles utr WHERE utr.user_id = u.id AND utr.tenant_id = $2 AND utr.is_active AND utr.deleted_at IS NULL) AS is_member,
              (SELECT a.id FROM ambassador_profiles a WHERE a.user_id = u.id AND a.deleted_at IS NULL LIMIT 1) AS ambassador_id
         FROM users u WHERE u.phone = $1 AND u.deleted_at IS NULL`, [phoneE164, tenantId]);
    const x = r.rows[0];
    return x ? { userId: x.id, displayName: shortName(x.full_name), phoneMasked: maskPhone(x.phone ?? ''), isMember: !!x.is_member, ambassadorId: x.ambassador_id ?? null } : null;
  }

  /** Is this lookup value an `ambassador_tier` this tenant can use? */
  async tierKnown(tenantId: string, tierId: string, exec?: SqlExecutor): Promise<boolean> {
    const db = exec ?? this.replica.forTenant(tenantId);
    const r = await db.query(`SELECT 1 FROM lookup_values WHERE id = $1 AND type_code = 'ambassador_tier' AND is_active AND deleted_at IS NULL AND (tenant_id IS NULL OR tenant_id = $2)`, [tierId, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** The cluster ids that name no active admin region. */
  async unknownRegions(tenantId: string, ids: string[], exec?: SqlExecutor): Promise<string[]> {
    if (ids.length === 0) return [];
    const db = exec ?? this.replica.forTenant(tenantId);
    const r = await db.query<{ id: string }>(`SELECT id::text AS id FROM admin_regions WHERE id = ANY($1::uuid[]) AND is_active AND deleted_at IS NULL`, [ids]);
    const known = new Set(r.rows.map((x) => x.id));
    return ids.filter((i) => !known.has(i));
  }
}
