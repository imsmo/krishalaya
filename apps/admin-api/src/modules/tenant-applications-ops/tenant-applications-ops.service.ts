// apps/admin-api/src/modules/tenant-applications-ops/tenant-applications-ops.service.ts · PC-55 A1 (review side).
// The god-mode realm reviews the PUBLIC intake (0081) that no tenant token can read. Laws honoured:
//   • PII DISCIPLINE — the QUEUE read returns contact_phone MASKED (last 4) and no email; the DETAIL read
//     (one case, deliberate click, audited) returns the full contact so a human can actually call them.
//   • MAKER-CHECKER-ADJACENT — a decision requires HardwareKey + StepUp at the controller (consequential).
//   • APPROVE PROVISIONS FOR REAL — one tx: insert the tenant (slug derived + collision-safe), flip the
//     application to approved, link provisioned_tenant_id, audit both. No half-approved states.
//   • REJECT DEMANDS A REASON — never a silent no (the reason is stored AND audited).
//   • Rule Zero — slug derivation is unicode-safe: it transliterates nothing and invents nothing; if the org
//     name yields no ASCII-safe slug (e.g. pure Devanagari/Arabic), we fall back to a stable `tenant-<8hex>`
//     slug instead of mangling the name or blocking the country.
import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../core/database/admin-pool';
import { AdminAuditWriter } from '../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../core/auth/admin-auth.guard';

const OPEN = ['submitted', 'under_review'];
const maskPhone = (p: string | null) => (p ? `••••${p.slice(-4)}` : null);

/** ASCII slug or an honest stable fallback (never a mangled non-Latin name). */
export function slugFor(orgName: string, id: string): string {
  const base = orgName.toLowerCase().normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return base.length >= 3 ? base : `tenant-${id.replace(/-/g, '').slice(0, 8)}`;
}

@Injectable()
export class TenantApplicationsOpsService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter) {}

  /** Reviewer queue — PII MASKED here by design; keyset paged (submitted_at,id). */
  async list(q: { status?: string; countryCode?: string; cursor?: { c: string; id: string }; limit: number }) {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `deleted_at IS NULL`;
    if (q.status) where += ` AND status = ${p(q.status)}`;
    if (q.countryCode) where += ` AND country_code = ${p(q.countryCode.toUpperCase())}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (submitted_at < ${cc} OR (submitted_at = ${cc} AND id < ${ci}))`; }
    const lim = p(Math.min(q.limit, 100));
    const r = await this.pool.query(
      `SELECT id, org_name, org_type_id, org_type_other, country_code, contact_name, contact_phone,
              member_count_estimate, status, submitted_at, reviewer_id, decided_at, provisioned_tenant_id
         FROM tenant_applications WHERE ${where} ORDER BY submitted_at DESC, id DESC LIMIT ${lim}`, params);
    const items = r.rows.map((x: any) => ({
      id: x.id, orgName: x.org_name, orgTypeId: x.org_type_id, orgTypeOther: x.org_type_other,
      countryCode: x.country_code, contactName: x.contact_name, contactPhoneMasked: maskPhone(x.contact_phone),
      memberCountEstimate: x.member_count_estimate, status: x.status,
      submittedAt: new Date(x.submitted_at).toISOString(), reviewerId: x.reviewer_id,
      decidedAt: x.decided_at ? new Date(x.decided_at).toISOString() : null, provisionedTenantId: x.provisioned_tenant_id,
    }));
    const last = r.rows[r.rows.length - 1];
    const nextCursor = items.length === Math.min(q.limit, 100) && last
      ? Buffer.from(`${new Date(last.submitted_at).toISOString()}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /** Detail — FULL contact + pitch + doc ids (the deliberate, audited read a human needs to act). */
  async get(actor: AdminRequestContext, id: string) {
    const r = await this.pool.query(`SELECT * FROM tenant_applications WHERE id=$1 AND deleted_at IS NULL`, [id]);
    const x = r.rows[0];
    if (!x) throw new NotFoundException('application not found');
    await this.pool.withTx((c) => this.audit.write(c, {
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'tenant_application.viewed',
      entityType: 'tenant_application', entityId: id, oldValue: null, newValue: { status: x.status },
      reason: 'reviewer opened the case (PII disclosed)', ip: actor.ip, requestId: actor.requestId || null,
    }));
    return {
      id: x.id, orgName: x.org_name, orgTypeId: x.org_type_id, orgTypeOther: x.org_type_other,
      countryCode: x.country_code, regionIds: x.region_ids ?? [], contactName: x.contact_name,
      contactPhone: x.contact_phone, contactEmail: x.contact_email, memberCountEstimate: x.member_count_estimate,
      pitchText: x.pitch_text, docMediaIds: x.doc_media_ids ?? [], status: x.status,
      submittedAt: new Date(x.submitted_at).toISOString(), reviewerId: x.reviewer_id,
      reviewStartedAt: x.review_started_at ? new Date(x.review_started_at).toISOString() : null,
      decidedAt: x.decided_at ? new Date(x.decided_at).toISOString() : null, decisionReason: x.decision_reason,
      provisionedTenantId: x.provisioned_tenant_id, version: x.version,
    };
  }

  /** submitted → under_review (claims the case for this reviewer). */
  async claim(actor: AdminRequestContext, id: string) {
    return this.pool.withTx(async (c) => {
      const app = await this.lock(c, id);
      if (app.status !== 'submitted') throw new ConflictException(`only a submitted application can be claimed (is ${app.status})`);
      await c.query(`UPDATE tenant_applications SET status='under_review', reviewer_id=$2, review_started_at=now(), version=version+1 WHERE id=$1`, [id, actor.userId]);
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'tenant_application.claimed',
        entityType: 'tenant_application', entityId: id, oldValue: { status: app.status }, newValue: { status: 'under_review' },
        reason: null, ip: actor.ip, requestId: actor.requestId || null });
      return { id, status: 'under_review' as const };
    });
  }

  /** APPROVE → provision the real tenant in the SAME tx, then link + audit. */
  async approve(actor: AdminRequestContext, id: string, dto: { slug?: string; tenantTypeId?: string; reason?: string }) {
    return this.pool.withTx(async (c) => {
      const app = await this.lock(c, id);
      if (!OPEN.includes(app.status)) throw new ConflictException(`only an open application can be approved (is ${app.status})`);
      const tenantTypeId = dto.tenantTypeId ?? app.org_type_id;
      if (!tenantTypeId) throw new BadRequestException('tenantTypeId is required (the application did not carry a seeded org type)');
      const slug = dto.slug?.trim() || slugFor(app.org_name, app.id);
      const dup = await c.query(`SELECT 1 FROM tenants WHERE slug=$1`, [slug]);
      if (dup.rowCount) throw new ConflictException(`slug '${slug}' is taken — pass an explicit slug`);
      const t = await c.query(
        `INSERT INTO tenants (slug, legal_name, display_name, tenant_type_id, country_code, status)
         VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
        [slug, app.org_name, app.org_name, tenantTypeId, app.country_code]);
      const tenantId = t.rows[0].id;
      await c.query(`UPDATE tenant_applications SET status='approved', decided_at=now(), reviewer_id=COALESCE(reviewer_id,$2),
                       decision_reason=$3, provisioned_tenant_id=$4, version=version+1 WHERE id=$1`,
        [id, actor.userId, dto.reason ?? null, tenantId]);
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'tenant_application.approved',
        entityType: 'tenant_application', entityId: id, oldValue: { status: app.status },
        newValue: { status: 'approved', provisionedTenantId: tenantId, slug }, reason: dto.reason ?? null, ip: actor.ip, requestId: actor.requestId || null });
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'tenant.provisioned',
        entityType: 'tenant', entityId: tenantId, oldValue: null, newValue: { slug, fromApplication: id, status: 'pending' },
        reason: 'provisioned from public application', ip: actor.ip, requestId: actor.requestId || null });
      // The provisioned tenant lands in 'pending' — the EXISTING tenant-ops approve path takes it live,
      // so onboarding checks are never bypassed by this door.
      return { id, status: 'approved' as const, tenantId, slug, tenantStatus: 'pending' as const };
    });
  }

  /** REJECT → reason REQUIRED (never a silent no). */
  async reject(actor: AdminRequestContext, id: string, reason: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('a written reason is required to reject');
    return this.pool.withTx(async (c) => {
      const app = await this.lock(c, id);
      if (!OPEN.includes(app.status)) throw new ConflictException(`only an open application can be rejected (is ${app.status})`);
      await c.query(`UPDATE tenant_applications SET status='rejected', decided_at=now(), reviewer_id=COALESCE(reviewer_id,$2),
                       decision_reason=$3, version=version+1 WHERE id=$1`, [id, actor.userId, reason.trim()]);
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'tenant_application.rejected',
        entityType: 'tenant_application', entityId: id, oldValue: { status: app.status }, newValue: { status: 'rejected' },
        reason: reason.trim(), ip: actor.ip, requestId: actor.requestId || null });
      return { id, status: 'rejected' as const };
    });
  }

  private async lock(c: PoolClient, id: string) {
    const r = await c.query(`SELECT id, org_name, org_type_id, country_code, status FROM tenant_applications WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    if (!r.rows[0]) throw new NotFoundException('application not found');
    return r.rows[0] as { id: string; org_name: string; org_type_id: string | null; country_code: string; status: string };
  }
}
