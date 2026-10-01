// modules/communication/repositories/notification-template.repository.ts · per event×channel×language templates
// (+ tenant overrides). resolve() prefers the tenant's own active template, else the platform default
// (tenant_id IS NULL). tenant_id in every tenant-scoped query (Law 1) + RLS. Reads accept an optional tx for the
// fanout handler's connection.
//
// [PC-56 TENANT-8a] THE IN-PLACE UPSERT IS GONE, AND SO IS THE LIST THAT READ `t.body`. `upsert()` replaced a tenant
// row's `body` under `ON CONFLICT … DO UPDATE` and minted no version, so the words `resolve()` reads never changed
// (F-1); `listFor()` returned `t.body` — the row, not the serving version — so the API printed as live words that
// never sent. The tenant realm now writes a DRAFT VERSION (0175 grants the INSERT) and the row's serving pointer moves
// only by the approval act; every read below takes the words from the SERVING VERSION.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { NotificationTemplate } from '../domain/notification-template.entity';
import { NotifChannel } from '../domain/communication.events';
import { createHash } from 'node:crypto';

// **THE WORDS COME FROM THE SERVING VERSION, NOT FROM THE ROW (0122).** Before that migration `body` was replaced in
// place by the upsert below, so `notifications.template_id` pointed at a row whose text could have changed since the
// send and the delivery log could not say what a recipient had read. The version is immutable (a trigger enforces it),
// so this join is what makes the log's claim true.
//
// **AND THE LIFECYCLE IS CHECKED HERE FOR THE FIRST TIME.** 0072 added `lifecycle_status` — draft, submitted, approved,
// rejected, paused — and no code in the monorepo ever read it: `resolve()` sent on `is_active` alone, so a template
// WhatsApp had rejected or paused was fully sendable, which is how a business number gets blocked. A row with no
// approved version now resolves to NOTHING and the fallback chain moves on to the next language.
const RESOLVE_COLS = `t.id, t.event_code, t.channel, t.language_code, t.tenant_id,
  v.subject AS subject, v.body AS body, v.provider_template_ref AS provider_template_ref,
  t.is_active, t.created_at, v.id AS version_id, v.version_no`;
function toDomain(r: any): NotificationTemplate {
  return NotificationTemplate.rehydrate({ id: r.id, eventCode: r.event_code, channel: r.channel as NotifChannel, languageCode: r.language_code,
    tenantId: r.tenant_id, subject: r.subject, body: r.body, providerTemplateRef: r.provider_template_ref, isActive: r.is_active, createdAt: r.created_at,
    versionId: r.version_id ?? null, versionNo: r.version_no ?? null });
}

@Injectable()
export class NotificationTemplateRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Resolve the effective template: tenant override first, then platform default. Active AND approved only. */
  async resolve(tenantId: string | null, eventCode: string, channel: string, languageCode: string, tx?: TxContext): Promise<NotificationTemplate | null> {
    const sql = `SELECT ${RESOLVE_COLS} FROM notification_templates t
       JOIN notification_template_versions v
         ON v.id = t.serving_version_id AND v.lifecycle = 'approved' AND v.deleted_at IS NULL
       WHERE t.event_code=$1 AND t.channel=$2 AND t.language_code=$3 AND t.is_active=true AND t.deleted_at IS NULL
         AND (t.tenant_id=$4 OR t.tenant_id IS NULL)
       ORDER BY t.tenant_id NULLS LAST LIMIT 1`;        // a tenant row sorts before the NULL platform row
    const params = [eventCode, channel, languageCode, tenantId];
    const r = tx ? await tx.query(sql, params) : await this.replica.forTenant(tenantId ?? '').query(sql, params);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /* ============================================================================================================ */
  /* PC-56 TENANT-8a · THE OVERRIDE                                                                               */
  /* ============================================================================================================ */

  /** This tenant's languages in its own order (`tenant_languages`: the default first, then the registry's order).
   *  Empty when the tenant declared none — nothing in apps/api writes the table today. */
  async tenantLanguageOrder(tenantId: string | null, tx?: TxContext): Promise<string[]> {
    if (!tenantId) return [];
    const sql = `SELECT tl.language_code FROM tenant_languages tl JOIN languages lg ON lg.code = tl.language_code
      WHERE tl.tenant_id = $1 AND lg.deleted_at IS NULL ORDER BY tl.is_default DESC, lg.sort_order, tl.language_code`;
    const r = tx ? await tx.query(sql, [tenantId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId]);
    return r.rows.map((x: any) => String(x.language_code));
  }

  /** The platform registry's active languages, in its order — the house rule for a tenant that declared none. */
  async activeLanguages(): Promise<Array<{ code: string; nameEnglish: string; nameNative: string }>> {
    const r = await this.replica.forTenant('').query(
      `SELECT code, name_english, name_native FROM languages WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: String(x.code), nameEnglish: String(x.name_english), nameNative: String(x.name_native) }));
  }

  /** The event's declared variables (0122's contract), required first. */
  async variablesFor(eventCode: string, tx?: TxContext): Promise<Array<{ name: string; sourceRef: string; sampleValue: string; isRequired: boolean }>> {
    const sql = `SELECT name, source_ref, sample_value, is_required FROM notification_event_variables
      WHERE event_code = $1 AND deleted_at IS NULL ORDER BY is_required DESC, name`;
    const r = tx ? await tx.query(sql, [eventCode]) : await this.replica.forTenant('').query(sql, [eventCode]);
    return r.rows.map((x: any) => ({ name: String(x.name), sourceRef: String(x.source_ref), sampleValue: String(x.sample_value), isRequired: Boolean(x.is_required) }));
  }

  /** W180's rows: one per event × channel × language that has a platform default or this tenant's override, keyset on
   *  the slot itself (never OFFSET). The words' SOURCE is computed from the serving versions, never from `is_active`. */
  async index(tenantId: string, q: OverrideIndexQuery): Promise<OverrideIndexRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'TRUE';
    if (q.eventCode) where += ` AND s.event_code LIKE ${p(q.eventCode.replace(/[\\%_]/g, (m) => `\\${m}`) + '%')}`;
    if (q.channel) where += ` AND s.channel = ${p(q.channel)}`;
    if (q.languageCode) where += ` AND s.language_code = ${p(q.languageCode)}`;
    if (q.only === 'overrides') where += ` AND o.id IS NOT NULL`;
    if (q.cursor) where += ` AND (s.event_code, s.channel, s.language_code) > (${p(q.cursor.e)}, ${p(q.cursor.c)}, ${p(q.cursor.l)})`;
    const lim = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`${SLOT_SQL} WHERE ${where}
      ORDER BY s.event_code, s.channel, s.language_code LIMIT ${lim}`, params);
    return r.rows.map(toIndexRow);
  }

  /** One slot — for W181, by any template id this tenant can see (its own override or the platform default). */
  async slotOf(tenantId: string, templateId: string, tx?: TxContext): Promise<OverrideIndexRow | null> {
    const run = (sql: string, ps: unknown[]) => (tx ? tx.query(sql, ps) : this.replica.forTenant(tenantId).query(sql, ps));
    const t = await run(`SELECT event_code, channel, language_code FROM notification_templates
      WHERE id = $2 AND deleted_at IS NULL AND (tenant_id IS NULL OR tenant_id = $1)`, [tenantId, templateId]);
    if (!t.rows[0]) return null;
    const x = t.rows[0] as any;
    return this.slot(tenantId, x.event_code, x.channel, x.language_code, tx);
  }

  async slot(tenantId: string, eventCode: string, channel: string, languageCode: string, tx?: TxContext): Promise<OverrideIndexRow | null> {
    const sql = `${SLOT_SQL_FOR_ONE} WHERE TRUE ORDER BY 1 LIMIT 1`;
    const ps = [tenantId, eventCode, channel, languageCode];
    const r = tx ? await tx.query(sql, ps) : await this.replica.forTenant(tenantId).query(sql, ps);
    return r.rows[0] ? toIndexRow(r.rows[0]) : null;
  }

  /** The words a template is serving (its approved serving version), for the reference pane and the review's diff. */
  async servingWords(tenantId: string, templateId: string | null, tx?: TxContext): Promise<{ versionNo: number; subject: string | null; body: string; approvedAt: Date | null } | null> {
    if (!templateId) return null;
    const sql = `SELECT v.version_no, v.subject, v.body, v.approved_at FROM notification_templates t
      JOIN notification_template_versions v ON v.id = t.serving_version_id AND v.lifecycle = 'approved' AND v.deleted_at IS NULL
      WHERE t.id = $2 AND t.is_active AND t.deleted_at IS NULL AND (t.tenant_id IS NULL OR t.tenant_id = $1)`;
    const r = tx ? await tx.query(sql, [tenantId, templateId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, templateId]);
    const x = r.rows[0] as any;
    return x ? { versionNo: Number(x.version_no), subject: x.subject ?? null, body: String(x.body), approvedAt: x.approved_at ?? null } : null;
  }

  /** Every version of THIS TENANT's override — W181's history, newest first, with who wrote and who decided it. */
  async versionsOf(tenantId: string, templateId: string, tx?: TxContext): Promise<OverrideVersionRow[]> {
    const sql = `SELECT v.id, v.version_no, v.lifecycle, v.subject, v.body, v.reason, v.rejection_reason, v.created_at,
        v.authored_by_user_id, ua.full_name AS author_name, v.submitted_at, v.approved_by_user_id, uc.full_name AS approver_name,
        v.approved_by_admin_id, v.approved_at, v.rejected_by_user_id, ur.full_name AS rejecter_name, v.rejected_at
      FROM notification_template_versions v
      LEFT JOIN users ua ON ua.id = v.authored_by_user_id
      LEFT JOIN users uc ON uc.id = v.approved_by_user_id
      LEFT JOIN users ur ON ur.id = v.rejected_by_user_id
      WHERE v.template_id = $2 AND v.tenant_id = $1 AND v.deleted_at IS NULL
      ORDER BY v.version_no DESC LIMIT 50`;
    const r = tx ? await tx.query(sql, [tenantId, templateId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, templateId]);
    return r.rows.map(toVersionRow);
  }

  /** W180's honest header — every figure a live count, never a literal (F-12). */
  async summary(tenantId: string): Promise<OverrideSummary> {
    const r = await this.replica.forTenant(tenantId).query(`
      WITH serving AS (
        SELECT t.event_code, t.channel, t.tenant_id FROM notification_templates t
          JOIN notification_template_versions v ON v.id = t.serving_version_id AND v.lifecycle = 'approved' AND v.deleted_at IS NULL
         WHERE t.is_active AND t.deleted_at IS NULL AND (t.tenant_id IS NULL OR t.tenant_id = $1))
      SELECT
        (SELECT count(*)::int FROM notification_events WHERE deleted_at IS NULL) AS events_total,
        (SELECT count(*)::int FROM notification_events WHERE deleted_at IS NULL AND (user_can_opt_out = false OR priority = 'critical')) AS locked_events,
        (SELECT coalesce(json_agg(e.code ORDER BY e.code), '[]'::json) FROM notification_events e
          WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM serving s WHERE s.event_code = e.code)) AS events_without_template,
        (SELECT count(*)::int FROM serving WHERE channel = 'whatsapp') AS whatsapp_serving,
        (SELECT count(*)::int FROM notification_events WHERE deleted_at IS NULL AND default_channels ? 'whatsapp') AS whatsapp_events,
        (SELECT count(*)::int FROM notification_templates WHERE tenant_id IS NULL AND deleted_at IS NULL) AS platform_rows,
        (SELECT count(*)::int FROM serving WHERE tenant_id IS NULL) AS platform_serving,
        (SELECT count(*)::int FROM notification_templates WHERE tenant_id = $1 AND deleted_at IS NULL) AS override_rows,
        (SELECT count(*)::int FROM serving WHERE tenant_id = $1) AS overrides_serving,
        (SELECT count(*)::int FROM notification_template_versions WHERE tenant_id = $1 AND lifecycle IN ('draft', 'submitted') AND deleted_at IS NULL) AS versions_open,
        (SELECT count(*)::int FROM notification_template_versions WHERE tenant_id = $1 AND lifecycle = 'submitted_to_provider' AND deleted_at IS NULL) AS versions_at_provider`, [tenantId]);
    const x = r.rows[0] as any;
    return {
      eventsTotal: x.events_total, lockedEvents: x.locked_events, eventsWithoutTemplate: (x.events_without_template ?? []) as string[],
      whatsappServing: x.whatsapp_serving, whatsappEvents: x.whatsapp_events, platformRows: x.platform_rows, platformServing: x.platform_serving,
      overrideRows: x.override_rows, overridesServing: x.overrides_serving, versionsOpen: x.versions_open, versionsAtProvider: x.versions_at_provider,
    };
  }

  /* ---- writes (all inside the act's transaction, tenant context set by the unit of work) ---------------------- */

  async lockOverride(tx: TxContext, tenantId: string, eventCode: string, channel: string, languageCode: string): Promise<{ id: string; isActive: boolean; servingVersionId: string | null; currentVersionNo: number } | null> {
    const r = await tx.query(`SELECT id, is_active, serving_version_id, current_version_no FROM notification_templates
      WHERE tenant_id = $1 AND event_code = $2 AND channel = $3 AND language_code = $4 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId, eventCode, channel, languageCode]);
    const x = r.rows[0] as any;
    return x ? { id: String(x.id), isActive: Boolean(x.is_active), servingVersionId: x.serving_version_id ?? null, currentVersionNo: Number(x.current_version_no) } : null;
  }

  async lockOverrideById(tx: TxContext, tenantId: string, templateId: string): Promise<{ id: string; eventCode: string; channel: string; languageCode: string; isActive: boolean; servingVersionId: string | null } | null> {
    const r = await tx.query(`SELECT id, event_code, channel, language_code, is_active, serving_version_id FROM notification_templates
      WHERE id = $2 AND tenant_id = $1 AND deleted_at IS NULL FOR UPDATE`, [tenantId, templateId]);
    const x = r.rows[0] as any;
    return x ? { id: String(x.id), eventCode: String(x.event_code), channel: String(x.channel), languageCode: String(x.language_code), isActive: Boolean(x.is_active), servingVersionId: x.serving_version_id ?? null } : null;
  }

  /** The override row: born INACTIVE with no serving version (0175's guard refuses anything else). `body` stays '' —
   *  a tenant row's words live only in its versions. */
  async insertOverrideRow(tx: TxContext, tenantId: string, id: string, slot: { eventCode: string; channel: string; languageCode: string }, userId: string): Promise<void> {
    await tx.query(`INSERT INTO notification_templates (id, event_code, channel, language_code, tenant_id, subject, body, is_active, current_version_no, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,NULL,'',false,1,$6,$6)`, [id, slot.eventCode, slot.channel, slot.languageCode, tenantId, userId]);
  }

  async nextVersionNo(tx: TxContext, templateId: string): Promise<number> {
    const r = await tx.query(`SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM notification_template_versions WHERE template_id = $1`, [templateId]);
    return Number((r.rows[0] as any).n);
  }

  /** A DRAFT version, authored by a member. tenant_id / event / channel / language / sha are the trigger's (0175). */
  async insertDraftVersion(tx: TxContext, v: { templateId: string; tenantId: string; eventCode: string; channel: string; languageCode: string; versionNo: number; subject: string | null; body: string; authorUserId: string; reason: string }): Promise<string> {
    const sha = createHash('sha256').update(v.body, 'utf8').digest('hex');
    const r = await tx.query(`INSERT INTO notification_template_versions
        (template_id, tenant_id, event_code, channel, language_code, version_no, subject, body, body_sha256, lifecycle, needs_second_person, authored_by_user_id, reason, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',true,$10,$11,$10) RETURNING id`,
      [v.templateId, v.tenantId, v.eventCode, v.channel, v.languageCode, v.versionNo, v.subject, v.body, sha, v.authorUserId, v.reason]);
    await tx.query(`UPDATE notification_templates SET current_version_no = $2, updated_by = $3 WHERE id = $1`, [v.templateId, v.versionNo, v.authorUserId]);
    return String((r.rows[0] as any).id);
  }

  async openVersionForUpdate(tx: TxContext, tenantId: string, templateId: string): Promise<{ id: string; versionNo: number; lifecycle: string; authoredByUserId: string | null } | null> {
    const r = await tx.query(`SELECT id, version_no, lifecycle, authored_by_user_id FROM notification_template_versions
      WHERE template_id = $2 AND tenant_id = $1 AND lifecycle IN ('draft', 'submitted') AND deleted_at IS NULL FOR UPDATE`, [tenantId, templateId]);
    const x = r.rows[0] as any;
    return x ? { id: String(x.id), versionNo: Number(x.version_no), lifecycle: String(x.lifecycle), authoredByUserId: x.authored_by_user_id ?? null } : null;
  }

  /** The decision columns only (0175's column grant). The lifecycle it is handed is the state machine's answer. */
  async decideVersion(tx: TxContext, tenantId: string, versionId: string, to: string, by: string, act: 'submit' | 'approve' | 'reject' | 'withdraw', reason: string): Promise<void> {
    if (act === 'submit') {
      await tx.query(`UPDATE notification_template_versions SET lifecycle = $3, submitted_by_user_id = $4, submitted_at = now(), updated_by = $4
        WHERE id = $2 AND tenant_id = $1`, [tenantId, versionId, to, by]);
    } else if (act === 'approve') {
      await tx.query(`UPDATE notification_template_versions SET lifecycle = $3, approved_by_user_id = $4, approved_at = now(), updated_by = $4
        WHERE id = $2 AND tenant_id = $1`, [tenantId, versionId, to, by]);
    } else {
      await tx.query(`UPDATE notification_template_versions SET lifecycle = $3, rejected_by_user_id = $4, rejected_at = now(), rejection_reason = $5, updated_by = $4
        WHERE id = $2 AND tenant_id = $1`, [tenantId, versionId, to, by, reason.slice(0, 300)]);
    }
  }

  /** Make an approved version SERVING: the version it replaces is superseded and the row made active — one statement
   *  set in the act's transaction (ADMIN-11b's `promoteToServing`, in the tenant realm). */
  async promote(tx: TxContext, tenantId: string, templateId: string, versionId: string, by: string): Promise<void> {
    await tx.query(`UPDATE notification_template_versions SET lifecycle = 'superseded', updated_by = $4
      WHERE template_id = $2 AND tenant_id = $1 AND lifecycle = 'approved' AND id <> $3`, [tenantId, templateId, versionId, by]);
    await tx.query(`UPDATE notification_templates SET serving_version_id = $3, is_active = true, updated_by = $4
      WHERE id = $2 AND tenant_id = $1`, [tenantId, templateId, versionId, by]);
  }

  /** Retire the override: its serving version superseded, the row inactive — `resolve()` answers from the platform
   *  default on the next send (fallback-never-silence). */
  async retire(tx: TxContext, tenantId: string, templateId: string, by: string): Promise<void> {
    await tx.query(`UPDATE notification_template_versions SET lifecycle = 'superseded', updated_by = $3
      WHERE template_id = $2 AND tenant_id = $1 AND lifecycle = 'approved'`, [tenantId, templateId, by]);
    await tx.query(`UPDATE notification_templates SET serving_version_id = NULL, is_active = false, updated_by = $3
      WHERE id = $2 AND tenant_id = $1`, [tenantId, templateId, by]);
  }
}

/* ---- the slot read (W180 / W181) --------------------------------------------------------------------------- */

export interface OverrideIndexQuery { eventCode?: string; channel?: string; languageCode?: string; only?: 'all' | 'overrides'; cursor?: { e: string; c: string; l: string }; limit: number }

export interface OverrideIndexRow {
  eventCode: string; channel: string; languageCode: string;
  priority: string; userCanOptOut: boolean; channelIsDefault: boolean; defaultChannels: string[];
  platform: { templateId: string | null; servingVersionNo: number | null; serves: boolean };
  override: { templateId: string | null; servingVersionNo: number | null; serves: boolean; servingSince: Date | null; latestVersionNo: number | null; latestLifecycle: string | null; latestAt: Date | null };
}
export interface OverrideVersionRow {
  id: string; versionNo: number; lifecycle: string; subject: string | null; body: string; reason: string; rejectionReason: string | null; createdAt: Date;
  authoredByUserId: string | null; authorName: string | null; submittedAt: Date | null;
  approvedByUserId: string | null; approverName: string | null; approvedByAdmin: boolean; approvedAt: Date | null;
  rejectedByUserId: string | null; rejecterName: string | null; rejectedAt: Date | null;
}
export interface OverrideSummary {
  eventsTotal: number; lockedEvents: number; eventsWithoutTemplate: string[]; whatsappServing: number; whatsappEvents: number;
  platformRows: number; platformServing: number; overrideRows: number; overridesServing: number; versionsOpen: number; versionsAtProvider: number;
}

const SLOT_COLS = `s.event_code, s.channel, s.language_code, e.priority, e.user_can_opt_out, e.default_channels,
    (e.default_channels ? s.channel) AS in_defaults,
    p.id AS p_id, pv.version_no AS p_serving_no, COALESCE(p.is_active AND pv.id IS NOT NULL, false) AS p_serves,
    o.id AS o_id, ov.version_no AS o_serving_no, COALESCE(o.is_active AND ov.id IS NOT NULL, false) AS o_serves, ov.approved_at AS o_serving_since,
    ol.version_no AS o_latest_no, ol.lifecycle AS o_latest_lifecycle, ol.created_at AS o_latest_at`;
const SLOT_JOINS = `JOIN notification_events e ON e.code = s.event_code AND e.deleted_at IS NULL
  LEFT JOIN notification_templates p ON p.tenant_id IS NULL AND p.deleted_at IS NULL
        AND p.event_code = s.event_code AND p.channel = s.channel AND p.language_code = s.language_code
  LEFT JOIN notification_template_versions pv ON pv.id = p.serving_version_id AND pv.lifecycle = 'approved' AND pv.deleted_at IS NULL
  LEFT JOIN notification_templates o ON o.tenant_id = $1 AND o.deleted_at IS NULL
        AND o.event_code = s.event_code AND o.channel = s.channel AND o.language_code = s.language_code
  LEFT JOIN notification_template_versions ov ON ov.id = o.serving_version_id AND ov.lifecycle = 'approved' AND ov.deleted_at IS NULL
  LEFT JOIN LATERAL (SELECT version_no, lifecycle, created_at FROM notification_template_versions
        WHERE template_id = o.id AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1) ol ON true`;
const SLOT_SQL = `WITH slots AS (
    SELECT DISTINCT event_code, channel, language_code FROM notification_templates
     WHERE deleted_at IS NULL AND (tenant_id IS NULL OR tenant_id = $1))
  SELECT ${SLOT_COLS} FROM slots s ${SLOT_JOINS}`;
/** One slot, which need not have any row yet (a NEW override on an event × channel × language with no default). */
const SLOT_SQL_FOR_ONE = `WITH slots AS (SELECT $2::varchar AS event_code, $3::varchar AS channel, $4::varchar AS language_code)
  SELECT ${SLOT_COLS} FROM slots s ${SLOT_JOINS}`;

function toIndexRow(x: any): OverrideIndexRow {
  return {
    eventCode: String(x.event_code), channel: String(x.channel), languageCode: String(x.language_code),
    priority: String(x.priority), userCanOptOut: Boolean(x.user_can_opt_out), channelIsDefault: Boolean(x.in_defaults),
    defaultChannels: Array.isArray(x.default_channels) ? (x.default_channels as string[]) : [],
    platform: { templateId: x.p_id ?? null, servingVersionNo: x.p_serving_no == null ? null : Number(x.p_serving_no), serves: Boolean(x.p_serves) },
    override: {
      templateId: x.o_id ?? null, servingVersionNo: x.o_serving_no == null ? null : Number(x.o_serving_no), serves: Boolean(x.o_serves),
      servingSince: x.o_serving_since ?? null, latestVersionNo: x.o_latest_no == null ? null : Number(x.o_latest_no),
      latestLifecycle: x.o_latest_lifecycle ?? null, latestAt: x.o_latest_at ?? null,
    },
  };
}
function toVersionRow(x: any): OverrideVersionRow {
  return {
    id: String(x.id), versionNo: Number(x.version_no), lifecycle: String(x.lifecycle), subject: x.subject ?? null, body: String(x.body),
    reason: String(x.reason), rejectionReason: x.rejection_reason ?? null, createdAt: x.created_at,
    authoredByUserId: x.authored_by_user_id ?? null, authorName: x.author_name ?? null, submittedAt: x.submitted_at ?? null,
    approvedByUserId: x.approved_by_user_id ?? null, approverName: x.approver_name ?? null, approvedByAdmin: x.approved_by_admin_id != null,
    approvedAt: x.approved_at ?? null, rejectedByUserId: x.rejected_by_user_id ?? null, rejecterName: x.rejecter_name ?? null, rejectedAt: x.rejected_at ?? null,
  };
}
