// apps/admin-api/src/modules/partner-ops/services/partner-ops.service.ts · PC-56 PARTNER-1a (founder D2 + D3).
//
// **WHY THE SLA WRITE TAKES ONE ADMINISTRATOR, NOT TWO — A NAMED DEVIATION.** settings-ops' second-person rule applies only
// to the `money_path` and `security` risk classes (`requiresChecker`), and even there it takes the proposer as a
// caller-supplied `proposedByAdminId` with no proposal row behind it. A partner's published decision promise is an
// `ordinary`-class contractual fact — it moves no money and opens no door — and a real two-person flow for it would need a
// new proposal model (a stored proposal, a distinct approver, an expiry) that this wave does not build. So the SLA is set
// by ONE administrator holding `partners.manage`, with a reason of at least 20 characters, under FIDO2 + step-up, with
// the old and new value in an audit row committed in the same transaction. `checker: 'single_administrator'` says so in
// every response, so no reader mistakes it for a checked change.
//
// **WHY THE INVITE CODE IS HANDED OVER, NOT SENT.** The admin realm holds no webhook KEK by design, so it cannot seal a
// copy of the token for the partner realm's relay to deliver: no sealed copy is kept and no SMS is sent. The platform
// administrator receives the raw code ONCE in this response and hands it over out of band — "send it yourself; we never
// email a secret". The outbox row records the act (ids only), and the partner realm's relay handler marks the invite
// `send_failure = 'platform_handover'`. The raw token is never logged, never in the audit row, never in the outbox
// payload; only its sha256 is stored.
import { HttpException, Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { PartnerOpsRepository } from '../repositories/partner-ops.repository';
import { isUuid, maskInvitePhone, newInviteToken, nextSla, slaDecisionHours } from '../domain/partner-ops.rules';
import {
  PartnerAdminInvitePendingError, PartnerHasAdminError, PartnerNotFoundError, PartnerPlatformRoleError,
  namedPartnerOpsError,
} from '../domain/partner-ops.errors';

@Injectable()
export class PartnerOpsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: PartnerOpsRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  async list() {
    return { data: await this.repo.list() };
  }

  async get(id: string) {
    if (!isUuid(id)) throw new PartnerNotFoundError();
    const row = await this.repo.get(id);
    if (!row) throw new PartnerNotFoundError();
    return { data: row };
  }

  /** Set (or clear, with `null`) the partner's published decision promise. One key of `sla`; every other key kept. */
  async setSla(actor: AdminRequestContext, id: string, dto: { decisionHours: number | null; reason: string }) {
    if (!isUuid(id)) throw new PartnerNotFoundError();
    return this.pool.withTx(async (c) => {
      const row = await this.repo.lockForSla(c, id);
      if (!row) throw new PartnerNotFoundError();
      const previous = slaDecisionHours(row.sla);
      const sla = nextSla(row.sla, dto.decisionHours);
      await this.repo.writeSla(c, id, sla);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'partners.sla_set', entityType: 'financial_partner', entityId: id,
        oldValue: { decisionHours: previous }, newValue: { decisionHours: dto.decisionHours },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { data: { id, slaDecisionHours: dto.decisionHours, previous, checker: 'single_administrator' as const } };
    });
  }

  /** Invite a partner's FIRST administrator. The checks here give a clean answer; the 0226 trigger re-checks every one
   *  of them under the per-partner advisory lock, so a race between two operators still ends in exactly one invite. */
  async inviteFirstAdmin(actor: AdminRequestContext, id: string, dto: { phone: string; reason: string; languageCode?: string }) {
    if (!isUuid(id)) throw new PartnerNotFoundError();
    try {
      return await this.pool.withTx(async (c) => {
        if (!(await this.repo.lockLivePartner(c, id))) throw new PartnerNotFoundError();
        if ((await this.repo.countActiveAdmins(c, id)) > 0) throw new PartnerHasAdminError();
        const pending = await this.repo.livePlatformInvite(c, id);
        if (pending) throw new PartnerAdminInvitePendingError(pending.expiresAt);
        const roleId = await this.repo.partnerAdminRoleId(c);
        if (!roleId) throw new PartnerPlatformRoleError();

        const { token, hash } = newInviteToken();
        const invite = await this.repo.insertPlatformInvite(c, {
          partnerId: id, phone: dto.phone, roleId, adminId: actor.userId,
          languageCode: dto.languageCode ?? 'en', tokenHash: hash,
        });
        await this.repo.insertInviteOutbox(c, invite.id, id);
        const phoneMasked = maskInvitePhone(dto.phone);
        await this.audit.write(c, {
          actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
          action: 'partners.admin_invite_created', entityType: 'partner_invite', entityId: invite.id,
          newValue: { partnerId: id, phone: phoneMasked, roleCode: 'partner_admin', expiresAt: invite.expiresAt, delivery: 'handover' },
          reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
        });
        return {
          data: {
            inviteId: invite.id, partnerId: id, roleCode: 'partner_admin' as const, phoneMasked,
            expiresAt: invite.expiresAt, token, shownOnce: true as const, delivery: 'handover' as const,
          },
        };
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const named = namedPartnerOpsError(e);
      if (named) throw named;
      throw e;
    }
  }
}
