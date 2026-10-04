// modules/logistics/services/ops-otp.service.ts · PC-56 TENANT-SW-e — the EXISTING OTP service (core/auth/otp.service: hashed in the
// cache, TTL, throttled, attempt-capped, single-use, constant-time) used for three logistics acts: the member's answer to a slot
// proposal through the OTP link, the drop-point keeper's receipt of a parcel, and the member's collection of it.
//
// ONE CHANGE OF SHAPE, ON PURPOSE: the cache key is SCOPED (`<act>:<object id>:<phone>`), never the bare phone. The bare phone is
// the LOGIN code's key: a handover code read back to a driver at a drop point must never be usable as the keeper's login, and
// issuing one must not overwrite a login code in flight. The text goes to the person's own phone in their language
// (`sms.otp_*`, en/hi/gu). THE CODE IS NEVER LOGGED, RETURNED, STORED OR AUDITED — only the fact and the time it verified.
import { Inject, Injectable } from '@nestjs/common';
import { OTP_SERVICE, OtpService, SMS_SENDER, SmsSender, SmsOtpContext } from '../../../core/auth/otp.service';
import { TranslationService } from '../../../core/i18n/translation.service';

export type OpsOtpPurpose = Extract<SmsOtpContext['purpose'], 'slot_proposal' | 'parcel_handover' | 'parcel_collect'>;
const MESSAGE_KEY: Record<OpsOtpPurpose, string> = { slot_proposal: 'sms.otp_slots', parcel_handover: 'sms.otp_handover', parcel_collect: 'sms.otp_collect' };

export const opsOtpScope = (purpose: OpsOtpPurpose, objectId: string, phone: string) => `${purpose}:${objectId}:${phone}`;

@Injectable()
export class OpsOtpService {
  constructor(
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly i18n: TranslationService,
  ) {}

  /** Issue a scoped code and send it to the person's own phone. Returns only the TTL — never the code. */
  async send(purpose: OpsOtpPurpose, objectId: string, phone: string, lang: string): Promise<{ ttlSec: number }> {
    const { code, ttlSec } = await this.otp.issue(opsOtpScope(purpose, objectId, phone));
    const ttlMin = Math.max(1, Math.round(ttlSec / 60));
    await this.sms.sendOtp(phone, { code, ttlMin, purpose, locale: lang }, this.i18n.t(MESSAGE_KEY[purpose], lang, { code, minutes: ttlMin }));
    return { ttlSec };
  }

  verify(purpose: OpsOtpPurpose, objectId: string, phone: string, code: string): Promise<boolean> {
    if (!/^\d{4,8}$/.test(code ?? '')) return Promise.resolve(false);
    return this.otp.verify(opsOtpScope(purpose, objectId, phone), code);
  }
}
