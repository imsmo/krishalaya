// modules/identity/services/change-phone.service.ts · OTP-verified phone-number change (PRD §4 / DPDP §13).
// start(): send an OTP to the NEW number (reusing the core OtpService) — refuses if that number already belongs
// to ANOTHER account (UNIQUE(phone) is the DB backstop). confirm(): verify the OTP, then swap the caller's OWN
// identity phone in one ACID tx (the subject is the token's userId — no client id, zero IDOR) + emit
// identity.phone_changed. Money-free. start is idempotent on the caller's key (Law 3) so a retried tap doesn't
// re-spam SMS; the OTP itself is single-use + throttled inside OtpService.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { OTP_SERVICE, OtpService, SMS_SENDER, SmsSender } from '../../../core/auth/otp.service';
import { TranslationService } from '../../../core/i18n/translation.service';
import { tryGetRequestContext } from '../../../core/tenancy-context/request-context';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { InvalidPhoneError, InvalidOtpError, PhoneAlreadyInUseError, UserNotFoundError } from '../domain/identity.errors';
import { UserRepository } from '../repositories/user.repository';

@Injectable()
export class ChangePhoneService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly i18n: TranslationService,
    private readonly users: UserRepository,
  ) {}

  /** Step 1: OTP the NEW number (refusing a number already owned by someone else). */
  async start(tenantId: string, userId: string, rawNewPhone: string, idemKey: string): Promise<{ ok: true }> {
    const phone = normalizePhoneE164(rawNewPhone);
    if (!phone) throw new InvalidPhoneError();
    return this.idem.remember(idemKey, userId, 'identity.change_phone.start', () =>
      timed(this.metrics, 'identity.change_phone.start', { tenant: tenantId }, async () => {
        const owner = await this.users.findByPhone(tenantId, phone);
        if (owner && owner.id !== userId) throw new PhoneAlreadyInUseError();   // can't capture someone else's number
        const { code, ttlSec } = await this.otp.issue(phone);                   // throttled inside
        const lang = tryGetRequestContext()?.lang ?? 'en';
        const ttlMin = Math.round(ttlSec / 60);
        await this.sms.sendOtp(phone, { code, ttlMin, purpose: 'change_phone', locale: lang }, this.i18n.t('sms.otp', lang, { code, minutes: ttlMin }));
        this.metrics.inc('identity.change_phone.otp_sent');
        return { ok: true as const };
      }));
  }

  /** Step 2: verify the OTP + swap the caller's identity phone (their own; UNIQUE(phone) backstops a race). */
  async confirm(tenantId: string, userId: string, rawNewPhone: string, code: string): Promise<{ ok: true }> {
    const phone = normalizePhoneE164(rawNewPhone);
    if (!phone) throw new InvalidPhoneError();
    if (!(await this.otp.verify(phone, code))) throw new InvalidOtpError();
    await this.uow.run(tenantId, async (tx) => {
      const clash = await this.users.getByPhoneForUpdate(tx, phone);
      if (clash && clash.id !== userId) throw new PhoneAlreadyInUseError();
      const user = await this.users.getForUpdate(tx, userId);
      if (!user) throw new UserNotFoundError(userId);
      user.changePhone(phone);
      await this.users.updatePhone(tx, userId, phone, new Date());
      for (const e of user.pullEvents()) await this.outbox.write(tx, { tenantId: null, aggregateType: 'user', aggregateId: userId, eventType: e.type, payload: { v: 1, ...e.payload } });
    }, { userId });
    this.metrics.inc('identity.change_phone.confirmed');
    return { ok: true };
  }
}
