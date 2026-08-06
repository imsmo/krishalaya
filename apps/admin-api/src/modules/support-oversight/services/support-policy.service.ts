// apps/admin-api/src/modules/support-oversight/services/support-policy.service.ts · the support POLICY
// (PC-56 ADMIN-2b, closes ADMIN-2-Q2 + ADMIN-2-Q4; tables 0097, ledger 0098, fired by apps/worker's
// `support-escalations` job).
//
// WHAT THIS REPAIRS. ADMIN-2's escalation screen had to tell an operator, in words, that nobody is paged when an SLA
// breaks. That was true: the targets were a code constant and the chain did not exist. Now the promise is stored, the
// worker fires it, and every firing is logged — so "was the support head actually rung about TKT-8812?" is answerable.
//
// PUBLISH, NEVER EDIT — the dunning-ladder law (0094) applied again, for the same reason: six months from now the only
// defensible answer to "why was my P1 not escalated?" is the policy that was active then.
//
// THE VALIDATION IS THE VALUE. `assertPolicy` refuses the four combinations that would read fine and behave wrongly: an
// SLA with no chain behind it, a chain that wakes somebody at an hour the policy says the desk is shut, targets that
// tighten as severity falls, and an AI allowed to auto-answer a P0 about somebody's money before a human reads it.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { assertPolicy, describePolicy } from '../domain/support-policy';
import { PublishSupportPolicyDto } from '../dto/support-oversight.dto';

@Injectable()
export class SupportPolicyService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: SupportOversightRepository,
  ) {}

  /** The active policy plus what the chain has actually done lately. NULL policy is returned as null — see the header. */
  async current() {
    const [active, events, versions] = await Promise.all([
      this.repo.activePolicy(),
      this.repo.recentEscalationEvents(50),
      this.repo.listPolicyVersions(),
    ]);
    return {
      ...(active ?? { policy: null, slas: [], escalations: [] }),
      recentEvents: events,
      versions,
      // Stated in the payload so no console can present a recorded step as a delivered page: the platform has an SMS
      // sender and nothing for calls, email or pagers, so those steps log `provider_pending`.
      deliveryNote: 'in_app steps are delivered (they land on the SLA board); call/sms/pager steps are logged as provider_pending until a provider is configured',
    };
  }

  async publish(actor: AdminRequestContext, dto: PublishSupportPolicyDto) {
    const policy = assertPolicy(dto);      // 422 naming the exact rule that was broken

    return this.pool.withTx(async (client) => {
      const version = await this.repo.nextPolicyVersion(client);
      const id = randomUUID();
      await this.repo.insertPolicy(client, { id, version, actorUserId: actor.userId, policy });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.policy_published', entityType: 'support_policy', entityId: id,
        newValue: {
          version,
          // the human sentence, so the audit row says what the policy DOES rather than listing twenty columns
          rule: describePolicy(policy),
          slas: policy.slas,
          escalations: policy.escalations.map((e) => `${e.severity}+${e.afterMinutes}m ${e.channel} → ${e.targetRole}`),
        },
        reason: policy.notes ?? `support policy v${version} published`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, version, isActive: true, rule: describePolicy(policy) };
    });
  }
}
