// modules/tenancy/domain/tenant.entity.ts · a tenant as the IN-TENANT self-serve plane sees it (0002 tenants).
// Pure TS. A tenant admin may edit ONLY its own PROFILE fields here; identity (slug), classification
// (tenant_type_id, country_code), and lifecycle (status, risk_score, approved_at, onboarded_by) are god-mode and
// NEVER mutated in apps/api (Law 11 — those live in apps/admin-api tenant-ops). Provisioning (row creation) is also
// god-mode/onboarding — this entity only rehydrates an existing tenant. No money.
import { InvalidTenantProfileError, TenantNotPendingError } from './tenancy.errors';
import { TenantStatus } from './tenant.state';
import { isPending } from './tenant.state';
import type { DomainEvent } from './tenancy.events';
import { CurrentIdentity, TaxIdentityFormat, assertValid, validateAll } from './tax-identity';

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// **THE GSTIN AND PAN REGEXES THAT USED TO LIVE HERE ARE GONE (PC-56 TENANT-4d-3).** They were Indian
// formats applied unconditionally to every tenant on the platform, while `countryCode` sat one field away and
// was never consulted — so a Bangladeshi co-operative could not record its BIN: the write was REFUSED as
// "gstin is malformed". Rule zero: no shortcut that blocks a country. The formats are now rows in
// `tax_identity_formats` keyed by country (0147) and the validator is `domain/tax-identity.ts`, which also
// COLLECTS every error instead of throwing on the first (W2424) and verifies the GSTIN check digit the old
// regex accepted anything for (W2425 / 0146's invoice snapshot).

export interface TenantProps {
  id: string; slug: string; legalName: string; displayName: string; tenantTypeId: string; countryCode: string;
  regionId: string | null; gstin: string | null; pan: string | null; cinOrRegNo: string | null; fssaiLicense: string | null;
  ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null;
  status: TenantStatus; riskScore: number; approvedAt?: Date | null; createdAt?: Date | null;
}
/** ONLY these profile fields are self-serve editable. (status/slug/type/country/risk are deliberately absent.) */
export type TenantProfilePatch = {
  legalName?: string; displayName?: string; regionId?: string | null; gstin?: string | null; pan?: string | null;
  cinOrRegNo?: string | null; fssaiLicense?: string | null; ownerName?: string | null; ownerPhone?: string | null; ownerEmail?: string | null;
};

function plain(v: string, max: number, label: string): string {
  const s = v.trim();
  if (!s) throw new InvalidTenantProfileError(`${label} is required`);
  if (s.length > max) throw new InvalidTenantProfileError(`${label} exceeds ${max} chars`);
  if (/[<>]/.test(s) || CONTROL_RE.test(s)) throw new InvalidTenantProfileError(`${label} must be plain text`);
  return s;
}
// `optPhone` / `optEmail` / `optName` are GONE with the regexes above: the owner-contact fields go through the
// same collecting validator as the tax fields now, so a bad phone AND a bad email are reported together instead
// of one per submit. `plain` stays — displayName is not tax identity and keeps its own local rule.

export class Tenant {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: TenantProps) {}
  static rehydrate(p: TenantProps): Tenant { return new Tenant(p); }

  get id() { return this.p.id; }
  get status() { return this.p.status; }
  toProps(): Readonly<TenantProps> { return Object.freeze({ ...this.p }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  get countryCode() { return this.p.countryCode; }

  /** The tenant's tax identity as the validator and the review diff see it (domain/tax-identity.ts). */
  identity(): CurrentIdentity {
    return {
      gstin: this.p.gstin, pan: this.p.pan, cinOrRegNo: this.p.cinOrRegNo, fssaiLicense: this.p.fssaiLicense,
      legalName: this.p.legalName, ownerName: this.p.ownerName, ownerPhone: this.p.ownerPhone, ownerEmail: this.p.ownerEmail,
    };
  }

  /**
   * Edit self-serve profile fields only. Returns the {old,new} diff for the audit row. Throws if no real change.
   *
   * PC-56 TENANT-4d-3: the tax-identity fields are validated by `domain/tax-identity.ts` against the tenant's
   * COUNTRY formats, which the caller resolves and passes in.
   *
   * **`formats` IS REQUIRED, WITH NO DEFAULT, DELIBERATELY.** An empty list is a legitimate state — a country
   * whose formats nobody has recorded accepts length-capped plain text rather than refusing a correct number —
   * but it must be an explicit `[]` at the call site, never an omission. A default of `[]` would make the
   * dangerous case (an Indian tenant whose formats the caller forgot to load) silently accept any string into a
   * field that 0146 now freezes onto every invoice. The type system refuses that instead.
   */
  updateProfile(patch: TenantProfilePatch, formats: readonly TaxIdentityFormat[]): { old: Record<string, unknown>; new: Record<string, unknown> } {
    // ONE validation pass, every error collected. The tax fields and the billing-contact fields both go through
    // it, so the screen can list them together exactly as W2424 promises.
    const result = validateAll(formats, {
      gstin: patch.gstin, pan: patch.pan, cin_or_reg_no: patch.cinOrRegNo, fssai_license: patch.fssaiLicense,
      legalName: patch.legalName, ownerName: patch.ownerName, ownerPhone: patch.ownerPhone, ownerEmail: patch.ownerEmail,
    });
    assertValid(result);

    const old: Record<string, unknown> = {}; const next: Record<string, unknown> = {};
    const set = (k: keyof TenantProps, v: unknown) => { if (v !== (this.p as any)[k]) { old[k] = (this.p as any)[k]; next[k] = v; (this.p as any)[k] = v; } };
    // displayName and regionId are not tax identity and keep their own local rules.
    if (patch.displayName !== undefined) set('displayName', plain(patch.displayName, 150, 'display_name'));
    if (patch.regionId !== undefined) set('regionId', patch.regionId);
    for (const [k, v] of Object.entries(result.cleaned) as [keyof TenantProps, unknown][]) set(k, v);
    if (Object.keys(next).length === 0) throw new InvalidTenantProfileError('no profile changes supplied');
    this.events.push({ type: 'tenancy.tenant_profile_updated', payload: { tenantId: this.p.id, fields: Object.keys(next) } });
    return { old, new: next };
  }

  /** Submit the onboarding profile for god-mode review. Does NOT change status (Law 11) — only signals admin-api. */
  submitForReview(): void {
    if (!isPending(this.p.status)) throw new TenantNotPendingError(this.p.status);
    this.events.push({ type: 'tenancy.tenant_onboarding_submitted', payload: { tenantId: this.p.id, slug: this.p.slug } });
  }
}
