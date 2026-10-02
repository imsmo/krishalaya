// modules/ambassadors/services/assisted-onboarding.service.ts · ambassador-assisted farmer onboarding (PRD §16.10).
// An active ambassador onboards a farmer who can't self-register. Composes EXISTING server-owned primitives so
// there is one source of truth for each concern (Law 11): identity.UserService.adminCreate (idempotent-by-phone
// user creation + 'user.created_assisted' audit), identity.ConsentService.grant (DPDP consent, channel
// 'ambassador_assisted', assistedBy = the ambassador) and the referral engine for ATTRIBUTION (a 'signed_up'
// referral linking farmer→ambassador). The onboarding COMMISSION is NOT self-granted here — it accrues only
// when an admin ACTIVATES the referral (the existing audited ambassador.manage gate). The whole op is idempotent
// on the caller's key (Law 3): re-running returns the same farmer (phone-unique) without duplicate side effects.
//
// PC-56 TENANT-10a · F-4 — AN EXISTING MEMBER IS NEVER "ONBOARDED". `adminCreate` resolves an existing user by phone and
// returns them (shared identity behaviour, untouched here), so an active ambassador who knew a member's phone recorded
// DPDP consents in that member's name and became their referrer — earning on their activation and every later sale.
// Now the phone is checked FIRST: a phone that already belongs to an account is refused (409 AMB_EXISTING_USER) before
// any consent or attribution row exists; and because a concurrent self-signup could land between that check and the
// create, the created account's own `created_at` is compared with the moment the check ran — an account older than the
// check is the same refusal, still before any consent is written. A retry with the same key replays the first result.
// F-15: the ambassador's `last_activity_at` is touched inside the attribution transaction.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { UserService } from '../../identity/services/user.service';
import { ConsentService } from '../../identity/services/consent.service';
import { Referral } from '../domain/referral.entity';
import { DomainEvent } from '../domain/ambassadors.events';
import { ReferralRepository } from '../repositories/referral.repository';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { AmbassadorActor } from './ambassador-profile.service';
import { NotAnAmbassadorError, ConsentRequiredError, AssistedOnboardingExistingUserError } from '../domain/ambassadors.errors';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { AssistedOnboardingDto } from '../dto/assisted-onboarding.dto';

@Injectable()
export class AssistedOnboardingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly users: UserService,
    private readonly consents: ConsentService,
    private readonly referrals: ReferralRepository,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  async onboard(tenantId: string, actor: AmbassadorActor, idemKey: string, dto: AssistedOnboardingDto, ip: string | null) {
    if (!dto.consents.some((c) => c.granted)) throw new ConsentRequiredError();   // DPDP: no consent → no account
    const me = await this.profiles.findByUser(tenantId, actor.userId);
    if (!me || !me.toProps().isActive) throw new NotAnAmbassadorError();
    const ambassadorUserId = me.toProps().userId;

    return this.idem.remember(idemKey, actor.userId, 'ambassadors.assisted_onboard', () =>
      timed(this.metrics, 'ambassadors.assisted_onboard', { tenant: tenantId }, async () => {
        // 0. F-4: the phone must belong to NOBODY yet. Checked before anything is written.
        const phone = normalizePhoneE164(dto.phone);
        const checkedAt = await this.uow.run(tenantId, async (tx) => {
          if (phone) {
            const r = await tx.query(`SELECT 1 FROM users WHERE phone=$1 AND deleted_at IS NULL LIMIT 1`, [phone]);
            if ((r.rowCount ?? 0) > 0) throw new AssistedOnboardingExistingUserError();
          }
          const t = await tx.query<{ at: string }>(`SELECT clock_timestamp()::text AS at`);
          return t.rows[0].at;
        }, { userId: actor.userId });

        // 1. create the farmer (identity's own path; audited 'user.created_assisted'; an invalid phone is refused there)
        const user = await this.users.adminCreate(tenantId, actor.userId,
          { phone: dto.phone, fullName: dto.fullName, languageCode: dto.languageCode, countryCode: dto.countryCode }, ip);
        const createdBeforeCheck = await this.uow.run(tenantId, async (tx) => {
          const r = await tx.query<{ older: boolean }>(`SELECT created_at < $2::timestamptz AS older FROM users WHERE id=$1`, [user.id, checkedAt]);
          return r.rows[0]?.older === true;
        }, { userId: actor.userId });
        if (createdBeforeCheck) throw new AssistedOnboardingExistingUserError();

        // 2. record each DPDP consent on the farmer's behalf, stamped channel=ambassador_assisted + assistedBy
        for (const c of dto.consents) {
          await this.consents.grant(tenantId, user.id, { purposeCode: c.purposeCode, granted: c.granted, channel: 'ambassador_assisted', assistedBy: ambassadorUserId });
        }

        // 3. attribution: a 'signed_up' referral farmer→ambassador (idempotent; commission accrues on admin activation)
        const referralId = await this.attribute(tenantId, ambassadorUserId, me.toProps().id, user.id);
        return { user, ambassadorId: me.toProps().id, referralId };
      }));
  }

  /** Link the new farmer to the ambassador as a 'signed_up' referral, unless the farmer already has one. */
  private async attribute(tenantId: string, ambassadorUserId: string, ambassadorId: string, refereeUserId: string): Promise<string | null> {
    return this.uow.run(tenantId, async (tx) => {
      await this.profiles.touchActivity(tx, tenantId, ambassadorId);
      const existing = await this.referrals.findByReferee(tenantId, refereeUserId, tx);
      if (existing) return existing.toJSON().id as string;          // already attributed — no duplicate
      // F-28 (PC-56 TENANT-10a, found on the way): this was `AMB-<hex>` — a HYPHEN the referral code rule (^[A-Z0-9]{4,20}$)
      // refuses, so every assisted onboarding threw InvalidReferralError AFTER the account and consents were written and
      // no attribution was ever recorded. The code is now `AMB` + 8 hex digits from the uuid's RANDOM tail (its head is the
      // millisecond clock, identical for every onboarding in the same minute): valid, and still unmistakably assisted.
      const code = `AMB${uuidv7().replace(/-/g, '').slice(-8).toUpperCase()}`;
      const r = Referral.create({ id: uuidv7(), tenantId, referrerUserId: ambassadorUserId, refereeUserId: null, code, rewardRule: {} });
      r.signUp(refereeUserId);
      await this.referrals.insert(tx, r);
      await this.flush(tx, tenantId, r.id, r.pullEvents());
      return r.id;
    }, { userId: ambassadorUserId });
  }

  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'referral', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
