// modules/identity/services/team.service.ts · PC-56 TENANT-SW-c · B / C — THE TEAM (W183) AND ONE STAFF MEMBER (W184).
//
// READS (all need `user.approve` — "Team restricted — only tenant_admin manages staff", W183):
//   • overview — the seats tile (a REAL count against the plan's `staff_seats`, or "unlimited (<plan>)"), the staff table (Name · Role ·
//     Desks · Overrides (count) · 2FA · Last active, µs keyset), the MAKER-CHECKER PAIRS derived from effective permissions (never typed),
//     pending invites (phone masked) and privileged-override proposals waiting for a second administrator;
//   • staff — one person: roles, desks, overrides WITH their reason, 2FA state, conflicts, the session cut-off and its REAL bound.
// WRITES:
//   • invite (flag `staff_invites`) — a pending invite with a token shown ONCE (the idempotency record keeps the answer without it);
//     the outbox event `tenancy.staff_invited` makes the SMS handler send it; seats are checked up front (kindly) — the database checks
//     again when the invite is accepted;
//   • revoke an invite (reason ≥ 10); lookup / ACCEPT (public: token + OTP on the invited phone → user found or created, role active,
//     desks joined, invite accepted — all in one transaction under the seat trigger; then a session, pending if they have 2FA);
//   • add staff DIRECTLY — the exception act, with a reason, audited as such.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OTP_SERVICE, OtpService } from '../../../core/auth/otp.service';
import { AppConfig } from '../../../core/config/app-config';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { SESSION_POSTURE_CACHE_SECONDS } from '../../../core/auth/session-posture.guard';
import { uuidv7 } from '../../../core/database/uuid.util';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { User } from '../domain/user.entity';
import { UserRepository } from '../repositories/user.repository';
import { DeskRepository } from '../repositories/desk.repository';
import { VerificationTeamRepository, InviteRow } from '../repositories/verification-team.repository';
import {
  INVITE_DAYS, cleanReason, inviteLink, inviteTokenHash, looksLikeInviteToken, makerCheckerPairs, maskPhone, newInviteToken, reasonRefusal, seatState,
} from '../domain/verification-team';
import { namedSwcRefusal, swcRefused } from '../domain/swc.errors';
import { AuthService, AuthTokens, DeviceInput } from './auth.service';

export interface TeamActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
const canManage = (a: TeamActor) => a.permissions.has('user.approve') || a.permissions.has('*');
export const STAFF_INVITED = 'tenancy.staff_invited';
export const STAFF_INVITES_FLAG = 'staff_invites';
const inviteAad = (id: string) => `staff_invite:${id}`;

@Injectable()
export class TeamService {
  private readonly kek: Buffer;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    private readonly config: AppConfig,
    private readonly roleCache: RoleCacheService,
    private readonly flags: FlagsService,
    private readonly repo: VerificationTeamRepository,
    private readonly users: UserRepository,
    private readonly desks: DeskRepository,
    private readonly auth: AuthService,
  ) {
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);
  }

  private assertManager(a: TeamActor) { if (!canManage(a)) throw swcRefused('TEAM_RESTRICTED'); }

  // ═════════════════════════════════════ reads
  async overview(tenantId: string, a: TeamActor, q: { cursor?: KeysetCursor; limit: number }) {
    this.assertManager(a);
    const [plan, used, staff, invites, proposals, staffRoles, invitesOn] = await Promise.all([
      this.repo.seatPlan(tenantId), this.repo.seatsUsed(tenantId), this.repo.staffList(tenantId, q),
      this.repo.invites(tenantId, { status: 'pending', limit: 50 }), this.repo.proposals(tenantId, { status: 'proposed', limit: 50 }),
      this.repo.staffRoleCodes(tenantId), this.flags.isEnabled(STAFF_INVITES_FLAG, { tenantId }).catch(() => false),
    ]);
    // THE PAIRS over EVERY staff member (not just this page): effective permissions, as the RBAC resolver computes them.
    const everyone = q.cursor || staff.length === q.limit ? await this.repo.staffList(tenantId, { limit: 100 }) : staff;
    const perms = await this.repo.effectivePermissions(tenantId, everyone.map((s) => s.userId));
    const pairs = makerCheckerPairs(everyone.map((s) => ({ userId: s.userId, name: s.name, roles: s.roles, permissions: perms.get(s.userId) ?? new Set<string>() })));
    const last = staff[staff.length - 1];
    return {
      seats: seatState(used, plan),
      staff: staff.map(({ cursorTs: _c, ...s }) => s),
      nextCursor: staff.length === q.limit && last ? encodeKeyset(last.cursorTs, last.userId) : null,
      pairs, pairsOver: everyone.length,
      invites, proposals, staffRoles, invitesEnabled: Boolean(invitesOn),
      sessionEndBoundSec: SESSION_POSTURE_CACHE_SECONDS, accessTokenTtlSec: this.config.auth.accessTtlSec,
    };
  }

  async staff(tenantId: string, a: TeamActor, userId: string) {
    this.assertManager(a);
    const person = await this.repo.staffPerson(tenantId, userId);
    if (!person) throw swcRefused('STAFF_NOT_FOUND');
    const [overrides, conflicts, proposals, cutoff, checker, perms] = await Promise.all([
      this.repo.overridesOf(tenantId, userId), this.repo.conflictsOfStaff(tenantId, userId),
      this.repo.proposals(tenantId, { userId, limit: 20 }), this.repo.sessionCutoff(tenantId, userId), this.repo.checkerCodes(tenantId),
      this.repo.effectivePermissions(tenantId, [userId]),
    ]);
    return {
      ...person, overrides, conflicts, proposals, sessionCutoffAt: cutoff,
      checkerCodes: Object.fromEntries(checker), effectivePermissions: [...(perms.get(userId) ?? new Set<string>())].sort(),
      isSelf: userId === a.userId, sessionEndBoundSec: SESSION_POSTURE_CACHE_SECONDS, accessTokenTtlSec: this.config.auth.accessTtlSec,
    };
  }

  async invites(tenantId: string, a: TeamActor, q: { status?: string; cursor?: KeysetCursor; limit: number }): Promise<{ items: InviteRow[]; nextCursor: string | null }> {
    this.assertManager(a);
    const items = await this.repo.invites(tenantId, q);
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  // ═════════════════════════════════════ invite (W2335–W2337)
  async invite(tenantId: string, a: TeamActor, dto: { phone: string; roleCode: string; deskIds?: string[]; languageCode?: string; channel?: string }, key: string) {
    this.assertManager(a);
    if (dto.channel && dto.channel !== 'sms') throw swcRefused('WHATSAPP_NOT_CONNECTED');
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw swcRefused('INVITE_PHONE_INVALID');
    const raw: { v: { token: string; link: string | null } | null } = { v: null };
    try {
      const stored = await this.idem.remember(key, a.userId, 'identity.team.invite', () => this.uow.run(tenantId, async (tx) => {
        const role = await this.repo.roleByCodeTx(tx, dto.roleCode);
        if (!role || !role.isStaff || role.isPlatform) throw swcRefused('INVITE_ROLE_NOT_STAFF');
        const deskIds = [...new Set(dto.deskIds ?? [])];
        if ((await this.repo.activeDeskIdsTx(tx, tenantId, deskIds)).length !== deskIds.length) throw swcRefused('INVITE_DESK_INVALID');
        // seats: refused kindly here when already full (the trigger refuses again at accept)
        const plan = await this.repo.seatPlan(tenantId, tx);
        const st = seatState(await this.repo.seatsUsed(tenantId, tx), plan);
        if (st.kind === 'limited' && st.full) throw swcRefused('STAFF_SEATS_EXHAUSTED', { used: st.used, seats: st.seats, plan: st.planName });
        // a pending invite past its 7 days no longer blocks the phone
        const pend = await this.repo.pendingInviteForPhoneTx(tx, tenantId, phone);
        if (pend) await this.repo.expireInviteTx(tx, tenantId, pend);
        const t = newInviteToken();
        const ins = await this.repo.insertInviteTx(tx, { tenantId, phone, roleId: role.id, deskIds, invitedBy: a.userId, languageCode: dto.languageCode ?? 'en',
          tokenHash: t.hash, tokenSealedFor: (id) => sealEnvelope(this.kek, t.token, inviteAad(id)) });
        await this.outbox.write(tx, { tenantId, aggregateType: 'staff_invite', aggregateId: ins.id, eventType: STAFF_INVITED, payload: { v: 1, inviteId: ins.id } });
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'team.invite.created', entityType: 'staff_invite', entityId: ins.id,
          newValue: { phone: maskPhone(phone), roleCode: role.code, desks: deskIds.length, channel: 'sms', expiresAt: ins.expiresAt }, ip: a.ip, requestId: a.requestId });
        raw.v = { token: t.token, link: inviteLink(this.config.tenantConsoleBaseUrl, t.token) };
        return { id: ins.id, expiresAt: ins.expiresAt, phoneMasked: maskPhone(phone), roleCode: role.code, deskIds, days: INVITE_DAYS };
      }, { userId: a.userId }));
      // SHOWN ONCE: the raw token rides only the first answer; a replay of the key answers `token: null`.
      const r = raw.v;
      return { ...stored, token: r?.token ?? null, link: r?.link ?? null, tokenShown: Boolean(r) };
    } catch (e) { throw namedSwcRefusal(e); }
  }

  async revokeInvite(tenantId: string, a: TeamActor, id: string, reason: string) {
    this.assertManager(a);
    if (reasonRefusal(reason)) throw swcRefused('REASON_REQUIRED');
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const inv = await this.repo.inviteForUpdate(tx, tenantId, id);
        if (!inv) throw swcRefused('INVITE_NOT_FOUND');
        await this.repo.revokeInviteTx(tx, tenantId, id, a.userId, cleanReason(reason));
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'team.invite.revoked', entityType: 'staff_invite', entityId: id,
          oldValue: { status: inv.status }, newValue: { status: 'revoked', phone: inv.phoneMasked }, reason: cleanReason(reason), ip: a.ip, requestId: a.requestId });
        return { id, status: 'revoked' as const };
      }, { userId: a.userId });
    } catch (e) { throw namedSwcRefusal(e); }
  }

  /** Public: what an invite is (to show on the accept page) — never the phone in full, never another tenant's invite. */
  async lookup(tenantId: string, token: string) {
    if (!looksLikeInviteToken(token)) throw swcRefused('INVITE_NOT_FOUND');
    return this.uow.run(tenantId, async (tx) => {
      const inv = await this.repo.inviteByHashForUpdate(tx, tenantId, inviteTokenHash(token));
      if (!inv) throw swcRefused('INVITE_NOT_FOUND');
      return { organisation: await this.repo.tenantName(tenantId, tx), roleCode: inv.roleCode, phoneMasked: inv.phoneMasked, status: inv.expired && inv.status === 'pending' ? 'expired' : inv.status, expiresAt: inv.expiresAt };
    });
  }

  /**
   * ACCEPT (public, rate-limited): the token AND the OTP just sent to the INVITED phone. One transaction: the person (found by phone or
   * created), their staff role ACTIVE (approved by the inviter — the invite was the approval; created_by = the inviter), the invite's desks,
   * the invite `accepted` (0199: single use, not expired, accepted by that person in their own session) — the seat trigger runs on the role
   * row. Then a session — pending when the person has confirmed 2FA.
   */
  async accept(dto: { tenantId: string; token: string; phone: string; code: string; fullName?: string; device?: DeviceInput }, ip: string | null): Promise<AuthTokens & { invite: { id: string; roleCode: string } }> {
    if (!looksLikeInviteToken(dto.token)) throw swcRefused('INVITE_NOT_FOUND');
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw swcRefused('INVITE_NOT_FOUND');
    const hash = inviteTokenHash(dto.token);
    // 1 · the invite exists, is pending and is for THIS phone (read first, so a wrong token never consumes an OTP)
    const pre = await this.uow.run(dto.tenantId, (tx) => this.repo.inviteByHashForUpdate(tx, dto.tenantId, hash));
    if (!pre || pre.phone !== phone) throw swcRefused('INVITE_NOT_FOUND');
    if (pre.status !== 'pending') throw swcRefused('INVITE_ALREADY_USED');
    if (pre.expired) throw swcRefused('INVITE_EXPIRED');
    // 2 · the OTP on the invited phone (core OtpService: hashed, attempt-capped, single use)
    if (!(await this.otp.verify(phone, dto.code))) throw swcRefused('INVITE_OTP_INVALID');
    const box: { user: User | null; roleCode: string; inviteId: string; session: { sessionId: string; refreshToken: string; pending: boolean } | null } = { user: null, roleCode: '', inviteId: '', session: null };
    try {
      await this.uow.run(dto.tenantId, async (tx) => {
        const inv = await this.repo.inviteByHashForUpdate(tx, dto.tenantId, hash);
        if (!inv || inv.phone !== phone) throw swcRefused('INVITE_NOT_FOUND');
        if (inv.status !== 'pending') throw swcRefused('INVITE_ALREADY_USED');
        box.inviteId = inv.id; box.roleCode = inv.roleCode;
        let user = await this.users.getByPhoneForUpdate(tx, phone);
        if (!user) {
          user = User.register({ id: uuidv7(), phone, fullName: dto.fullName ?? null });
          await this.users.insert(tx, user);
        }
        box.user = user;
        const uid = user.id;
        // the acceptance is THIS person's act, in their own session (0199's invite trigger checks app.user_id)
        await tx.query(`SELECT set_config('app.user_id', $1, true)`, [uid]);
        await this.assignStaffRoleTx(tx, dto.tenantId, uid, inv.roleId, inv.invitedBy);
        for (const deskId of await this.repo.activeDeskIdsTx(tx, dto.tenantId, inv.deskIds)) await this.desks.addMemberTx(tx, dto.tenantId, deskId, uid, inv.invitedBy);
        await this.repo.acceptInviteTx(tx, dto.tenantId, inv.id, uid);
        await this.audit.write(tx, { tenantId: dto.tenantId, actorUserId: uid, action: 'team.invite.accepted', entityType: 'staff_invite', entityId: inv.id,
          newValue: { roleCode: inv.roleCode, desks: inv.deskIds.length, invitedBy: inv.invitedBy }, ip });
        await this.outbox.write(tx, { tenantId: dto.tenantId, aggregateType: 'user_tenant_role', aggregateId: uid, eventType: 'identity.role_assigned',
          payload: { v: 1, userId: uid, tenantId: dto.tenantId, roleCode: inv.roleCode, active: true, via: 'invite' } });
        box.session = await this.auth.openProvenSessionIn(tx, uid, { ip, device: dto.device, phone });
      }, { userId: undefined });
    } catch (e) { throw namedSwcRefusal(e); }
    const user = box.user as User | null;
    if (!user || !box.session) throw swcRefused('INVITE_NOT_FOUND');
    await this.roleCache.invalidate(user.id, dto.tenantId);
    const tokens = await this.auth.finishSignIn(user, dto.tenantId, box.session);
    return { ...tokens, invite: { id: box.inviteId, roleCode: box.roleCode } };
  }

  /** The staff role row for an invite or a direct add: re-activated if it exists unrevoked-or-revoked, else inserted — always ACTIVE. */
  private async assignStaffRoleTx(tx: TxContext, tenantId: string, userId: string, roleId: string, approvedBy: string): Promise<void> {
    const ex = await tx.query<{ id: string; is_active: boolean }>(`SELECT id, is_active FROM user_tenant_roles WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3 AND deleted_at IS NULL FOR UPDATE`, [tenantId, userId, roleId]);
    if (ex.rows[0]?.is_active) throw swcRefused('INVITE_ALREADY_STAFF');
    if (ex.rows[0]) {
      await tx.query(`UPDATE user_tenant_roles SET is_active = true, approved_by = $2, approved_at = now(), revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL, updated_at = now() WHERE id = $1`, [ex.rows[0].id, approvedBy]);
    } else {
      await tx.query(`INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active, role_data, approved_by, approved_at, created_by)
        VALUES ($1, $2, $3, $4, 'none', true, '{}'::jsonb, $5, now(), $5)`, [uuidv7(), userId, tenantId, roleId, approvedBy]);
    }
  }

  // ═════════════════════════════════════ add directly (the exception act)
  async addDirectly(tenantId: string, a: TeamActor, dto: { phone: string; fullName?: string; roleCode: string; deskIds?: string[]; reason: string }, key: string) {
    this.assertManager(a);
    if (reasonRefusal(dto.reason)) throw swcRefused('REASON_REQUIRED');
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw swcRefused('INVITE_PHONE_INVALID');
    let userId = '';
    try {
      const out = await this.idem.remember(key, a.userId, 'identity.team.add_directly', () => this.uow.run(tenantId, async (tx) => {
        const role = await this.repo.roleByCodeTx(tx, dto.roleCode);
        if (!role || !role.isStaff || role.isPlatform) throw swcRefused('INVITE_ROLE_NOT_STAFF');
        const deskIds = [...new Set(dto.deskIds ?? [])];
        if ((await this.repo.activeDeskIdsTx(tx, tenantId, deskIds)).length !== deskIds.length) throw swcRefused('INVITE_DESK_INVALID');
        let user = await this.users.getByPhoneForUpdate(tx, phone);
        if (!user) { user = User.register({ id: uuidv7(), phone, fullName: dto.fullName ?? null }); await this.users.insert(tx, user); }
        userId = user.id;
        await this.assignStaffRoleTx(tx, tenantId, user.id, role.id, a.userId);
        for (const d of deskIds) await this.desks.addMemberTx(tx, tenantId, d, user.id, a.userId);
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'team.staff.added_directly', entityType: 'user', entityId: user.id,
          newValue: { roleCode: role.code, desks: deskIds.length, phone: maskPhone(phone), exception: 'no invite — added by an administrator' }, reason: cleanReason(dto.reason), ip: a.ip, requestId: a.requestId });
        await this.outbox.write(tx, { tenantId, aggregateType: 'user_tenant_role', aggregateId: user.id, eventType: 'identity.role_assigned',
          payload: { v: 1, userId: user.id, tenantId, roleCode: role.code, active: true, via: 'direct' } });
        return { userId: user.id, roleCode: role.code, desks: deskIds.length };
      }, { userId: a.userId }));
      if (userId) await this.roleCache.invalidate(userId, tenantId);
      return out;
    } catch (e) { throw namedSwcRefusal(e); }
  }
}
