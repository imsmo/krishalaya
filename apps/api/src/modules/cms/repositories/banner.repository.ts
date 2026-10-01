// modules/cms/repositories/banner.repository.ts · banners + banner_texts · PC-56 TENANT-8d (migration 0178).
// tenant_id in every query (Law 1) + RLS (0178: `bn_tenant` / `bt_tenant`, USING + WITH CHECK). Mutations lock the row FOR
// UPDATE; a slot (placement) is locked by a transaction-scoped advisory lock before it is read for a reorder or a join.
// The window is resolved and read back `AT TIME ZONE` the tenant's zone (`tenants.country_code → countries.timezone`,
// 6c-1 / 7c) — never in the Node process's zone. Keyset lists on (created_at DESC, id DESC), the cursor printed BY SQL to
// the microsecond (a JS Date drops the microseconds — 8b's finding).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Banner } from '../domain/banner.entity';
import { BannerState } from '../domain/banner.state';
import { BannerText } from '../domain/banner-rules';
import { MemberFacts, RegionFact, readAudience } from '../domain/banner-audience';
import { BannerPhase, ResolvedInstant } from '../domain/banner-window';
import { SlotEntry } from '../domain/banner-slot';

const COLS = `b.id, b.tenant_id, b.placement, b.media_id, b.language_code, b.target_url, b.audience, b.starts_at, b.ends_at, b.banner_group_key, b.slot_order,
  b.state, b.click_count, b.activated_at, b.activated_by, b.paused_at, b.paused_by, b.paused_reason, b.archived_at, b.archived_by, b.archived_reason,
  b.created_by, b.last_edited_by, b.created_at, b.updated_at, to_char(b.updated_at, 'YYYYMMDDHH24MISSUS') AS version`;

function toDomain(r: any): Banner {
  return Banner.rehydrate({
    id: r.id, tenantId: r.tenant_id, placement: r.placement, mediaId: r.media_id, targetUrl: r.target_url, audience: readAudience(r.audience),
    startsAt: r.starts_at, endsAt: r.ends_at, groupKey: r.banner_group_key, slotOrder: Number(r.slot_order), state: r.state as BannerState,
    clickCount: Number(r.click_count), activatedAt: r.activated_at, activatedBy: r.activated_by, pausedAt: r.paused_at, pausedBy: r.paused_by,
    pausedReason: r.paused_reason, archivedAt: r.archived_at, archivedBy: r.archived_by, archivedReason: r.archived_reason,
    createdBy: r.created_by, lastEditedBy: r.last_edited_by, createdAt: r.created_at, updatedAt: r.updated_at, version: String(r.version),
    legacyLanguageCode: r.language_code ?? null,
  });
}
const textOf = (r: any): BannerText => ({ languageCode: String(r.language_code), headline: String(r.headline), body: r.body ?? null, ctaLabel: r.cta_label ?? null });

/** The phase filter, as SQL over `state` + the window at `now()`. */
const PHASE_SQL: Record<BannerPhase, string> = {
  live: `b.state = 'active' AND b.starts_at <= now() AND b.ends_at > now()`,
  scheduled: `b.state = 'active' AND b.starts_at > now()`,
  ended: `b.state = 'active' AND b.ends_at <= now()`,
  draft: `b.state = 'draft'`, paused: `b.state = 'paused'`, archived: `b.state = 'archived'`,
};

export interface BannerListQuery { phase?: BannerPhase; placement?: string; languageCode?: string; cursor?: { c: string; id: string }; limit: number }
export interface BannerRowExtras { timezone: string; startsLocal: { date: string; time: string }; endsLocal: { date: string; time: string } }
export interface BannerListRow extends BannerRowExtras { banner: Banner; texts: BannerText[] }
export interface MediaFact { id: string; s3Key: string; mimeType: string; kind: string; scanStatus: string }

@Injectable()
export class BannerRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: TxContext) { return tx ?? this.replica.forTenant(tenantId); }

  /* ---- locks ---- */
  async lockSlot(tx: TxContext, tenantId: string, placement: string): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`cms_banner_slot|${tenantId}|${placement}`]);
  }

  /* ---- the row ---- */
  async insert(tx: TxContext, b: Banner, createdBy: string): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO banners (id, tenant_id, placement, media_id, target_url, audience, starts_at, ends_at, banner_group_key, slot_order, state, created_by, updated_by, last_edited_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,'draft',$11,$11,$11)`,
      [p.id, p.tenantId, p.placement, p.mediaId, p.targetUrl, JSON.stringify(p.audience), p.startsAt, p.endsAt, p.groupKey, p.slotOrder, createdBy]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Banner | null> {
    const r = await tx.query(`SELECT ${COLS} FROM banners b WHERE b.id=$1 AND b.tenant_id=$2 AND b.deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<(BannerRowExtras & { banner: Banner }) | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT ${COLS}, co.timezone,
              to_char(b.starts_at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS s_date, to_char(b.starts_at AT TIME ZONE co.timezone, 'HH24:MI') AS s_time,
              to_char(b.ends_at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS e_date, to_char(b.ends_at AT TIME ZONE co.timezone, 'HH24:MI') AS e_time
         FROM banners b JOIN tenants t ON t.id = b.tenant_id JOIN countries co ON co.code = t.country_code
        WHERE b.id=$1 AND b.tenant_id=$2 AND b.deleted_at IS NULL`, [id, tenantId]);
    const x = r.rows[0];
    return x ? { banner: toDomain(x), timezone: x.timezone, startsLocal: { date: x.s_date, time: x.s_time }, endsLocal: { date: x.e_date, time: x.e_time } } : null;
  }
  /** The content of a banner (not its state): placement, image, link, audience, window, group, place. */
  async updateContent(tx: TxContext, b: Banner, userId: string): Promise<number> {
    const p = b.toProps();
    const r = await tx.query(
      `UPDATE banners SET placement=$3, media_id=$4, target_url=$5, audience=$6::jsonb, starts_at=$7, ends_at=$8, banner_group_key=$9, slot_order=$10,
              updated_at=now(), updated_by=$11
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.placement, p.mediaId, p.targetUrl, JSON.stringify(p.audience), p.startsAt, p.endsAt, p.groupKey, p.slotOrder, userId]);
    return r.rowCount ?? 0;
  }
  /** A state move with its facts (the entity made the move; banners_guard re-takes the machine). */
  async updateState(tx: TxContext, b: Banner, userId: string): Promise<number> {
    const p = b.toProps();
    const r = await tx.query(
      `UPDATE banners SET state=$3, activated_at=$4, activated_by=$5, paused_at=$6, paused_by=$7, paused_reason=$8, archived_at=$9, archived_by=$10, archived_reason=$11,
              updated_at=now(), updated_by=$12
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.state, p.activatedAt, p.activatedBy, p.pausedAt, p.pausedBy, p.pausedReason, p.archivedAt, p.archivedBy, p.archivedReason, userId]);
    return r.rowCount ?? 0;
  }

  /* ---- the words ---- */
  async textsOf(tenantId: string, bannerId: string, tx?: TxContext): Promise<BannerText[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT language_code, headline, body, cta_label FROM banner_texts WHERE tenant_id=$1 AND banner_id=$2 AND deleted_at IS NULL ORDER BY language_code`, [tenantId, bannerId]);
    return r.rows.map(textOf);
  }
  async textsFor(tenantId: string, ids: readonly string[], tx?: TxContext): Promise<Map<string, BannerText[]>> {
    const out = new Map<string, BannerText[]>();
    if (ids.length === 0) return out;
    const r = await this.on(tenantId, tx).query(
      `SELECT banner_id, language_code, headline, body, cta_label FROM banner_texts WHERE tenant_id=$1 AND banner_id = ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY language_code`, [tenantId, ids]);
    for (const x of r.rows) out.set(String(x.banner_id), [...(out.get(String(x.banner_id)) ?? []), textOf(x)]);
    return out;
  }
  /** The banner's words become exactly `texts`: upsert each language, remove the languages no longer there. */
  async replaceTexts(tx: TxContext, tenantId: string, bannerId: string, texts: readonly BannerText[], userId: string): Promise<void> {
    const keep = texts.map((t) => t.languageCode);
    await tx.query(`DELETE FROM banner_texts WHERE tenant_id=$1 AND banner_id=$2 AND NOT (language_code = ANY($3::varchar[]))`, [tenantId, bannerId, keep]);
    for (const t of texts) {
      await tx.query(
        `INSERT INTO banner_texts (tenant_id, banner_id, language_code, headline, body, cta_label, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (banner_id, language_code) DO UPDATE SET headline=EXCLUDED.headline, body=EXCLUDED.body, cta_label=EXCLUDED.cta_label, updated_at=now(), updated_by=EXCLUDED.updated_by`,
        [tenantId, bannerId, t.languageCode, t.headline, t.body, t.ctaLabel, userId]);
    }
  }

  /* ---- the checks 0178 owns (one source for the review, the act and the trigger) ---- */
  async activationRefusals(tenantId: string, bannerId: string, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(`SELECT banner_activation_refusals($1::uuid) AS r`, [bannerId]);
    return (r.rows[0]?.r ?? []) as string[];
  }
  async mediaIssue(tenantId: string, mediaId: string, tx?: TxContext): Promise<string | null> {
    const r = await this.on(tenantId, tx).query(`SELECT banner_media_issue($1::uuid, $2::uuid) AS i`, [tenantId, mediaId]);
    return (r.rows[0]?.i ?? null) as string | null;
  }
  async audienceIssues(tenantId: string, audience: unknown, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(`SELECT banner_audience_issues($1::uuid, $2::jsonb) AS i`, [tenantId, JSON.stringify(audience)]);
    return (r.rows[0]?.i ?? []) as string[];
  }
  async requiredLanguages(tenantId: string, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(`SELECT banner_required_languages() AS l`);
    return (r.rows[0]?.l ?? []) as string[];
  }
  /** The image the console prints (its key and scan status) — the cooperative's own only. */
  async mediaFacts(tenantId: string, ids: readonly string[], tx?: TxContext): Promise<Map<string, MediaFact>> {
    const out = new Map<string, MediaFact>();
    if (ids.length === 0) return out;
    const r = await this.on(tenantId, tx).query(
      `SELECT id, s3_key, mime_type, kind, scan_status FROM media_assets WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`, [tenantId, ids]);
    for (const x of r.rows) out.set(String(x.id), { id: String(x.id), s3Key: String(x.s3_key), mimeType: String(x.mime_type), kind: String(x.kind), scanStatus: String(x.scan_status) });
    return out;
  }
  /** The cooperative's own clean images, newest first — the form's picker (bounded). */
  async cleanImages(tenantId: string, limit = 50, tx?: TxContext): Promise<MediaFact[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT id, s3_key, mime_type, kind, scan_status FROM media_assets WHERE tenant_id=$1 AND kind='image' AND scan_status='clean' AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => ({ id: String(x.id), s3Key: String(x.s3_key), mimeType: String(x.mime_type), kind: String(x.kind), scanStatus: String(x.scan_status) }));
  }

  /* ---- the registries ---- */
  async placements(tenantId: string, tx?: TxContext): Promise<Array<{ code: string; name: string; chosen: boolean; legacy: boolean; sortOrder: number }>> {
    const r = await this.on(tenantId, tx).query(
      `SELECT code, default_name, meta, sort_order, tenant_id FROM lookup_values
        WHERE type_code='cms_banner_placement' AND (tenant_id IS NULL OR tenant_id=$1) AND is_active AND deleted_at IS NULL ORDER BY sort_order, code`, [tenantId]);
    return r.rows.map((x: any) => ({ code: String(x.code), name: String(x.default_name), chosen: (x.meta?.chosen ?? true) !== false, legacy: x.meta?.legacy === true, sortOrder: Number(x.sort_order) }));
  }
  async tenantRoles(tenantId: string, tx?: TxContext): Promise<Array<{ code: string; name: string }>> {
    const r = await this.on(tenantId, tx).query(`SELECT code, default_name FROM roles WHERE scope='tenant' AND is_active AND deleted_at IS NULL ORDER BY code`);
    return r.rows.map((x: any) => ({ code: String(x.code), name: String(x.default_name) }));
  }
  /** Regions by id, in the tenant's country (validation and printing). */
  async regionsByIds(tenantId: string, ids: readonly string[], tx?: TxContext): Promise<RegionFact[]> {
    const valid = ids.filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x));
    if (valid.length === 0) return [];
    const r = await this.on(tenantId, tx).query(
      `SELECT g.id, g.path::text AS path, g.default_name, g.level FROM admin_regions g JOIN tenants t ON t.country_code = g.country_code
        WHERE t.id=$1 AND g.id = ANY($2::uuid[]) AND g.is_active AND g.deleted_at IS NULL`, [tenantId, valid]);
    return r.rows.map((x: any) => ({ id: String(x.id), path: String(x.path), name: String(x.default_name), level: Number(x.level) }));
  }
  /** The regions the form offers: states, districts and talukas of the tenant's country (villages are named by id). */
  async regionChoices(tenantId: string, tx?: TxContext): Promise<RegionFact[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT g.id, g.path::text AS path, g.default_name, g.level FROM admin_regions g JOIN tenants t ON t.country_code = g.country_code
        WHERE t.id=$1 AND g.level <= 3 AND g.is_active AND g.deleted_at IS NULL ORDER BY g.path LIMIT 500`, [tenantId]);
    return r.rows.map((x: any) => ({ id: String(x.id), path: String(x.path), name: String(x.default_name), level: Number(x.level) }));
  }
  async tenantLanguages(tenantId: string, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT tl.language_code FROM tenant_languages tl JOIN languages lg ON lg.code = tl.language_code
        WHERE tl.tenant_id=$1 AND lg.is_active AND lg.deleted_at IS NULL ORDER BY tl.is_default DESC, lg.sort_order, tl.language_code`, [tenantId]);
    return r.rows.map((x: any) => String(x.language_code));
  }
  async languageNames(tenantId: string, tx?: TxContext): Promise<Array<{ code: string; nameEnglish: string; nameNative: string }>> {
    const r = await this.on(tenantId, tx).query(`SELECT code, name_english, name_native FROM languages WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: String(x.code), nameEnglish: String(x.name_english), nameNative: String(x.name_native) }));
  }

  /* ---- the window, in the tenant's zone ---- */
  /** Typed wall-clocks (`YYYY-MM-DD HH:MM`, already shape-checked) → instants AT TIME ZONE the tenant's, and how each reads back. */
  async resolveWindow(tenantId: string, starts: string | null, ends: string | null, tx?: TxContext): Promise<{ timezone: string | null; startsAt: ResolvedInstant | null; endsAt: ResolvedInstant | null }> {
    const r = await this.on(tenantId, tx).query(
      `SELECT co.timezone, s.at AS s_at, to_char(s.at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS s_date, to_char(s.at AT TIME ZONE co.timezone, 'HH24:MI') AS s_time,
              e.at AS e_at, to_char(e.at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS e_date, to_char(e.at AT TIME ZONE co.timezone, 'HH24:MI') AS e_time
         FROM tenants t JOIN countries co ON co.code = t.country_code
         CROSS JOIN LATERAL (SELECT CASE WHEN $2::text IS NULL THEN NULL ELSE ($2::text)::timestamp AT TIME ZONE co.timezone END AS at) s
         CROSS JOIN LATERAL (SELECT CASE WHEN $3::text IS NULL THEN NULL ELSE ($3::text)::timestamp AT TIME ZONE co.timezone END AS at) e
        WHERE t.id = $1`, [tenantId, starts, ends]);
    const x = r.rows[0];
    if (!x) return { timezone: null, startsAt: null, endsAt: null };
    const inst = (at: Date | null, d: string, t: string): ResolvedInstant | null => (at ? { at, localDate: d, localTime: t } : null);
    return { timezone: x.timezone, startsAt: inst(x.s_at, x.s_date, x.s_time), endsAt: inst(x.e_at, x.e_date, x.e_time) };
  }
  async timezoneOf(tenantId: string, tx?: TxContext): Promise<string | null> {
    const r = await this.on(tenantId, tx).query(`SELECT co.timezone FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id=$1`, [tenantId]);
    return r.rows[0]?.timezone ?? null;
  }

  /* ---- the slot ---- */
  async slotEntries(tenantId: string, placement: string, tx?: TxContext): Promise<SlotEntry[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT id, slot_order FROM banners WHERE tenant_id=$1 AND placement=$2 AND state <> 'archived' AND deleted_at IS NULL ORDER BY slot_order, id`, [tenantId, placement]);
    return r.rows.map((x: any) => ({ id: String(x.id), slotOrder: Number(x.slot_order) }));
  }
  async slotForUpdate(tx: TxContext, tenantId: string, placement: string): Promise<SlotEntry[]> {
    const r = await tx.query(
      `SELECT id, slot_order FROM banners WHERE tenant_id=$1 AND placement=$2 AND state <> 'archived' AND deleted_at IS NULL ORDER BY slot_order, id FOR UPDATE`, [tenantId, placement]);
    return r.rows.map((x: any) => ({ id: String(x.id), slotOrder: Number(x.slot_order) }));
  }
  async setSlot(tx: TxContext, tenantId: string, id: string, to: number, userId: string): Promise<void> {
    await tx.query(`UPDATE banners SET slot_order=$3, updated_at=now(), updated_by=$4 WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId, to, userId]);
  }

  /* ---- reads ---- */
  async list(tenantId: string, q: BannerListQuery): Promise<BannerListRow[]> {
    const params: unknown[] = [tenantId]; let where = `b.tenant_id=$1 AND b.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.phase) where += ` AND ${PHASE_SQL[q.phase]}`;
    if (q.placement) where += ` AND b.placement=${p(q.placement)}`;
    if (q.languageCode) where += ` AND EXISTS (SELECT 1 FROM banner_texts t WHERE t.banner_id=b.id AND t.tenant_id=b.tenant_id AND t.language_code=${p(q.languageCode)} AND t.deleted_at IS NULL)`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (b.created_at < ${cc}::timestamptz OR (b.created_at = ${cc}::timestamptz AND b.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS}, co.timezone, to_char(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS cursor_at,
              to_char(b.starts_at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS s_date, to_char(b.starts_at AT TIME ZONE co.timezone, 'HH24:MI') AS s_time,
              to_char(b.ends_at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS e_date, to_char(b.ends_at AT TIME ZONE co.timezone, 'HH24:MI') AS e_time
         FROM banners b JOIN tenants t ON t.id = b.tenant_id JOIN countries co ON co.code = t.country_code
        WHERE ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT ${lp}`, params);
    const texts = await this.textsFor(tenantId, r.rows.map((x: any) => String(x.id)));
    return r.rows.map((x: any) => ({
      banner: toDomain(x), texts: texts.get(String(x.id)) ?? [], timezone: x.timezone, cursorAt: x.cursor_at,
      startsLocal: { date: x.s_date, time: x.s_time }, endsLocal: { date: x.e_date, time: x.e_time },
    }) as BannerListRow & { cursorAt: string });
  }
  /** W173's chips: how many banners in each phase (and each placement), live. */
  async counts(tenantId: string): Promise<{ byPhase: Record<string, number>; byPlacement: Record<string, number>; total: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT CASE WHEN b.state <> 'active' THEN b.state WHEN b.starts_at > now() THEN 'scheduled' WHEN b.ends_at <= now() THEN 'ended' ELSE 'live' END AS phase,
              b.placement, count(*)::int AS n
         FROM banners b WHERE b.tenant_id=$1 AND b.deleted_at IS NULL GROUP BY 1, 2`, [tenantId]);
    const byPhase: Record<string, number> = {}; const byPlacement: Record<string, number> = {}; let total = 0;
    for (const x of r.rows) { byPhase[x.phase] = (byPhase[x.phase] ?? 0) + x.n; byPlacement[x.placement] = (byPlacement[x.placement] ?? 0) + x.n; total += x.n; }
    return { byPhase, byPlacement, total };
  }
  /** The banners live NOW, in slot order — what a member's app would be offered (before the audience is applied). */
  async liveNow(tenantId: string, placement: string | undefined, limit: number): Promise<Banner[]> {
    const params: unknown[] = [tenantId, limit];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM banners b WHERE b.tenant_id=$1 AND b.deleted_at IS NULL AND ${PHASE_SQL.live}${placement ? ` AND b.placement=$3` : ''}
        ORDER BY b.placement, b.slot_order, b.id LIMIT $2`, placement ? [...params, placement] : params);
    return r.rows.map(toDomain);
  }
  async groupSiblings(tenantId: string, groupKey: string, excludeId: string | null): Promise<Array<{ id: string; placement: string; state: BannerState; mediaId: string; languages: string[] }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT b.id, b.placement, b.state, b.media_id,
              COALESCE((SELECT array_agg(t.language_code ORDER BY t.language_code) FROM banner_texts t WHERE t.banner_id=b.id AND t.deleted_at IS NULL), '{}') AS langs
         FROM banners b WHERE b.tenant_id=$1 AND b.banner_group_key=$2 AND b.deleted_at IS NULL AND ($3::uuid IS NULL OR b.id <> $3::uuid)
        ORDER BY b.created_at, b.id LIMIT 50`, [tenantId, groupKey, excludeId]);
    return r.rows.map((x: any) => ({ id: String(x.id), placement: String(x.placement), state: x.state as BannerState, mediaId: String(x.media_id), languages: x.langs as string[] }));
  }
  async userNames(tenantId: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
    const out = new Map<string, string>();
    if (valid.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [valid]);
    for (const x of r.rows) if (x.full_name) out.set(String(x.id), String(x.full_name));
    return out;
  }

  /* ---- the members the evaluator reads (W174's reach; the live box's caller) ---- */
  /** Active members of the tenant: role codes, the paths of their addresses' regions, the language they read. Bounded. */
  async memberFacts(tenantId: string, limit: number, userId?: string): Promise<MemberFacts[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT u.id, u.language_code,
              array_agg(DISTINCT r.code) AS roles,
              COALESCE(array_agg(DISTINCT g.path::text) FILTER (WHERE g.path IS NOT NULL), '{}') AS paths
         FROM user_tenant_roles utr
         JOIN users u ON u.id = utr.user_id AND u.deleted_at IS NULL
         JOIN roles r ON r.id = utr.role_id
         LEFT JOIN addresses a ON a.user_id = u.id AND a.deleted_at IS NULL AND (a.tenant_id IS NULL OR a.tenant_id = utr.tenant_id)
         LEFT JOIN admin_regions g ON g.id = a.region_id
        WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL ${userId ? 'AND u.id = $3::uuid' : ''}
        GROUP BY u.id, u.language_code ORDER BY u.id LIMIT $2`, userId ? [tenantId, limit, userId] : [tenantId, limit]);
    return r.rows.map((x: any) => ({ userId: String(x.id), roles: x.roles as string[], regionPaths: x.paths as string[], languageCode: x.language_code ?? null }));
  }

  /** Atomic click increment — only on a banner that is LIVE (an archived or paused banner accrues nothing). */
  async incrementClick(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE banners b SET click_count = click_count + 1 WHERE b.id=$1 AND b.tenant_id=$2 AND b.deleted_at IS NULL AND ${PHASE_SQL.live}`, [id, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
}
