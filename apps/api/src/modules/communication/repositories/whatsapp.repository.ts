// modules/communication/repositories/whatsapp.repository.ts · PC-56 TENANT-8e · the facts W425–W430 print, and the one
// WhatsApp record a cooperative can write (its opt-in policy, 0179). tenant_id in every query + RLS (`woo_tenant`).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface OptinPolicyRow { sources: string[]; consentStatement: string; collectionState: 'not_collected'; version: number; updatedAt: Date; updatedBy: string | null; createdAt: Date }
export interface ChannelServing { channel: string; platform: number; own: number }

@Injectable()
export class WhatsAppRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** What the provider registry says: the WhatsApp answer (0179's function) and the message providers that DO exist. */
  async providerFacts(tenantId: string): Promise<{ connected: boolean; messageProviders: Array<{ code: string; category: string }> }> {
    const r = await this.replica.forTenant(tenantId).query<{ connected: boolean; providers: Array<{ code: string; category: string }> | null }>(
      `SELECT whatsapp_provider_connected() AS connected,
              (SELECT jsonb_agg(jsonb_build_object('code', code, 'category', category) ORDER BY code) FROM integration_providers
                WHERE category IN ('sms', 'whatsapp', 'email', 'voice') AND is_active AND deleted_at IS NULL) AS providers`);
    return { connected: Boolean(r.rows[0]?.connected), messageProviders: r.rows[0]?.providers ?? [] };
  }
  /** Serving templates this cooperative's members can receive, by channel: the platform's and its own approved overrides
   *  (`resolve()`'s join). WhatsApp is counted like every other channel — and is 0. */
  async servingByChannel(tenantId: string): Promise<ChannelServing[]> {
    const r = await this.replica.forTenant(tenantId).query<{ channel: string; platform: number; own: number }>(
      `SELECT t.channel, count(*) FILTER (WHERE t.tenant_id IS NULL)::int AS platform, count(*) FILTER (WHERE t.tenant_id = $1)::int AS own
         FROM notification_templates t
         JOIN notification_template_versions v ON v.id = t.serving_version_id AND v.lifecycle = 'approved' AND v.deleted_at IS NULL
        WHERE t.is_active AND t.deleted_at IS NULL AND (t.tenant_id IS NULL OR t.tenant_id = $1)
        GROUP BY t.channel ORDER BY t.channel`, [tenantId]);
    return r.rows.map((x) => ({ channel: x.channel, platform: Number(x.platform), own: Number(x.own) }));
  }
  /** This cooperative's WhatsApp override rows (8a's plane — any lifecycle; none can serve: no provider). */
  async whatsappOverrides(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification_templates WHERE tenant_id = $1 AND channel = 'whatsapp' AND deleted_at IS NULL`, [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  /** Catalogued events that LIST whatsapp as a default channel — each records a WhatsApp leg it cannot send. */
  async eventsDeclaringWhatsApp(): Promise<string[]> {
    const r = await this.replica.forTenant('').query<{ code: string }>(
      `SELECT code FROM notification_events WHERE deleted_at IS NULL AND default_channels ? 'whatsapp' ORDER BY code`);
    return r.rows.map((x) => x.code);
  }
  /** The `whatsapp_optin_source` vocabulary (platform rows, Law 6), in its order. */
  async optinSources(): Promise<Array<{ code: string; name: string }>> {
    const r = await this.replica.forTenant('').query<{ code: string; default_name: string }>(
      `SELECT code, default_name FROM lookup_values WHERE type_code = 'whatsapp_optin_source' AND tenant_id IS NULL AND is_active AND deleted_at IS NULL
        ORDER BY sort_order, code`);
    return r.rows.map((x) => ({ code: x.code, name: x.default_name }));
  }
  async getPolicy(tenantId: string, tx?: TxContext): Promise<OptinPolicyRow | null> {
    const sql = `SELECT sources, consent_statement, collection_state, version, updated_at, updated_by, created_at FROM whatsapp_optin_policies
                  WHERE tenant_id = $1 AND deleted_at IS NULL ${tx ? 'FOR UPDATE' : ''}`;
    const r = tx ? await tx.query(sql, [tenantId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId]);
    const x = r.rows[0];
    return x ? { sources: x.sources, consentStatement: x.consent_statement, collectionState: x.collection_state, version: Number(x.version), updatedAt: x.updated_at, updatedBy: x.updated_by, createdAt: x.created_at } : null;
  }
  async insertPolicy(tx: TxContext, tenantId: string, sources: string[], statement: string, actor: string): Promise<void> {
    await tx.query(`INSERT INTO whatsapp_optin_policies (tenant_id, sources, consent_statement, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)`,
      [tenantId, sources, statement, actor]);
  }
  async updatePolicy(tx: TxContext, tenantId: string, sources: string[], statement: string, actor: string): Promise<void> {
    await tx.query(`UPDATE whatsapp_optin_policies SET sources = $2, consent_statement = $3, version = version + 1, updated_by = $4
                     WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId, sources, statement, actor]);
  }
}
