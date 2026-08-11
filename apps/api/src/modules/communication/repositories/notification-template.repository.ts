// modules/communication/repositories/notification-template.repository.ts · per event×channel×language templates
// (+ tenant overrides). resolve() prefers the tenant's own active template, else the platform default
// (tenant_id IS NULL) — the UNIQUE(event_code,channel,language_code,tenant_id) backs the upsert. tenant_id in
// every tenant-scoped query (Law 1) + RLS. Reads accept an optional tx for the fanout handler's connection.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { NotificationTemplate } from '../domain/notification-template.entity';
import { NotifChannel } from '../domain/communication.events';

const COLS = `id, event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active, created_at`;

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
export interface TemplateListQuery { eventCode?: string; channel?: string; languageCode?: string; cursor?: { c: string; id: string }; limit: number; }

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

  /** The version id whose words this template is serving — recorded on the delivery row so a send can be reconstructed
   *  years later. Returned by `resolve()` on the domain object; exposed separately for callers that already hold one. */

  async upsert(tx: TxContext, tenantId: string, t: { eventCode: string; channel: string; languageCode: string; subject: string | null; body: string; providerTemplateRef: string | null; isActive: boolean }, id: string): Promise<void> {
    await tx.query(
      `INSERT INTO notification_templates (id, event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)
       ON CONFLICT (event_code, channel, language_code, tenant_id) DO UPDATE
         SET subject=EXCLUDED.subject, body=EXCLUDED.body, provider_template_ref=EXCLUDED.provider_template_ref, is_active=EXCLUDED.is_active, updated_at=now()`,
      [id, t.eventCode, t.channel, t.languageCode, tenantId, t.subject, t.body, t.providerTemplateRef, t.isActive]);
  }

  /** Tenant templates + platform defaults visible to the tenant. Keyset (never OFFSET). */
  async listFor(tenantId: string, q: TemplateListQuery): Promise<NotificationTemplate[]> {
    const params: unknown[] = [tenantId]; let where = `(tenant_id=$1 OR tenant_id IS NULL) AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.eventCode) where += ` AND event_code=${p(q.eventCode)}`;
    if (q.channel) where += ` AND channel=${p(q.channel)}`;
    if (q.languageCode) where += ` AND language_code=${p(q.languageCode)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM notification_templates WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
