// apps/admin-api/src/modules/billing-ops/services/dunning-policy.service.ts · the platform's COLLECTIONS LADDER
// (PC-56 ADMIN-1b, closes ADMIN-1-Q6; tables in migration 0094).
//
// WHY THIS EXISTS. PC-56 ADMIN-1 built the collection queue and had to label its suggested next channel a
// "convention" — an honest word for "the platform has no policy". A billing operation should not have to say that.
// This service makes the ladder a stored, versioned object: when we first remind, when it escalates to a call, and
// whether non-payment ever suspends a tenant.
//
// TWO DESIGN CHOICES CARRY THE WEIGHT:
//   • PUBLISH, NEVER EDIT. A change is a NEW VERSION with its own effective date, and the previous one stays
//     readable — because six months from now the only defensible answer to "why was I chased on day 3?" is the
//     ladder that was active then. Editing in place would destroy that answer.
//   • THE LADDER IS ADVISORY TO PEOPLE, BINDING ON NOTHING. An operator may still ring a tenant early or skip a
//     rung; 0035's per-invoice cap remains the only hard bound. A policy that refused human judgement would be
//     routed around, and then the recorded ladder would stop describing reality — which is worse than not having one.
//
// Suspension is deliberately NOT automated by this service. `suspendAfterDays` is a THRESHOLD that the console
// surfaces and a human acts on through the audited, elevation-gated tenant-ops path. Suspending a tenant stops
// farmers transacting; that is not a side effect of a cron job reading a config row.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository } from '../repositories/billing.repository';
import { InvalidDunningPolicyError } from '../domain/billing-ops.errors';
import { assertLadder } from '../domain/dunning-policy';
import { PublishDunningPolicyDto } from '../dto/billing-ops.dto';

@Injectable()
export class DunningPolicyService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
  ) {}

  /** The active ladder, or null. NULL IS RETURNED AS NULL: a platform with no collections policy should say so,
   *  not render an empty step list that reads like a policy of doing nothing. */
  async active() {
    return this.repo.activeDunningPolicy();
  }

  async versions() {
    return { items: await this.repo.listDunningPolicyVersions() };
  }

  /** Publish a new version and retire the current one, in ONE transaction — there is never a moment with two active
   *  ladders (the 0094 partial unique index would refuse it anyway) nor a moment with none. */
  async publish(actor: AdminRequestContext, dto: PublishDunningPolicyDto) {
    const steps = assertLadder(dto.steps, dto.suspendAfterDays ?? null);   // throws InvalidDunningPolicyError (422)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.effectiveFrom)) throw new InvalidDunningPolicyError('effectiveFrom must be YYYY-MM-DD');

    return this.pool.withTx(async (client) => {
      const version = await this.repo.nextDunningPolicyVersion(client);
      const id = randomUUID();
      await this.repo.insertDunningPolicy(client, {
        id, version, name: dto.name.trim(), effectiveFrom: dto.effectiveFrom,
        suspendAfterDays: dto.suspendAfterDays ?? null, notes: dto.notes?.trim() || null,
        actorUserId: actor.userId, steps,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.dunning_policy_published', entityType: 'dunning_policy', entityId: id,
        newValue: {
          version, name: dto.name.trim(), effectiveFrom: dto.effectiveFrom,
          suspendAfterDays: dto.suspendAfterDays ?? null, steps,
        },
        reason: dto.notes?.trim() || `dunning policy v${version} published`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, version, isActive: true, effectiveFrom: dto.effectiveFrom, steps };
    });
  }
}
