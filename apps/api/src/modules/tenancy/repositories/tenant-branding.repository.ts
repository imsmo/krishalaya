// modules/tenancy/repositories/tenant-branding.repository.ts · PC-56 TENANT-13d · SQL for W191 (0194): tenant_branding,
// tenant_branding_history, tenant_branding_proposals, the logo's media row, and the tenants sync. tenant_id in EVERY query (Law 1) + RLS
// (0175 split shape). Every write runs inside the caller's unit of work as kv_app; the publication pointer, the history row and the
// tenants columns move ONLY in the transaction that confirms a proposal (0194's triggers refuse anything else).
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { BrandDraftValues } from '../domain/brand-rules';
import { BrandProposalStatus } from '../domain/brand-domain.state';

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface BrandRow extends BrandDraftValues {
  id: string; tenantId: string; status: 'draft' | 'published'; version: number; draftRevision: number;
  publishedAt: string | null; publishedBy: string | null; checkerUserId: string | null; updatedAt: string; updatedBy: string | null;
}
export interface BrandSnapshot extends BrandDraftValues { logoMime: 'image/png' | 'image/svg+xml' }
export interface BrandHistoryRow extends BrandSnapshot {
  id: string; version: number; kind: 'publish' | 'rollback'; rolledBackTo: number | null; contrast: unknown; contrastMin: number;
  proposalId: string; proposedBy: string; proposedByName: string | null; confirmedBy: string; confirmedByName: string | null;
  reason: string; publishedAt: string; cursorTs: string;
}
export interface BrandProposalRow extends BrandSnapshot {
  id: string; tenantId: string; kind: 'publish' | 'rollback'; publishesVersion: number; rollbackTo: number | null;
  contrast: unknown; contrastMin: number; draftRevision: number; reason: string;
  proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string; status: BrandProposalStatus;
  confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null; cursorTs: string;
}
export interface LogoMedia { id: string; tenantId: string | null; mime: string; scanStatus: string; kind: string; s3Key: string; bytes: number; deleted: boolean }

const BRAND_COLS = `b.id, b.tenant_id, b.display_name, b.app_short_name, b.logo_media_id, b.primary_color, b.accent_color, b.ink_color,
  b.surface_color, b.powered_by_hidden, b.status, b.version, b.draft_revision, ${iso('b.published_at')} AS published_at, b.published_by,
  b.checker_user_id, ${iso('b.updated_at')} AS updated_at, b.updated_by`;
const SNAP = (a: string) => `${a}.display_name, ${a}.app_short_name, ${a}.logo_media_id, ${a}.logo_mime, ${a}.primary_color, ${a}.accent_color,
  ${a}.ink_color, ${a}.surface_color, ${a}.powered_by_hidden`;

function brandOf(r: any): BrandRow {
  return {
    id: r.id, tenantId: r.tenant_id, displayName: r.display_name, appShortName: r.app_short_name, logoMediaId: r.logo_media_id ?? null,
    colours: { primary: r.primary_color, accent: r.accent_color, ink: r.ink_color, surface: r.surface_color },
    poweredByHidden: r.powered_by_hidden === true, status: r.status, version: Number(r.version), draftRevision: Number(r.draft_revision),
    publishedAt: r.published_at ?? null, publishedBy: r.published_by ?? null, checkerUserId: r.checker_user_id ?? null,
    updatedAt: r.updated_at, updatedBy: r.updated_by ?? null,
  };
}
function snapOf(r: any): BrandSnapshot {
  return {
    displayName: r.display_name, appShortName: r.app_short_name, logoMediaId: r.logo_media_id, logoMime: r.logo_mime,
    colours: { primary: r.primary_color, accent: r.accent_color, ink: r.ink_color, surface: r.surface_color }, poweredByHidden: r.powered_by_hidden === true,
  };
}
function historyOf(r: any): BrandHistoryRow {
  return {
    ...snapOf(r), id: r.id, version: Number(r.version), kind: r.kind, rolledBackTo: r.rolled_back_to === null ? null : Number(r.rolled_back_to),
    contrast: r.contrast, contrastMin: Number(r.contrast_min), proposalId: r.proposal_id, proposedBy: r.proposed_by, proposedByName: r.proposed_by_name ?? null,
    confirmedBy: r.confirmed_by, confirmedByName: r.confirmed_by_name ?? null, reason: r.reason, publishedAt: r.published_at, cursorTs: r.cursor_ts,
  };
}
function proposalOf(r: any): BrandProposalRow {
  return {
    ...snapOf(r), id: r.id, tenantId: r.tenant_id, kind: r.kind, publishesVersion: Number(r.publishes_version),
    rollbackTo: r.rollback_to === null ? null : Number(r.rollback_to), contrast: r.contrast, contrastMin: Number(r.contrast_min),
    draftRevision: Number(r.draft_revision), reason: r.reason, proposedBy: r.proposed_by, proposedByName: r.proposed_by_name ?? null,
    proposedAt: r.proposed_at, expiresAt: r.expires_at, status: r.status, confirmedBy: r.confirmed_by ?? null, confirmedByName: r.confirmed_by_name ?? null,
    confirmedAt: r.confirmed_at ?? null, refusedBy: r.refused_by ?? null, refusedAt: r.refused_at ?? null, refuseReason: r.refuse_reason ?? null,
    expiredAt: r.expired_at ?? null, cursorTs: r.cursor_ts,
  };
}
const PROPOSAL_SELECT = `SELECT p.id, p.tenant_id, p.kind, p.publishes_version, p.rollback_to, ${SNAP('p')}, p.contrast, p.contrast_min, p.draft_revision,
  p.reason, p.proposed_by, pu.full_name AS proposed_by_name, ${iso('p.proposed_at')} AS proposed_at, ${iso('p.expires_at')} AS expires_at, p.status,
  p.confirmed_by, cu.full_name AS confirmed_by_name, ${iso('p.confirmed_at')} AS confirmed_at, p.refused_by, ${iso('p.refused_at')} AS refused_at,
  p.refuse_reason, ${iso('p.expired_at')} AS expired_at, ${US_SQL('p.created_at')} AS cursor_ts
  FROM tenant_branding_proposals p LEFT JOIN users pu ON pu.id = p.proposed_by LEFT JOIN users cu ON cu.id = p.confirmed_by`;
const HISTORY_SELECT = `SELECT h.id, h.version, h.kind, h.rolled_back_to, ${SNAP('h')}, h.contrast, h.contrast_min, h.proposal_id, h.proposed_by,
  pu.full_name AS proposed_by_name, h.confirmed_by, cu.full_name AS confirmed_by_name, h.reason, ${iso('h.published_at')} AS published_at,
  ${US_SQL('h.published_at')} AS cursor_ts
  FROM tenant_branding_history h LEFT JOIN users pu ON pu.id = h.proposed_by LEFT JOIN users cu ON cu.id = h.confirmed_by`;

@Injectable()
export class TenantBrandingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ---- reads -------------------------------------------------------------------------------------------------------------- */

  async brand(tenantId: string, tx?: SqlExecutor, forUpdate = false): Promise<BrandRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${BRAND_COLS} FROM tenant_branding b WHERE b.tenant_id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [tenantId]);
    return r.rows[0] ? brandOf(r.rows[0]) : null;
  }
  async tenantFacts(tenantId: string, tx?: SqlExecutor): Promise<{ displayName: string; slug: string; logoUrl: string | null } | null> {
    const r = await this.on(tenantId, tx).query(`SELECT display_name, slug, logo_url FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows[0] ? { displayName: r.rows[0].display_name, slug: r.rows[0].slug, logoUrl: r.rows[0].logo_url ?? null } : null;
  }
  async logo(tenantId: string, mediaId: string, tx?: SqlExecutor): Promise<LogoMedia | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT id, tenant_id, mime_type, scan_status, kind, s3_key, bytes, deleted_at FROM media_assets WHERE id = $1 AND tenant_id = $2`, [mediaId, tenantId]);
    const x = r.rows[0];
    return x ? { id: x.id, tenantId: x.tenant_id, mime: x.mime_type, scanStatus: x.scan_status, kind: x.kind, s3Key: x.s3_key, bytes: Number(x.bytes), deleted: x.deleted_at !== null } : null;
  }
  async history(tenantId: string, version: number, tx?: SqlExecutor): Promise<BrandHistoryRow | null> {
    const r = await this.on(tenantId, tx).query(`${HISTORY_SELECT} WHERE h.tenant_id = $1 AND h.version = $2`, [tenantId, version]);
    return r.rows[0] ? historyOf(r.rows[0]) : null;
  }
  async listHistory(tenantId: string, cursor: KeysetCursor | undefined, limit: number): Promise<BrandHistoryRow[]> {
    const params: unknown[] = [tenantId]; let where = 'h.tenant_id = $1';
    if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (h.published_at, h.id) < ($2::timestamptz, $3::uuid)`; }
    params.push(limit);
    const r = await this.on(tenantId).query(`${HISTORY_SELECT} WHERE ${where} ORDER BY h.published_at DESC, h.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(historyOf);
  }
  async proposal(tenantId: string, id: string, tx?: SqlExecutor, forUpdate = false): Promise<BrandProposalRow | null> {
    const r = await this.on(tenantId, tx).query(`${PROPOSAL_SELECT} WHERE p.tenant_id = $1 AND p.id = $2${forUpdate ? ' FOR UPDATE OF p' : ''}`, [tenantId, id]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }
  async liveProposal(tenantId: string, tx?: SqlExecutor): Promise<BrandProposalRow | null> {
    const r = await this.on(tenantId, tx).query(`${PROPOSAL_SELECT} WHERE p.tenant_id = $1 AND p.status = 'proposed' LIMIT 1`, [tenantId]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }
  async listProposals(tenantId: string, cursor: KeysetCursor | undefined, limit: number): Promise<BrandProposalRow[]> {
    const params: unknown[] = [tenantId]; let where = 'p.tenant_id = $1';
    if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (p.created_at, p.id) < ($2::timestamptz, $3::uuid)`; }
    params.push(limit);
    const r = await this.on(tenantId).query(`${PROPOSAL_SELECT} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(proposalOf);
  }
  /** A plan feature read for real (0194 `kv_plan_feature`: override → subscription plan → false), with the plan code for the banner. */
  async planFeature(tenantId: string, code: string, tx?: SqlExecutor): Promise<{ enabled: boolean; planCode: string | null }> {
    const r = await this.on(tenantId, tx).query(
      `SELECT kv_plan_feature($1, $2) AS enabled,
              (SELECT p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.status IN ('trialing', 'active', 'past_due')
                ORDER BY s.created_at DESC LIMIT 1) AS plan_code`, [tenantId, code]);
    return { enabled: r.rows[0]?.enabled === true, planCode: r.rows[0]?.plan_code ?? null };
  }
  /** The cheapest public plans that include a feature — the banner's "<plan>" (read, never hard-coded). */
  async plansWith(tenantId: string, code: string): Promise<string[]> {
    const r = await this.on(tenantId).query(
      `SELECT p.code FROM plan_features pf JOIN plans p ON p.id = pf.plan_id
        WHERE pf.feature_code = $1 AND pf.is_included AND p.is_public AND p.is_active ORDER BY p.monthly_price_minor, p.code`, [code]);
    return r.rows.map((x: any) => String(x.code));
  }
  async platformSetting(tenantId: string, key: string, tx?: SqlExecutor): Promise<unknown> {
    const r = await this.on(tenantId, tx).query(`SELECT kv_platform_setting($1) AS v`, [key]);
    return r.rows[0]?.v ?? null;
  }

  /* ---- the draft ---------------------------------------------------------------------------------------------------------- */

  async insertDraftTx(tx: TxContext, tenantId: string, v: BrandDraftValues, userId: string): Promise<void> {
    await tx.query(
      `INSERT INTO tenant_branding (tenant_id, display_name, app_short_name, logo_media_id, primary_color, accent_color, ink_color, surface_color,
                                    powered_by_hidden, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tenantId, v.displayName, v.appShortName, v.logoMediaId, v.colours.primary, v.colours.accent, v.colours.ink, v.colours.surface, v.poweredByHidden, userId]);
  }
  /** An edit of the working copy: the brand returns to `draft` (members keep seeing the published version) and its revision moves. */
  async updateDraftTx(tx: TxContext, tenantId: string, v: BrandDraftValues, userId: string, status: 'draft' | 'published' = 'draft'): Promise<number> {
    const r = await tx.query(
      `UPDATE tenant_branding SET display_name=$2, app_short_name=$3, logo_media_id=$4, primary_color=$5, accent_color=$6, ink_color=$7,
              surface_color=$8, powered_by_hidden=$9, status=$11, draft_revision = draft_revision + 1, updated_by=$10, updated_at=now()
        WHERE tenant_id=$1 RETURNING draft_revision`,
      [tenantId, v.displayName, v.appShortName, v.logoMediaId, v.colours.primary, v.colours.accent, v.colours.ink, v.colours.surface, v.poweredByHidden, userId, status]);
    return Number(r.rows[0]?.draft_revision ?? 0);
  }
  async insertLogoMediaTx(tx: TxContext, m: { id: string; tenantId: string; userId: string; s3Key: string; mime: string; bytes: number; sha256: string; width: number; height: number }): Promise<void> {
    // born `pending`: the antivirus scan (the media plane's HMAC-signed callback) decides when it becomes `clean` — a publish needs `clean`
    await tx.query(
      `INSERT INTO media_assets (id, tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, width, height, scan_status, created_by)
       VALUES ($1,$2,$3,'image',$4,$5,$6,$7,$8,$9,'pending',$3)`,
      [m.id, m.tenantId, m.userId, m.s3Key, m.mime, m.bytes, m.sha256, Math.round(m.width), Math.round(m.height)]);
  }

  /* ---- proposals and the publish transaction --------------------------------------------------------------------------- */

  async insertProposalTx(tx: TxContext, p: {
    tenantId: string; kind: 'publish' | 'rollback'; publishesVersion: number; rollbackTo: number | null; snap: BrandSnapshot;
    contrast: unknown; contrastMin: number; draftRevision: number; reason: string; proposedBy: string;
  }): Promise<string> {
    const s = p.snap;
    const r = await tx.query(
      `INSERT INTO tenant_branding_proposals (tenant_id, kind, publishes_version, rollback_to, display_name, app_short_name, logo_media_id, logo_mime,
              primary_color, accent_color, ink_color, surface_color, powered_by_hidden, contrast, contrast_min, draft_revision, reason, proposed_by,
              proposed_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18, now(), now() + interval '7 days') RETURNING id`,
      [p.tenantId, p.kind, p.publishesVersion, p.rollbackTo, s.displayName, s.appShortName, s.logoMediaId, s.logoMime, s.colours.primary, s.colours.accent,
       s.colours.ink, s.colours.surface, s.poweredByHidden, JSON.stringify(p.contrast), p.contrastMin, p.draftRevision, p.reason, p.proposedBy]);
    return r.rows[0].id;
  }
  async confirmTx(tx: TxContext, tenantId: string, id: string, checker: string): Promise<void> {
    await tx.query(`UPDATE tenant_branding_proposals SET status='confirmed', confirmed_by=$3, confirmed_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, checker]);
  }
  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE tenant_branding_proposals SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, reason]);
  }
  async expireTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`UPDATE tenant_branding_proposals SET status='expired', expired_at=now() WHERE id=$1 AND tenant_id=$2 AND status='proposed' AND expires_at <= now()`, [id, tenantId]);
    return (r.rowCount ?? 0) === 1;
  }
  /** Cite the proposal for 0194's gates (tenant_branding, tenant_branding_history, tenants) — local to this transaction. */
  async citeProposalTx(tx: TxContext, id: string): Promise<void> {
    await tx.query(`SELECT set_config('app.brand_proposal_id', $1, true)`, [id]);
  }
  async insertHistoryTx(tx: TxContext, p: BrandProposalRow): Promise<string> {
    const s = p;
    const r = await tx.query(
      `INSERT INTO tenant_branding_history (tenant_id, version, kind, rolled_back_to, display_name, app_short_name, logo_media_id, logo_mime, primary_color,
              accent_color, ink_color, surface_color, powered_by_hidden, contrast, contrast_min, proposal_id, proposed_by, confirmed_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19) RETURNING id`,
      [p.tenantId, p.publishesVersion, p.kind, p.rollbackTo, s.displayName, s.appShortName, s.logoMediaId, s.logoMime, s.colours.primary, s.colours.accent,
       s.colours.ink, s.colours.surface, s.poweredByHidden, JSON.stringify(p.contrast), p.contrastMin, p.id, p.proposedBy, p.confirmedBy, p.reason]);
    return r.rows[0].id;
  }
  /**
   * Move the publication pointer to the confirmed proposal's version. A ROLLBACK also replaces the working copy with the rolled-back
   * values (the next publish must not silently re-publish what was rolled back); a PUBLISH leaves the working copy and marks the brand
   * `published` only when the working copy IS what was published.
   */
  async publishPointerTx(tx: TxContext, p: BrandProposalRow, workingCopyMatches: boolean): Promise<void> {
    if (p.kind === 'rollback') {
      await tx.query(
        `UPDATE tenant_branding SET display_name=$2, app_short_name=$3, logo_media_id=$4, primary_color=$5, accent_color=$6, ink_color=$7, surface_color=$8,
                powered_by_hidden=$9, status='published', version=$10, published_at=now(), published_by=$11, checker_user_id=$12,
                draft_revision = draft_revision + 1, updated_at=now()
          WHERE tenant_id=$1`,
        [p.tenantId, p.displayName, p.appShortName, p.logoMediaId, p.colours.primary, p.colours.accent, p.colours.ink, p.colours.surface, p.poweredByHidden,
         p.publishesVersion, p.proposedBy, p.confirmedBy]);
      return;
    }
    await tx.query(
      `UPDATE tenant_branding SET status=$2, version=$3, published_at=now(), published_by=$4, checker_user_id=$5, updated_at=now() WHERE tenant_id=$1`,
      [p.tenantId, workingCopyMatches ? 'published' : 'draft', p.publishesVersion, p.proposedBy, p.confirmedBy]);
  }
  /** tenants.display_name / tenants.logo_url — what the storefront and the document headers read — kept in sync, in the publish tx. */
  async syncTenantTx(tx: TxContext, tenantId: string, displayName: string, logoUrl: string | null): Promise<{ before: { displayName: string; logoUrl: string | null } }> {
    const b = await tx.query(`SELECT display_name, logo_url FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    await tx.query(`UPDATE tenants SET display_name=$2, logo_url=$3, updated_at=now() WHERE id=$1`, [tenantId, displayName, logoUrl]);
    return { before: { displayName: b.rows[0]?.display_name ?? '', logoUrl: b.rows[0]?.logo_url ?? null } };
  }

  /* ---- the clock job ------------------------------------------------------------------------------------------------------- */

  async tenantsWithOpenProposals(pool: Pool): Promise<string[]> {
    // kv_relay (the runner's pool) is BYPASSRLS and holds SELECT on both proposal tables — it only reads WHICH tenants to visit
    const r = await pool.query(
      `SELECT tenant_id AS id FROM tenant_branding_proposals WHERE status='proposed' AND expires_at <= now()
        UNION SELECT tenant_id FROM tenant_domain_proposals WHERE status='proposed' AND expires_at <= now() ORDER BY 1`);
    return r.rows.map((x: { id: string }) => x.id);
  }
  async dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query(`SELECT id FROM tenant_branding_proposals WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now() ORDER BY expires_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => x.id);
  }
}
