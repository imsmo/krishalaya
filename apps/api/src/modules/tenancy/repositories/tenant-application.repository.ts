// modules/tenancy/repositories/tenant-application.repository.ts · PC-55 A1 (public intake side).
// 0081 grants kv_app INSERT ONLY on tenant_applications — so this repository can ONLY write. There is
// deliberately no read here: an app token must never be able to list other applicants' contacts/pitches.
// The reviewer reads live in admin-api (kv_admin, audited). Duplicate/replay handling is by UNIQUE index:
//   uq_tenant_applications_open  → one open application per (phone, org)
//   uq_tenant_applications_idem  → Idempotency-Key replay guard
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';

export interface TenantApplicationInsert {
  id: string; orgName: string; orgTypeId?: string; orgTypeOther?: string; countryCode: string;
  regionIds: string[]; contactName: string; contactPhone: string; contactEmail?: string;
  memberCountEstimate?: number; pitchText?: string; docMediaIds: string[];
  submitIp: string | null; idempotencyKey: string;
}

@Injectable()
export class TenantApplicationRepository {
  /** Returns false when a UNIQUE index rejects the row (open duplicate or key replay) — the service maps
   *  each case to its own honest answer instead of a generic 500. */
  async insert(tx: TxContext, a: TenantApplicationInsert): Promise<{ ok: true } | { ok: false; conflict: 'duplicate_open' | 'replay' }> {
    try {
      await tx.query(
        `INSERT INTO tenant_applications
           (id, org_name, org_type_id, org_type_other, country_code, region_ids, contact_name, contact_phone,
            contact_email, member_count_estimate, pitch_text, doc_media_ids, status, submit_ip, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,'submitted',$13,$14)`,
        [a.id, a.orgName, a.orgTypeId ?? null, a.orgTypeOther ?? null, a.countryCode, JSON.stringify(a.regionIds),
         a.contactName, a.contactPhone, a.contactEmail ?? null, a.memberCountEstimate ?? null, a.pitchText ?? null,
         JSON.stringify(a.docMediaIds), a.submitIp, a.idempotencyKey]);
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; constraint?: string };
      if (err?.code === '23505') {
        return { ok: false, conflict: err.constraint === 'uq_tenant_applications_idem' ? 'replay' : 'duplicate_open' };
      }
      throw e;
    }
  }
}
