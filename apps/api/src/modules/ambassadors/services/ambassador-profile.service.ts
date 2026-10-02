// modules/ambassadors/services/ambassador-profile.service.ts · enroll + manage ambassadors (admin).
// enroll/suspend/update need ambassador.manage (Law 11 — not self-grant) + write an audit row in the same tx.
// One profile per user (409 on duplicate). getMine resolves the caller's own profile. authz THROWS.
//
// PC-56 TENANT-10a — W159 / W2481–W2487
//   • RECRUIT (W2481–W2484): the member is found by PHONE (never a pasted UUID), must hold an active role in THIS
//     cooperative and must not already be an ambassador; tier, up to three cluster regions and an optional mentor are
//     checked against the tables that define them. `reviewRecruit` and the act share one rule function
//     (`recruitRefusals`), the act re-gathering its facts inside its own transaction. Idempotent on the caller's key.
//   • EDIT (F-12): every change to stipend / tier / cluster / mentor / kiosk / AePS / training writes
//     `ambassador.updated` with the before and after of exactly the fields that changed (and the reason, when given).
//   • SUSPEND / REINSTATE (F-12): suspend REQUIRES a reason; both record before → after.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext, SqlExecutor } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import { DomainEvent } from '../domain/ambassadors.events';
import { encodeCursor } from '../domain/cursor';
import { EditEntries, RecruitEntries, RecruitFacts, Refusal, editDiff, editRefusals, recruitRefusals, RECRUIT_FIELDS, EDIT_FIELDS } from '../domain/recruit.rules';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { AmbassadorRosterReadModel, MemberCandidate, RosterQuery } from '../read-models/ambassador-roster.read-model';
import { AmbassadorNotFoundError, AmbassadorsForbiddenError } from '../domain/ambassadors.errors';
import { DomainError } from '../../../shared/errors/app-error';
import { requireReason } from './ambassador-earning.service';

export interface AmbassadorActor { userId: string; canManage: boolean; }

/** The review the form chain renders (W2482; with refusals it IS W2481) — the DairyReview shape the console's chain reads. */
export interface ProfileReview {
  ready: boolean;
  fields: Array<{ name: string; entered: string | null; stored: string | null; normalised: boolean }>;
  refusals: Refusal[];
  diff: Array<{ field: string; before: string | null; after: string | null }> | null;
  entityType: 'ambassador_profile';
  member: MemberCandidate | null;
}

/** 422 with every refusal, against its field — the console's failure screen lists them (W2484). */
export class RecruitRefusedError extends DomainError {
  constructor(refusals: Refusal[]) { super('AMBASSADOR_REFUSED', `Refused: ${refusals.map((r) => r.code).join(', ')}`, 422, { refusals }); }
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const optReason = (raw: string | null | undefined): string | null => {
  const s = (raw ?? '').trim();
  if (s.length === 0) return null;
  return requireReason(s, 'record this change');
};

@Injectable()
export class AmbassadorProfileService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: AmbassadorProfileRepository,
    private readonly rosterModel: AmbassadorRosterReadModel,
  ) {}

  /* ------------------------------------------------------------------------------------------------------------ */
  /* RECRUIT                                                                                                      */
  /* ------------------------------------------------------------------------------------------------------------ */

  private async recruitFacts(tenantId: string, e: RecruitEntries, exec?: SqlExecutor): Promise<RecruitFacts> {
    const phoneE164 = e.phone ? normalizePhoneE164(e.phone) : null;
    const member = phoneE164 ? await this.rosterModel.memberByPhone(tenantId, phoneE164, exec) : null;
    return {
      phoneE164,
      member: member ? { userId: member.userId, isMember: member.isMember } : null,
      alreadyAmbassador: !!member?.ambassadorId,
      ...(await this.sharedFacts(tenantId, e, exec)),
      _candidate: member,
    } as RecruitFacts & { _candidate: MemberCandidate | null };
  }
  private async sharedFacts(tenantId: string, e: EditEntries, exec?: SqlExecutor): Promise<Pick<RecruitFacts, 'tierKnown' | 'unknownClusterIds' | 'mentor'>> {
    const tierKnown = e.tierId ? (UUID.test(e.tierId) ? await this.rosterModel.tierKnown(tenantId, e.tierId, exec) : false) : null;
    const ids = e.clusterRegionIds ?? [];
    const malformed = ids.filter((i) => !UUID.test(i));
    const unknownClusterIds = [...malformed, ...(await this.rosterModel.unknownRegions(tenantId, ids.filter((i) => UUID.test(i)), exec))];
    let mentor: RecruitFacts['mentor'] = null;
    if (e.mentorAmbassadorId) {
      const m = UUID.test(e.mentorAmbassadorId) ? await this.repo.getById(tenantId, e.mentorAmbassadorId, exec as TxContext | undefined) : null;
      mentor = { exists: !!m, active: !!m?.isActive, userId: m?.userId ?? null };
    }
    return { tierKnown, unknownClusterIds, mentor };
  }

  async reviewRecruit(tenantId: string, actor: AmbassadorActor, e: RecruitEntries): Promise<ProfileReview> {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    const facts = await this.recruitFacts(tenantId, e) as RecruitFacts & { _candidate: MemberCandidate | null };
    const refusals = recruitRefusals(e, facts);
    const entered: Record<string, string | null> = {
      phone: e.phone ?? null, tierId: e.tierId ?? null, clusterRegionIds: (e.clusterRegionIds ?? []).join(',') || null,
      mentorAmbassadorId: e.mentorAmbassadorId ?? null, kioskEnabled: e.kioskEnabled === undefined ? null : String(e.kioskEnabled),
      aepsEnabled: e.aepsEnabled === undefined ? null : String(e.aepsEnabled), monthlyStipendMinor: e.monthlyStipendMinor ?? null,
    };
    // A person who is NOT a member of this cooperative is never named to it: the review says NOT_A_MEMBER and nothing more.
    const named = facts._candidate && facts._candidate.isMember ? facts._candidate : null;
    const stored: Record<string, string | null> = { ...entered, phone: named?.phoneMasked ?? null, kioskEnabled: String(e.kioskEnabled ?? false), aepsEnabled: String(e.aepsEnabled ?? false), monthlyStipendMinor: e.monthlyStipendMinor || '0' };
    return {
      ready: refusals.length === 0,
      fields: RECRUIT_FIELDS.map((name) => ({ name, entered: entered[name], stored: stored[name], normalised: name === 'phone' ? !!named : entered[name] !== stored[name] })),
      refusals, diff: null, entityType: 'ambassador_profile', member: named,
    };
  }

  async enroll(tenantId: string, actor: AmbassadorActor, e: RecruitEntries & { userId?: string }, idemKey: string, ip: string | null) {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.enroll', () =>
      timed(this.metrics, 'ambassadors.enroll', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          // The legacy body named a userId; the act still resolves that person to a phone so the SAME rules apply.
          let entries: RecruitEntries = e;
          if (!e.phone && e.userId) {
            const u = await tx.query<{ phone: string }>(`SELECT phone FROM users WHERE id=$1 AND deleted_at IS NULL`, [e.userId]);
            entries = { ...e, phone: u.rows[0]?.phone ?? '' };
          }
          const facts = await this.recruitFacts(tenantId, entries, tx);
          const refusals = recruitRefusals(entries, facts);
          if (refusals.length > 0) throw new RecruitRefusedError(refusals);
          const userId = facts.member!.userId;
          const a = AmbassadorProfile.enroll({ id: uuidv7(), userId, tenantId, clusterRegionIds: entries.clusterRegionIds ?? [], tierId: entries.tierId || null,
            mentorAmbassadorId: entries.mentorAmbassadorId || null, trainingCompletedAt: null, kioskEnabled: !!entries.kioskEnabled, aepsEnabled: !!entries.aepsEnabled,
            monthlyStipendMinor: BigInt(entries.monthlyStipendMinor || '0') });
          try { await this.repo.insert(tx, a); }
          catch (err) { if ((err as { code?: string }).code === '23505') throw new RecruitRefusedError([{ field: 'phone', code: 'ALREADY_AMBASSADOR' }]); throw err; }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.enrolled', entityType: 'ambassador_profile', entityId: a.id,
            oldValue: null, newValue: { userId, ...a.editableSnapshot() }, ip });
          await this.flush(tx, tenantId, a.id, a.pullEvents());
          return a.toJSON();
        }, { userId: actor.userId })));
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* EDIT                                                                                                         */
  /* ------------------------------------------------------------------------------------------------------------ */

  async reviewEdit(tenantId: string, actor: AmbassadorActor, id: string, e: EditEntries): Promise<ProfileReview> {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    const a = await this.repo.getById(tenantId, id);
    if (!a) throw new AmbassadorNotFoundError(id);
    const current = a.editableSnapshot();
    const diff = editDiff(current, e);
    const refusals = editRefusals(e, await this.sharedFacts(tenantId, e), a.userId, diff);
    const entered = (n: string): string | null => { const v = (e as Record<string, unknown>)[n]; return v === undefined ? null : Array.isArray(v) ? v.join(',') : String(v); };
    return {
      ready: refusals.length === 0,
      fields: EDIT_FIELDS.map((name) => { const d = diff.find((x) => x.field === name); return { name, entered: entered(name), stored: d ? d.after : (name === 'trainingCompleted' ? (current.trainingCompletedAt ? 'true' : 'false') : entered(name) ?? (current[name] == null ? null : Array.isArray(current[name]) ? (current[name] as string[]).join(',') : String(current[name]))), normalised: false }; }),
      refusals, diff, entityType: 'ambassador_profile', member: null,
    };
  }

  async update(tenantId: string, actor: AmbassadorActor, id: string, e: EditEntries & { reason?: string }, ip: string | null = null) {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    const reason = optReason(e.reason);
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, id);
      if (!a) throw new AmbassadorNotFoundError(id);
      const before = a.editableSnapshot();
      const diff = editDiff(before, e);
      const refusals = editRefusals(e, await this.sharedFacts(tenantId, e, tx), a.userId, diff);
      if (refusals.length > 0) throw new RecruitRefusedError(refusals);
      a.update({
        clusterRegionIds: e.clusterRegionIds, tierId: e.tierId === '' ? null : e.tierId, mentorAmbassadorId: e.mentorAmbassadorId === '' ? null : e.mentorAmbassadorId,
        kioskEnabled: e.kioskEnabled, aepsEnabled: e.aepsEnabled,
        monthlyStipendMinor: e.monthlyStipendMinor !== undefined && e.monthlyStipendMinor !== '' ? BigInt(e.monthlyStipendMinor) : undefined,
        trainingCompletedAt: e.trainingCompleted && !before.trainingCompletedAt ? new Date() : undefined,
      });
      await this.repo.update(tx, a);
      const after = a.editableSnapshot();
      const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.updated', entityType: 'ambassador_profile', entityId: id,
        oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])), newValue: Object.fromEntries(changed.map((k) => [k, after[k]])), reason, ip });
      return a.toJSON();
    }, { userId: actor.userId });
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* SUSPEND / REINSTATE                                                                                          */
  /* ------------------------------------------------------------------------------------------------------------ */

  async setActive(tenantId: string, actor: AmbassadorActor, id: string, active: boolean, ip: string | null, reasonRaw?: string | null) {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    const reason = active ? optReason(reasonRaw) : requireReason(reasonRaw, 'suspend an ambassador');
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, id);
      if (!a) throw new AmbassadorNotFoundError(id);
      const before = { isActive: a.isActive };
      if (active) a.reinstate(); else a.suspend();
      await this.repo.update(tx, a);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: active ? 'ambassador.reinstated' : 'ambassador.suspended', entityType: 'ambassador_profile', entityId: id,
        oldValue: before, newValue: { isActive: a.isActive }, reason, ip });
      await this.flush(tx, tenantId, id, a.pullEvents());
      return a.toJSON();
    }, { userId: actor.userId });
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* READS                                                                                                        */
  /* ------------------------------------------------------------------------------------------------------------ */

  async getById(tenantId: string, id: string) { const a = await this.repo.getById(tenantId, id); if (!a) throw new AmbassadorNotFoundError(id); return a.toJSON(); }
  async getMine(tenantId: string, actor: AmbassadorActor) { const a = await this.repo.findByUser(tenantId, actor.userId); if (!a) throw new AmbassadorNotFoundError('me'); return a.toJSON(); }
  /** W159's roster (A11). */
  async roster(tenantId: string, actor: AmbassadorActor, q: RosterQuery) {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    return this.rosterModel.roster(tenantId, q);
  }
  async summary(tenantId: string, actor: AmbassadorActor) {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    return this.rosterModel.summary(tenantId);
  }
  /** The plain profile list (keyset, µs cursor) — kept for callers that want the profile shape only. */
  async list(tenantId: string, actor: AmbassadorActor, q: { activeOnly?: boolean; cursor?: { c: string; id: string }; limit: number }) {
    if (!actor.canManage) throw new AmbassadorsForbiddenError('requires ambassador.manage');
    const rows = await this.repo.listFor(tenantId, q);
    const items = rows.map((a) => a.toJSON());
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeCursor(last.toProps().createdAtRaw, last.id) : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'ambassador_profile', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
