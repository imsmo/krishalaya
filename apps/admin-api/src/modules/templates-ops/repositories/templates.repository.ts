// apps/admin-api/src/modules/templates-ops/repositories/templates.repository.ts · PC-56 ADMIN-11b.
//
// kv_admin, cross-tenant by role (Law 11) — the platform's template registry INCLUDES every tenant override, because
// W102's "Tenant overrides (14)" panel is the only place anybody can see that a tenant has diverged from the platform's
// wording. 0122 grants kv_app SELECT on the versions table so the send path can read the serving body and can never
// author one.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

export interface TemplateRow {
  id: string;
  eventCode: string;
  channel: string;
  languageCode: string;
  tenantId: string | null;
  tenantName: string | null;
  subject: string | null;
  /** The wording that is SERVING — read from the serving version, not from the mutable row. */
  body: string;
  providerTemplateRef: string | null;
  isActive: boolean;
  lifecycle: string | null;
  servingVersionId: string | null;
  servingVersionNo: number | null;
  currentVersionNo: number;
  priority: string;
  userCanOptOut: boolean;
  /** Count of tenant rows for the same event×channel×language — W101's "Overrides" column. */
  overrideCount: number;
}

export interface VersionRow {
  id: string;
  templateId: string;
  versionNo: number;
  subject: string | null;
  body: string;
  providerTemplateRef: string | null;
  bodySha256: string;
  lifecycle: string;
  needsSecondPerson: boolean;
  authoredByAdminId: string | null;
  approvedByAdminId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  reason: string;
  createdAt: string;
}

const TEMPLATE_COLS = `
  SELECT t.id, t.event_code, t.channel, t.language_code, t.tenant_id, tn.legal_name AS tenant_name,
         -- **THE BODY THE PLATFORM IS ACTUALLY SENDING.** COALESCE to the row only where no version exists at all,
         -- which after 0122's backfill means a row created by a writer that predates this plane — worth surfacing
         -- rather than hiding behind an empty string.
         COALESCE(sv.subject, t.subject) AS subject,
         COALESCE(sv.body, t.body) AS body,
         COALESCE(sv.provider_template_ref, t.provider_template_ref) AS provider_template_ref,
         t.is_active, sv.lifecycle, t.serving_version_id, sv.version_no AS serving_version_no,
         t.current_version_no, e.priority, e.user_can_opt_out,
         COALESCE(ov.n, 0)::int AS override_count
    FROM notification_templates t
    JOIN notification_events e ON e.code = t.event_code
    LEFT JOIN notification_template_versions sv ON sv.id = t.serving_version_id
    LEFT JOIN tenants tn ON tn.id = t.tenant_id
    LEFT JOIN (SELECT event_code, channel, language_code, COUNT(*) AS n
                 FROM notification_templates WHERE tenant_id IS NOT NULL AND deleted_at IS NULL
                GROUP BY event_code, channel, language_code) ov
      ON ov.event_code = t.event_code AND ov.channel = t.channel AND ov.language_code = t.language_code`;

function toTemplate(r: Record<string, unknown>): TemplateRow {
  return {
    id: String(r.id), eventCode: String(r.event_code), channel: String(r.channel), languageCode: String(r.language_code),
    tenantId: (r.tenant_id as string | null) ?? null, tenantName: (r.tenant_name as string | null) ?? null,
    subject: (r.subject as string | null) ?? null, body: String(r.body ?? ''),
    providerTemplateRef: (r.provider_template_ref as string | null) ?? null,
    isActive: Boolean(r.is_active), lifecycle: (r.lifecycle as string | null) ?? null,
    servingVersionId: (r.serving_version_id as string | null) ?? null,
    servingVersionNo: r.serving_version_no === null || r.serving_version_no === undefined ? null : Number(r.serving_version_no),
    currentVersionNo: Number(r.current_version_no ?? 1),
    priority: String(r.priority), userCanOptOut: Boolean(r.user_can_opt_out),
    overrideCount: Number(r.override_count ?? 0),
  };
}

function toVersion(r: Record<string, unknown>): VersionRow {
  return {
    id: String(r.id), templateId: String(r.template_id), versionNo: Number(r.version_no),
    subject: (r.subject as string | null) ?? null, body: String(r.body),
    providerTemplateRef: (r.provider_template_ref as string | null) ?? null,
    bodySha256: String(r.body_sha256), lifecycle: String(r.lifecycle),
    needsSecondPerson: Boolean(r.needs_second_person),
    authoredByAdminId: (r.authored_by_admin_id as string | null) ?? null,
    approvedByAdminId: (r.approved_by_admin_id as string | null) ?? null,
    approvedAt: r.approved_at ? new Date(String(r.approved_at)).toISOString() : null,
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    reason: String(r.reason ?? ''),
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

@Injectable()
export class TemplatesRepository {
  constructor(private readonly pool: AdminPool) {}

  async list(q: {
    channel?: string; languageCode?: string; eventCode?: string; platformOnly?: boolean;
    cursor?: string; limit: number;
  }): Promise<TemplateRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 't.deleted_at IS NULL';
    if (q.channel) where += ` AND t.channel = ${p(q.channel)}`;
    if (q.languageCode) where += ` AND t.language_code = ${p(q.languageCode)}`;
    if (q.eventCode) where += ` AND t.event_code = ${p(q.eventCode)}`;
    if (q.platformOnly) where += ' AND t.tenant_id IS NULL';
    // Keyset on the natural key rather than created_at: this registry is browsed by an operator looking for an EVENT,
    // and a list ordered by insertion time makes 1,286 rows unnavigable. Law 8's partition-key-first rule does not
    // apply — `notification_templates` is not partitioned.
    if (q.cursor) where += ` AND (t.event_code, t.channel, t.language_code) > (${p(q.cursor.split('|')[0])}, ${p(q.cursor.split('|')[1] ?? '')}, ${p(q.cursor.split('|')[2] ?? '')})`;
    const r = await this.pool.query(
      `${TEMPLATE_COLS} WHERE ${where} ORDER BY t.event_code, t.channel, t.language_code LIMIT ${p(q.limit)}`, params);
    return r.rows.map(toTemplate);
  }

  async byId(id: string): Promise<TemplateRow | null> {
    const r = await this.pool.query(`${TEMPLATE_COLS} WHERE t.id = $1 AND t.deleted_at IS NULL`, [id]);
    return r.rows[0] ? toTemplate(r.rows[0]) : null;
  }

  async byKey(eventCode: string, channel: string, languageCode: string, tenantId: string | null): Promise<TemplateRow | null> {
    const r = await this.pool.query(
      `${TEMPLATE_COLS} WHERE t.event_code=$1 AND t.channel=$2 AND t.language_code=$3
         AND t.tenant_id IS NOT DISTINCT FROM $4 AND t.deleted_at IS NULL`,
      [eventCode, channel, languageCode, tenantId]);
    return r.rows[0] ? toTemplate(r.rows[0]) : null;
  }

  async versions(templateId: string): Promise<VersionRow[]> {
    const r = await this.pool.query(
      `SELECT id, template_id, version_no, subject, body, provider_template_ref, body_sha256, lifecycle,
              needs_second_person, authored_by_admin_id, approved_by_admin_id, approved_at, rejection_reason,
              reason, created_at
         FROM notification_template_versions
        WHERE template_id = $1 AND deleted_at IS NULL
        ORDER BY version_no DESC`, [templateId]);
    return r.rows.map(toVersion);
  }

  async versionById(client: PoolClient, id: string): Promise<VersionRow | null> {
    const r = await client.query(
      `SELECT id, template_id, version_no, subject, body, provider_template_ref, body_sha256, lifecycle,
              needs_second_person, authored_by_admin_id, approved_by_admin_id, approved_at, rejection_reason,
              reason, created_at
         FROM notification_template_versions WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }

  /** The event catalogue, with its declared variables. One round trip: the authoring screen needs both and a second
   *  query would let them drift between the validation and the panel that explains it. */
  async eventWithVariables(code: string): Promise<{
    code: string; priority: string; userCanOptOut: boolean; defaultChannels: string[];
    variables: { name: string; sourceRef: string; sampleValue: string; isRequired: boolean }[];
  } | null> {
    const r = await this.pool.query(
      `SELECT e.code, e.priority, e.user_can_opt_out, e.default_channels,
              COALESCE((SELECT json_agg(json_build_object('name', v.name, 'sourceRef', v.source_ref,
                                                          'sampleValue', v.sample_value, 'isRequired', v.is_required)
                                        ORDER BY v.is_required DESC, v.name)
                          FROM notification_event_variables v
                         WHERE v.event_code = e.code AND v.deleted_at IS NULL), '[]'::json) AS variables
         FROM notification_events e WHERE e.code = $1 AND e.deleted_at IS NULL`, [code]);
    const row = r.rows[0];
    if (!row) return null;
    return {
      code: String(row.code), priority: String(row.priority), userCanOptOut: Boolean(row.user_can_opt_out),
      defaultChannels: Array.isArray(row.default_channels) ? row.default_channels.map(String) : [],
      variables: (row.variables ?? []) as { name: string; sourceRef: string; sampleValue: string; isRequired: boolean }[],
    };
  }

  /** W101's four headline figures, in one round trip. */
  async census(): Promise<{
    eventsInCatalogue: number; platformTemplates: number; channelsCovered: number; liveLanguages: number;
    providerApprovalsPending: number; unversioned: number; securityCopyOverrides: number;
  }> {
    const r = await this.pool.query(`
      SELECT (SELECT COUNT(*) FROM notification_events WHERE deleted_at IS NULL)::int AS events_in_catalogue,
             (SELECT COUNT(*) FROM notification_templates WHERE tenant_id IS NULL AND deleted_at IS NULL)::int AS platform_templates,
             (SELECT COUNT(DISTINCT channel) FROM notification_templates WHERE deleted_at IS NULL)::int AS channels_covered,
             (SELECT COUNT(*) FROM languages WHERE is_active = true AND deleted_at IS NULL)::int AS live_languages,
             -- "DLT / WA approvals pending 6 · provider_template_ref missing": a template on a channel that REQUIRES a
             -- registration and has none. Counted from the serving version, because the ref belongs to the words.
             (SELECT COUNT(*) FROM notification_templates t
                LEFT JOIN notification_template_versions v ON v.id = t.serving_version_id
               WHERE t.deleted_at IS NULL AND t.channel IN ('sms','whatsapp')
                 AND COALESCE(v.provider_template_ref, t.provider_template_ref) IS NULL)::int AS provider_approvals_pending,
             -- Rows no version points at: a writer that predates this plane, or a rejected-only template. Shown rather
             -- than coalesced away — an unversioned row is a send whose words cannot be reconstructed.
             (SELECT COUNT(*) FROM notification_templates WHERE serving_version_id IS NULL AND deleted_at IS NULL)::int AS unversioned,
             -- **THE AUDIT QUERY FROM 0122 §122.8, RUN ON EVERY PAGE LOAD.** Tenant rows for opt-out-locked or critical
             -- events: wording a tenant took over before the rule was enforced. Zero is the only acceptable number and
             -- it is printed whether it is zero or not.
             (SELECT COUNT(*) FROM notification_templates t JOIN notification_events e ON e.code = t.event_code
               WHERE t.tenant_id IS NOT NULL AND t.deleted_at IS NULL
                 AND (e.user_can_opt_out = false OR e.priority = 'critical'))::int AS security_copy_overrides`);
    const row = r.rows[0];
    return {
      eventsInCatalogue: Number(row.events_in_catalogue), platformTemplates: Number(row.platform_templates),
      channelsCovered: Number(row.channels_covered), liveLanguages: Number(row.live_languages),
      providerApprovalsPending: Number(row.provider_approvals_pending), unversioned: Number(row.unversioned),
      securityCopyOverrides: Number(row.security_copy_overrides),
    };
  }

  /** Coverage inputs: the catalogue, the live languages, and which platform defaults exist. Computed on read (ADMIN-11's
   *  rule): a stored coverage number is wrong the moment a template is authored. */
  async coverageInputs(): Promise<{
    events: { code: string; priority: string; userCanOptOut: boolean; defaultChannels: string[] }[];
    liveLanguages: string[]; present: Set<string>;
  }> {
    const [ev, lang, tpl] = await Promise.all([
      this.pool.query(`SELECT code, priority, user_can_opt_out, default_channels FROM notification_events WHERE deleted_at IS NULL`),
      this.pool.query(`SELECT code FROM languages WHERE is_active = true AND deleted_at IS NULL ORDER BY sort_order, code`),
      this.pool.query(`SELECT event_code, channel, language_code FROM notification_templates
                        WHERE tenant_id IS NULL AND deleted_at IS NULL AND is_active = true`),
    ]);
    return {
      events: ev.rows.map((r) => ({
        code: String(r.code), priority: String(r.priority), userCanOptOut: Boolean(r.user_can_opt_out),
        defaultChannels: Array.isArray(r.default_channels) ? r.default_channels.map(String) : [],
      })),
      liveLanguages: lang.rows.map((r) => String(r.code)),
      present: new Set(tpl.rows.map((r) => `${r.event_code}|${r.channel}|${r.language_code}`)),
    };
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* WRITES — all inside a caller-owned transaction (Law 4)                                          */
  /* ---------------------------------------------------------------------------------------------- */

  /** Create the template ROW when the event×channel×language×tenant combination has none yet. The row is the identity;
   *  the words live in versions. `is_active` starts FALSE: a template with no approved version must not be picked up by
   *  `resolve()`, and the old default of true is how an unapproved body would have started sending. */
  async createTemplateShell(client: PoolClient, t: {
    eventCode: string; channel: string; languageCode: string; tenantId: string | null; adminId: string;
  }): Promise<string> {
    // The id comes from the DATABASE (`uuid_generate_v7()`), not from the service. admin-api has no uuid helper of its
    // own, and inventing one here would give this realm a second id generator that could drift from the tenant realm's.
    // `current_version_no` starts at 0 and `is_active` at FALSE: a template row whose words have not been approved must
    // not be picked up by `resolve()`, and 0012's `is_active DEFAULT true` is exactly how an unapproved body would start
    // sending the moment the row appeared.
    const r = await client.query(
      `INSERT INTO notification_templates
         (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active,
          current_version_no, created_by)
       VALUES ($1,$2,$3,$4,NULL,'',NULL,false,0,$5) RETURNING id`,
      [t.eventCode, t.channel, t.languageCode, t.tenantId, t.adminId]);
    return String(r.rows[0].id);
  }

  async nextVersionNo(client: PoolClient, templateId: string): Promise<number> {
    const r = await client.query(
      `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM notification_template_versions WHERE template_id = $1`, [templateId]);
    return Number(r.rows[0].n);
  }

  async insertVersion(client: PoolClient, v: {
    templateId: string; tenantId: string | null; eventCode: string; channel: string; languageCode: string;
    versionNo: number; subject: string | null; body: string; providerTemplateRef: string | null;
    needsSecondPerson: boolean; authoredByAdminId: string; reason: string;
  }): Promise<string> {
    const r = await client.query(
      `INSERT INTO notification_template_versions
         (template_id, tenant_id, event_code, channel, language_code, version_no, subject, body,
          provider_template_ref, body_sha256, lifecycle, needs_second_person, authored_by_admin_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, encode(digest($8,'sha256'),'hex'), 'draft', $10,$11,$12,$11)
       RETURNING id`,
      [v.templateId, v.tenantId, v.eventCode, v.channel, v.languageCode, v.versionNo, v.subject, v.body,
        v.providerTemplateRef, v.needsSecondPerson, v.authoredByAdminId, v.reason]);
    await client.query(`UPDATE notification_templates SET current_version_no = $2, updated_at = now() WHERE id = $1`,
      [v.templateId, v.versionNo]);
    return String(r.rows[0].id);
  }

  async setLifecycle(client: PoolClient, versionId: string, lifecycle: string, extra: {
    approverAdminId?: string; rejectionReason?: string;
  } = {}): Promise<void> {
    await client.query(
      `UPDATE notification_template_versions
          SET lifecycle = $2,
              approved_by_admin_id = COALESCE($3, approved_by_admin_id),
              approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
              rejection_reason = COALESCE($4, rejection_reason),
              updated_at = now()
        WHERE id = $1`,
      [versionId, lifecycle, extra.approverAdminId ?? null, extra.rejectionReason ?? null]);
  }

  /** Move the serving pointer, supersede the version it replaced, and make the row sendable. **ONE STATEMENT SET, ONE
   *  TRANSACTION**: a serving pointer that moved without the old version being superseded would show two approved
   *  versions and no way to tell which one is live. */
  async promoteToServing(client: PoolClient, templateId: string, versionId: string): Promise<void> {
    await client.query(
      `UPDATE notification_template_versions SET lifecycle = 'superseded', updated_at = now()
        WHERE template_id = $1 AND lifecycle = 'approved' AND id <> $2`, [templateId, versionId]);
    await client.query(
      `UPDATE notification_templates SET serving_version_id = $2, is_active = true, updated_at = now()
        WHERE id = $1`, [templateId, versionId]);
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* SENDER REGISTRY                                                                                 */
  /* ---------------------------------------------------------------------------------------------- */

  async listSenders(): Promise<{
    id: string; channel: string; sender: string; entityId: string | null; countryCode: string;
    provider: string | null; status: string; verifiedByProviderAt: string | null; note: string | null;
  }[]> {
    const r = await this.pool.query(
      `SELECT id, channel, sender, entity_id, country_code, provider, status, verified_by_provider_at, note
         FROM messaging_sender_ids WHERE deleted_at IS NULL ORDER BY country_code, channel, sender`);
    return r.rows.map((x) => ({
      id: String(x.id), channel: String(x.channel), sender: String(x.sender),
      entityId: (x.entity_id as string | null) ?? null, countryCode: String(x.country_code),
      provider: (x.provider as string | null) ?? null, status: String(x.status),
      verifiedByProviderAt: x.verified_by_provider_at ? new Date(String(x.verified_by_provider_at)).toISOString() : null,
      note: (x.note as string | null) ?? null,
    }));
  }

  async insertSender(client: PoolClient, s: {
    channel: string; sender: string; entityId: string | null; countryCode: string; provider: string | null;
    note: string | null; adminId: string;
  }): Promise<string> {
    const r = await client.query(
      `INSERT INTO messaging_sender_ids (channel, sender, entity_id, country_code, provider, status, registered_by_admin_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,'recorded',$6,$7,$6) RETURNING id`,
      [s.channel, s.sender, s.entityId, s.countryCode.toUpperCase(), s.provider, s.adminId, s.note]);
    return String(r.rows[0].id);
  }
}
