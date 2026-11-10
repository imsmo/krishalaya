// modules/gov-console/services/gov-members.service.ts · PC-56 GOV-0 · THE AUTHORITY'S PEOPLE (GOV-1 Q4-A).
//
//   list     → the authority's memberships (names, phones by their last 3, role, who asked, who approved, when it ends).
//   request  → any live member names a person (by phone — an existing platform account) for a role and a term of 1–12 months, with a reason.
//   approve  → a live HEAD who is neither the requester nor the grantee — the second person. The end date is set by the database (0239).
//   remove   → ONE head, at once, with a reason; never their own row. The person's gov sessions in this authority end in the same transaction
//              when they hold no other live role there.
//
// THE REFUSAL ORDER (E14): the key → the input → the domain's refusal (read first) → ONLY THEN `idem.remember` and the unit of work. A
// refused act never reserves its idempotency key and never opens a write (pinned with a spy). Every act writes a gov-realm audit row (no
// tenant; `newValue.authorityId` — 0239's `al_insert_gov_realm`) in the same transaction.
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { GovRealmUnitOfWork } from '../../../core/database/gov-realm-uow';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { AuthService } from '../../identity/services/auth.service';
import { GovConsoleRepository } from '../repositories/gov-console.repository';
import { approvalRefusal, isGovRole, maskPhoneTail, reasonRefusal, removalRefusal, termRefusal } from '../domain/gov-membership.rules';
import { govRefused, namedGovRefusal } from '../domain/gov-console.errors';
import { GovSession } from '../guards/gov-session.guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const govActorRole = (s: GovSession) => `gov:${s.authorityId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);

@Injectable()
export class GovMembersService {
  constructor(
    private readonly repo: GovConsoleRepository,
    private readonly uow: GovRealmUnitOfWork,
    private readonly audit: AuditWriter,
    private readonly auth: AuthService,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  list(s: GovSession) {
    return this.uow.run(s.authorityId, (tx) => this.repo.membershipsTx(tx), { userId: s.userId });
  }

  async request(s: GovSession, dto: { phone: string; roleCode: string; termMonths: number; reason: string }, key: string | undefined) {
    if (!key) throw govRefused('GOV_IDEMPOTENCY_KEY_REQUIRED');
    if (!isGovRole(dto.roleCode)) throw govRefused('GOV_ROLE_REQUIRED');
    const term = termRefusal(dto.termMonths); if (term) throw govRefused(term);
    const why = reasonRefusal(dto.reason); if (why) throw govRefused(why);
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw govRefused('GOV_PHONE_INVALID');
    const grantee = await this.uow.run(s.authorityId, (tx) => this.repo.userIdByPhoneTx(tx, phone), { userId: s.userId });
    if (!grantee) throw govRefused('GOV_PERSON_UNKNOWN');
    try {
      return await this.idem.remember(key, s.userId, 'gov.members.request', () => this.uow.run(s.authorityId, async (tx) => {
        const id = await this.repo.requestTx(tx, grantee, dto.roleCode, dto.termMonths, dto.reason.trim());
        await this.audit.write(tx, { tenantId: null, actorUserId: s.userId, actorRole: govActorRole(s), action: 'gov.membership.requested', entityType: 'authority_membership', entityId: id,
          newValue: { authorityId: s.authorityId, granteeUserId: grantee, phone: maskPhoneTail(phone), roleCode: dto.roleCode, termMonths: dto.termMonths }, reason: dto.reason.trim(),
          ip: s.ip, requestId: s.requestId });
        return { id, status: 'requested' as const, roleCode: dto.roleCode, termMonths: dto.termMonths, phoneMasked: maskPhoneTail(phone) };
      }, { userId: s.userId }));
    } catch (e) { throw namedGovRefusal(e); }
  }

  async approve(s: GovSession, id: string, key: string | undefined) {
    if (!key) throw govRefused('GOV_IDEMPOTENCY_KEY_REQUIRED');
    const facts = UUID.test(id) ? await this.uow.run(s.authorityId, (tx) => this.repo.membershipTx(tx, id), { userId: s.userId }) : null;
    // THE TWO-PERSON RULE, before any key is reserved or any write opened (0239's CHECKs and guard say it again in the database)
    const refusal = approvalRefusal(facts, s.userId);
    if (refusal) throw govRefused(refusal);
    try {
      return await this.idem.remember(key, s.userId, 'gov.members.approve', () => this.uow.run(s.authorityId, async (tx) => {
        if (!(await this.repo.approveTx(tx, id))) throw govRefused('GOV_MEMBERSHIP_NOT_FOUND');
        const expiresAt = await this.repo.expiresAtTx(tx, id);
        await this.audit.write(tx, { tenantId: null, actorUserId: s.userId, actorRole: govActorRole(s), action: 'gov.membership.approved', entityType: 'authority_membership', entityId: id,
          oldValue: { status: 'requested' }, newValue: { authorityId: s.authorityId, status: 'active', granteeUserId: facts!.userId, requestedBy: facts!.requestedBy, roleCode: facts!.roleCode, expiresAt },
          ip: s.ip, requestId: s.requestId });
        return { id, status: 'active' as const, expiresAt };
      }, { userId: s.userId }));
    } catch (e) { throw namedGovRefusal(e); }
  }

  async remove(s: GovSession, id: string, reason: string, key: string | undefined) {
    if (!key) throw govRefused('GOV_IDEMPOTENCY_KEY_REQUIRED');
    const why = reasonRefusal(reason); if (why) throw govRefused(why);
    const facts = UUID.test(id) ? await this.uow.run(s.authorityId, (tx) => this.repo.membershipTx(tx, id), { userId: s.userId }) : null;
    const refusal = removalRefusal(facts, s.userId);
    if (refusal) throw govRefused(refusal);
    try {
      return await this.idem.remember(key, s.userId, 'gov.members.remove', () => this.uow.run(s.authorityId, async (tx) => {
        if (!(await this.repo.removeTx(tx, id, reason.trim()))) throw govRefused('GOV_MEMBERSHIP_NOT_FOUND');
        // AT ONCE (Q4-A): their gov sessions in THIS authority end with their last live role here
        const sessionsEnded = (await this.repo.isLiveMemberTx(tx, s.authorityId, facts!.userId)) ? 0 : await this.auth.revokeGovSessionsIn(tx, facts!.userId, s.authorityId);
        await this.audit.write(tx, { tenantId: null, actorUserId: s.userId, actorRole: govActorRole(s), action: 'gov.membership.removed', entityType: 'authority_membership', entityId: id,
          oldValue: { status: facts!.status }, newValue: { authorityId: s.authorityId, status: 'removed', granteeUserId: facts!.userId, roleCode: facts!.roleCode, sessionsEnded },
          reason: reason.trim(), ip: s.ip, requestId: s.requestId });
        return { id, status: 'removed' as const, sessionsEnded };
      }, { userId: s.userId }));
    } catch (e) { throw namedGovRefusal(e); }
  }
}
