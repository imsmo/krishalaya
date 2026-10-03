// modules/tenancy/repositories/setting-governance.repository.ts · PC-56 TENANT-13b · SQL for the settings maker-checker (0192):
// tenant_setting_proposals, tenant_setting_history, the registry view W186 prints, tenant_languages (the one language store, F-14).
// tenant_id in EVERY query (Law 1) + RLS (0175 shape on the new tables). Every instant that leaves this file as a cursor is printed
// by the database with microseconds (US_SQL) and compared as timestamptz — never a JS Date (the µs keyset of record).
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { SettingDefinition } from '../domain/tenant-settings.entity';
import { SettingProposalStatus } from '../domain/setting-proposal.state';
import { definitionOf } from './tenant-settings.repository';

export interface ProposalRow {
  id: string; tenantId: string; key: string; oldValue: unknown; newValue: unknown; reason: string;
  proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string; status: SettingProposalStatus;
  confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null; effectiveAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null;
  expiredAt: string | null; expireNote: string | null; appliedAt: string | null; cursorTs: string;
}
export interface HistoryRow {
  id: string; key: string; oldValue: unknown; newValue: unknown; source: 'direct' | 'proposal';
  actorUserId: string | null; proposalId: string | null; proposedBy: string | null; confirmedBy: string | null;
  reason: string | null; appliedAt: string; cursorTs: string;
}
export interface RegistryRow { def: SettingDefinition; value: unknown; isDefault: boolean }
export interface LanguageRow { code: string; isDefault: boolean; nameNative: string; nameEnglish: string; isActive: boolean }

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const PROPOSAL_COLS = `p.id, p.tenant_id, p.key, p.old_value, p.new_value, p.reason, p.proposed_by, up.full_name AS proposed_by_name,
  ${iso('p.proposed_at')} AS proposed_at, ${iso('p.expires_at')} AS expires_at, p.status,
  p.confirmed_by, uc.full_name AS confirmed_by_name, ${iso('p.confirmed_at')} AS confirmed_at, ${iso('p.effective_at')} AS effective_at,
  p.refused_by, ${iso('p.refused_at')} AS refused_at, p.refuse_reason, ${iso('p.expired_at')} AS expired_at, p.expire_note,
  ${iso('p.applied_at')} AS applied_at, ${US_SQL('p.created_at')} AS cursor_ts`;
const PROPOSAL_FROM = `tenant_setting_proposals p LEFT JOIN users up ON up.id = p.proposed_by LEFT JOIN users uc ON uc.id = p.confirmed_by`;

function proposalOf(x: any): ProposalRow {
  return {
    id: x.id, tenantId: x.tenant_id, key: x.key, oldValue: x.old_value, newValue: x.new_value, reason: x.reason,
    proposedBy: x.proposed_by, proposedByName: x.proposed_by_name ?? null, proposedAt: x.proposed_at, expiresAt: x.expires_at, status: x.status,
    confirmedBy: x.confirmed_by ?? null, confirmedByName: x.confirmed_by_name ?? null, confirmedAt: x.confirmed_at ?? null, effectiveAt: x.effective_at ?? null,
    refusedBy: x.refused_by ?? null, refusedAt: x.refused_at ?? null, refuseReason: x.refuse_reason ?? null,
    expiredAt: x.expired_at ?? null, expireNote: x.expire_note ?? null, appliedAt: x.applied_at ?? null, cursorTs: x.cursor_ts,
  };
}

@Injectable()
export class SettingGovernanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: TxContext) { return tx ?? this.replica.forTenant(tenantId); }

  /* ---- the registry W186 prints ---------------------------------------------------------------------------------------- */

  /** Every tenant-scope definition with the tenant's effective value. */
  async registry(tenantId: string): Promise<RegistryRow[]> {
    const r = await this.on(tenantId).query(
      `SELECT d.key, d.value_type, d.scope, d.risk_class, d.member_notice, d.tenant_min, d.tenant_max, d.floor_note, d.default_value, d.description,
              d.lock_note, to_char(d.deprecated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deprecated_at,
              COALESCE(ts.value, d.default_value) AS value, (ts.value IS NULL) AS is_default
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1 AND ts.deleted_at IS NULL
        WHERE d.scope = 'tenant'
        ORDER BY d.key`, [tenantId]);
    return r.rows.map((x: any) => ({ def: definitionOf(x), value: x.value, isDefault: x.is_default === true }));
  }

  /** The tenant's effective value of one key, inside the writing transaction (the "before" of before/after). */
  async effectiveTx(tx: TxContext, tenantId: string, key: string): Promise<{ value: unknown; isDefault: boolean } | null> {
    const r = await tx.query(
      `SELECT COALESCE(ts.value, d.default_value) AS value, (ts.value IS NULL) AS is_default
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1 AND ts.deleted_at IS NULL
        WHERE d.key = $2`, [tenantId, key]);
    return r.rows[0] ? { value: r.rows[0].value, isDefault: r.rows[0].is_default === true } : null;
  }

  /** Active, unsuspended tenant_admin holders — the people who may propose and confirm (0192 `kv_is_tenant_admin`). */
  async adminIds(tenantId: string, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND ro.code = 'tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions s WHERE s.tenant_id = utr.tenant_id AND s.user_id = utr.user_id AND s.lifted_at IS NULL AND s.deleted_at IS NULL)
        ORDER BY utr.user_id`, [tenantId]);
    return r.rows.map((x: any) => String(x.user_id));
  }

  /* ---- writes ---------------------------------------------------------------------------------------------------------- */

  async upsertSettingTx(tx: TxContext, tenantId: string, key: string, value: unknown, actorUserId: string | null): Promise<void> {
    await tx.query(
      `INSERT INTO tenant_settings (tenant_id, key, value, created_at, created_by, updated_by) VALUES ($1,$2,$3::jsonb, now(), $4, $4)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [tenantId, key, JSON.stringify(value), actorUserId]);
  }

  async insertHistoryTx(tx: TxContext, h: {
    tenantId: string; key: string; oldValue: unknown; newValue: unknown; source: 'direct' | 'proposal';
    actorUserId?: string | null; proposalId?: string | null; proposedBy?: string | null; confirmedBy?: string | null; reason?: string | null;
  }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO tenant_setting_history (tenant_id, key, old_value, new_value, source, actor_user_id, proposal_id, proposed_by, confirmed_by, reason)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [h.tenantId, h.key, JSON.stringify(h.oldValue), JSON.stringify(h.newValue), h.source, h.actorUserId ?? null, h.proposalId ?? null,
       h.proposedBy ?? null, h.confirmedBy ?? null, h.reason ?? null]);
    return r.rows[0].id;
  }

  async insertProposalTx(tx: TxContext, p: { tenantId: string; key: string; oldValue: unknown; newValue: unknown; reason: string; proposedBy: string }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO tenant_setting_proposals (tenant_id, key, old_value, new_value, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6, now(), now() + interval '7 days') RETURNING id`,
      [p.tenantId, p.key, JSON.stringify(p.oldValue), JSON.stringify(p.newValue), p.reason, p.proposedBy]);
    return r.rows[0].id;
  }

  async liveProposalTx(tx: TxContext, tenantId: string, key: string): Promise<{ id: string } | null> {
    const r = await tx.query(`SELECT id FROM tenant_setting_proposals WHERE tenant_id=$1 AND key=$2 AND status IN ('proposed','confirmed')`, [tenantId, key]);
    return r.rows[0] ? { id: r.rows[0].id } : null;
  }

  async getProposalForUpdate(tx: TxContext, tenantId: string, id: string): Promise<ProposalRow | null> {
    await tx.query(`SELECT 1 FROM tenant_setting_proposals WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
    const r = await tx.query(`SELECT ${PROPOSAL_COLS} FROM ${PROPOSAL_FROM} WHERE p.tenant_id=$1 AND p.id=$2`, [tenantId, id]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }

  async getProposal(tenantId: string, id: string): Promise<ProposalRow | null> {
    const r = await this.on(tenantId).query(`SELECT ${PROPOSAL_COLS} FROM ${PROPOSAL_FROM} WHERE p.tenant_id=$1 AND p.id=$2`, [tenantId, id]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }

  /** Confirm: the database computes effective_at = next_midnight_ist(now()); trg_tsp_moves refuses maker = checker. */
  async confirmTx(tx: TxContext, tenantId: string, id: string, checker: string): Promise<{ confirmedAt: string; effectiveAt: string }> {
    const r = await tx.query(
      `UPDATE tenant_setting_proposals SET status='confirmed', confirmed_by=$3, confirmed_at=now(), effective_at=next_midnight_ist(now())
        WHERE tenant_id=$1 AND id=$2 AND status='proposed'
        RETURNING ${iso('confirmed_at')} AS confirmed_at, ${iso('effective_at')} AS effective_at`, [tenantId, id, checker]);
    if (r.rowCount !== 1) throw new Error(`setting proposal ${id}: confirm matched ${r.rowCount} rows`);
    return { confirmedAt: r.rows[0].confirmed_at, effectiveAt: r.rows[0].effective_at };
  }

  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    const r = await tx.query(
      `UPDATE tenant_setting_proposals SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4
        WHERE tenant_id=$1 AND id=$2 AND status='proposed'`, [tenantId, id, by, reason]);
    if (r.rowCount !== 1) throw new Error(`setting proposal ${id}: refuse matched ${r.rowCount} rows`);
  }

  async markAppliedTx(tx: TxContext, tenantId: string, id: string): Promise<void> {
    const r = await tx.query(`UPDATE tenant_setting_proposals SET status='applied', applied_at=now() WHERE tenant_id=$1 AND id=$2 AND status='confirmed'`, [tenantId, id]);
    if (r.rowCount !== 1) throw new Error(`setting proposal ${id}: apply matched ${r.rowCount} rows`);
  }

  async markExpiredTx(tx: TxContext, tenantId: string, id: string, note: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE tenant_setting_proposals SET status='expired', expired_at=now(), expire_note=$3
        WHERE tenant_id=$1 AND id=$2 AND ((status='proposed' AND expires_at <= now()) OR status='confirmed')`, [tenantId, id, note]);
    return r.rowCount === 1;
  }

  /** The tenant's proposals, newest first, µs keyset. */
  async listProposals(tenantId: string, opts: { status?: SettingProposalStatus; key?: string; cursor?: KeysetCursor; limit: number }): Promise<ProposalRow[]> {
    const params: unknown[] = [tenantId]; const where = ['p.tenant_id = $1'];
    if (opts.status) { params.push(opts.status); where.push(`p.status = $${params.length}`); }
    if (opts.key) { params.push(opts.key); where.push(`p.key = $${params.length}`); }
    if (opts.cursor) { params.push(opts.cursor.ts, opts.cursor.id); where.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    params.push(opts.limit);
    const r = await this.on(tenantId).query(
      `SELECT ${PROPOSAL_COLS} FROM ${PROPOSAL_FROM} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(proposalOf);
  }

  /** History of one key (or all), newest first, µs keyset. */
  async listHistory(tenantId: string, opts: { key?: string; cursor?: KeysetCursor; limit: number }): Promise<HistoryRow[]> {
    const params: unknown[] = [tenantId]; const where = ['h.tenant_id = $1'];
    if (opts.key) { params.push(opts.key); where.push(`h.key = $${params.length}`); }
    if (opts.cursor) { params.push(opts.cursor.ts, opts.cursor.id); where.push(`(h.applied_at, h.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    params.push(opts.limit);
    const r = await this.on(tenantId).query(
      `SELECT h.id, h.key, h.old_value, h.new_value, h.source, h.actor_user_id, h.proposal_id, h.proposed_by, h.confirmed_by, h.reason,
              ${iso('h.applied_at')} AS applied_at, ${US_SQL('h.applied_at')} AS cursor_ts
         FROM tenant_setting_history h WHERE ${where.join(' AND ')} ORDER BY h.applied_at DESC, h.id DESC LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, key: x.key, oldValue: x.old_value, newValue: x.new_value, source: x.source, actorUserId: x.actor_user_id ?? null,
      proposalId: x.proposal_id ?? null, proposedBy: x.proposed_by ?? null, confirmedBy: x.confirmed_by ?? null, reason: x.reason ?? null,
      appliedAt: x.applied_at, cursorTs: x.cursor_ts,
    }));
  }

  /* ---- the job (kv_relay reads only `tenants`; every claim and act runs as kv_app per tenant) ------------------------- */

  async activeTenants(pool: Pool): Promise<string[]> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`);
    return r.rows.map((x: { id: string }) => x.id);
  }
  async dueToApplyTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query(
      `SELECT id FROM tenant_setting_proposals WHERE tenant_id=$1 AND status='confirmed' AND effective_at <= now() ORDER BY effective_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => x.id);
  }
  async dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query(
      `SELECT id FROM tenant_setting_proposals WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now() ORDER BY expires_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => x.id);
  }
  /** Every active member of the tenant (the member notice audience; the 9b resolution-notice precedent, bounded). */
  async memberUserIdsTx(tx: TxContext, tenantId: string): Promise<string[]> {
    const r = await tx.query(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr
        WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL ORDER BY utr.user_id LIMIT 50000`, [tenantId]);
    return r.rows.map((x: any) => String(x.user_id));
  }

  /* ---- tenant_languages (F-14) ---------------------------------------------------------------------------------------- */

  async languages(tenantId: string, tx?: TxContext): Promise<LanguageRow[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT tl.language_code AS code, tl.is_default, lg.name_native, lg.name_english, lg.is_active
         FROM tenant_languages tl JOIN languages lg ON lg.code = tl.language_code
        WHERE tl.tenant_id = $1 AND lg.deleted_at IS NULL ORDER BY tl.is_default DESC, lg.sort_order, tl.language_code`, [tenantId]);
    return r.rows.map((x: any) => ({ code: x.code, isDefault: x.is_default === true, nameNative: x.name_native, nameEnglish: x.name_english, isActive: x.is_active === true }));
  }
  async platformLanguages(tenantId: string): Promise<Array<{ code: string; nameNative: string; nameEnglish: string }>> {
    const r = await this.on(tenantId).query(`SELECT code, name_native, name_english FROM languages WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: x.code, nameNative: x.name_native, nameEnglish: x.name_english }));
  }
  async activeLanguageCodesTx(tx: TxContext, codes: string[]): Promise<string[]> {
    const r = await tx.query(`SELECT code FROM languages WHERE code = ANY($1::text[]) AND is_active AND deleted_at IS NULL`, [codes]);
    return r.rows.map((x: any) => x.code);
  }
  /**
   * What still uses a language the tenant is removing: a PUBLISHED page, an ACTIVE tenant template override, a REVIEWED lesson
   * subtitle, an ACTIVE banner's text. Counted per kind so the refusal can name them (A5).
   */
  async languageUsesTx(tx: TxContext, tenantId: string, codes: string[]): Promise<Array<{ code: string; kind: string; count: number }>> {
    if (codes.length === 0) return [];
    const r = await tx.query(
      `SELECT code, kind, n::int AS count FROM (
         SELECT language_code AS code, 'page' AS kind, count(*) AS n FROM cms_pages
          WHERE tenant_id=$1 AND language_code = ANY($2::text[]) AND status='published' AND deleted_at IS NULL GROUP BY language_code
         UNION ALL
         SELECT language_code, 'template', count(*) FROM notification_templates
          WHERE tenant_id=$1 AND language_code = ANY($2::text[]) AND is_active AND deleted_at IS NULL GROUP BY language_code
         UNION ALL
         SELECT language_code, 'subtitle', count(*) FROM course_lesson_subtitles
          WHERE tenant_id=$1 AND language_code = ANY($2::text[]) AND status='reviewed' AND deleted_at IS NULL GROUP BY language_code
         UNION ALL
         SELECT bt.language_code, 'banner', count(*) FROM banner_texts bt JOIN banners b ON b.id = bt.banner_id
          WHERE bt.tenant_id=$1 AND bt.language_code = ANY($2::text[]) AND bt.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL GROUP BY bt.language_code
       ) u WHERE n > 0 ORDER BY code, kind`, [tenantId, codes]);
    return r.rows.map((x: any) => ({ code: x.code, kind: x.kind, count: Number(x.count) }));
  }
  async replaceLanguagesTx(tx: TxContext, tenantId: string, enabled: string[], primary: string): Promise<void> {
    await tx.query(`DELETE FROM tenant_languages WHERE tenant_id=$1 AND NOT (language_code = ANY($2::text[]))`, [tenantId, enabled]);
    await tx.query(`UPDATE tenant_languages SET is_default = false WHERE tenant_id=$1 AND is_default AND language_code <> $2`, [tenantId, primary]);
    await tx.query(
      `INSERT INTO tenant_languages (tenant_id, language_code, is_default)
       SELECT $1, c, c = $3 FROM unnest($2::text[]) AS c
       ON CONFLICT (tenant_id, language_code) DO UPDATE SET is_default = EXCLUDED.is_default`, [tenantId, enabled, primary]);
  }
}
