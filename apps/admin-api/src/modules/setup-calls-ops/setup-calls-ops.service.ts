// apps/admin-api/src/modules/setup-calls-ops/setup-calls-ops.service.ts · PC-56 TENANT-SW-d · C1 — the ADMIN REALM side of "Book a setup call".
//
// Founder decision (2026-10-04): a PLATFORM-STAFFED request object. The tenant asks (apps/api, one open request per tenant); the Krishalaya
// team works the queue HERE (Law 11 — god-mode lives only in apps/admin-api, kv_admin):
//   • the queue: requests by status (PII MASKED — the last four digits the request already carries) and the open in-app notices
//     (`platform_ops_notices`, written by apps/api's SetupCallRequestedHandler — the platform has no ops alert channel, so this is it);
//   • the case: ONE deliberate, audited read returns the requester's phone from their user record so a human can call them;
//   • schedule (a time), done (an outcome note), cancel (a reason) — each in ONE transaction with its audit row; scheduling acknowledges
//     the notice. 0200's trigger is the wall: only this realm (kv_admin) may schedule or close; the request itself is fixed.
// No calendar integration: the team calls in the slot the requester chose.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../core/database/admin-pool';
import { AdminAuditWriter } from '../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../core/auth/admin-auth.guard';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const STATUSES = ['requested', 'scheduled', 'done', 'cancelled'] as const;

@Injectable()
export class SetupCallsOpsService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter) {}

  /** The queue — masked, keyset on (preferred slot, id): the soonest call first. */
  async list(q: { status?: string; cursor?: { c: string; id: string }; limit: number }) {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'true';
    if (q.status) { if (!(STATUSES as readonly string[]).includes(q.status)) throw new BadRequestException('unknown status'); where += ` AND r.status = ${p(q.status)}`; }
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (r.preferred_slot_start > ${cc}::timestamptz OR (r.preferred_slot_start = ${cc}::timestamptz AND r.id > ${ci}::uuid))`; }
    const lim = p(Math.min(q.limit, 100));
    const r = await this.pool.query(
      `SELECT r.id, r.tenant_id, t.display_name AS org, r.preferred_slot_start, r.preferred_slot_end, r.language_code, r.phone_masked, r.status,
              r.scheduled_at, r.done_at, r.cancelled_at, r.created_at, to_char(r.preferred_slot_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cur
         FROM setup_call_requests r JOIN tenants t ON t.id = r.tenant_id
        WHERE ${where} ORDER BY r.preferred_slot_start, r.id LIMIT ${lim}`, params);
    const items = r.rows.map((x: any) => ({
      id: x.id, tenantId: x.tenant_id, organisation: x.org, slotStart: iso(x.preferred_slot_start), slotEnd: iso(x.preferred_slot_end), language: x.language_code,
      phoneMasked: x.phone_masked, status: x.status, scheduledAt: iso(x.scheduled_at), doneAt: iso(x.done_at), cancelledAt: iso(x.cancelled_at), createdAt: iso(x.created_at),
    }));
    const last = r.rows[r.rows.length - 1];
    return { items, nextCursor: items.length === Math.min(q.limit, 100) && last ? Buffer.from(`${last.cur}|${last.id}`).toString('base64') : null };
  }

  /** The admin realm's open in-app notices (PII-free summaries). */
  async notices(limit = 50) {
    const r = await this.pool.query(
      `SELECT n.id, n.tenant_id, t.display_name AS org, n.kind, n.ref_id, n.summary, n.created_at FROM platform_ops_notices n JOIN tenants t ON t.id = n.tenant_id
        WHERE n.acknowledged_at IS NULL ORDER BY n.created_at DESC, n.id DESC LIMIT $1`, [Math.min(limit, 200)]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, organisation: x.org, kind: x.kind, refId: x.ref_id, summary: x.summary, createdAt: iso(x.created_at) }));
  }

  /** The case — the requester's phone from THEIR user record, for the human who will call. Audited (PII disclosed). */
  async get(actor: AdminRequestContext, id: string) {
    const r = await this.pool.query(
      `SELECT r.*, t.display_name AS org, u.phone, u.full_name FROM setup_call_requests r JOIN tenants t ON t.id = r.tenant_id
         JOIN users u ON u.id = r.requested_by WHERE r.id = $1`, [id]);
    const x = r.rows[0];
    if (!x) throw new NotFoundException('setup call not found');
    await this.pool.withTx((c) => this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'setup_call.viewed', entityType: 'setup_call_request',
      entityId: id, oldValue: null, newValue: { status: x.status }, reason: 'platform staff opened the request to call the requester (phone disclosed)', ip: actor.ip, requestId: actor.requestId || null }));
    return { id: x.id, tenantId: x.tenant_id, organisation: x.org, requesterName: x.full_name ?? null, phone: x.phone, slotStart: iso(x.preferred_slot_start), slotEnd: iso(x.preferred_slot_end),
      language: x.language_code, notes: x.notes ?? null, status: x.status, scheduledAt: iso(x.scheduled_at), outcomeNote: x.outcome_note ?? null, createdAt: iso(x.created_at) };
  }

  private async lock(c: PoolClient, id: string) {
    const r = await c.query(`SELECT * FROM setup_call_requests WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rows[0]) throw new NotFoundException('setup call not found');
    return r.rows[0];
  }
  private named(e: unknown): never {
    const m = /\[([A-Z_]+)\]/.exec(String((e as Error)?.message ?? ''));
    if (m) throw new ConflictException({ code: m[1], message: String((e as Error).message) });
    throw e;
  }

  async schedule(actor: AdminRequestContext, id: string, dto: { scheduledAt: string }) {
    const at = new Date(dto.scheduledAt);
    if (Number.isNaN(at.getTime())) throw new BadRequestException('scheduledAt must be an ISO instant');
    return this.pool.withTx(async (c) => {
      const row = await this.lock(c, id);
      if (row.status !== 'requested' && row.status !== 'scheduled') throw new ConflictException({ code: 'SETUP_CALL_CLOSED', message: `this request is ${row.status}` });
      try {
        await c.query(`UPDATE setup_call_requests SET status = 'scheduled', scheduled_at = $2, handled_by = $3 WHERE id = $1`, [id, at.toISOString(), actor.userId]);
      } catch (e) { this.named(e); }
      await c.query(`UPDATE platform_ops_notices SET acknowledged_by = $2, acknowledged_at = now() WHERE kind = 'setup_call_requested' AND ref_id = $1 AND acknowledged_at IS NULL`, [id, actor.userId]);
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'setup_call.scheduled', entityType: 'setup_call_request', entityId: id,
        oldValue: { status: row.status }, newValue: { status: 'scheduled', scheduledAt: at.toISOString() }, reason: null, ip: actor.ip, requestId: actor.requestId || null });
      return { id, status: 'scheduled' as const, scheduledAt: at.toISOString() };
    });
  }

  async done(actor: AdminRequestContext, id: string, dto: { outcomeNote: string }) {
    const note = (dto.outcomeNote ?? '').trim();
    if (note.length < 3 || note.length > 500) throw new BadRequestException('outcomeNote of 3–500 characters is required');
    return this.pool.withTx(async (c) => {
      const row = await this.lock(c, id);
      if (row.status !== 'scheduled') throw new ConflictException({ code: 'SETUP_CALL_BAD_MOVE', message: `only a scheduled call is closed as done (is ${row.status})` });
      try { await c.query(`UPDATE setup_call_requests SET status = 'done', done_at = now(), outcome_note = $2 WHERE id = $1`, [id, note]); } catch (e) { this.named(e); }
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'setup_call.done', entityType: 'setup_call_request', entityId: id,
        oldValue: { status: row.status }, newValue: { status: 'done' }, reason: note, ip: actor.ip, requestId: actor.requestId || null });
      return { id, status: 'done' as const };
    });
  }

  async cancel(actor: AdminRequestContext, id: string, dto: { reason: string }) {
    const why = (dto.reason ?? '').trim();
    if (why.length < 3 || why.length > 300) throw new BadRequestException('reason of 3–300 characters is required');
    return this.pool.withTx(async (c) => {
      const row = await this.lock(c, id);
      try {
        await c.query(`UPDATE setup_call_requests SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, handled_by = COALESCE(handled_by, $3), scheduled_at = COALESCE(scheduled_at, NULL) WHERE id = $1`, [id, why, actor.userId]);
      } catch (e) { this.named(e); }
      await c.query(`UPDATE platform_ops_notices SET acknowledged_by = $2, acknowledged_at = now() WHERE kind = 'setup_call_requested' AND ref_id = $1 AND acknowledged_at IS NULL`, [id, actor.userId]);
      await this.audit.write(c, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'setup_call.cancelled_by_platform', entityType: 'setup_call_request', entityId: id,
        oldValue: { status: row.status }, newValue: { status: 'cancelled' }, reason: why, ip: actor.ip, requestId: actor.requestId || null });
      return { id, status: 'cancelled' as const };
    });
  }
}
