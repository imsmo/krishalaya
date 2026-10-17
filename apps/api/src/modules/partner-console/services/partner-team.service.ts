// modules/partner-console/services/partner-team.service.ts · PC-56 PARTNER-0 · founder D4 — THE PARTNER'S OWN PEOPLE.
//
//   team      — members (name, masked phone, role, 2FA, since / removed) and live pending invites, read on the kv_partner axis (0225 definers);
//   invite    — partner_admin (`partner.team.manage`): a pending invite whose raw token is in THIS answer only (an Idempotency-Key replay
//               answers `token: null`); the database keeps sha256(token) + a KEK-sealed copy the SMS handler clears; the SMS goes through the
//               outbox (`partner.member_invited` → PartnerMemberInvitedHandler, a relay-gate case); 7 days and single use are 0225's;
//   revoke    — an invite, with a reason (10–500);
//   remove    — a member, with a reason; never yourself; never the last partner_admin (the service says so kindly, 0225's trigger is the
//               wall); the person's PARTNER sessions for this partner are revoked in the same transaction (their refresh is refused at once,
//               and the guard refuses their access token on its next request);
//   lookup    — public: what an invite is (the partner's name, the role, the phone by its last 3, the state) — never the phone in full;
//   accept    — public: the token AND an OTP on the INVITED phone → the person found or created, the membership active, the invite accepted,
//               a partner session opened — ONE transaction (pending when the person has confirmed 2FA, exactly the tenant flow).
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OTP_SERVICE, OtpService } from '../../../core/auth/otp.service';
import { AppConfig } from '../../../core/config/app-config';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { uuidv7 } from '../../../core/database/uuid.util';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { User } from '../../identity/domain/user.entity';
import { UserRepository } from '../../identity/repositories/user.repository';
import { AuthService, AuthTokens, DeviceInput, TwoFactorPendingError } from '../../identity/services/auth.service';
import { INVITE_DAYS, cleanReason, inviteTokenHash, looksLikeInviteToken, newInviteToken, reasonRefusal } from '../../identity/domain/verification-team';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { inviteState, isPartnerRole, maskPhoneTail } from '../domain/partner-console.rules';
import { namedPartnerRefusal, partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

export const PARTNER_MEMBER_INVITED = 'partner.member_invited';
export const partnerInviteAad = (id: string) => `partner_invite:${id}`;
const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);
const STATE_REFUSAL = { used: 'PARTNER_INVITE_ALREADY_USED', revoked: 'PARTNER_INVITE_REVOKED', expired: 'PARTNER_INVITE_EXPIRED' } as const;

@Injectable()
export class PartnerTeamService {
  private readonly kek: Buffer;
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    private readonly users: UserRepository,
    private readonly auth: AuthService,
    config: AppConfig,
  ) {
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);
  }

  team(s: PartnerSession) { return this.repo.team(s.partnerId); }

  async invite(s: PartnerSession, dto: { phone: string; roleCode: string; languageCode?: string }, key: string | undefined) {
    if (!key) throw partnerRefused('PARTNER_IDEMPOTENCY_KEY_REQUIRED');
    if (!isPartnerRole(dto.roleCode)) throw partnerRefused('PARTNER_ROLE_REQUIRED');
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw partnerRefused('PARTNER_INVITE_PHONE_INVALID');
    const raw: { v: string | null } = { v: null };
    try {
      const stored = await this.idem.remember(key, s.userId, 'partner.team.invite', () => this.uow.run(s.partnerId, async (tx) => {
        const role = await this.repo.roleByCodeTx(tx, dto.roleCode);
        if (!role || role.scope !== 'partner') throw partnerRefused('PARTNER_ROLE_REQUIRED');
        const stale = await this.repo.stalePendingForPhoneTx(tx, s.partnerId, phone);   // a pending invite past its 7 days no longer blocks
        if (stale) await this.repo.expireInviteTx(tx, stale);
        const t = newInviteToken();
        const id = uuidv7();
        const ins = await this.repo.insertInviteTx(tx, { id, partnerId: s.partnerId, phone, roleId: role.id, invitedBy: s.userId, languageCode: dto.languageCode ?? 'en',
          tokenHash: t.hash, tokenSealed: sealEnvelope(this.kek, t.token, partnerInviteAad(id)) });
        await this.outbox.write(tx, { tenantId: null, aggregateType: 'partner_invite', aggregateId: ins.id, eventType: PARTNER_MEMBER_INVITED, payload: { v: 1, inviteId: ins.id, partnerId: s.partnerId } });
        await this.audit.write(tx, { tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.team.invite_created', entityType: 'partner_invite', entityId: ins.id,
          newValue: { partnerId: s.partnerId, phone: maskPhoneTail(phone), roleCode: role.code, channel: 'sms', expiresAt: ins.expiresAt }, ip: s.ip, requestId: s.requestId });
        raw.v = t.token;
        return { id: ins.id, expiresAt: ins.expiresAt, phoneMasked: maskPhoneTail(phone), roleCode: role.code, days: INVITE_DAYS };
      }, { userId: s.userId }));
      // SHOWN ONCE: the raw token rides only the first answer; a replay of the key answers `token: null`.
      return { ...stored, token: raw.v, tokenShown: raw.v !== null };
    } catch (e) { throw namedPartnerRefusal(e); }
  }

  async revokeInvite(s: PartnerSession, id: string, reason: string) {
    if (reasonRefusal(reason)) throw partnerRefused('PARTNER_REASON_REQUIRED');
    try {
      return await this.uow.run(s.partnerId, async (tx) => {
        const inv = await this.repo.inviteForUpdateTx(tx, id);   // RLS: this partner's invites only
        if (!inv) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
        await this.repo.revokeInviteTx(tx, id, s.userId, cleanReason(reason));
        await this.audit.write(tx, { tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.team.invite_revoked', entityType: 'partner_invite', entityId: id,
          oldValue: { status: inv.status }, newValue: { partnerId: s.partnerId, status: 'revoked' }, reason: cleanReason(reason), ip: s.ip, requestId: s.requestId });
        return { id, status: 'revoked' as const };
      }, { userId: s.userId });
    } catch (e) { throw namedPartnerRefusal(e); }
  }

  async removeMember(s: PartnerSession, membershipId: string, reason: string) {
    if (reasonRefusal(reason)) throw partnerRefused('PARTNER_REASON_REQUIRED');
    try {
      return await this.uow.run(s.partnerId, async (tx) => {
        const m = await this.repo.membershipForUpdateTx(tx, membershipId);   // RLS: this partner's memberships only
        if (!m || !m.isActive) throw partnerRefused('PARTNER_MEMBER_NOT_FOUND');
        if (m.userId === s.userId) throw partnerRefused('PARTNER_REMOVE_SELF');
        if (m.roleCode === 'partner_admin' && (await this.repo.otherActiveAdminsTx(tx, s.partnerId, m.id)) === 0) throw partnerRefused('PARTNER_LAST_ADMIN');
        await this.repo.removeMembershipTx(tx, m.id, s.userId, cleanReason(reason));
        // their sessions in THIS partner end with their last membership here
        const ended = (await this.repo.holdsAnyActiveTx(tx, s.partnerId, m.userId)) ? 0 : await this.auth.revokePartnerSessionsIn(tx, m.userId, s.partnerId);
        await this.audit.write(tx, { tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.team.member_removed', entityType: 'partner_membership', entityId: m.id,
          oldValue: { roleCode: m.roleCode, active: true }, newValue: { partnerId: s.partnerId, active: false, sessionsEnded: ended }, reason: cleanReason(reason), ip: s.ip, requestId: s.requestId });
        return { id: m.id, active: false, sessionsEnded: ended };
      }, { userId: s.userId });
    } catch (e) { throw namedPartnerRefusal(e); }
  }

  /** Public: what an invite is — the partner's name, the role, the phone by its last 3, the state. */
  async lookup(token: string) {
    if (!looksLikeInviteToken(token)) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    const hash = inviteTokenHash(token);
    const partnerId = await this.uow.run(null, (tx) => this.repo.partnerForTokenTx(tx, hash));
    if (!partnerId) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    return this.uow.run(partnerId, async (tx) => {
      const inv = await this.repo.inviteByHashForUpdateTx(tx, hash);
      if (!inv) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
      const org = await this.repo.partnerOrgTx(tx, partnerId);
      const st = inviteState(inv);
      return { organisation: org?.name ?? '', roleCode: inv.roleCode, phoneMasked: maskPhoneTail(inv.phone), status: st === 'usable' ? 'pending' : st, expiresAt: inv.expiresAt };
    });
  }

  async accept(dto: { token: string; phone: string; code: string; fullName?: string; device?: DeviceInput }, ip: string | null): Promise<AuthTokens & { invite: { id: string; roleCode: string } }> {
    if (!looksLikeInviteToken(dto.token)) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    const hash = inviteTokenHash(dto.token);
    const partnerId = await this.uow.run(null, (tx) => this.repo.partnerForTokenTx(tx, hash));
    if (!partnerId) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    // 1 · exists, is for THIS phone, and is usable — read first, so a wrong or spent token never consumes an OTP
    const pre = await this.uow.run(partnerId, (tx) => this.repo.inviteByHashForUpdateTx(tx, hash));
    if (!pre || pre.phone !== phone) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    const st0 = inviteState(pre);
    if (st0 !== 'usable') throw partnerRefused(STATE_REFUSAL[st0]);
    // 2 · the OTP on the invited phone (core OtpService: hashed, attempt-capped, single use)
    if (!(await this.otp.verify(phone, dto.code))) throw partnerRefused('PARTNER_INVITE_OTP_INVALID');
    const box: { user: User | null; inviteId: string; roleCode: string; session: { sessionId: string; refreshToken: string; pending: boolean } | null; access: { roles: string[]; permissions: string[] } | null } =
      { user: null, inviteId: '', roleCode: '', session: null, access: null };
    try {
      await this.uow.run(partnerId, async (tx) => {
        const inv = await this.repo.inviteByHashForUpdateTx(tx, hash);
        if (!inv || inv.phone !== phone) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
        const st = inviteState(inv);
        if (st !== 'usable') throw partnerRefused(STATE_REFUSAL[st]);
        box.inviteId = inv.id; box.roleCode = inv.roleCode;
        let user = await this.users.getByPhoneForUpdate(tx, phone);
        if (!user) { user = User.register({ id: uuidv7(), phone, fullName: dto.fullName ?? null }); await this.users.insert(tx, user); }
        box.user = user;
        await this.repo.setSessionUserTx(tx, user.id);   // the acceptance is THIS person's act, in their own session (0225's trigger)
        const ex = await this.repo.membershipOfForUpdateTx(tx, partnerId, user.id, inv.roleId);
        if (ex?.isActive) throw partnerRefused('PARTNER_ALREADY_MEMBER');
        if (ex) await this.repo.reactivateMembershipTx(tx, ex.id, inv.invitedBy, inv.id);
        else await this.repo.insertMembershipTx(tx, { id: uuidv7(), userId: user.id, partnerId, roleId: inv.roleId, invitedBy: inv.invitedBy, inviteId: inv.id });
        await this.repo.acceptInviteTx(tx, inv.id, user.id);
        await this.audit.write(tx, { tenantId: null, actorUserId: user.id, actorRole: `partner:${partnerId}:${inv.roleCode}`, action: 'partner.team.invite_accepted', entityType: 'partner_invite', entityId: inv.id,
          newValue: { partnerId, roleCode: inv.roleCode, invitedBy: inv.invitedBy }, ip });
        box.access = await this.repo.accessTx(tx, user.id, partnerId);
        box.session = await this.auth.openProvenSessionIn(tx, user.id, { ip, device: dto.device, phone, partnerId });
      });
    } catch (e) { throw namedPartnerRefusal(e); }
    const user = box.user;
    if (!user || !box.session || !box.access) throw partnerRefused('PARTNER_INVITE_NOT_FOUND');
    if (box.session.pending) throw new TwoFactorPendingError(box.session.refreshToken);
    const tokens = this.auth.mintPartner(user, partnerId, box.session.sessionId, box.session.refreshToken, box.access);
    return { ...tokens, invite: { id: box.inviteId, roleCode: box.roleCode } };
  }
}
