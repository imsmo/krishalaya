// modules/identity/services/two-factor.service.ts · PC-56 TENANT-SW-c · B3 — TOTP 2FA FOR STAFF (founder decision), the person's own acts.
//
//   enrol    → a fresh secret SEALED with the 13a envelope (AAD `user_totp:<user>`, the platform KEK — never plaintext) and the
//              otpauth URI, both returned ONCE. Re-enrolling is allowed only while unconfirmed or after a disable (0199 trigger).
//   confirm  → a current code (±1 step) confirms it; the matched step is recorded (the replay guard starts there) and 10 recovery
//              codes are minted, shown ONCE, stored as HMAC-SHA256(pepper, code).
//   verify   → one code for a sign-in or a disable: a TOTP whose step is later than the last one used (the DATABASE refuses an equal or
//              earlier step — `[TOTP_REPLAY]`), or one unused recovery code (single use, trigger).
//   disable  → needs a code (or a recovery code); retires the recovery codes; audited.
// The posture cache (SessionPostureService) is told on every change, so `require_staff_2fa` sees the new state on the next request.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { openEnvelope, resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { SessionPostureService } from '../../../core/auth/session-posture.guard';
import { VerificationTeamRepository } from '../repositories/verification-team.repository';
import { hashRecoveryCode, looksLikeRecoveryCode, matchedStep, newRecoveryCodes, newTotpSecret, otpauthUri } from '../domain/totp';
import { namedSwcRefusal, swcRefused } from '../domain/swc.errors';

export interface TwoFactorActor { userId: string; tenantId: string; ip: string | null; requestId: string | null }
const aad = (userId: string) => `user_totp:${userId}`;

@Injectable()
export class TwoFactorService {
  private readonly kek: Buffer;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly config: AppConfig,
    private readonly repo: VerificationTeamRepository,
    private readonly posture: SessionPostureService,
  ) {
    // the platform's one KEK (13a / 13c): production without it refuses to boot already; dev uses the documented dev key
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);
  }

  state(a: TwoFactorActor) { return this.repo.totpState(a.tenantId, a.userId); }

  async enrol(a: TwoFactorActor): Promise<{ secret: string; otpauthUri: string; shownOnce: true }> {
    const secret = newTotpSecret();
    const sealed = sealEnvelope(this.kek, secret, aad(a.userId));
    let label = 'staff';
    try {
      await this.uow.run(a.tenantId, async (tx) => {
        const cur = await this.repo.totpForUpdate(tx, a.userId);
        if (cur && cur.confirmedAt && !cur.disabledAt) throw swcRefused('TOTP_ALREADY_CONFIRMED');
        if (cur) await this.repo.reEnrolTotpTx(tx, a.userId, sealed); else await this.repo.insertTotpTx(tx, a.userId, sealed);
        label = (await this.repo.userName(tx, a.userId)) ?? 'staff';
        await this.audit.write(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'two_factor.enrolment_started', entityType: 'user', entityId: a.userId,
          newValue: { method: 'totp' }, ip: a.ip, requestId: a.requestId });
      }, { userId: a.userId });
    } catch (e) { throw namedSwcRefusal(e); }
    await this.posture.forgetTotp(a.userId);
    return { secret, otpauthUri: otpauthUri(secret, label), shownOnce: true };
  }

  async confirm(a: TwoFactorActor, code: string, now = Date.now()): Promise<{ confirmed: true; recoveryCodes: string[] }> {
    const codes = newRecoveryCodes();
    try {
      await this.uow.run(a.tenantId, async (tx) => {
        const cur = await this.repo.totpForUpdate(tx, a.userId);
        if (!cur || cur.disabledAt) throw swcRefused('TOTP_NOT_ENROLLED');
        if (cur.confirmedAt) throw swcRefused('TOTP_ALREADY_CONFIRMED');
        const step = matchedStep(code, openEnvelope(this.kek, cur.secretEnc, aad(a.userId)), now);
        if (step === null) throw swcRefused('TOTP_INVALID');
        await this.repo.confirmTotpTx(tx, a.userId, step);
        await this.repo.replaceRecoveryCodesTx(tx, a.userId, codes.map((c) => hashRecoveryCode(this.config.auth.hashPepper, c)));
        await this.audit.write(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'two_factor.enabled', entityType: 'user', entityId: a.userId,
          newValue: { method: 'totp', recoveryCodes: codes.length }, ip: a.ip, requestId: a.requestId });
      }, { userId: a.userId });
    } catch (e) { throw namedSwcRefusal(e); }
    await this.posture.forgetTotp(a.userId);
    return { confirmed: true, recoveryCodes: codes };
  }

  /**
   * Check ONE second factor for `userId` inside the caller's transaction (sign-in or disable). A recovery code is used up; a TOTP's
   * step is recorded, and the database refuses any step not later than the last one (`[TOTP_REPLAY]`). Throws a named refusal.
   */
  async verifyInTx(tx: TxContext, userId: string, input: { code?: string | null; recoveryCode?: string | null }, now = Date.now()): Promise<'totp' | 'recovery'> {
    const cur = await this.repo.totpForUpdate(tx, userId);
    if (!cur || cur.disabledAt) throw swcRefused('TOTP_NOT_ENROLLED');
    if (!cur.confirmedAt) throw swcRefused('TOTP_NOT_CONFIRMED');
    if (input.recoveryCode) {
      if (!looksLikeRecoveryCode(input.recoveryCode)) throw swcRefused('RECOVERY_CODE_INVALID');
      const used = await this.repo.useRecoveryCodeTx(tx, userId, hashRecoveryCode(this.config.auth.hashPepper, input.recoveryCode));
      if (used === 'used') throw swcRefused('RECOVERY_CODE_USED');
      if (used === 'none') throw swcRefused('RECOVERY_CODE_INVALID');
      return 'recovery';
    }
    const step = matchedStep(String(input.code ?? ''), openEnvelope(this.kek, cur.secretEnc, aad(userId)), now);
    if (step === null) throw swcRefused('TOTP_INVALID');
    try { await this.repo.useTotpStepTx(tx, userId, step); } catch (e) { throw namedSwcRefusal(e); }
    return 'totp';
  }

  async disable(a: TwoFactorActor, input: { code?: string | null; recoveryCode?: string | null; reason?: string | null }, now = Date.now()): Promise<{ disabled: true }> {
    try {
      await this.uow.run(a.tenantId, async (tx) => {
        const via = await this.verifyInTx(tx, a.userId, input, now);
        await this.repo.disableTotpTx(tx, a.userId, 'by_user');
        await this.audit.write(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'two_factor.disabled', entityType: 'user', entityId: a.userId,
          newValue: { method: 'totp', via }, reason: (input.reason ?? '').trim() || null, ip: a.ip, requestId: a.requestId });
      }, { userId: a.userId });
    } catch (e) { throw namedSwcRefusal(e); }
    await this.posture.forgetTotp(a.userId);
    return { disabled: true };
  }
}
