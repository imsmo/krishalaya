// modules/tenancy/services/tenant-settings.service.ts · PC-56 TENANT-13b · W186 ORGANISATION SETTINGS — THE MONEY / SECURITY GATE
// (F-4, Law 9), THE FLOORS, THE EFFECT COLUMN, HISTORY, AND THE ONE LANGUAGE STORE.
//
// Founder decision 2026-10-03: TENANT MAKER-CHECKER WITH PLATFORM FLOORS, EFFECTIVE NEXT MIDNIGHT IST WITH MEMBER NOTICE.
//
//   • GET  /tenant-settings            tenant.settings (F-12 — it was open to every member). The registry as W186 prints it: key, type,
//                                       platform default, your value, risk class, the floor, the Effect (ONLY where a consumer reads
//                                       the key — setting-consumers.ts), the pending proposal, the admin count.
//   • PUT  /tenant-settings            an ORDINARY, WIRED key only. Trust-affecting keys answer 409 PROPOSAL_REQUIRED by name; unwired
//                                       keys 409 SETTING_NOT_WIRED; deprecated keys 409 SETTING_DEPRECATED. Before/after + optional
//                                       reason in the audit and in tenant_setting_history (F-16).
//   • POST /tenant-settings/preview    W2755's review — every refusal against its field, the before → after, the floor verdict, "from the
//                                       next midnight IST", who must confirm. Writes nothing.
//   • POST /tenant-settings/proposals  a trust-affecting key: a PROPOSAL (reason ≥ 20), never the value. Refused when the tenant has one
//                                       administrator ("needs a second administrator — your organisation has one").
//   • POST …/proposals/:id/confirm     a DIFFERENT active tenant_admin. 0192's trigger is the wall; this service gives its refusal a name.
//                                       effective_at = the next 00:00 Asia/Kolkata, computed by the database.
//   • POST …/proposals/:id/refuse      a tenant_admin, with a reason ≥ 20.
//   • the apply job                     (jobs/setting-proposals.job.ts) applies due confirmed proposals per tenant as kv_app: writes the
//                                       value citing the proposal (0192 `trg_tenant_settings_gate`), history, audit, the outbox event and
//                                       — for member-notice keys — `tenancy.setting_effective` to every active member. Expires proposals
//                                       unconfirmed after 7 days.
//   • PUT  /tenant-settings/languages  writes tenant_languages (F-14). Removing a language something published uses is refused by name.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { SettingDefinition, validateSettingValue } from '../domain/tenant-settings.entity';
import {
  floorProblem, isFloorLocked, isTrustAffecting, istStamp, nextMidnightIst, noticeValue, proposalReasonProblem, sameValue,
} from '../domain/setting-governance';
import { isWired, unwiredReason } from '../domain/setting-consumers';
import { SettingProposalStatus, assertProposalMove } from '../domain/setting-proposal.state';
import {
  InvalidSettingError, LanguageInUseError, LanguagesInvalidError, SettingCheckerIsMakerError, SettingDeprecatedError,
  SettingNeedsSecondAdminError, SettingNotGatedError, SettingNotWiredError, SettingOutsideFloorError, SettingProposalExpiredError,
  SettingProposalLiveError, SettingProposalNotFoundError, SettingProposalRequiredError, SettingReasonError, SettingUnchangedError,
  TenantForbiddenError, UnknownSettingError, SettingNotTenantScopedError,
} from '../domain/tenancy.errors';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { ProposalRow, SettingGovernanceRepository } from '../repositories/setting-governance.repository';
import { TenantActor } from '../policies/tenancy.policies';

export const SETTING_EFFECTIVE_EVENT = 'tenancy.setting_effective';
export const SETTING_CHANGED_EVENT = 'tenancy.tenant_setting_changed';
export const LANGUAGES_CHANGED_EVENT = 'tenancy.tenant_languages_changed';
const MAX_LANGUAGES = 12;
const LANG_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export interface SettingInput { key: string; value: unknown; reason?: string | null }
export type SettingRoute = 'direct' | 'proposal' | 'none';
export interface Refusal { field: string | null; code: string; detail?: Record<string, unknown> }

/** Map a 0192 trigger refusal (its `[CODE]` token) to the named error the API answers with. Anything else is re-thrown as is. */
function mapTriggerError(e: unknown, proposalId: string, key?: string): never {
  const msg = String((e as { message?: string })?.message ?? '');
  if (msg.includes('[SETTING_CHECKER_IS_MAKER]')) throw new SettingCheckerIsMakerError(proposalId);
  if (msg.includes('[SETTING_CHECKER_NOT_ADMIN]') || msg.includes('[SETTING_PROPOSER_NOT_ADMIN]')) throw new TenantForbiddenError('Only an active tenant administrator may propose, confirm or refuse a trust-affecting setting');
  if (msg.includes('[SETTING_OUTSIDE_FLOOR]')) throw new SettingOutsideFloorError(key ?? '', { problem: 'database_floor' });
  if (msg.includes('[SETTING_PROPOSAL_EXPIRED]')) throw new SettingProposalExpiredError(proposalId, '');
  throw e;
}

@Injectable()
export class TenantSettingsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly defs: TenantSettingsRepository,
    private readonly repo: SettingGovernanceRepository,
    private readonly ui: UiMessageRepository,
  ) {}

  private assertManager(a: TenantActor) { if (!a.canManage) throw new TenantForbiddenError(); }

  /* ================================================================================================================== */
  /* READS                                                                                                              */
  /* ================================================================================================================== */

  /** W186's registry table, its pending proposals, the admin count and the language panel — one read, tenant.settings. */
  async registry(tenantId: string, actor: TenantActor) {
    this.assertManager(actor);
    const [rows, live, admins, languages, platformLanguages] = await Promise.all([
      this.repo.registry(tenantId),
      this.repo.listProposals(tenantId, { limit: 200 }).then((ps) => ps.filter((p) => p.status === 'proposed' || p.status === 'confirmed')),
      this.repo.adminIds(tenantId),
      this.repo.languages(tenantId),
      this.repo.platformLanguages(tenantId),
    ]);
    const byKey = new Map(live.map((p) => [p.key, p] as const));
    const items = rows.map(({ def, value, isDefault }) => {
      const route = this.routeOf(def);
      const fp = isDefault ? null : floorProblem(def, value);
      return {
        key: def.key, type: def.valueType, platformDefault: def.defaultValue, value, isDefault,
        riskClass: def.riskClass ?? 'ordinary', memberNotice: def.memberNotice === true,
        trustAffecting: isTrustAffecting(def),
        // the Effect column — ONLY where a consumer reads the key (F-15); otherwise null and the row is in the "not yet wired" list
        effect: isWired(def.key) ? (def.description ?? null) : null,
        wired: isWired(def.key), unwiredReason: unwiredReason(def.key), deprecated: def.deprecatedAt !== null,
        route,
        floor: { min: def.tenantMin ?? null, max: def.tenantMax ?? null, locked: isFloorLocked(def), note: def.floorNote ?? null },
        outsideFloor: fp !== null, lockNote: def.lockNote ?? null,
        pendingProposal: byKey.has(def.key) ? this.proposalView(byKey.get(def.key)!, actor.userId) : null,
      };
    });
    return {
      items,
      counts: { total: items.length, overridden: items.filter((i) => !i.isDefault).length, editable: items.filter((i) => i.route !== 'none').length,
                pending: live.length },
      admins: { count: admins.length, youAreAdmin: admins.includes(actor.userId) },
      languages: { enabled: languages, platform: platformLanguages, addOn: { built: false } },
      discipline: { effectiveAt: 'next_midnight_ist', zone: 'Asia/Kolkata', proposalTtlDays: 7, reasonMin: 20 },
    };
  }

  /** How a key is written from the tenant console. */
  routeOf(def: SettingDefinition): SettingRoute {
    if (def.scope !== 'tenant' || def.deprecatedAt) return 'none';
    if (unwiredReason(def.key) === 'no_consumer' || unwiredReason(def.key) === 'deprecated_languages') return 'none';
    if (isTrustAffecting(def)) return isFloorLocked(def) ? 'none' : 'proposal';
    return 'direct';
  }

  private proposalView(p: ProposalRow, me: string) {
    return {
      id: p.id, key: p.key, status: p.status, oldValue: p.oldValue, newValue: p.newValue, reason: p.reason,
      proposedBy: p.proposedBy, proposedByName: p.proposedByName, proposedAt: p.proposedAt, expiresAt: p.expiresAt,
      confirmedBy: p.confirmedBy, confirmedByName: p.confirmedByName, confirmedAt: p.confirmedAt, effectiveAt: p.effectiveAt,
      refusedBy: p.refusedBy, refusedAt: p.refusedAt, refuseReason: p.refuseReason, expiredAt: p.expiredAt, expireNote: p.expireNote, appliedAt: p.appliedAt,
      youProposed: p.proposedBy === me,
      // the screen offers Confirm only to someone the trigger will accept; the API (and the trigger) judge again
      canConfirm: p.status === 'proposed' && p.proposedBy !== me,
      canRefuse: p.status === 'proposed',
    };
  }

  async proposals(tenantId: string, actor: TenantActor, q: { status?: SettingProposalStatus; key?: string; cursor?: string; limit: number }) {
    this.assertManager(actor);
    const rows = await this.repo.listProposals(tenantId, { status: q.status, key: q.key, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows.map((p) => this.proposalView(p, actor.userId)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  async proposal(tenantId: string, actor: TenantActor, id: string) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new SettingProposalNotFoundError(id);
    const p = await this.repo.getProposal(tenantId, id);
    if (!p) throw new SettingProposalNotFoundError(id);
    const def = await this.defs.findDefinition(tenantId, p.key);
    const admins = await this.repo.adminIds(tenantId);
    return { ...this.proposalView(p, actor.userId), riskClass: def?.riskClass ?? 'ordinary', memberNotice: def?.memberNotice === true,
             floor: def ? { min: def.tenantMin ?? null, max: def.tenantMax ?? null, note: def.floorNote ?? null } : null,
             wouldTakeEffectAt: nextMidnightIst(new Date()).toISOString(), admins: admins.length };
  }

  async history(tenantId: string, actor: TenantActor, q: { key?: string; cursor?: string; limit: number }) {
    this.assertManager(actor);
    const rows = await this.repo.listHistory(tenantId, { key: q.key, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows.map(({ cursorTs, ...h }) => h), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  /* ================================================================================================================== */
  /* THE REVIEW (W2755) — read-only, the same checks the writes make                                                   */
  /* ================================================================================================================== */

  async preview(tenantId: string, actor: TenantActor, input: SettingInput) {
    this.assertManager(actor);
    const def = await this.defs.findDefinition(tenantId, input.key);
    if (!def) throw new UnknownSettingError(input.key);
    const refusals: Refusal[] = [];
    const route = this.routeOf(def);
    if (def.scope !== 'tenant') refusals.push({ field: 'key', code: 'SETTING_NOT_TENANT_SCOPED' });
    else if (def.deprecatedAt) refusals.push({ field: 'key', code: 'SETTING_DEPRECATED' });
    else if (route === 'none' && unwiredReason(def.key)) refusals.push({ field: 'key', code: 'SETTING_NOT_WIRED', detail: { reason: unwiredReason(def.key) } });
    else if (route === 'none') refusals.push({ field: 'key', code: 'SETTING_FLOOR_LOCKED', detail: { only: def.tenantMin } });
    let normalised: unknown = input.value;
    try { if (def.scope === 'tenant') normalised = validateSettingValue(def, input.value); }
    catch (e) { refusals.push({ field: 'value', code: 'TENANT_SETTING_INVALID', detail: { message: (e as Error).message } }); }
    const fp = floorProblem(def, normalised);
    if (fp) refusals.push({ field: 'value', code: 'SETTING_OUTSIDE_FLOOR', detail: { ...fp } });
    const current = await this.uow.run(tenantId, (tx) => this.repo.effectiveTx(tx, tenantId, def.key), { userId: actor.userId });
    if (current && sameValue(current.value, normalised)) refusals.push({ field: 'value', code: 'SETTING_UNCHANGED' });
    const admins = await this.repo.adminIds(tenantId);
    if (route === 'proposal') {
      const rp = proposalReasonProblem(input.reason);
      if (rp) refusals.push({ field: 'reason', code: 'SETTING_REASON_INVALID', detail: { problem: rp } });
      if (admins.length < 2) refusals.push({ field: null, code: 'NEEDS_SECOND_ADMIN', detail: { admins: admins.length } });
      const live = (await this.repo.listProposals(tenantId, { key: def.key, limit: 5 })).find((p) => p.status === 'proposed' || p.status === 'confirmed');
      if (live) refusals.push({ field: 'key', code: 'SETTING_PROPOSAL_LIVE', detail: { proposalId: live.id } });
    } else if (input.reason && input.reason.trim().length > 500) {
      refusals.push({ field: 'reason', code: 'SETTING_REASON_INVALID', detail: { problem: 'too_long' } });
    }
    return {
      key: def.key, type: def.valueType, riskClass: def.riskClass ?? 'ordinary', memberNotice: def.memberNotice === true, route,
      before: current?.value ?? def.defaultValue, beforeIsDefault: current?.isDefault ?? true, after: normalised,
      floor: { min: def.tenantMin ?? null, max: def.tenantMax ?? null, note: def.floorNote ?? null, verdict: fp ? fp.code : 'inside' },
      effect: isWired(def.key) ? def.description ?? null : null,
      // a proposal confirmed now would take effect at this instant (the confirmation fixes the real one)
      takesEffect: route === 'proposal' ? { when: 'next_midnight_ist', ifConfirmedNow: nextMidnightIst(new Date()).toISOString() } : { when: 'immediately' },
      confirmer: route === 'proposal' ? { rule: 'a_different_tenant_admin', admins: admins.length } : null,
      ready: refusals.length === 0, refusals,
    };
  }

  /* ================================================================================================================== */
  /* ORDINARY KEYS — direct, with before/after                                                                          */
  /* ================================================================================================================== */

  async put(tenantId: string, actor: TenantActor, idemKey: string, input: SettingInput, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.tenant_setting_put', () =>
      timed(this.metrics, 'tenancy.tenant_setting_put', { tenant: tenantId }, async () => {
        const def = await this.defs.findDefinition(tenantId, input.key);
        if (!def) throw new UnknownSettingError(input.key);
        if (def.scope !== 'tenant') throw new SettingNotTenantScopedError(def.key, def.scope);
        if (def.deprecatedAt) throw new SettingDeprecatedError(def.key);
        // THE GATE (F-4). Read on every write; a trust-affecting key is never one person's.
        if (isTrustAffecting(def)) throw new SettingProposalRequiredError(def.key, def.memberNotice && def.riskClass === 'ordinary' ? 'member_notice' : def.riskClass ?? 'ordinary');
        const why = unwiredReason(def.key);
        if (why === 'no_consumer') throw new SettingNotWiredError(def.key, why);
        const value = validateSettingValue(def, input.value);
        const fp = floorProblem(def, value);
        if (fp) throw new SettingOutsideFloorError(def.key, { ...fp });
        const reason = input.reason?.trim() ? input.reason.trim() : null;
        if (reason && reason.length > 500) throw new SettingReasonError('too_long');
        return this.uow.run(tenantId, async (tx) => {
          const before = await this.repo.effectiveTx(tx, tenantId, def.key);
          if (before && !before.isDefault && sameValue(before.value, value)) throw new SettingUnchangedError(def.key);
          await this.repo.upsertSettingTx(tx, tenantId, def.key, value, actor.userId);
          const historyId = await this.repo.insertHistoryTx(tx, { tenantId, key: def.key, oldValue: before?.value ?? def.defaultValue, newValue: value, source: 'direct', actorUserId: actor.userId, reason });
          // audit_log.entity_id is a uuid: the entity is the history row (the key travels in old/new). The pre-13b audit passed the KEY
          // as entity_id — every ordinary-key write would have failed on the cast.
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_setting_changed', entityType: 'tenant_setting_history', entityId: historyId,
            oldValue: { key: def.key, value: before?.value ?? def.defaultValue, isDefault: before?.isDefault ?? true }, newValue: { key: def.key, value }, reason, ip });
          // outbox_events.aggregate_id is a uuid: the aggregate is the tenant (the key is in the payload). Pre-13b this passed the KEY and failed.
          await this.outbox.write(tx, { tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: SETTING_CHANGED_EVENT, payload: { v: 1, tenantId, key: def.key, historyId } });
          return { key: def.key, value, before: before?.value ?? def.defaultValue, historyId };
        }, { userId: actor.userId });
      }));
  }

  /* ================================================================================================================== */
  /* TRUST-AFFECTING KEYS — propose · confirm · refuse                                                                  */
  /* ================================================================================================================== */

  async propose(tenantId: string, actor: TenantActor, idemKey: string, input: SettingInput, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.setting_propose', () =>
      timed(this.metrics, 'tenancy.setting_propose', { tenant: tenantId }, async () => {
        const def = await this.defs.findDefinition(tenantId, input.key);
        if (!def) throw new UnknownSettingError(input.key);
        if (def.scope !== 'tenant') throw new SettingNotTenantScopedError(def.key, def.scope);
        if (def.deprecatedAt) throw new SettingDeprecatedError(def.key);
        if (!isTrustAffecting(def)) throw new SettingNotGatedError(def.key);
        const why = unwiredReason(def.key);
        if (why === 'no_consumer') throw new SettingNotWiredError(def.key, why);
        const value = validateSettingValue(def, input.value);
        // THE FLOOR, refused by name at proposal time (A2). 0192's trigger repeats it.
        const fp = floorProblem(def, value);
        if (fp) throw new SettingOutsideFloorError(def.key, { ...fp });
        const rp = proposalReasonProblem(input.reason);
        if (rp) throw new SettingReasonError(rp);
        const reason = String(input.reason).trim();
        return this.uow.run(tenantId, async (tx) => {
          const admins = await this.repo.adminIds(tenantId, tx);
          if (admins.length < 2) throw new SettingNeedsSecondAdminError(admins.length);
          const live = await this.repo.liveProposalTx(tx, tenantId, def.key);
          if (live) throw new SettingProposalLiveError(def.key, live.id);
          const before = await this.repo.effectiveTx(tx, tenantId, def.key);
          const oldValue = before?.value ?? def.defaultValue;
          if (sameValue(oldValue, value)) throw new SettingUnchangedError(def.key);
          let id: string;
          try { id = await this.repo.insertProposalTx(tx, { tenantId, key: def.key, oldValue, newValue: value, reason, proposedBy: actor.userId }); }
          catch (e) { mapTriggerError(e, '', def.key); }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.setting_proposed', entityType: 'tenant_setting_proposal', entityId: id,
            oldValue: { key: def.key, value: oldValue }, newValue: { key: def.key, value, status: 'proposed', riskClass: def.riskClass, memberNotice: def.memberNotice === true }, reason, ip });
          const row = await this.repo.getProposalForUpdate(tx, tenantId, id);
          return this.proposalView(row!, actor.userId);
        }, { userId: actor.userId });
      }));
  }

  async confirm(tenantId: string, actor: TenantActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new SettingProposalNotFoundError(id);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.setting_confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.getProposalForUpdate(tx, tenantId, id);
        if (!p) throw new SettingProposalNotFoundError(id);
        assertProposalMove(p.status, 'confirmed');
        if (new Date(p.expiresAt).getTime() <= Date.now()) throw new SettingProposalExpiredError(id, p.expiresAt);
        // NO maker ≠ checker check here on purpose: 0192's trg_tsp_moves IS the wall, and this service only names its refusal. A
        // second check in TypeScript would hide the trigger's removal from every test (the brief's mutation: neuter the trigger → red).
        let when: { confirmedAt: string; effectiveAt: string };
        try { when = await this.repo.confirmTx(tx, tenantId, id, actor.userId); }
        catch (e) { mapTriggerError(e, id, p.key); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.setting_confirmed', entityType: 'tenant_setting_proposal', entityId: id,
          oldValue: { key: p.key, value: p.oldValue, status: 'proposed', proposedBy: p.proposedBy },
          newValue: { key: p.key, value: p.newValue, status: 'confirmed', confirmedBy: actor.userId, effectiveAt: when.effectiveAt }, reason: p.reason, ip });
        const row = await this.repo.getProposalForUpdate(tx, tenantId, id);
        return this.proposalView(row!, actor.userId);
      }, { userId: actor.userId }));
  }

  async refuse(tenantId: string, actor: TenantActor, idemKey: string, id: string, reason: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new SettingProposalNotFoundError(id);
    const rp = proposalReasonProblem(reason);
    if (rp) throw new SettingReasonError(rp);
    const why = reason.trim();
    return this.idem.remember(idemKey, actor.userId, 'tenancy.setting_refuse', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.getProposalForUpdate(tx, tenantId, id);
        if (!p) throw new SettingProposalNotFoundError(id);
        assertProposalMove(p.status, 'refused');
        try { await this.repo.refuseTx(tx, tenantId, id, actor.userId, why); }
        catch (e) { mapTriggerError(e, id, p.key); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.setting_refused', entityType: 'tenant_setting_proposal', entityId: id,
          oldValue: { key: p.key, value: p.oldValue, proposed: p.newValue, status: 'proposed', proposedBy: p.proposedBy },
          newValue: { key: p.key, status: 'refused', refusedBy: actor.userId, withdrawn: p.proposedBy === actor.userId }, reason: why, ip });
        const row = await this.repo.getProposalForUpdate(tx, tenantId, id);
        return this.proposalView(row!, actor.userId);
      }, { userId: actor.userId }));
  }

  /* ================================================================================================================== */
  /* THE JOB'S ACTS (kv_app, one tenant at a time)                                                                       */
  /* ================================================================================================================== */

  /** Apply ONE due confirmed proposal. Re-locks and re-checks; returns what happened. */
  async applyDue(tenantId: string, id: string): Promise<'applied' | 'expired' | 'skipped'> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.getProposalForUpdate(tx, tenantId, id);
      if (!p || p.status !== 'confirmed' || !p.effectiveAt) return 'skipped';
      const due = await tx.query(`SELECT ($1::timestamptz <= now()) AS due`, [p.effectiveAt]);
      if (due.rows[0]?.due !== true) return 'skipped';
      const def = await this.defs.findDefinition(tenantId, p.key, tx);
      // The floor may have been tightened by the platform between the confirmation and midnight: re-judge, never apply past it.
      const fp = def ? floorProblem(def, p.newValue) : { code: 'number_required' as const };
      if (!def || fp || def.deprecatedAt) {
        assertProposalMove('confirmed', 'expired');
        const note = !def ? 'the key is no longer registered' : def.deprecatedAt ? 'the key was deprecated before it took effect' : `outside the platform floor at apply time (${fp!.code})`;
        await this.repo.markExpiredTx(tx, tenantId, id, note);
        await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.setting_not_applied', entityType: 'tenant_setting_proposal', entityId: id,
          oldValue: { status: 'confirmed' }, newValue: { status: 'expired', note }, reason: note });
        return 'expired';
      }
      assertProposalMove('confirmed', 'applied');
      const before = await this.repo.effectiveTx(tx, tenantId, p.key);
      const oldValue = before?.value ?? def.defaultValue;
      // cite the proposal: 0192's trg_tenant_settings_gate admits a trust-affecting write ONLY with a confirmed, due proposal for
      // this tenant, key and value (two different tenant_admins). Transaction-local.
      await tx.query(`SELECT set_config('app.setting_proposal_id', $1, true)`, [id]);
      await this.repo.upsertSettingTx(tx, tenantId, p.key, p.newValue, p.confirmedBy);
      await this.repo.insertHistoryTx(tx, { tenantId, key: p.key, oldValue, newValue: p.newValue, source: 'proposal', proposalId: id,
        proposedBy: p.proposedBy, confirmedBy: p.confirmedBy, reason: p.reason });
      await this.repo.markAppliedTx(tx, tenantId, id);
      await tx.query(`SELECT set_config('app.setting_proposal_id', '', true)`);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.setting_applied', entityType: 'tenant_setting_proposal', entityId: id,
        oldValue: { key: p.key, value: oldValue }, newValue: { key: p.key, value: p.newValue, status: 'applied', proposedBy: p.proposedBy, confirmedBy: p.confirmedBy, effectiveAt: p.effectiveAt },
        reason: p.reason });
      await this.outbox.write(tx, { tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: SETTING_CHANGED_EVENT, payload: { v: 1, tenantId, key: p.key, proposalId: id } });
      if (def.memberNotice) await this.memberNotice(tx, tenantId, p, oldValue);
      return 'applied';
    }, { userId: undefined });
  }

  /** `tenancy.setting_effective` → every active member, in their language (seed 0007 copy, names from seed core/0024). */
  private async memberNotice(tx: TxContext, tenantId: string, p: ProposalRow, oldValue: unknown): Promise<void> {
    const names = await this.ui.mapsUnder(`setting.name.${p.key}`, tx);
    const settingName = names.get(`setting.name.${p.key}`);
    if (!settingName) {
      // fails closed and counted: a notice with a registry key in it is the 6d-7 defect; the spec pins every member_notice key's name
      this.metrics.inc('tenancy_setting_notice_unnamed_total', { key: p.key });
      return;
    }
    const values = await this.ui.mapsUnder('setting.value.', tx);
    const valueMap = (v: unknown) => {
      const nv = noticeValue(p.key, v);
      if ('text' in nv) return { en: nv.text, hi: nv.text, gu: nv.text };
      return values.get(nv.messageKey) ?? { en: String(v), hi: String(v), gu: String(v) };
    };
    const recipientUserIds = await this.repo.memberUserIdsTx(tx, tenantId);
    await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_setting_proposal', aggregateId: p.id, eventType: SETTING_EFFECTIVE_EVENT, payload: {
      v: 1, tenantId, proposalId: p.id, key: p.key, recipientUserIds, settingName,
      oldValue: valueMap(oldValue), newValue: valueMap(p.newValue), effectiveAt: istStamp(new Date(p.effectiveAt!)),
    } });
  }

  /** Expire ONE proposal unconfirmed after 7 days. */
  async expireDue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.getProposalForUpdate(tx, tenantId, id);
      if (!p || p.status !== 'proposed') return false;
      const ok = await this.repo.markExpiredTx(tx, tenantId, id, 'unconfirmed after 7 days');
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.setting_expired', entityType: 'tenant_setting_proposal', entityId: id,
        oldValue: { key: p.key, status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'expired' }, reason: 'unconfirmed after 7 days' });
      return ok;
    }, { userId: undefined });
  }

  /* ================================================================================================================== */
  /* LANGUAGES (F-14) — tenant_languages, the store every consumer reads                                                 */
  /* ================================================================================================================== */

  async putLanguages(tenantId: string, actor: TenantActor, idemKey: string, input: { enabled: string[]; primary: string; reason?: string | null }, ip: string | null) {
    this.assertManager(actor);
    const enabled = [...new Set((input.enabled ?? []).map((c) => String(c).trim()))];
    const primary = String(input.primary ?? '').trim();
    if (enabled.length === 0) throw new LanguagesInvalidError('at_least_one');
    if (enabled.length > MAX_LANGUAGES) throw new LanguagesInvalidError('too_many', { max: MAX_LANGUAGES });
    if (enabled.some((c) => !LANG_CODE.test(c))) throw new LanguagesInvalidError('bad_code');
    if (!enabled.includes(primary)) throw new LanguagesInvalidError('primary_not_enabled', { primary });
    return this.idem.remember(idemKey, actor.userId, 'tenancy.tenant_languages_put', () =>
      this.uow.run(tenantId, async (tx) => {
        const active = await this.repo.activeLanguageCodesTx(tx, enabled);
        const unknown = enabled.filter((c) => !active.includes(c));
        if (unknown.length) throw new LanguagesInvalidError('not_platform_active', { codes: unknown });
        const before = await this.repo.languages(tenantId, tx);
        const removed = before.map((l) => l.code).filter((c) => !enabled.includes(c));
        const uses = await this.repo.languageUsesTx(tx, tenantId, removed);
        if (uses.length) throw new LanguageInUseError(uses);
        const beforePrimary = before.find((l) => l.isDefault)?.code ?? null;
        if (sameValue(before.map((l) => l.code).sort(), [...enabled].sort()) && beforePrimary === primary) throw new SettingUnchangedError('languages');
        await this.repo.replaceLanguagesTx(tx, tenantId, enabled, primary);
        const after = await this.repo.languages(tenantId, tx);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_languages_changed', entityType: 'tenant_languages', entityId: tenantId,
          oldValue: { enabled: before.map((l) => l.code), primary: beforePrimary },
          newValue: { enabled: after.map((l) => l.code), primary, removed, added: enabled.filter((c) => !before.some((l) => l.code === c)) },
          reason: input.reason?.trim() || null, ip });
        await this.outbox.write(tx, { tenantId, aggregateType: 'tenant', aggregateId: tenantId, eventType: LANGUAGES_CHANGED_EVENT, payload: { v: 1, tenantId, enabled: after.map((l) => l.code), primary } });
        return { enabled: after, primary };
      }, { userId: actor.userId }));
  }
}
// re-exported for the controller's error mapping
export { InvalidSettingError };
