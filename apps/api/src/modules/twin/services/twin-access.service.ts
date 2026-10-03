// modules/twin/services/twin-access.service.ts · PC-56 TENANT-12 · W420's LOCKED STATE and its one honest act (F-3, F-15).
//
// The Twin is licensed by the `digital_twin` feature flag (founder decision: LICENSED BY FEATURE FLAG PER PLAN — the flag engine's
// rules.plans / rules.tenant_ids, admin-plane written; 0190 revoked kv_app's writes on plan_features / tenant_features /
// subscription_addons so a tenant cannot self-license). These two reads/acts are deliberately OUTSIDE the flag guard: a tenant
// without the flag must still be able to see the Locked page and ask the account desk ONCE.
//
// "Ask your account desk" = ONE row per tenant (twin_access_requests, UNIQUE tenant_id): asking again returns the same row and
// writes nothing — "the locked page never nags … no countdown, no repeated prompts". The first ask is audited; the admin realm reads
// the row. Nothing here reaches billing, a plan, or a support ticket (the support module is a separate, flag-OFF surface).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { TwinRepository } from '../repositories/twin.repository';
import { TwinForbiddenError } from '../domain/twin.errors';
import { TwinActor, canView } from './twin.service';

export const TWIN_FLAG = 'digital_twin';

@Injectable()
export class TwinAccessService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
              private readonly repo: TwinRepository, private readonly audit: AuditWriter, private readonly flags: FlagsService) {}

  async state(tenantId: string, actor: TwinActor) {
    if (!canView(actor)) throw new TwinForbiddenError('twin.view');
    const [enabled, req] = await Promise.all([this.flags.isEnabled(TWIN_FLAG, { tenantId, userId: actor.userId }), this.repo.accessRequest(tenantId)]);
    const names = req ? await this.repo.shortNames(tenantId, [req.requestedBy]) : new Map<string, string>();
    return { enabled, request: req ? { id: req.id, requestedAt: req.requestedAt, requestedBy: names.get(req.requestedBy) ?? null } : null, canRequest: !enabled && !req };
  }

  /** The one idempotent ask. Written once per tenant; a second ask (by anyone) answers with the first, `written: false`. */
  async request(tenantId: string, actor: TwinActor, key: string) {
    if (!canView(actor)) throw new TwinForbiddenError('twin.view');
    return this.idem.remember(key, actor.userId, 'twin.access.request', async () => {
      if (await this.flags.isEnabled(TWIN_FLAG, { tenantId, userId: actor.userId })) return { enabled: true, written: false, request: null };
      const written = await this.uow.run(tenantId, async (tx) => {
        const id = uuidv7();
        const fresh = await this.repo.insertAccessRequest(tx, tenantId, id, actor.userId);
        if (fresh) {
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'twin.access_requested', entityType: 'twin_access_request', entityId: id,
            oldValue: null, newValue: { flag: TWIN_FLAG, requestedBy: actor.userId }, reason: null, ip: actor.ip, requestId: actor.requestId,
          });
        }
        return fresh;
      }, { userId: actor.userId });
      const req = await this.repo.accessRequest(tenantId);
      return { enabled: false, written, request: req ? { id: req.id, requestedAt: req.requestedAt } : null };
    });
  }
}
