// modules/tenancy/services/setup-call.service.ts · PC-56 TENANT-SW-d · W2619–W2625 — "Book a setup call (free)".
//
// Founder decision: a PLATFORM-STAFFED REQUEST OBJECT. The tenant asks (one open request per tenant — SETUP_CALL_ALREADY_OPEN, by the
// service AND 0200's unique index), lists its own and may cancel with a reason; the Krishalaya team schedules and closes it in the
// admin realm (apps/admin-api `setup-calls-ops`, kv_admin). The request writes the outbox event `tenancy.setup_call_requested` in the
// same transaction: the relay (kv_relay) runs (1) the notification fan-out — a confirmation to the requester in their language (en /
// hi / gu) — and (2) `SetupCallRequestedHandler`, which puts a PII-free notice in the admin realm's in-app queue. No calendar
// integration; the page says so. No raw phone in the request (last four digits).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { SetupCallRepository, SetupCallRow } from '../repositories/setup-call.repository';
import { NOTES_MAX, SETUP_CALL_REQUESTED, SETUP_CALL_ZONE, SetupCallLanguage, lastFourMask, slotProblem } from '../domain/setup-call';
import { namedSwdTenancyRefusal, swdTenancyRefusal } from '../domain/swd.errors';
import { TenantActor } from '../policies/tenancy.policies';

export interface SetupCallInput { slotStart: Date; slotEnd: Date; languageCode: SetupCallLanguage; notes?: string | null }
const view = (r: SetupCallRow) => ({
  id: r.id, slotStart: r.slotStart, slotEnd: r.slotEnd, zone: SETUP_CALL_ZONE, languageCode: r.languageCode, phoneMasked: r.phoneMasked, notes: r.notes,
  status: r.status, scheduledAt: r.scheduledAt, outcomeNote: r.outcomeNote, doneAt: r.doneAt, cancelReason: r.cancelReason, cancelledAt: r.cancelledAt,
  teamNotified: r.opsNotifiedAt !== null, createdAt: r.createdAt,
});
export type SetupCallView = ReturnType<typeof view>;

@Injectable()
export class SetupCallService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: SetupCallRepository,
  ) {}

  private assertAdmin(a: TenantActor) { if (!a.canManage) throw swdTenancyRefusal('SETUP_CALL_RESTRICTED'); }

  async request(tenantId: string, actor: TenantActor, idemKey: string, input: SetupCallInput, ip: string | null): Promise<SetupCallView> {
    this.assertAdmin(actor);
    const problem = slotProblem(input.slotStart, input.slotEnd);
    if (problem) throw swdTenancyRefusal('SETUP_CALL_SLOT_INVALID', { problem });
    const notes = input.notes?.trim() ? input.notes.trim().slice(0, NOTES_MAX) : null;
    return this.idem.remember(idemKey, actor.userId, 'tenancy.setup_call_request', async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          if (await this.repo.open(tenantId, tx)) throw swdTenancyRefusal('SETUP_CALL_ALREADY_OPEN');
          const masked = lastFourMask(await this.repo.requesterPhone(tx, actor.userId));
          if (!masked) throw swdTenancyRefusal('SETUP_CALL_NO_PHONE');
          const id = uuidv7();
          await this.repo.insertTx(tx, { id, tenantId, requestedBy: actor.userId, slotStart: input.slotStart, slotEnd: input.slotEnd, languageCode: input.languageCode, phoneMasked: masked, notes });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.setup_call_requested', entityType: 'setup_call_request', entityId: id,
            newValue: { slotStart: input.slotStart.toISOString(), slotEnd: input.slotEnd.toISOString(), languageCode: input.languageCode, phoneMasked: masked }, ip });
          // the requester's confirmation (notification map: recipient `requestedBy`) + the admin realm's queue notice (the handler)
          await this.outbox.write(tx, { tenantId, aggregateType: 'setup_call_request', aggregateId: id, eventType: SETUP_CALL_REQUESTED,
            payload: { v: 1, requestId: id, requestedBy: actor.userId, slotStart: istCivil(input.slotStart), slotEnd: istCivil(input.slotEnd), language: input.languageCode } });
          return view((await this.repo.get(tenantId, id, tx))!);
        }, { userId: actor.userId });
      } catch (e) { throw namedSwdTenancyRefusal(e); }
    });
  }

  async list(tenantId: string, actor: TenantActor, after?: KeysetCursor, limit = 20) {
    this.assertAdmin(actor);
    const rows = await this.repo.page(tenantId, limit + 1, after);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: page.map(view), nextCursor: rows.length > limit && last ? encodeKeyset(last.cursorTs, last.id) : null, zone: SETUP_CALL_ZONE };
  }

  async cancel(tenantId: string, actor: TenantActor, id: string, reason: string, ip: string | null): Promise<SetupCallView> {
    this.assertAdmin(actor);
    const why = (reason ?? '').trim();
    if (why.length < 3 || why.length > 300) throw swdTenancyRefusal('REASON_REQUIRED');
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const row = await this.repo.get(tenantId, id, tx, true);
        if (!row) throw swdTenancyRefusal('SETUP_CALL_NOT_FOUND');
        if (!(await this.repo.cancelTx(tx, tenantId, id, actor.userId, why))) throw swdTenancyRefusal('SETUP_CALL_CLOSED');
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.setup_call_cancelled', entityType: 'setup_call_request', entityId: id, oldValue: { status: row.status }, newValue: { status: 'cancelled' }, reason: why, ip });
        return view((await this.repo.get(tenantId, id, tx))!);
      }, { userId: actor.userId });
    } catch (e) { throw namedSwdTenancyRefusal(e); }
  }
}

/** "2026-10-12 10:30" in IST — the notice's words, never a raw ISO instant in vernacular copy. */
export function istCivil(d: Date): string {
  const s = new Date(d.getTime() + 330 * 60_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}
