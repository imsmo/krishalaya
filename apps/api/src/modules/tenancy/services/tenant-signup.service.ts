// modules/tenancy/services/tenant-signup.service.ts · W113's door (PC-56 TENANT-1d-3a).
//
// ---------------------------------------------------------------------------------------------------------------------
// THE FINDING: THERE WAS NO WAY IN, IN EITHER DIRECTION
// ---------------------------------------------------------------------------------------------------------------------
// W113 says "No account needed to start … 14-day free trial · no card needed · go live the same day". TENANT-1d recorded
// the screen as queued with the note "tenant self-serve signup exists in apps/api". **It does not.**
//
//   * `tenant-self-serve.integration.spec.ts` is the IN-TENANT plane (a tenant admin editing its own profile) and says so:
//     "provisioning itself is god-mode, not part of this plane".
//   * The only public intake is `POST /v1/tenant-applications` (0081) — a REVIEW request, three per hour per IP. A screen
//     promising same-day go-live while filing a review request lies about a wait.
//   * `VerifyOtpSchema` REQUIRES `tenantId`, so somebody who belongs to no organisation cannot even authenticate.
//
// So this service is the door, and it is the only place in apps/api that may create a tenant. 0131 carries the Law 11
// argument in full; the short version is that it can only CREATE, only at `status = 'trial'`, grants no features, and
// cannot touch an existing tenant.
// ---------------------------------------------------------------------------------------------------------------------
import { Inject, Injectable } from '@nestjs/common';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OTP_SERVICE, OtpService } from '../../../core/auth/otp.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { BadRequestError, InfraError } from '../../../shared/errors/app-error';
import { InvalidOtpError } from '../../identity/domain/identity.errors';
import { User } from '../../identity/domain/user.entity';
import { UserRepository } from '../../identity/repositories/user.repository';
import { AuthService, AuthTokens } from '../../identity/services/auth.service';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { TenantSignupRepository } from '../repositories/tenant-signup.repository';
import {
  SignupRefusedError, languageOf, signupPolicyFrom, slugCandidates, trialPeriodEnd, validateOrgName,
} from '../domain/signup';

export interface SignupInput {
  phone: string;
  code: string;
  fullName: string;
  orgName: string;
  orgTypeId: string;
  /** W115's chosen plan (PC-56 TENANT-4d-1). Honoured only behind the `signup_plan_choice` flag. */
  planCode?: string;
  lang?: string;
  countryCode?: string;
  device?: { fingerprint: string; platform?: string; model?: string; appVersion?: string };
}

export interface SignupResult {
  tenantId: string;
  slug: string;
  displayName: string;
  /** True when this phone already administered an organisation and was returned to it (W113's one-per-number rule). */
  resumed: boolean;
  trialEndsOn: string | null;
  tokens: AuthTokens;
}

@Injectable()
export class TenantSignupService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    private readonly users: UserRepository,
    private readonly auth: AuthService,
    private readonly repo: TenantSignupRepository,
    private readonly flags: FlagsService,
  ) {}

  /**
   * Verify the phone, then create the organisation — or return the one this phone already administers.
   *
   * **THE OTP IS VERIFIED THROUGH THE SAME `OtpService` THE LOGIN PATH USES.** A second verification implementation on the
   * one route that can create a tenant is the last place a subtly weaker check should live: the shared one is hashed,
   * attempt-capped, constant-time and single-use, and reusing it means a fix to either path fixes both.
   */
  async signUp(input: SignupInput, ip: string | null): Promise<SignupResult> {
    const phone = normalizePhoneE164(input.phone);
    if (!phone) throw new BadRequestError('a valid mobile number is required');

    const org = validateOrgName(input.orgName);
    if (!org.ok) throw new BadRequestError(`organisation name is ${org.reason === 'too_short' ? 'too short' : 'too long'}`);

    const name = (input.fullName ?? '').trim();
    if (name.length < 2) throw new BadRequestError('your name is required');

    // **THE CODE IS CHECKED BEFORE ANYTHING IS READ OR WRITTEN.** Everything below this line is a consequence of a verified
    // phone; a failed code must not reveal whether a number is registered, cost a database round trip, or leave a row.
    if (!(await this.otp.verify(phone, input.code))) throw new InvalidOtpError();

    const lang = languageOf(input.lang);
    const countryCode = (input.countryCode ?? 'IN').toUpperCase();

    const out = await this.uow.run(null as never, async (tx) => {
      // register-or-reuse. `getByPhoneForUpdate` locks the row, so two taps cannot both register the same phone.
      let user = await this.users.getByPhoneForUpdate(tx, phone);
      let userCreated = false;
      if (!user) {
        user = User.register({ id: uuidv7(), phone, fullName: name, languageCode: lang, countryCode });
        await this.users.insert(tx, user);
        userCreated = true;
      }

      // **THE RESUME CHECK RUNS ON THE WRITER, INSIDE THIS TRANSACTION.** On the replica it would be subject to lag, and
      // two taps on a village connection would both read "no organisation" and create two.
      const existing = await this.repo.findAdministeredTenant(tx, user.id);
      if (existing) {
        // W113: "a second attempt from the same number resumes the first, it never starts a duplicate". Nothing is created
        // and nothing is changed — but it is RECORDED, because a resume is also how a stolen phone would be used.
        await this.audit.write(tx, {
          tenantId: existing.tenantId, actorUserId: user.id, action: 'tenancy.signup_resumed',
          entityType: 'tenant', entityId: existing.tenantId, newValue: { resumed: true }, ip,
        });
        return { kind: 'resumed' as const, user, existing };
      }

      const policy = signupPolicyFrom(await this.repo.signupSettings(tx));

      if (!(await this.repo.tenantTypeExists(tx, input.orgTypeId))) {
        // The form's own list comes from this registry, so a bad id means a stale page or a hand-crafted request.
        throw new BadRequestError('choose an organisation type from the list');
      }

      // W115's CHOICE (PC-56 TENANT-4d-1). Until this wave the tenant's choice was not a parameter of signup
      // at all: `policy.trialPlanCode` is one platform setting, so every co-operative on the platform was
      // trialing whichever plan the platform picked, while W115 drew three cards and three buttons. A chosen
      // code is honoured only behind the flag, validated against PUBLIC ACTIVE plans for their country, and
      // REFUSED BY NAME if it is not one of them — a co-operative that picked Professional and silently got
      // Starter would find out from an invoice.
      let planCode = policy.trialPlanCode;
      if (input.planCode) {
        const choiceAllowed = await this.flags.isEnabled('signup_plan_choice', {}).catch(() => false);
        if (choiceAllowed) {
          const offered = await this.repo.publicPlanCodes(tx, countryCode);
          if (!offered.includes(input.planCode)) {
            throw new BadRequestError('choose a plan from the list', { code: 'SIGNUP_PLAN_NOT_OFFERED', planCode: input.planCode });
          }
          planCode = input.planCode;
        }
      }

      const plan = await this.repo.trialPlan(tx, planCode, countryCode);
      if (!plan) {
        // **REFUSED, NOT GUESSED.** Picking "some cheap plan" would put a co-operative on terms nobody chose for their
        // country, and they would discover it on their first invoice.
        throw new InfraError('SIGNUP_TRIAL_PLAN_UNAVAILABLE',
          `no public plan '${planCode}' for ${countryCode} — nothing was created`);
      }

      const tenantId = uuidv7();
      const tenant = await this.repo.insertTenant(tx, {
        id: tenantId, slugCandidates: slugCandidates(org.value),
        // Both names start as what the applicant typed. A legal name differing from a display name is a real distinction
        // (W113 asks for one name) and belongs on the profile screen, not in a guess made here.
        legalName: org.value, displayName: org.value,
        tenantTypeId: input.orgTypeId, countryCode, ownerName: name, ownerPhone: phone,
      });
      if (!tenant) throw new SignupRefusedError('SIGNUP_SLUG_UNAVAILABLE', 'that organisation name is taken — please add your district or a distinguishing word');

      const roleId = await this.repo.roleIdByCode(tx, 'tenant_admin');
      // A tenant with no administrator is a console nobody can open. Refusing here rolls the whole thing back rather than
      // leaving an orphan organisation the applicant cannot reach.
      if (!roleId) throw new InfraError('SIGNUP_ROLE_MISSING', 'the tenant_admin role is not seeded — nothing was created');
      await this.repo.grantOwnerRole(tx, { id: uuidv7(), userId: user.id, tenantId, roleId });

      const periodStart = new Date().toISOString().slice(0, 10);
      const periodEnd = trialPeriodEnd(periodStart, policy.trialDays);
      await this.repo.insertTrialSubscription(tx, {
        id: uuidv7(), tenantId, planId: plan.id, priceMinor: plan.monthlyPriceMinor,
        currencyCode: plan.currencyCode, periodStart, periodEnd,
      });

      // Law 4: the audit row is inside the same transaction as the act it describes.
      await this.audit.write(tx, {
        tenantId, actorUserId: user.id, action: 'tenancy.self_serve_signup',
        entityType: 'tenant', entityId: tenantId,
        newValue: {
          slug: tenant.slug, displayName: org.value, countryCode, lang,
          planCode, trialDays: policy.trialDays, trialEndsOn: periodEnd,
          userCreated, status: 'trial',
        },
        ip,
      });
      await this.outbox.write(tx, {
        tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: 'tenancy.tenant_signed_up',
        payload: { v: 1, tenantId, slug: tenant.slug, ownerUserId: user.id, trialEndsOn: periodEnd, lang },
      });

      return { kind: 'created' as const, user, tenant, trialEndsOn: periodEnd };
    }, { userId: undefined });

    // **THE SESSION IS OPENED THROUGH THE SAME PATH A LOGIN USES**, in its own transaction after the tenant exists — an
    // access token carries the tenant id, so it cannot be minted before there is one. `AuthService.openSessionFor` is the
    // tail of `verifyOtp` extracted, not a second implementation: one place mints tokens.
    const tenantId = out.kind === 'resumed' ? out.existing.tenantId : out.tenant.id;
    const tokens = await this.auth.openSessionFor(out.user, tenantId, ip, input.device);

    if (out.kind === 'resumed') {
      return {
        tenantId: out.existing.tenantId, slug: out.existing.slug, displayName: out.existing.displayName,
        resumed: true, trialEndsOn: null, tokens,
      };
    }
    return {
      tenantId: out.tenant.id, slug: out.tenant.slug, displayName: out.tenant.slug,
      resumed: false, trialEndsOn: out.trialEndsOn, tokens,
    };
  }
}
