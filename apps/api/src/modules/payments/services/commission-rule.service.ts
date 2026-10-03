// modules/payments/services/commission-rule.service.ts · PC-56 TENANT-SW-a · A1 / A3 — a tenant's commission rules, OWNER + CHECKER.
//
// Before this wave a tenant admin holding `payout.approve` created a rule directly, one person, no reason, with a platform share of
// their choosing (F-3), an effective date of their choosing including the past (F-4), and deactivated one the same way (F-9). Now:
//   • PROPOSE (commission.manage = tenant_admin): a new effective-dated rule, or the deactivation of one of the tenant's own rules, with
//     a reason (20–500) and an effective date at least the next IST midnight + 7 days (canon W149 "7-day notice enforced"). The
//     platform share is NOT a field (the DTO refuses it) — it is the plan floor, read at confirmation.
//   • CONFIRM (a DIFFERENT active tenant_admin, within 7 days): in ONE transaction the proposal is confirmed (0196 trg_crp_moves is the
//     maker ≠ checker wall — no TypeScript check duplicates it) and the effective-dated rule row is written (or the target end-dated),
//     citing the proposal (trg_commission_rules_gate: share = plan floor, ≥ 7 days, exactly what was confirmed).
//   • APPLY (the 13b apply job, via PROPOSAL_APPLIER_REGISTRY): at the effective IST midnight the proposal is marked applied (a
//     deactivation also flips is_active) and every member is told (`tenancy.commission_rule_effective`, en/hi/gu).
//   • REFUSE (a tenant_admin, reason), EXPIRE (the job, 7 days unconfirmed).
// Every act is audited with actor, reason, before → after, ip. Orders freeze the rule at placement (CommissionSnapshotService), so a
// change here touches only orders placed on or after its date.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ProposalApplier } from '../../../core/jobs/proposal-applier.registry';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { CommissionRuleRepository, CommissionRuleRow } from '../repositories/commission-rule.repository';
import { CommissionProposalRow, CommissionProposalStatus, CommissionRuleProposalRepository } from '../repositories/commission-rule-proposal.repository';
import { CreateCommissionRuleDto, DeactivateCommissionRuleDto, CommissionResolutionQueryDto } from '../dto/create-commission-rule.dto';
import {
  InvalidCommissionRuleError, CommissionRuleForbiddenError, CommissionRuleNotFoundError, CommissionProposalNotFoundError, CommissionNoticeError,
  CommissionNeedsSecondAdminError, CommissionProposalStateError, CommissionGateError,
} from '../domain/commission.errors';
import { addDays, earliestAtConfirm, earliestEffectiveFrom, istToday, noticeVerdict, resolveAmong, RuleCandidate } from '../domain/commission-proposal';

export interface CommissionActor { userId: string; canManage: boolean; }
export const COMMISSION_RULE_EFFECTIVE_EVENT = 'tenancy.commission_rule_effective';
export const COMMISSION_APPLIER_NAME = 'payments.commission_rule_proposals';

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new CommissionGateError(g.code, g.message);
  throw e;
}
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const uiKey = (k: string) => k;

@Injectable()
export class CommissionRuleService implements ProposalApplier {
  readonly name = COMMISSION_APPLIER_NAME;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: CommissionRuleRepository,
    private readonly proposals: CommissionRuleProposalRepository,
  ) {}

  private assertManager(a: CommissionActor) { if (!a.canManage) throw new CommissionRuleForbiddenError('changing commission rules requires commission.manage'); }

  /* ── PROPOSE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

  async proposeCreate(tenantId: string, actor: CommissionActor, idemKey: string, dto: CreateCommissionRuleDto, ip: string | null) {
    this.assertManager(actor);
    const v = noticeVerdict(dto.effectiveFrom);
    if (!v.ok) throw new CommissionNoticeError(v.earliest);
    if (dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom) throw new InvalidCommissionRuleError('effective_to must be on/after effective_from');
    const capMinor = dto.capMinor == null ? null : String(dto.capMinor);
    const fixedMinor = String(dto.fixedMinor);
    return this.idem.remember(idemKey, actor.userId, 'payments.commission_rule_propose', () =>
      timed(this.metrics, 'payments.commission_rule_propose', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          if ((await this.proposals.adminCountTx(tx, tenantId)) < 2) throw new CommissionNeedsSecondAdminError();
          const id = uuidv7();
          try {
            await this.proposals.insertTx(tx, { id, tenantId, kind: 'create', targetRuleId: null, categoryId: dto.categoryId ?? null, source: dto.source ?? null,
              sellerRoleId: dto.sellerRoleId ?? null, rateBps: dto.rateBps, fixedMinor, capMinor, chargedTo: dto.chargedTo, priority: dto.priority,
              effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null, reason: dto.reason, proposedBy: actor.userId });
          } catch (e) { rethrowGate(e); }
          const floor = await this.repo.platformShareFloor(tx, tenantId);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'payments.commission_rule_proposed', entityType: 'commission_rule_proposal', entityId: id,
            oldValue: null, newValue: { kind: 'create', rateBps: dto.rateBps, fixedMinor, capMinor, chargedTo: dto.chargedTo, priority: dto.priority,
              source: dto.source ?? null, categoryId: dto.categoryId ?? null, sellerRoleId: dto.sellerRoleId ?? null,
              effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null, platformShareBps: floor, platformShareSource: 'plan_floor' },
            reason: dto.reason, ip });
          return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId, floor);
        }, { userId: actor.userId })));
  }

  async proposeDeactivate(tenantId: string, actor: CommissionActor, idemKey: string, ruleId: string, dto: DeactivateCommissionRuleDto, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(ruleId)) throw new CommissionRuleNotFoundError(ruleId);
    const v = noticeVerdict(dto.effectiveFrom);
    if (!v.ok) throw new CommissionNoticeError(v.earliest);
    return this.idem.remember(idemKey, actor.userId, 'payments.commission_rule_propose_deactivate', () =>
      this.uow.run(tenantId, async (tx) => {
        const rule = await this.repo.getForUpdate(tx, tenantId, ruleId);   // NULL-tenant rows never returned → platform defaults are not the tenant's
        if (!rule) throw new CommissionRuleNotFoundError(ruleId);
        if ((await this.proposals.adminCountTx(tx, tenantId)) < 2) throw new CommissionNeedsSecondAdminError();
        const id = uuidv7();
        try {
          await this.proposals.insertTx(tx, { id, tenantId, kind: 'deactivate', targetRuleId: ruleId, categoryId: null, source: null, sellerRoleId: null,
            rateBps: null, fixedMinor: null, capMinor: null, chargedTo: null, priority: null, effectiveFrom: dto.effectiveFrom, effectiveTo: null,
            reason: dto.reason, proposedBy: actor.userId });
        } catch (e) { rethrowGate(e); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'payments.commission_rule_deactivation_proposed', entityType: 'commission_rule_proposal', entityId: id,
          oldValue: { ruleId, isActive: rule.isActive, effectiveTo: rule.effectiveTo }, newValue: { kind: 'deactivate', ruleId, stopsFrom: dto.effectiveFrom },
          reason: dto.reason, ip });
        return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId);
      }, { userId: actor.userId }));
  }

  /* ── CONFIRM / REFUSE ────────────────────────────────────────────────────────────────────────────────────────────────────────── */

  async confirm(tenantId: string, actor: CommissionActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new CommissionProposalNotFoundError(id);
    return this.idem.remember(idemKey, actor.userId, 'payments.commission_rule_confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.proposals.getForUpdate(tx, tenantId, id);
        if (!p) throw new CommissionProposalNotFoundError(id);
        if (p.status !== 'proposed') throw new CommissionProposalStateError(p.status);
        if (p.effectiveFrom < earliestAtConfirm()) throw new CommissionNoticeError(earliestAtConfirm());
        // NO maker ≠ checker check here on purpose: trg_crp_moves IS the wall; this service only names its refusal.
        const ruleId = p.kind === 'create' ? uuidv7() : null;
        try {
          await this.proposals.confirmTx(tx, tenantId, id, actor.userId, ruleId);
          await tx.query(`SELECT set_config('app.commission_proposal_id', $1, true)`, [id]);
          if (p.kind === 'create') {
            const floor = await this.repo.platformShareFloor(tx, tenantId);
            await this.repo.insertConfirmedTx(tx, { id: ruleId!, tenantId, proposalId: id, categoryId: p.categoryId, source: p.source, sellerRoleId: p.sellerRoleId,
              rateBps: p.rateBps!, fixedMinor: p.fixedMinor!, capMinor: p.capMinor, platformShareBps: floor, chargedTo: p.chargedTo!, priority: p.priority!,
              effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, createdBy: actor.userId });
          } else {
            const before = await this.repo.getForUpdate(tx, tenantId, p.targetRuleId!);
            if (!before) throw new CommissionRuleNotFoundError(p.targetRuleId!);
            await this.repo.endDateTx(tx, tenantId, p.targetRuleId!, addDays(p.effectiveFrom, -1), id);
          }
          await tx.query(`SELECT set_config('app.commission_proposal_id', '', true)`);
        } catch (e) { rethrowGate(e); }
        const rule = p.kind === 'create' ? await this.repo.getForUpdate(tx, tenantId, ruleId!) : await this.repo.getForUpdate(tx, tenantId, p.targetRuleId!);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'payments.commission_rule_confirmed', entityType: 'commission_rule_proposal', entityId: id,
          oldValue: { status: 'proposed', proposedBy: p.proposedBy, ...(p.kind === 'deactivate' ? { ruleId: p.targetRuleId, effectiveTo: null } : {}) },
          newValue: { status: 'confirmed', confirmedBy: actor.userId, kind: p.kind, ruleId: rule?.id ?? null, effectiveFrom: p.effectiveFrom,
            ...(rule ? { rule: this.serialize(rule) } : {}) },
          reason: p.reason, ip });
        return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId);
      }, { userId: actor.userId }));
  }

  async refuse(tenantId: string, actor: CommissionActor, idemKey: string, id: string, reason: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new CommissionProposalNotFoundError(id);
    const why = reason.trim();
    return this.idem.remember(idemKey, actor.userId, 'payments.commission_rule_refuse', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.proposals.getForUpdate(tx, tenantId, id);
        if (!p) throw new CommissionProposalNotFoundError(id);
        if (p.status !== 'proposed') throw new CommissionProposalStateError(p.status);
        try { await this.proposals.refuseTx(tx, tenantId, id, actor.userId, why); } catch (e) { rethrowGate(e); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'payments.commission_rule_refused', entityType: 'commission_rule_proposal', entityId: id,
          oldValue: { status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'refused', refusedBy: actor.userId, withdrawn: p.proposedBy === actor.userId },
          reason: why, ip });
        return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId);
      }, { userId: actor.userId }));
  }

  /* ── THE CLOCK (ProposalApplier — driven by 13b's apply job) ─────────────────────────────────────────────────────────────────── */

  dueToApplyTx(tx: TxContext, tenantId: string, limit: number) { return this.proposals.dueToApplyTx(tx, tenantId, limit); }
  dueToExpireTx(tx: TxContext, tenantId: string, limit: number) { return this.proposals.dueToExpireTx(tx, tenantId, limit); }

  async applyDue(tenantId: string, id: string): Promise<'applied' | 'skipped'> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.proposals.getForUpdate(tx, tenantId, id);
      if (!p || p.status !== 'confirmed' || p.effectiveFrom > istToday()) return 'skipped';
      await tx.query(`SELECT set_config('app.commission_proposal_id', $1, true)`, [id]);
      let rule: CommissionRuleRow | null = null;
      if (p.kind === 'deactivate') {
        await this.repo.deactivateTx(tx, tenantId, p.targetRuleId!);
        rule = await this.repo.getForUpdate(tx, tenantId, p.targetRuleId!);
      } else {
        rule = await this.repo.getForUpdate(tx, tenantId, p.ruleId!);
      }
      await this.proposals.markAppliedTx(tx, tenantId, id);
      await tx.query(`SELECT set_config('app.commission_proposal_id', '', true)`);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'payments.commission_rule_applied', entityType: 'commission_rule_proposal', entityId: id,
        oldValue: { status: 'confirmed' }, newValue: { status: 'applied', kind: p.kind, ruleId: rule?.id ?? null, effectiveFrom: p.effectiveFrom, proposedBy: p.proposedBy, confirmedBy: p.confirmedBy },
        reason: p.reason });
      if (rule) await this.memberNotice(tx, tenantId, p, rule);
      return 'applied';
    }, { userId: undefined });
  }

  async expireDue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.proposals.getForUpdate(tx, tenantId, id);
      if (!p || p.status !== 'proposed') return false;
      const ok = (await this.proposals.markExpiredTx(tx, tenantId, id, 'unconfirmed after 7 days')) > 0;
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'payments.commission_rule_expired', entityType: 'commission_rule_proposal', entityId: id,
        oldValue: { status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'expired' }, reason: 'unconfirmed after 7 days' });
      return ok;
    }, { userId: undefined });
  }

  /** `tenancy.commission_rule_effective` → every active member, in their language (seed 0007 copy; words from seed core/0025). */
  private async memberNotice(tx: TxContext, tenantId: string, p: CommissionProposalRow, rule: CommissionRuleRow): Promise<void> {
    const words = await tx.query<{ key: string; language_code: string; text: string }>(
      `SELECT key, language_code, text FROM ui_messages WHERE key = ANY($1::text[])`,
      [[uiKey(`commission.change.${p.kind}`), uiKey(`commission.payer.${rule.chargedTo}`)]]);
    const map = (k: string) => Object.fromEntries(words.rows.filter((w) => w.key === k).map((w) => [w.language_code, w.text]));
    const change = map(`commission.change.${p.kind}`); const payer = map(`commission.payer.${rule.chargedTo}`);
    if (!change.en || !payer.en) { this.metrics.inc('payments_commission_notice_unworded_total', { kind: p.kind }); return; }   // fails closed, counted
    const recipientUserIds = await this.proposals.memberUserIdsTx(tx, tenantId);
    await this.outbox.write(tx, { tenantId, aggregateType: 'commission_rule_proposal', aggregateId: p.id, eventType: COMMISSION_RULE_EFFECTIVE_EVENT, payload: {
      v: 1, tenantId, proposalId: p.id, ruleId: rule.id, kind: p.kind, recipientUserIds, change, payer, rate: pct(rule.rateBps), effectiveFrom: p.effectiveFrom,
    } });
  }

  /* ── READS ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

  async list(tenantId: string, q: { activeOnly: boolean; includePlatformDefaults: boolean; cursor?: string; limit: number }) {
    const rows = await this.repo.list(tenantId, { activeOnly: q.activeOnly, includePlatformDefaults: q.includePlatformDefaults, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const floor = await this.repo.platformShareFloorRead(tenantId);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.serialize(r)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdAt, last.id) : null, platformShareBps: floor };
  }

  async listProposals(tenantId: string, viewer: string, q: { status?: CommissionProposalStatus; cursor?: string; limit: number }) {
    const rows = await this.proposals.list(tenantId, { status: q.status, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.view(r, viewer)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdAt, last.id) : null };
  }

  async getProposal(tenantId: string, viewer: string, id: string) {
    if (!UUID_RE.test(id)) throw new CommissionProposalNotFoundError(id);
    const p = await this.proposals.get(tenantId, id);
    if (!p) throw new CommissionProposalNotFoundError(id);
    return this.view(p, viewer);
  }

  /** "Platform share is set by your plan — visible, never hidden" (W149) + the dates a proposal may carry right now. */
  async policy(tenantId: string) {
    return { platformShareBps: await this.repo.platformShareFloorRead(tenantId), platformShareSource: 'plan_floor' as const,
      earliestEffectiveFrom: earliestEffectiveFrom(), noticeDays: 7, proposalTtlDays: 7, today: istToday() };
  }

  /** W149's "Resolution example — lowest priority number wins": which rule an order with these facts is charged under on a date; with
   *  `proposalId`, also what it WOULD be once that proposal applies (the review step's live example). */
  async resolution(tenantId: string, q: CommissionResolutionQueryDto) {
    const onDate = q.onDate ?? istToday();
    const facts = { categoryId: q.categoryId ?? null, sellerRoleId: q.sellerRoleId ?? null, source: q.source ?? null };
    const candidates = await this.repo.candidates(tenantId);
    const now = resolveAmong(candidates, { ...facts, onDate });
    let after: { onDate: string; winner: RuleCandidate | null; proposal: string } | null = null;
    if (q.proposalId) {
      const p = await this.proposals.get(tenantId, q.proposalId);
      if (!p) throw new CommissionProposalNotFoundError(q.proposalId);
      const day = p.effectiveFrom > onDate ? p.effectiveFrom : onDate;
      const hypo: RuleCandidate[] = p.kind === 'create'
        ? [...candidates, { id: 'proposed', tenantId, categoryId: p.categoryId, sellerRoleId: p.sellerRoleId, source: p.source, priority: p.priority!, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, isActive: true }]
        : candidates.map((c) => (c.id === p.targetRuleId ? { ...c, effectiveTo: addDays(p.effectiveFrom, -1) } : c));
      after = { onDate: day, winner: resolveAmong(hypo, { ...facts, onDate: day }), proposal: p.id };
    }
    const detail = async (c: RuleCandidate | null) => (c && c.id !== 'proposed' ? this.repo.getRead(tenantId, c.id).then((r) => (r ? this.serialize(r) : null)) : null);
    return { facts, onDate, winner: await detail(now), after: after ? { onDate: after.onDate, proposed: after.winner?.id === 'proposed', winner: await detail(after.winner) } : null };
  }

  private view(p: CommissionProposalRow, viewer: string, floor?: number) {
    return { id: p.id, kind: p.kind, status: p.status, targetRuleId: p.targetRuleId, ruleId: p.ruleId,
      rule: p.kind === 'create' ? { categoryId: p.categoryId, source: p.source, sellerRoleId: p.sellerRoleId, rateBps: p.rateBps, fixedMinor: p.fixedMinor,
        capMinor: p.capMinor, chargedTo: p.chargedTo, priority: p.priority, effectiveTo: p.effectiveTo, ...(floor != null ? { platformShareBps: floor } : {}) } : null,
      effectiveFrom: p.effectiveFrom, reason: p.reason, proposedBy: p.proposedBy, proposedAt: p.proposedAt, expiresAt: p.expiresAt,
      confirmedBy: p.confirmedBy, confirmedAt: p.confirmedAt, refusedBy: p.refusedBy, refusedAt: p.refusedAt, refuseReason: p.refuseReason,
      expiredAt: p.expiredAt, appliedAt: p.appliedAt, createdAt: p.createdAt,
      // display only — the trigger re-judges every move
      canConfirm: p.status === 'proposed' && p.proposedBy !== viewer, canRefuse: p.status === 'proposed', isMine: p.proposedBy === viewer };
  }

  serialize(r: CommissionRuleRow) {
    return { id: r.id, scope: r.tenantId == null ? 'platform' : 'tenant', categoryId: r.categoryId, source: r.source, sellerRoleId: r.sellerRoleId,
      rateBps: r.rateBps, fixedMinor: r.fixedMinor, capMinor: r.capMinor, platformShareBps: r.platformShareBps, chargedTo: r.chargedTo,
      priority: r.priority, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isActive: r.isActive, proposalId: r.proposalId,
      deactivationProposalId: r.deactivationProposalId, createdAt: r.createdAt,
      status: !r.isActive ? 'inactive' : r.effectiveFrom > istToday() ? 'scheduled' : r.effectiveTo && r.effectiveTo < istToday() ? 'ended' : 'in_force' };
  }
}
