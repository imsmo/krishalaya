// modules/memberships/repositories/agm-pack.repository.ts · PC-56 TENANT-SW-d · W199 — SQL for the AGM pack (0200) and the FACTS it is
// assembled from. Every read is the caller's own tenant (RLS + `tenant_id = $1`); the ledger reads are kv_app's SELECT on the money
// tables (0014 — read-models depend on it; never a write, Law 2). Partitioned tables are read by their partition key's range
// (`ledger_entries.created_at`, Law 8). Nothing here computes a figure the domain has not named a method for.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { MEMBER_ROLE_CODES } from './governance.repository';
import type {
  AccountFact, AnnexureFact, GmvFact, MemberCreditFact, QuorumFact, RegisterFact, ResolutionFact, SectionRow, StatementsFact,
} from '../domain/agm-pack';

export interface AgmPackRow {
  id: string; tenantId: string; fiscalYearLabel: string; fyStart: string; fyEnd: string; fyStartMonth: number; fyBasisSource: 'tenant_setting' | 'country_default';
  zone: string; secondLanguage: 'hi' | 'gu'; status: string; draftedBy: string; assembledAt: string; issuedBy: string | null; issueRequestedAt: string | null;
  confirmedBy: string | null; confirmedAt: string | null; issuedAt: string | null; documentId: string | null; pdfSha256: string | null; contentSha256: string | null;
  pdfMediaId: string | null; exportJobId: string | null; exportNote: string | null; parentPackId: string | null; addendumNo: number; reason: string | null;
  supersededBy: string | null; auditorMediaId: string | null; renderAttempts: number; renderError: string | null; withdrawnAt: string | null; withdrawReason: string | null;
  createdAt: string; cursorTs: string;
}
export interface SectionRecord extends SectionRow { id: string }
export interface TenantClock { zone: string; slug: string; displayName: string; legalName: string; fyMonth: number | null; fyBasisSource: 'tenant_setting' | 'country_default'; currency: string | null; defaultLanguage: string | null }

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');   // the SQL prints ::text — never a JS Date (pg-date sweep)
const COLS = `id, tenant_id, fiscal_year_label, fy_start::text AS fy_start, fy_end::text AS fy_end, fy_start_month, fy_basis_source, zone, second_language, status, drafted_by,
  assembled_at, issued_by, issue_requested_at, confirmed_by, confirmed_at, issued_at, document_id, pdf_sha256, content_sha256, pdf_media_id, export_job_id, export_note,
  parent_pack_id, addendum_no, reason, superseded_by, auditor_media_id, render_attempts, render_error, withdrawn_at, withdraw_reason, created_at, ${US_SQL('created_at')} AS cursor_ts`;
const packOf = (x: any): AgmPackRow => ({
  id: x.id, tenantId: x.tenant_id, fiscalYearLabel: x.fiscal_year_label, fyStart: day(x.fy_start), fyEnd: day(x.fy_end), fyStartMonth: Number(x.fy_start_month),
  fyBasisSource: x.fy_basis_source, zone: x.zone, secondLanguage: x.second_language, status: x.status, draftedBy: x.drafted_by, assembledAt: iso(x.assembled_at)!,
  issuedBy: x.issued_by ?? null, issueRequestedAt: iso(x.issue_requested_at), confirmedBy: x.confirmed_by ?? null, confirmedAt: iso(x.confirmed_at), issuedAt: iso(x.issued_at),
  documentId: x.document_id ?? null, pdfSha256: x.pdf_sha256 ? String(x.pdf_sha256).trim() : null, contentSha256: x.content_sha256 ? String(x.content_sha256).trim() : null,
  pdfMediaId: x.pdf_media_id ?? null, exportJobId: x.export_job_id ?? null, exportNote: x.export_note ?? null, parentPackId: x.parent_pack_id ?? null,
  addendumNo: Number(x.addendum_no), reason: x.reason ?? null, supersededBy: x.superseded_by ?? null, auditorMediaId: x.auditor_media_id ?? null,
  renderAttempts: Number(x.render_attempts ?? 0), renderError: x.render_error ?? null, withdrawnAt: iso(x.withdrawn_at), withdrawReason: x.withdraw_reason ?? null,
  createdAt: iso(x.created_at)!, cursorTs: x.cursor_ts,
});

@Injectable()
export class AgmPackRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ─────────────────────────────── the cooperative's clock, names, FY basis ─────────────────────────────── */
  async clock(tenantId: string, tx?: SqlExecutor | null): Promise<TenantClock | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT c.timezone AS zone, t.slug, t.display_name, t.legal_name, tenant_fiscal_year_start_month(t.id) AS fy_month,
              EXISTS (SELECT 1 FROM tenant_settings s WHERE s.tenant_id = t.id AND s.key = 'finance.fiscal_year_start_month' AND s.deleted_at IS NULL
                        AND jsonb_typeof(s.value) = 'number') AS fy_own,
              c.currency_code,
              (SELECT s.value #>> '{}' FROM tenant_settings s WHERE s.tenant_id = t.id AND s.key = 'languages.default' AND s.deleted_at IS NULL) AS default_lang
         FROM tenants t JOIN countries c ON c.code = t.country_code WHERE t.id = $1`, [tenantId]);
    const x = r.rows[0];
    if (!x) return null;
    return { zone: x.zone, slug: x.slug, displayName: x.display_name, legalName: x.legal_name, fyMonth: x.fy_month === null ? null : Number(x.fy_month),
      fyBasisSource: x.fy_own ? 'tenant_setting' : 'country_default', currency: x.currency_code ? String(x.currency_code).trim() : null, defaultLanguage: x.default_lang ?? null };
  }

  /** Has the FY ended in the cooperative's zone? (the half-open window's end, as an instant, ≤ now) */
  async fyEnded(tenantId: string, zone: string, endExclusive: string, tx?: SqlExecutor | null): Promise<boolean> {
    const r = await this.on(tenantId, tx).query(`SELECT (($1::date)::timestamp AT TIME ZONE $2) <= now() AS ended`, [endExclusive, zone]);
    return r.rows[0]?.ended === true;
  }

  /* ─────────────────────────────── the FACTS ─────────────────────────────── */

  async gmv(tenantId: string, zone: string, start: string, endExclusive: string, tx?: SqlExecutor | null): Promise<GmvFact[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT o.currency_code AS currency, COUNT(*)::int AS orders, COALESCE(SUM(o.subtotal_minor), 0)::text AS goods, COALESCE(SUM(o.total_minor), 0)::text AS paid
         FROM orders o
        WHERE o.tenant_id = $1 AND o.status = 'completed'
          AND o.completed_at >= (($2::date)::timestamp AT TIME ZONE $4) AND o.completed_at < (($3::date)::timestamp AT TIME ZONE $4)
        GROUP BY o.currency_code ORDER BY o.currency_code`, [tenantId, start, endExclusive, zone]);
    return r.rows.map((x: any) => ({ currency: String(x.currency).trim(), orders: Number(x.orders), goodsMinor: String(x.goods), buyerTotalMinor: String(x.paid) }));
  }

  /** Members today (holders of a member role) — the denominator of "paid to members" and the statements count. */
  async memberCount(tenantId: string, tx?: SqlExecutor | null): Promise<number> {
    const r = await this.on(tenantId, tx).query(
      `SELECT COUNT(DISTINCT utr.user_id)::int AS n FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL AND ro.code = ANY($2::text[])`, [tenantId, MEMBER_ROLE_CODES]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async memberCredits(tenantId: string, zone: string, start: string, endExclusive: string, tx?: SqlExecutor | null): Promise<MemberCreditFact[]> {
    const r = await this.on(tenantId, tx).query(
      `WITH mem AS (
         SELECT DISTINCT utr.user_id FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
          WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL AND ro.code = ANY($5::text[])
       )
       SELECT wa.currency_code AS currency,
              COALESCE(SUM(le.amount_minor) FILTER (WHERE le.amount_minor > 0), 0)::text AS credits,
              COALESCE(SUM(le.amount_minor) FILTER (WHERE le.amount_minor < 0), 0)::text AS clawbacks,
              COUNT(DISTINCT lt.id)::int AS txns
         FROM ledger_entries le
         JOIN ledger_transactions lt ON lt.id = le.txn_id
         JOIN lookup_values tt ON tt.id = lt.txn_type_id AND tt.type_code = 'ledger_txn_type' AND tt.code = 'escrow_release'
         JOIN wallet_accounts wa ON wa.id = le.account_id AND wa.owner_kind = 'user' AND wa.account_code = 'main'
        WHERE le.tenant_id = $1
          AND le.created_at >= (($2::date)::timestamp AT TIME ZONE $4) AND le.created_at < (($3::date)::timestamp AT TIME ZONE $4)
          AND lt.reference_type IN ('order', 'dispute', 'return')
          AND wa.owner_user_id IN (SELECT user_id FROM mem)
        GROUP BY wa.currency_code ORDER BY wa.currency_code`, [tenantId, start, endExclusive, zone, MEMBER_ROLE_CODES]);
    return r.rows.map((x: any) => ({ currency: String(x.currency).trim(), creditsMinor: String(x.credits), clawbacksMinor: String(x.clawbacks), transactions: Number(x.txns) }));
  }

  /** The net of the escrow_release legs posted by this cooperative's settlements to ONE account kind (platform fees / GST payable / own commission). */
  async accountNet(tenantId: string, which: 'platform_fees' | 'gst_payable' | 'tenant_commission', zone: string, start: string, endExclusive: string, tx?: SqlExecutor | null): Promise<AccountFact[]> {
    const acct = which === 'platform_fees' ? `wa.owner_kind = 'platform' AND wa.account_code = 'fees'`
      : which === 'gst_payable' ? `wa.owner_kind = 'platform' AND wa.account_code = 'gst_payable'`
      : `wa.owner_kind = 'tenant' AND wa.account_code = 'commission' AND wa.owner_tenant_id = $1`;
    const r = await this.on(tenantId, tx).query(
      `SELECT wa.currency_code AS currency, COALESCE(SUM(le.amount_minor), 0)::text AS net, COUNT(*)::int AS entries
         FROM ledger_entries le
         JOIN ledger_transactions lt ON lt.id = le.txn_id
         JOIN lookup_values tt ON tt.id = lt.txn_type_id AND tt.type_code = 'ledger_txn_type' AND tt.code = 'escrow_release'
         JOIN wallet_accounts wa ON wa.id = le.account_id AND ${acct}
        WHERE le.tenant_id = $1
          AND le.created_at >= (($2::date)::timestamp AT TIME ZONE $4) AND le.created_at < (($3::date)::timestamp AT TIME ZONE $4)
          AND lt.reference_type IN ('order', 'dispute', 'return')
        GROUP BY wa.currency_code ORDER BY wa.currency_code`, [tenantId, start, endExclusive, zone]);
    return r.rows.map((x: any) => ({ currency: String(x.currency).trim(), netMinor: String(x.net), entries: Number(x.entries) }));
  }

  async statements(tenantId: string, start: string, endInclusive: string, tx?: SqlExecutor | null): Promise<StatementsFact> {
    const r = await this.on(tenantId, tx).query(
      `SELECT COUNT(*)::int AS statements, COUNT(DISTINCT s.seller_user_id)::int AS members
         FROM settlement_statements s
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.period_start <= $3::date AND s.period_end >= $2::date
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                       WHERE utr.tenant_id = $1 AND utr.user_id = s.seller_user_id AND utr.is_active AND utr.deleted_at IS NULL AND ro.code = ANY($4::text[]))`,
      [tenantId, start, endInclusive, MEMBER_ROLE_CODES]);
    return { statements: Number(r.rows[0]?.statements ?? 0), members: Number(r.rows[0]?.members ?? 0) };
  }

  async registerAtFyEnd(tenantId: string, zone: string, endExclusive: string, tx?: SqlExecutor | null): Promise<RegisterFact> {
    const r = await this.on(tenantId, tx).query(
      `WITH cut AS (SELECT (($2::date)::timestamp AT TIME ZONE $3) AS at)
       SELECT COUNT(*)::int AS rows_at_end,
              COUNT(*) FILTER (WHERE csr.shares_held > 0)::int AS holders,
              COALESCE(SUM(csr.shares_held), 0)::bigint AS total_shares,
              COALESCE(SUM(csr.share_value_minor) FILTER (WHERE csr.shares_held > 0), 0)::text AS paid_up,
              COUNT(*) FILTER (WHERE csr.updated_at >= cut.at)::int AS changed_after
         FROM coop_share_registers csr, cut
        WHERE csr.tenant_id = $1 AND csr.created_at < cut.at AND (csr.deleted_at IS NULL OR csr.deleted_at >= cut.at)`, [tenantId, endExclusive, zone]);
    const x = r.rows[0];
    return { rowsAtFyEnd: Number(x?.rows_at_end ?? 0), holders: Number(x?.holders ?? 0), totalShares: Number(x?.total_shares ?? 0), paidUpMinor: String(x?.paid_up ?? '0'), changedAfterFyEnd: Number(x?.changed_after ?? 0) };
  }

  async resolutions(tenantId: string, zone: string, start: string, endExclusive: string, tx?: SqlExecutor | null): Promise<ResolutionFact[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT id, title, closed_at, outcome, resolution_type FROM coop_resolutions
        WHERE tenant_id = $1 AND status = 'closed' AND deleted_at IS NULL
          AND closed_at >= (($2::date)::timestamp AT TIME ZONE $4) AND closed_at < (($3::date)::timestamp AT TIME ZONE $4)
        ORDER BY closed_at, id LIMIT 500`, [tenantId, start, endExclusive, zone]);
    return r.rows.map((x: any) => ({ id: x.id, title: x.title, closedAt: iso(x.closed_at)!, outcome: x.outcome ?? 'not_recorded', type: x.resolution_type }));
  }

  async annexure(tenantId: string, mediaId: string | null, tx?: SqlExecutor | null): Promise<AnnexureFact | null> {
    if (!mediaId) return null;
    const r = await this.on(tenantId, tx).query(`SELECT id, bytes::text AS bytes, sha256, mime_type FROM media_assets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [mediaId, tenantId]);
    const x = r.rows[0];
    return x ? { mediaId: x.id, bytes: x.bytes ?? null, sha256: x.sha256 || null, mime: x.mime_type } : null;
  }
  async mediaOfTenant(tenantId: string, mediaId: string, tx?: SqlExecutor | null): Promise<boolean> {
    const r = await this.on(tenantId, tx).query(`SELECT 1 FROM media_assets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [mediaId, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }

  async quorum(tenantId: string, tx?: SqlExecutor | null): Promise<QuorumFact | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT (SELECT s.value #>> '{}' FROM tenant_settings s WHERE s.tenant_id = $1 AND s.key = 'governance.quorum_bp' AND s.deleted_at IS NULL) AS own,
              (SELECT d.default_value #>> '{}' FROM setting_definitions d WHERE d.key = 'governance.quorum_bp') AS dflt`, [tenantId]);
    const x = r.rows[0];
    const own = x?.own !== null && x?.own !== undefined && /^\d{1,5}$/.test(String(x.own)) ? Number(x.own) : null;
    const dflt = x?.dflt !== null && x?.dflt !== undefined && /^\d{1,5}$/.test(String(x.dflt)) ? Number(x.dflt) : null;
    if (own !== null) return { quorumBp: own, source: 'tenant_setting' };
    if (dflt !== null) return { quorumBp: dflt, source: 'platform_default' };
    return null;
  }

  /* ─────────────────────────────── the pack ─────────────────────────────── */
  async insertPackTx(tx: TxContext, p: { id: string; tenantId: string; label: string; fyStart: string; fyEnd: string; fyStartMonth: number; fyBasisSource: string; zone: string;
    secondLanguage: string; draftedBy: string; parentPackId: string | null; addendumNo: number; reason: string | null; auditorMediaId: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO agm_packs (id, tenant_id, fiscal_year_label, fy_start, fy_end, fy_start_month, fy_basis_source, zone, second_language, drafted_by, parent_pack_id, addendum_no, reason, auditor_media_id)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [p.id, p.tenantId, p.label, p.fyStart, p.fyEnd, p.fyStartMonth, p.fyBasisSource, p.zone, p.secondLanguage, p.draftedBy, p.parentPackId, p.addendumNo, p.reason, p.auditorMediaId]);
  }
  async replaceSectionsTx(tx: TxContext, tenantId: string, packId: string, rows: readonly SectionRow[]): Promise<void> {
    await tx.query(`DELETE FROM agm_pack_sections WHERE tenant_id = $1 AND pack_id = $2`, [tenantId, packId]);
    for (const r of rows) {
      await tx.query(
        `INSERT INTO agm_pack_sections (tenant_id, pack_id, section_code, item_code, status, method, refusal_code, figures, source_refs, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
        [tenantId, packId, r.section, r.item, r.status, r.method, r.refusalCode, JSON.stringify(r.figures), JSON.stringify(r.sourceRefs), r.sortOrder]);
    }
  }
  async sections(tenantId: string, packId: string, tx?: SqlExecutor | null): Promise<SectionRecord[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT id, section_code, item_code, status, method, refusal_code, figures, source_refs, sort_order FROM agm_pack_sections
        WHERE tenant_id = $1 AND pack_id = $2 ORDER BY sort_order, id`, [tenantId, packId]);
    return r.rows.map((x: any) => ({ id: x.id, section: x.section_code, item: x.item_code, status: x.status, method: x.method, refusalCode: x.refusal_code ?? null,
      figures: x.figures ?? {}, sourceRefs: x.source_refs ?? [], sortOrder: Number(x.sort_order) }));
  }
  async get(tenantId: string, id: string, tx?: SqlExecutor | null, forUpdate = false): Promise<AgmPackRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM agm_packs WHERE tenant_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [tenantId, id]);
    return r.rows[0] ? packOf(r.rows[0]) : null;
  }
  async page(tenantId: string, limit: number, after?: KeysetCursor, fyStart?: string): Promise<AgmPackRow[]> {
    const params: unknown[] = [tenantId, limit];
    let where = '';
    if (fyStart) { params.push(fyStart); where += ` AND fy_start = $${params.length}::date`; }
    if (after) { params.push(after.ts, after.id); where += ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`; }
    const r = await this.on(tenantId).query(`SELECT ${COLS} FROM agm_packs WHERE tenant_id = $1${where} ORDER BY created_at DESC, id DESC LIMIT $2`, params);
    return r.rows.map(packOf);
  }
  async issuing(tenantId: string, tx?: SqlExecutor | null): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(`SELECT id FROM agm_packs WHERE tenant_id = $1 AND status = 'issuing' ORDER BY confirmed_at, id LIMIT 20`, [tenantId]);
    return r.rows.map((x: any) => x.id);
  }

  /** One UPDATE per move: the trigger is the wall; the WHERE is the expected source state, so a lost race moves nothing (rowCount 0). */
  async moveTx(tx: TxContext, tenantId: string, id: string, from: string, set: Record<string, unknown>): Promise<boolean> {
    const keys = Object.keys(set);
    const sql = `UPDATE agm_packs SET ${keys.map((k, i) => `${k} = $${i + 4}`).join(', ')} WHERE tenant_id = $1 AND id = $2 AND status = $3`;
    const r = await tx.query(sql, [tenantId, id, from, ...keys.map((k) => set[k])]);
    return (r.rowCount ?? 0) === 1;
  }
  async setAnnexureTx(tx: TxContext, tenantId: string, id: string, mediaId: string | null): Promise<boolean> {
    const r = await tx.query(`UPDATE agm_packs SET auditor_media_id = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`, [tenantId, id, mediaId]);
    return (r.rowCount ?? 0) === 1;
  }
  async touchAssembledTx(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE agm_packs SET assembled_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`, [tenantId, id]);
  }
  async renderFailedTx(tx: TxContext, tenantId: string, id: string, error: string): Promise<void> {
    await tx.query(`UPDATE agm_packs SET render_attempts = render_attempts + 1, render_error = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'issuing'`, [tenantId, id, error.slice(0, 200)]);
  }
  async supersedeTx(tx: TxContext, tenantId: string, parentId: string, childId: string): Promise<boolean> {
    const r = await tx.query(`UPDATE agm_packs SET superseded_by = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'issued' AND superseded_by IS NULL`, [tenantId, parentId, childId]);
    return (r.rowCount ?? 0) === 1;
  }
  async userNames(tenantId: string, ids: string[], tx?: SqlExecutor | null): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const r = await this.on(tenantId, tx).query(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    return new Map(r.rows.map((x: any) => [x.id, x.full_name ?? '']));
  }
  async activeAdmins(tenantId: string, tx?: SqlExecutor | null): Promise<number> {
    const r = await this.on(tenantId, tx).query(
      `SELECT COUNT(DISTINCT utr.user_id)::int AS n FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id = $1 AND r.code = 'tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL`, [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  /** The public verify read (0200's SECURITY DEFINER — no tenant context, no figures). */
  async verify(executor: SqlExecutor, documentId: string): Promise<Record<string, any> | null> {
    const r = await executor.query(`SELECT * FROM public_agm_pack_verify($1)`, [documentId]);
    return r.rows[0] ?? null;
  }
}
