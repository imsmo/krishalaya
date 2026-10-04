// modules/tenancy/services/onboarding.service.ts · PC-56 TENANT-SW-d · W114 + W2693–W2695 — SIGNUP STEP 2, THE ORGANISATION PROFILE.
//
// Founder decision (2026-10-04): the profile is signup step 2 with SAVE-AND-EXIT. The console's /signup reaches this service the
// moment the organisation exists (the step-1 session): it reads the step, saves a SERVER draft (owner-only, 30 days — 0200), and
// completes the step with ONE audited write that reuses the `/settings/gst` validators (country formats, checksum honesty, the
// existing reason rule for a recorded identifier being replaced). The GSTIN state-code advisory is a CONFIRM, never a block: an
// unconfirmed mismatch returns `needs_confirm` and writes NOTHING; the same save with `confirmGstState` proceeds.
//
// Display name: once a brand is published (13d) the name members see has ONE writer — the brand publish; the step shows it read-only
// with "set by your brand" and refuses a different value by name (TENANT_NAME_IS_BRAND).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { TenantRepository } from '../repositories/tenant.repository';
import { OnboardingRepository, OnboardingFacts } from '../repositories/onboarding.repository';
import { TenantNotFoundError, InvalidTenantProfileError } from '../domain/tenancy.errors';
import { CurrentIdentity, checksumSupported, diffOf, reasonProblem, validateAll } from '../domain/tax-identity';
import {
  DRAFT_MAX_BYTES, GstStateAdvisory, ProfileStepInput, advisoryNeedsConfirm, cleanDraftPayload, draftBytes, gstStateAdvisory, missingRequired,
  reasonedRows, savedUpToStep,
} from '../domain/onboarding';
import { namedSwdTenancyRefusal, swdTenancyRefusal } from '../domain/swd.errors';
import { TenantActor } from '../policies/tenancy.policies';

export interface ProfileSaveInput extends ProfileStepInput { confirmGstState?: boolean; reason?: string }
export type ProfileSaveResult =
  | { status: 'needs_confirm'; advisory: GstStateAdvisory; saved: false }
  | { status: 'saved'; advisory: GstStateAdvisory; saved: true; fields: string[]; profileCompletedAt: string | null };

const t = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.trim() === '' ? null : v.trim());

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly tenants: TenantRepository,
    private readonly repo: OnboardingRepository,
  ) {}

  private assertAdmin(a: TenantActor) { if (!a.canManage) throw swdTenancyRefusal('ONBOARDING_RESTRICTED'); }
  private assertOpen(f: OnboardingFacts) {
    if (f.onboardingStep === 'done') throw swdTenancyRefusal('ONBOARDING_ALREADY_DONE');
    if (f.onboardingStep === null) throw swdTenancyRefusal('ONBOARDING_NOT_TRACKED');
  }

  /** W114's whole screen in one read: the step, the current values, the owner's draft (never anybody else's), the district list, the
   *  country's identifier fields with their checksum honesty, and whether the display name is the brand's. */
  async state(tenantId: string, actor: TenantActor) {
    this.assertAdmin(actor);
    const f = await this.repo.facts(tenantId);
    if (!f) throw new TenantNotFoundError(tenantId);
    const [draft, districts, formats] = await Promise.all([this.repo.draft(tenantId), this.repo.districts(tenantId, f.countryCode), this.tenants.taxIdentityFormats(tenantId, f.countryCode)]);
    const live = draft && !draft.expired ? draft : null;
    const mine = live && live.ownerUserId === actor.userId ? live : null;
    return {
      step: f.onboardingStep,
      profileCompletedAt: f.profileCompletedAt,
      countryCode: f.countryCode,
      current: { legalName: f.legalName, displayName: f.displayName, regionId: f.regionId, cinOrRegNo: f.cinOrRegNo, pan: f.pan, gstin: f.gstin, fssaiLicense: f.fssaiLicense },
      displayNameLocked: f.brandVersion > 0,
      draft: mine ? { payload: mine.payload, savedAt: mine.savedAt, expiresAt: mine.expiresAt } : null,
      /** W114 "Resuming setup is owner-only" — another administrator learns a draft exists, never what it says. */
      draftOwnedByOther: Boolean(live && live.ownerUserId !== actor.userId),
      savedUpToStep: savedUpToStep(f.onboardingStep, Boolean(mine)),
      districts,
      fields: formats.map((x) => ({
        fieldCode: x.fieldCode, labelKey: x.labelKey, maxLength: x.maxLength, example: x.example, isRequired: x.isRequired,
        checksum: x.checksumAlgo === null ? ('not_applicable' as const) : checksumSupported(x.checksumAlgo) ? ('verified' as const) : ('not_verifiable' as const),
      })),
      /** W114's "Couldn't save … kept in this browser and will retry automatically" — refused by name (server actions only). */
      browserStore: 'refused' as const,
    };
  }

  /** "Save & exit (resume later by OTP)": the owner's draft, on the server, 30 days. */
  async saveDraft(tenantId: string, actor: TenantActor, raw: Record<string, unknown>) {
    this.assertAdmin(actor);
    const payload = cleanDraftPayload(raw);
    if (draftBytes(payload) > DRAFT_MAX_BYTES) throw swdTenancyRefusal('ONBOARDING_DRAFT_TOO_LARGE');
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const f = await this.repo.facts(tenantId, tx);
        if (!f) throw new TenantNotFoundError(tenantId);
        this.assertOpen(f);
        const existing = await this.repo.draft(tenantId, tx);
        if (existing && existing.expired && existing.ownerUserId !== actor.userId) await this.repo.deleteDraftTx(tx, tenantId);
        const saved = await this.repo.upsertDraftTx(tx, tenantId, actor.userId, payload);
        // the KEYS saved, never the values (a half-typed PAN is not an audit fact)
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.onboarding_draft_saved', entityType: 'tenant', entityId: tenantId, newValue: { step: 'profile', fields: Object.keys(payload) } });
        return { step: 'profile' as const, ...saved, fields: Object.keys(payload) };
      }, { userId: actor.userId });
    } catch (e) { throw namedSwdTenancyRefusal(e); }
  }

  /** W2693's confirm step: everything that WOULD be saved — every error with its reason, the diff, the advisory. Writes nothing. */
  async preview(tenantId: string, actor: TenantActor, input: ProfileSaveInput) {
    this.assertAdmin(actor);
    const f = await this.repo.facts(tenantId);
    if (!f) throw new TenantNotFoundError(tenantId);
    return this.judge(tenantId, f, input, null);
  }

  private async judge(tenantId: string, f: OnboardingFacts, input: ProfileSaveInput, tx: TxContext | null) {
    const locked = f.brandVersion > 0;
    const displayName = locked ? f.displayName : t(input.displayName) ?? undefined;
    const missing = missingRequired({ ...input, displayName: locked ? f.displayName : input.displayName });
    const regionId = t(input.regionId);
    const district = regionId && /^[0-9a-f-]{36}$/i.test(regionId) ? await this.repo.districtState(tenantId, regionId, f.countryCode, tx) : null;
    const formats = await this.tenants.taxIdentityFormats(tenantId, f.countryCode);
    const result = validateAll(formats, { gstin: t(input.gstin), pan: t(input.pan), cin_or_reg_no: t(input.cinOrRegNo), fssai_license: t(input.fssaiLicense), legalName: input.legalName ?? undefined });
    const before: CurrentIdentity = { gstin: f.gstin, pan: f.pan, cinOrRegNo: f.cinOrRegNo, fssaiLicense: f.fssaiLicense, legalName: f.legalName, ownerName: null, ownerPhone: null, ownerEmail: null };
    const diff = diffOf(before, result.cleaned);
    if (displayName !== undefined && displayName !== f.displayName) diff.push({ field: 'displayName' as never, from: f.displayName, to: displayName });
    if (regionId && regionId !== f.regionId) diff.push({ field: 'regionId' as never, from: f.regionId, to: regionId });
    const names = await this.repo.stateNamesByGstCode(tenantId, f.countryCode, tx);
    const gstin = result.cleaned.gstin !== undefined ? result.cleaned.gstin : f.gstin;
    const advisory = gstStateAdvisory(gstin, district, f.countryCode, (c) => names.get(c) ?? null);
    const reasoned = reasonedRows(diff);
    const reasonErr = reasonProblem(input.reason, reasoned);
    const nameIsBrand = locked && input.displayName !== undefined && t(input.displayName) !== null && t(input.displayName) !== f.displayName;
    return {
      writable: f.onboardingStep === 'profile', step: f.onboardingStep,
      errors: [
        ...missing.map((m) => ({ field: m, reason: 'required' as const })),
        ...(regionId && !district ? [{ field: 'regionId', reason: 'district_invalid' as const }] : []),
        ...result.errors,
        ...(reasonErr ? [{ field: 'reason', reason: reasonErr }] : []),
        ...(nameIsBrand ? [{ field: 'displayName', reason: 'brand_owned' as const }] : []),
      ],
      verdicts: result.verdicts, diff, advisory, displayNameLocked: locked,
      reasonRequired: reasoned.length > 0, cleaned: result.cleaned, displayName, regionId, district, missing, nameIsBrand, reasonErr,
    };
  }

  /** Complete step 2: ONE audited write (the profile + the step closed + the owner's draft cleared), or `needs_confirm` and nothing. */
  async saveProfile(tenantId: string, actor: TenantActor, idemKey: string, input: ProfileSaveInput, ip: string | null): Promise<ProfileSaveResult> {
    this.assertAdmin(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.onboarding_profile', async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const f = await this.repo.facts(tenantId, tx);
          if (!f) throw new TenantNotFoundError(tenantId);
          this.assertOpen(f);
          const j = await this.judge(tenantId, f, input, tx);
          if (j.nameIsBrand) throw swdTenancyRefusal('TENANT_NAME_IS_BRAND');
          if (j.missing.length) throw swdTenancyRefusal('ONBOARDING_REQUIRED_MISSING', { fields: j.missing });
          if (!j.district) throw swdTenancyRefusal('ONBOARDING_DISTRICT_INVALID');
          if (j.errors.length) throw new InvalidTenantProfileError(`${j.errors.length} field(s) are invalid`, j.errors.map((e) => ({ field: String(e.field), reason: String(e.reason) })));
          // THE ADVISORY IS A CONFIRM, NOT A REFUSAL: nothing is written until the person has seen both states and said "continue"
          if (advisoryNeedsConfirm(j.advisory, input.confirmGstState === true)) return { status: 'needs_confirm' as const, advisory: j.advisory, saved: false as const };

          const tenant = await this.tenants.getForUpdate(tx, tenantId);
          if (!tenant) throw new TenantNotFoundError(tenantId);
          const formats = await this.tenants.taxIdentityFormats(tenantId, f.countryCode);
          let changed: { old: Record<string, unknown>; new: Record<string, unknown> } = { old: {}, new: {} };
          try {
            changed = tenant.updateProfile({
              legalName: input.legalName ?? undefined, ...(j.displayNameLocked ? {} : { displayName: j.displayName }), regionId: j.regionId ?? undefined,
              cinOrRegNo: t(input.cinOrRegNo), pan: t(input.pan), gstin: t(input.gstin), fssaiLicense: t(input.fssaiLicense),
            } as never, formats);
            await this.tenants.updateProfile(tx, tenant);
          } catch (e) {
            if (!(e instanceof InvalidTenantProfileError && /no profile changes/.test(e.message))) throw e;   // nothing new typed: the step still closes
          }
          await this.repo.completeTx(tx, tenantId);
          const draft = await this.repo.draft(tenantId, tx);
          if (draft && (draft.ownerUserId === actor.userId || draft.expired)) await this.repo.deleteDraftTx(tx, tenantId);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'tenancy.onboarding_profile_completed', entityType: 'tenant', entityId: tenantId,
            oldValue: changed.old, newValue: { ...changed.new, onboardingStep: 'done', gstStateAdvisory: j.advisory.kind, gstStateConfirmed: input.confirmGstState === true },
            reason: input.reason?.trim() || null, ip,
          });
          for (const e of tenant.pullEvents()) await this.outbox.write(tx, { tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: e.type, payload: { v: 1, ...e.payload } });
          await this.outbox.write(tx, { tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: 'tenancy.onboarding_completed', payload: { v: 1, tenantId, byUserId: actor.userId } });
          const after = await this.repo.facts(tenantId, tx);
          return { status: 'saved' as const, advisory: j.advisory, saved: true as const, fields: Object.keys(changed.new), profileCompletedAt: after?.profileCompletedAt ?? null };
        }, { userId: actor.userId });
      } catch (e) { throw namedSwdTenancyRefusal(e); }
    });
  }
}
