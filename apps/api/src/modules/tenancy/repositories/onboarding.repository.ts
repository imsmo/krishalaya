// modules/tenancy/repositories/onboarding.repository.ts · PC-56 TENANT-SW-d · W114 — SQL for signup step 2 (the organisation profile).
// Every read is the CALLER'S OWN tenant (the `tenants` wall, 0200: `id = current_tenant_id()`); the region reads are platform
// reference data (`admin_regions`, no tenant). Drafts are owner-only by 0200's trigger; this file never names an owner the session
// is not.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import type { DistrictState } from '../domain/onboarding';

export interface OnboardingFacts {
  status: string; countryCode: string; onboardingStep: 'profile' | 'done' | null; profileCompletedAt: string | null;
  legalName: string; displayName: string; regionId: string | null; cinOrRegNo: string | null; pan: string | null; gstin: string | null;
  fssaiLicense: string | null; brandVersion: number;
}
export interface DraftRow { ownerUserId: string; payload: Record<string, string>; savedAt: string; expiresAt: string; expired: boolean }
export interface DistrictOption { id: string; name: string; stateId: string; stateName: string; stateGstCode: string | null }

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

@Injectable()
export class OnboardingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  async facts(tenantId: string, tx?: SqlExecutor | null): Promise<OnboardingFacts | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT t.status::text AS status, t.country_code, t.onboarding_step, t.profile_completed_at, t.legal_name, t.display_name, t.region_id,
              t.cin_or_reg_no, t.pan, t.gstin, t.fssai_license,
              COALESCE((SELECT b.version FROM tenant_branding b WHERE b.tenant_id = t.id), 0) AS brand_version
         FROM tenants t WHERE t.id = $1 AND t.deleted_at IS NULL${tx ? ' FOR UPDATE OF t' : ''}`, [tenantId]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      status: x.status, countryCode: String(x.country_code).trim(), onboardingStep: x.onboarding_step ?? null, profileCompletedAt: iso(x.profile_completed_at),
      legalName: x.legal_name, displayName: x.display_name, regionId: x.region_id ?? null, cinOrRegNo: x.cin_or_reg_no ?? null, pan: x.pan ?? null,
      gstin: x.gstin ?? null, fssaiLicense: x.fssai_license ?? null, brandVersion: Number(x.brand_version ?? 0),
    };
  }

  /** The districts (level 2) of the tenant's country, each with its state and the state's GST code (0140) — W114's "Home district". */
  async districts(tenantId: string, countryCode: string): Promise<DistrictOption[]> {
    const r = await this.on(tenantId).query(
      `SELECT d.id, d.default_name AS name, s.id AS state_id, s.default_name AS state_name, s.gst_state_code
         FROM admin_regions d JOIN admin_regions s ON s.id = d.parent_id
        WHERE d.country_code = $1 AND d.level = 2 AND d.is_active AND d.deleted_at IS NULL AND s.deleted_at IS NULL
        ORDER BY s.default_name, d.default_name LIMIT 2000`, [countryCode]);
    return r.rows.map((x: any) => ({ id: x.id, name: x.name, stateId: x.state_id, stateName: x.state_name, stateGstCode: x.gst_state_code ? String(x.gst_state_code).trim() : null }));
  }

  /** One district of the tenant's country, with its state — or null (not a district, another country, inactive). */
  async districtState(tenantId: string, regionId: string, countryCode: string, tx?: SqlExecutor | null): Promise<DistrictState | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT d.default_name AS district, s.default_name AS state, s.gst_state_code
         FROM admin_regions d JOIN admin_regions s ON s.id = d.parent_id
        WHERE d.id = $1 AND d.country_code = $2 AND d.level = 2 AND d.is_active AND d.deleted_at IS NULL`, [regionId, countryCode]);
    const x = r.rows[0];
    return x ? { districtName: x.district, stateName: x.state, stateGstCode: x.gst_state_code ? String(x.gst_state_code).trim() : null } : null;
  }

  /** The state names keyed by their recorded GST code ("24" → Gujarat) for the tenant's country. */
  async stateNamesByGstCode(tenantId: string, countryCode: string, tx?: SqlExecutor | null): Promise<Map<string, string>> {
    const r = await this.on(tenantId, tx).query(
      `SELECT gst_state_code AS code, default_name AS name FROM admin_regions
        WHERE country_code = $1 AND level = 1 AND gst_state_code IS NOT NULL AND deleted_at IS NULL`, [countryCode]);
    return new Map(r.rows.map((x: any) => [String(x.code).trim(), String(x.name)]));
  }

  async draft(tenantId: string, tx?: SqlExecutor | null): Promise<DraftRow | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT owner_user_id, payload, saved_at, expires_at, expires_at <= now() AS expired FROM tenant_onboarding_drafts WHERE tenant_id = $1`, [tenantId]);
    const x = r.rows[0];
    return x ? { ownerUserId: x.owner_user_id, payload: x.payload ?? {}, savedAt: iso(x.saved_at)!, expiresAt: iso(x.expires_at)!, expired: x.expired === true } : null;
  }

  /** Save (or replace) the draft. The owner is the session's user — 0200's trigger refuses anybody else's draft. */
  async upsertDraftTx(tx: TxContext, tenantId: string, ownerUserId: string, payload: Record<string, string>): Promise<{ savedAt: string; expiresAt: string }> {
    const r = await tx.query(
      `INSERT INTO tenant_onboarding_drafts (tenant_id, owner_user_id, step, payload) VALUES ($1, $2, 'profile', $3::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET payload = EXCLUDED.payload, step = 'profile'
       RETURNING saved_at, expires_at`, [tenantId, ownerUserId, JSON.stringify(payload)]);
    return { savedAt: iso(r.rows[0].saved_at)!, expiresAt: iso(r.rows[0].expires_at)! };
  }

  async deleteDraftTx(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query(`DELETE FROM tenant_onboarding_drafts WHERE tenant_id = $1`, [tenantId]);
    return r.rowCount ?? 0;
  }

  /** Close step 2. Only from `profile` — a tenant not created through self-serve signup (NULL) is not "completed" by this. */
  async completeTx(tx: TxContext, tenantId: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE tenants SET onboarding_step = 'done', profile_completed_at = now(), updated_at = now()
        WHERE id = $1 AND onboarding_step = 'profile'`, [tenantId]);
    return (r.rowCount ?? 0) === 1;
  }
}
