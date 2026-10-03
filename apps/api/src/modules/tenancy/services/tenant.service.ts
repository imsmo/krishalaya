// modules/tenancy/services/tenant.service.ts · the IN-TENANT self-serve plane: a tenant admin views & edits its
// OWN tenant profile, submits onboarding for review, manages tenant-scoped settings, and reads its feature
// overrides + usage. Every read/write is scoped to ctx.tenantId (no id-from-request → no IDOR/cross-tenant
// enumeration). Writes: one ACID tx (UoW) + outbox event + audit row in the SAME tx + idempotency. Authorization
// THROWS (tenant.settings). LIFECYCLE (status) is NEVER touched here — that is god-mode in apps/admin-api (Law 11).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { Tenant } from '../domain/tenant.entity';
import { allowsSelfServeWrites } from '../domain/tenant.state';
import { DomainEvent } from '../domain/tenancy.events';
import { TenantNotFoundError, TenantForbiddenError, TenantNotWritableError, InvalidTenantProfileError, TenantNameIsBrandError } from '../domain/tenancy.errors';
import { TenantRepository } from '../repositories/tenant.repository';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { TenantFeatureRepository } from '../repositories/tenant-feature.repository';
import { UsageCounterRepository } from '../repositories/usage-counter.repository';
import { CurrentIdentity, checksumSupported, diffOf, isNoOp, reasonProblem, reasonRequired, validateAll } from '../domain/tax-identity';
import { UpdateTenantProfileDto } from '../dto/update-tenant.dto';
import { TenantActor } from '../policies/tenancy.policies';

@Injectable()
export class TenantService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly tenants: TenantRepository,
    private readonly settings: TenantSettingsRepository,
    private readonly features: TenantFeatureRepository,
    private readonly usage: UsageCounterRepository,
  ) {}

  private assertManager(a: TenantActor) { if (!a.canManage) throw new TenantForbiddenError(); }

  /** The caller's own tenant (read). */
  async getMine(tenantId: string) {
    const t = await this.tenants.getById(tenantId);
    if (!t) throw new TenantNotFoundError(tenantId);
    return this.serialize(t);
  }

  async updateProfile(tenantId: string, actor: TenantActor, idemKey: string, dto: UpdateTenantProfileDto, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.tenant_profile_update', () =>
      timed(this.metrics, 'tenancy.tenant_profile_update', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const t = await this.tenants.getForUpdate(tx, tenantId);
          if (!t) throw new TenantNotFoundError(tenantId);
          if (!allowsSelfServeWrites(t.status)) throw new TenantNotWritableError(t.status);
          // PC-56 TENANT-4d-3: the tenant's COUNTRY formats, resolved before validation — the Indian GSTIN/PAN
          // regexes that used to be hardcoded in the entity refused every other country's identifier outright.
          const formats = await this.tenants.taxIdentityFormats(tenantId, t.countryCode);
          const before = t.identity();
          const { reason, ...patch } = dto;
          const diff = t.updateProfile(patch, formats);
          // W2426 promises the audit entry carries a REASON. `audit_log.reason` and `AuditEntry.reason` have both
          // existed all along; this action never passed one, so the fourth of the four promised facts was a dead
          // column. Required only when a value is being REPLACED or CLEARED (see reasonProblem) — "why did this
          // tenant's GSTIN change?" is the question asked of a document already filed.
          const rows = diffOf(before, diff.new as Partial<CurrentIdentity>);
          const problem = reasonProblem(reason, rows);
          if (problem) throw new InvalidTenantProfileError(`reason is ${problem}`, [{ field: 'reason', reason: problem }]);
          // PC-56 TENANT-13d: once a brand is published, the name members see has ONE writer — the brand publish (0194 trg_tenants_brand_sync)
          try { await this.tenants.updateProfile(tx, t); }
          catch (e) { if (String((e as Error)?.message ?? '').includes('[TENANT_NAME_IS_BRAND]')) throw new TenantNameIsBrandError(); throw e; }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_profile_updated', entityType: 'tenant', entityId: tenantId, oldValue: diff.old, newValue: diff.new, reason: reason?.trim() || null, ip });
          await this.flush(tx, tenantId, t.pullEvents());
          return this.serialize(t);
        }, { userId: actor.userId })));
  }

  /**
   * W2424 + W2425 in one read-only call: validate the whole patch and return EVERY error with its reason, plus
   * the diff against the tenant's current values. **Nothing is saved.**
   *
   * This is not a second write path — it shares the exact validator the write uses (`validateAll`), so the
   * review screen cannot show a diff the write would compute differently. It exists because the two things
   * W2424/W2425 promise (all errors at once, and a diff before submitting) are impossible to deliver from a
   * write endpoint that throws on the first bad field and only reports success after it has already saved.
   */
  async previewProfile(tenantId: string, actor: TenantActor, dto: UpdateTenantProfileDto) {
    this.assertManager(actor);
    const t = await this.tenants.getById(tenantId);
    if (!t) throw new TenantNotFoundError(tenantId);
    const formats = await this.tenants.taxIdentityFormats(tenantId, t.countryCode);
    const { reason, ...patch } = dto;
    const result = validateAll(formats, {
      gstin: patch.gstin, pan: patch.pan, cin_or_reg_no: patch.cinOrRegNo, fssai_license: patch.fssaiLicense,
      legalName: patch.legalName, ownerName: patch.ownerName, ownerPhone: patch.ownerPhone, ownerEmail: patch.ownerEmail,
    });
    const diff = diffOf(t.identity(), result.cleaned);
    return {
      // A tenant whose status forbids self-serve writes learns that HERE, before filling in a form.
      writable: allowsSelfServeWrites(t.status),
      errors: result.errors,
      verdicts: result.verdicts,
      diff,
      noOp: isNoOp(diff),
      reasonRequired: reasonRequired(diff),
      reasonProblem: reasonProblem(reason, diff),
    };
  }

  /** W2424's form: the fields this tenant's COUNTRY defines, with labels as i18n keys and examples. */
  async taxIdentityFields(tenantId: string, actor: TenantActor) {
    this.assertManager(actor);
    const t = await this.tenants.getById(tenantId);
    if (!t) throw new TenantNotFoundError(tenantId);
    const formats = await this.tenants.taxIdentityFormats(tenantId, t.countryCode);
    return {
      countryCode: t.countryCode,
      // An empty list is a REAL state the screen must render ("we have not recorded your country's formats"),
      // not an error and not a reason to fall back to India's.
      fields: formats.map((f) => ({
        fieldCode: f.fieldCode, labelKey: f.labelKey, maxLength: f.maxLength, example: f.example,
        isRequired: f.isRequired,
        // Whether a check digit will actually be verified, so the form can say so up front rather than
        // implying every field is machine-checked.
        checksum: f.checksumAlgo === null ? ('not_applicable' as const) : checksumSupported(f.checksumAlgo) ? ('verified' as const) : ('not_verifiable' as const),
      })),
      current: t.identity(),
    };
  }

  /** Signal the god-mode plane that onboarding is ready for approval. Does NOT change status (Law 11). */
  async submitForReview(tenantId: string, actor: TenantActor, idemKey: string, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.tenant_submit_review', () =>
      timed(this.metrics, 'tenancy.tenant_submit_review', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const t = await this.tenants.getForUpdate(tx, tenantId);
          if (!t) throw new TenantNotFoundError(tenantId);
          t.submitForReview();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_onboarding_submitted', entityType: 'tenant', entityId: tenantId, newValue: { status: t.status }, ip });
          await this.flush(tx, tenantId, t.pullEvents());
          return { ok: true, status: t.status };
        }, { userId: actor.userId })));
  }

  // ---- settings ----
  // PC-56 TENANT-13b (F-4): the tenant setting READ and WRITE moved to TenantSettingsService, which reads `risk_class` on every write
  // and routes a trust-affecting key through the maker-checker proposal. The old `putSetting` here was an UNGATED writer (scope + type
  // only — one tenant_admin could lift the refund checker); it is closed, not kept beside the gate.

  // ---- read-only views (Law 11: overrides/usage are not self-settable) ----
  async listFeatures(tenantId: string) { return { items: (await this.features.listFor(tenantId)).map((f) => f.toJSON()) }; }
  async currentUsage(tenantId: string) { return { items: (await this.usage.currentPeriodFor(tenantId)).map((u) => u.toJSON()) }; }

  private serialize(t: Tenant) {
    const p = t.toProps();
    return { id: p.id, slug: p.slug, legalName: p.legalName, displayName: p.displayName, tenantTypeId: p.tenantTypeId,
      countryCode: p.countryCode, regionId: p.regionId, gstin: p.gstin, pan: p.pan, cinOrRegNo: p.cinOrRegNo,
      fssaiLicense: p.fssaiLicense, ownerName: p.ownerName, ownerPhone: p.ownerPhone, ownerEmail: p.ownerEmail,
      status: p.status, approvedAt: p.approvedAt ?? null, createdAt: p.createdAt ?? null };
  }
  private async flush(tx: TxContext, tenantId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
