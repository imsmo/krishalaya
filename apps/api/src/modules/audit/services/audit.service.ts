// modules/audit/services/audit.service.ts · read-only audit-trail use-cases (CQRS, Law 12).
// authz THROWS (Law 6): a caller without `audit.read` gets 403. No writes to the trail — it is written only by core/audit
// AuditWriter inside business transactions. Keyset cursor: µs instant + id (9a's F-7 fix).
//
// [PC-56 TENANT-9c · F-9] FOUR THINGS THIS READ DID NOT DO, AND NOW DOES:
//   1. MASKED BY DEFAULT. Every diff passes `maskEntry` before it leaves the API; the masked field paths travel beside it.
//      The unmasked value is a separate, RECORDED act (`reveal`, `member.pii.reveal` + a reason ≥ 20 — 1b's control) that
//      unmasks ONE row and writes both a read-log row and an `audit.entry.revealed` trail row BEFORE the value is returned.
//      The trail row never carries the value (1b's rule: the audit log must not become a second copy of the PII).
//   2. ITSELF AUDITED. Every page and every entry opened writes an `audit_read_log` row first (who, which roles, why, the
//      filter, the row count, the first and last id, the window) — recorded before returned; a failed record fails the read.
//   3. BOUNDED, IN THE COOPERATIVE'S DAYS. ≤ 92 days (the canon's own bound) over civil days in `countries.timezone`.
//   4. HONEST ABOUT `actor_role`. Old rows print "not recorded" (the field is null), never a guessed role.
// The flag is read HERE, not by FeatureFlagGuard, so a switched-off console is a sentence (`AUDITOR_REALM_OFF`), not a 404
// the page cannot tell from a broken one.
import { Inject, Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AuditRepository, AuditRow } from '../repositories/audit.repository';
import { AuditReadLogRepository } from '../repositories/audit-read-log.repository';
import { AuditorClockRepository, TenantClock } from '../repositories/auditor-clock.repository';
import { QueryAuditDto, MIN_REVEAL_REASON } from '../dto/audit.dto';
import { encodeAuditCursor, decodeAuditCursor } from '../domain/audit.cursor';
import { maskEntry } from '../domain/audit-diff-mask';
import { MAX_LIVE_WINDOW_DAYS, ReadPurpose, fiscalYearOf, resolveWindow, roleSetOf, spanOf } from '../domain/auditor-realm';
import { AuditEntryNotFoundError, AuditRevealRefusedError, AuditWindowRefusedError, AuditorRealmOffError } from '../domain/auditor.errors';

export const AUDIT_TRAIL_FLAG = 'audit_trail';
export const PII_REVEAL = 'member.pii.reveal';
/** How long a recorded reveal lets its own actor re-open the unmasked row (the console's redirect → page read). */
export const REVEAL_GRANT_MINUTES = 15;

export interface AuditActor {
  userId: string; canRead: boolean;
  roles?: readonly string[]; permissions?: ReadonlySet<string>; requestId?: string | null;
}

export interface AuditWire {
  id: string; actorUserId: string | null; actorRole: string | null; actorRoleRecorded: boolean; action: string;
  entityType: string | null; entityId: string | null; oldValue: unknown; newValue: unknown;
  /** The diff paths NOT shown (masked). Empty when nothing was PII — or when this is a recorded reveal. */
  maskedFields: string[]; masked: boolean;
  reason: string | null; requestId: string | null; createdAt: string;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));

/** The wire shape — MASKED unless `reveal` (the recorded act) asked otherwise. */
export function wire(r: AuditRow, reveal = false): AuditWire {
  const m = reveal ? { oldValue: r.oldValue ?? null, newValue: r.newValue ?? null, maskedFields: [] as string[] } : maskEntry(r.oldValue ?? null, r.newValue ?? null);
  return {
    id: r.id, actorUserId: r.actorUserId, actorRole: r.actorRole, actorRoleRecorded: r.actorRole !== null && r.actorRole !== '', action: r.action,
    entityType: r.entityType, entityId: r.entityId, oldValue: m.oldValue, newValue: m.newValue, maskedFields: m.maskedFields, masked: !reveal,
    reason: r.reason, requestId: r.requestId, createdAt: iso(r.createdAt),
  };
}

@Injectable()
export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly readLog: AuditReadLogRepository,
    private readonly clocks: AuditorClockRepository,
    private readonly flags: FlagsService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
  ) {}

  private async assertOn(tenantId: string): Promise<void> {
    const on = await this.flags.isEnabled(AUDIT_TRAIL_FLAG, { tenantId }).catch(() => false);   // fail closed
    if (!on) throw new AuditorRealmOffError();
  }

  private async record(tenantId: string, actor: AuditActor, purpose: ReadPurpose, surface: string, filter: Record<string, unknown>, ids: string[], win?: { from: string; to: string; zone: string }) {
    const span = spanOf(ids);
    await this.readLog.record({
      tenantId, actorUserId: actor.userId, actorRole: roleSetOf(actor.roles), purpose, surface, filter,
      rowCount: span.count, spanFirst: span.first, spanLast: span.last, requestId: actor.requestId ?? null, window: win ?? null,
    });
  }

  /** The window this list runs over (≤ 92 days, civil days in the cooperative's zone). */
  windowFor(clock: TenantClock, from?: string, to?: string) {
    const fy = fiscalYearOf(clock.today, clock.fyMonth);
    const w = resolveWindow(from, to, clock.today, MAX_LIVE_WINDOW_DAYS, fy.declared ? fy.start : null);
    if (!w.ok) throw new AuditWindowRefusedError(w.code, w.maxDays);
    return w;
  }

  async list(tenantId: string, actor: AuditActor, q: QueryAuditDto) {
    if (!actor.canRead) throw new ForbiddenError('audit.read required');
    await this.assertOn(tenantId);
    const clock = await this.clocks.clockOf(tenantId);
    const w = this.windowFor(clock, q.from, q.to);
    const rows = await this.repo.listFor(tenantId, {
      action: q.action, entityType: q.entityType, entityId: q.entityId, actorUserId: q.actorUserId,
      fromDay: w.from, toDay: w.to, zone: clock.zone, cursor: decodeAuditCursor(q.cursor), limit: q.limit,
    });
    const filter = { action: q.action ?? null, entityType: q.entityType ?? null, entityId: q.entityId ?? null, actorUserId: q.actorUserId ?? null, cursor: q.cursor ? 'next' : null, limit: q.limit };
    await this.record(tenantId, actor, 'trail_page', 'GET /v1/audit/entries', filter, rows.map((r) => r.id), { from: w.from, to: w.to, zone: clock.zone });
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeAuditCursor(last.cursorTs, last.id) : null;
    return { items: rows.map((r) => wire(r)), nextCursor, window: { from: w.from, to: w.to, days: w.days, maxDays: MAX_LIVE_WINDOW_DAYS, zone: clock.zone, defaulted: w.defaulted } };
  }

  /**
   * One entry, masked — or, with a `revealGrant`, unmasked: the grant is the id of THIS caller's own `trail_reveal` read-log
   * row for THIS entry, less than 15 minutes old (the console carries the grant in its URL after the recorded reveal, so no
   * value ever travels in a URL). A grant that is not that is ignored, never an error: the entry comes back masked.
   */
  async getById(tenantId: string, actor: AuditActor, id: string, revealGrant?: string | null) {
    if (!actor.canRead) throw new ForbiddenError('audit.read required');
    await this.assertOn(tenantId);
    const row = await this.repo.getById(tenantId, id);
    if (!row) return null;
    const granted = !!revealGrant && /^\d{1,19}$/.test(revealGrant) && await this.readLog.hasLiveReveal(tenantId, actor.userId, row.id, revealGrant, REVEAL_GRANT_MINUTES);
    await this.record(tenantId, actor, 'trail_entry', 'GET /v1/audit/entries/:id', { id, ...(granted ? { revealGrant } : {}) }, [row.id]);
    return wire(row, granted);
  }

  /**
   * THE RECORDED REVEAL — one row, unmasked, on `member.pii.reveal` with a reason of at least 20 characters. The read-log
   * row (`trail_reveal`, reason in the filter) and the `audit.entry.revealed` trail row (which fields — never their values)
   * are committed in ONE transaction BEFORE the value is returned. No try/catch: if the record fails, no PII leaves.
   */
  async reveal(tenantId: string, actor: AuditActor, id: string, reasonRaw: string, ip: string | null) {
    if (!actor.canRead) throw new ForbiddenError('audit.read required');
    await this.assertOn(tenantId);
    const can = !!actor.permissions && (actor.permissions.has(PII_REVEAL) || actor.permissions.has('*'));
    if (!can) throw new AuditRevealRefusedError('NO_PERMISSION');
    const reason = (reasonRaw ?? '').replace(/\s+/g, ' ').trim();
    if (reason.length < MIN_REVEAL_REASON) throw new AuditRevealRefusedError('REVEAL_REASON_TOO_SHORT', MIN_REVEAL_REASON);
    const row = await this.repo.getById(tenantId, id);
    if (!row) throw new AuditEntryNotFoundError(id);
    const fields = maskEntry(row.oldValue ?? null, row.newValue ?? null).maskedFields;
    const grant = await this.uow.run(tenantId, async (tx) => {
      const g = await tx.query<{ id: string }>(
        `INSERT INTO audit_read_log (tenant_id, actor_user_id, actor_role, purpose, surface, filter, row_count, span_first, span_last, request_id)
         VALUES ($1,$2,$3,'trail_reveal','POST /v1/audit/entries/:id/reveal',$4::jsonb,1,$5,$5,$6) RETURNING id::text AS id`,
        [tenantId, actor.userId, roleSetOf(actor.roles), JSON.stringify({ id, reason, fields }), row.id, actor.requestId ? actor.requestId.slice(0, 60) : null]);
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'audit.entry.revealed', entityType: 'audit_log_entry', entityId: null,
        newValue: { entryId: row.id, fields }, reason, ip, requestId: actor.requestId ?? null,
      });
      return g.rows[0].id;
    }, { userId: actor.userId });
    return { ...wire(row, true), revealGrant: grant, grantMinutes: REVEAL_GRANT_MINUTES };
  }
}
