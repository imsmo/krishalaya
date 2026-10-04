// modules/tenancy/events/handlers/setup-call-requested.handler.ts · PC-56 TENANT-SW-d · C1 — consumes `tenancy.setup_call_requested`:
// PUT THE REQUEST IN FRONT OF THE KRISHALAYA TEAM.
//
// The platform has no alert channel to its own ops team (HOTFIX-1 / 13a named the gap: "repeated failures page the on-call" is unbuilt),
// so the brief's fallback is built: an ADMIN-REALM IN-APP NOTICE — a row in `platform_ops_notices` (0200) that apps/admin-api lists
// (`GET /setup-calls/notices`) and acknowledges when the call is scheduled. The notice carries the slot, the language and the last four
// digits only (PII-free by CHECK). The requester's own confirmation is the notification fan-out (map entry → `tenant.setup_call_requested`,
// en / hi / gu), a separate handler of the same event.
//
// HOTFIX-2: the relay runs as kv_relay, which holds NOTHING on these tables — the work happens in a kv_app unit of work scoped to the
// event's tenant. Idempotent: the notice is keyed (kind, ref_id), so a redelivery adds nothing.
import { Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UnitOfWork } from '../../../../core/database/unit-of-work';
import { SetupCallRepository } from '../../repositories/setup-call.repository';
import { SETUP_CALL_REQUESTED } from '../../domain/setup-call';

export class SetupCallRequestedHandler implements OutboxHandler {
  readonly eventType = SETUP_CALL_REQUESTED;
  private readonly log = new Logger(SetupCallRequestedHandler.name);
  constructor(private readonly uow: UnitOfWork, private readonly repo: SetupCallRepository) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const requestId = typeof event.payload.requestId === 'string' ? event.payload.requestId : null;
    if (!event.tenantId || !requestId) return;   // malformed — fail closed, never invent a request
    const tenantId = event.tenantId;
    const created = await this.uow.run(tenantId, async (tx) => {
      const row = await this.repo.get(tenantId, requestId, tx);
      if (!row) return false;
      return this.repo.noticeOpsTx(tx, tenantId, row);
    }, { userId: undefined });
    if (created) this.log.log(`setup call ${requestId}: queued for the Krishalaya team`);
  }
}
