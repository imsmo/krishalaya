// modules/payments/services/charge-change.service.ts · W150's "Add charge" and "Propose change (checker)" — the write
// path `charge_definitions` never had (PC-56 TENANT-3c-2, schema 0141).
//
// THE SHAPE, AND WHY:
//   propose — a tenant admin (`tenant.settings`) says what the fee should become and from when. The proposal carries
//             the RESOLVED row it supersedes, read server-side: a client-supplied "current row" would let a caller
//             attach a signature to a different rule than the one on the screen.
//   decide  — a DIFFERENT tenant admin signs or refuses (W150's "owner + checker"). Maker ≠ checker in the domain,
//             the service AND 0141's CHECK.
//   apply   — INSERT the new dated row and END-DATE the previous one, in one transaction. Never an edit: W150's
//             "effective-dated rows, never edits", and TENANT-3a's frozen order basis depends on a superseded rule
//             still saying exactly what it charged.
//
// NO MONEY MOVES HERE (Law 2) and no price changes TODAY: the earliest a change may take effect is tomorrow, because
// two prices in one day cannot be explained to the buyer who paid the first one.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AppError, NotFoundError } from '../../../shared/errors/app-error';
import { ChargeChangeRepository, ChargeProposalRow } from '../repositories/charge-change.repository';
import {
  ChargeAction, MIN_NOTE_CHARS, diffSummary, effectiveFromGate, endDateFor, proposalGate, validateChargeConfig,
} from '../domain/charge-change';

export interface ChargeActor { userId: string; canManage: boolean }

export class ChargeProposalNotFoundError extends NotFoundError {
  constructor(id: string) { super('Charge proposal not found'); (this as any).details = { id }; }
}
export class ChargeRefusedError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) { super(code, message, 409, details); }
}
export class ChargeForbiddenError extends AppError {
  constructor() { super('CHARGE_FORBIDDEN', 'Requires tenant.settings', 403, { permission: 'tenant.settings' }); }
}

const today = (now: Date) => now.toISOString().slice(0, 10);

@Injectable()
export class ChargeChangeService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: ChargeChangeRepository,
  ) {}

  /** Propose an add / change / end. The action is DERIVED from what the tenant currently owns rather than trusted:
   *  a client claiming 'add' over an existing override would create the overlap 0141's EXCLUDE constraint forbids,
   *  and a 500 from a constraint is a worse answer than a named refusal. */
  async propose(tenantId: string, actor: ChargeActor, input: {
    chargeCode: string; action: ChargeAction; label?: string | null; calcMethod?: string | null;
    config?: unknown; currencyCode?: string; effectiveFrom: string; note: string;
  }, ip: string | null = null, now: Date = new Date()) {
    if (!actor.canManage) throw new ChargeForbiddenError();
    const note = (input.note ?? '').trim();
    if (note.length < MIN_NOTE_CHARS) {
      throw new ChargeRefusedError('CHARGE_NOTE_TOO_SHORT', `a note of at least ${MIN_NOTE_CHARS} characters is required`, { min: MIN_NOTE_CHARS });
    }

    return this.uow.run(tenantId, async (tx) => {
      const open = await this.repo.currentProposal(tx, tenantId, input.chargeCode);
      if (open && open.status === 'pending') {
        throw new ChargeRefusedError('CHARGE_PROPOSAL_DUPLICATE', 'a proposal on this charge is already waiting for a checker', { proposalId: open.id });
      }
      const current = await this.repo.currentTenantDefinition(tx, tenantId, input.chargeCode);
      // The action the DATA supports, not the one the client typed.
      const action: ChargeAction = input.action === 'end' ? 'end' : current ? 'change' : 'add';
      if (input.action === 'end' && !current) {
        throw new ChargeRefusedError('CHARGE_NO_OVERRIDE_TO_END', 'this tenant has no override for that charge, so there is nothing to end');
      }

      const eff = effectiveFromGate(input.effectiveFrom, today(now), current?.effectiveFrom ?? null);
      if (!eff.ok) {
        throw new ChargeRefusedError(eff.error, eff.error === 'CHARGE_EFFECTIVE_NOT_FUTURE'
          ? 'a change may take effect from tomorrow at the earliest — two prices in one day cannot be explained to the buyer who paid the first'
          : eff.error === 'CHARGE_EFFECTIVE_BEFORE_CURRENT'
            ? 'the new rule must start after the one it replaces'
            : 'effective_from must be a date (YYYY-MM-DD)');
      }

      let calcMethod: string | null = null;
      let config: Record<string, unknown> | null = null;
      if (action !== 'end') {
        const v = validateChargeConfig(String(input.calcMethod ?? ''), input.config);
        if (!v.ok) throw new ChargeRefusedError(v.error, 'the proposed fee configuration is not one the pricing engine can compute', v.detail);
        calcMethod = String(input.calcMethod);
        config = v.config;
      }

      const id = uuidv7();
      await this.repo.insertProposal(tx, {
        id, tenantId, chargeCode: input.chargeCode, action, label: input.label?.trim() || null,
        calcMethod, config, currencyCode: input.currencyCode ?? 'INR',
        effectiveFrom: input.effectiveFrom, supersedesId: action === 'add' ? null : current!.id,
        proposedBy: actor.userId, proposalNote: note,
      });
      const diff = diffSummary(
        current ? { calcMethod: current.calcMethod, config: current.config } : null,
        calcMethod && config ? { calcMethod, config } : null,
      );
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'charge.proposed', entityType: 'charge_definition', entityId: input.chargeCode,
        oldValue: current ? { id: current.id, calcMethod: current.calcMethod, config: current.config } : null,
        newValue: { proposalId: id, action, calcMethod, config, effectiveFrom: input.effectiveFrom, diff },
        reason: note, ip,
      });
      this.metrics.inc('payments.charge_proposed', { tenant: tenantId });
      return { id, chargeCode: input.chargeCode, action, effectiveFrom: input.effectiveFrom, status: 'pending' as const, diff };
    }, { userId: actor.userId });
  }

  /** The checker's signature or refusal — a DIFFERENT tenant admin. */
  async decide(tenantId: string, actor: ChargeActor, proposalId: string, decision: 'approved' | 'rejected', note: string | null, ip: string | null = null) {
    if (!actor.canManage) throw new ChargeForbiddenError();
    return this.uow.run(tenantId, async (tx) => {
      const row = await this.repo.getForUpdate(tx, tenantId, proposalId);
      if (!row) throw new ChargeProposalNotFoundError(proposalId);
      if (row.status !== 'pending') throw new ChargeRefusedError('CHARGE_PROPOSAL_DECIDED', `this proposal is already ${row.status}`, { status: row.status });
      if (row.proposedBy === actor.userId) {
        throw new ChargeRefusedError('CHARGE_CHECKER_IS_MAKER', 'the person who proposed a charge change cannot approve it');
      }
      const decisionNote = decision === 'rejected' ? (note ?? '').trim() : (note ?? '').trim() || null;
      if (decision === 'rejected' && (decisionNote ?? '').length < MIN_NOTE_CHARS) {
        throw new ChargeRefusedError('CHARGE_NOTE_TOO_SHORT', `a refusal owes the proposer at least ${MIN_NOTE_CHARS} characters`, { min: MIN_NOTE_CHARS });
      }
      const n = await this.repo.decide(tx, tenantId, proposalId, { status: decision, decidedBy: actor.userId, note: decisionNote });
      if (n === 0) throw new ChargeRefusedError('CHARGE_PROPOSAL_DECIDED', 'this proposal was decided by somebody else', {});
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: `charge.${decision}`, entityType: 'charge_definition', entityId: row.chargeCode,
        oldValue: { status: 'pending' }, newValue: { proposalId, status: decision, effectiveFrom: row.effectiveFrom },
        reason: decisionNote, ip,
      });
      return { id: proposalId, status: decision, chargeCode: row.chargeCode };
    }, { userId: actor.userId });
  }

  /**
   * Apply an APPROVED proposal: the new dated row is inserted and the superseded one end-dated the day before, in one
   * transaction, so the two windows touch and 0141's EXCLUDE constraint never sees an overlap.
   *
   * Either the proposer or the checker may press this — the second signature has already been given, and requiring a
   * third person to click would make the control theatre. The audit row records who did.
   */
  async apply(tenantId: string, actor: ChargeActor, proposalId: string, ip: string | null = null) {
    if (!actor.canManage) throw new ChargeForbiddenError();
    return this.uow.run(tenantId, async (tx) => {
      const row = await this.repo.getForUpdate(tx, tenantId, proposalId);
      if (!row) throw new ChargeProposalNotFoundError(proposalId);
      const gate = proposalGate({ id: row.id, status: row.status, decidedBy: row.decidedBy, proposedBy: row.proposedBy });
      if (gate.kind !== 'ready') {
        throw new ChargeRefusedError(`CHARGE_${gate.kind.toUpperCase()}`, `this proposal is ${row.status} — only an approved one may be applied`, { gate: gate.kind });
      }

      // End-date whatever the tenant currently owns, whether the proposal is a change or an end.
      if (row.supersedesId) {
        await this.repo.endDateDefinition(tx, tenantId, row.supersedesId, endDateFor(row.effectiveFrom));
      }
      let definitionId: string | null = null;
      if (row.action !== 'end') {
        definitionId = uuidv7();
        await this.repo.insertDefinition(tx, {
          id: definitionId, tenantId, chargeCode: row.chargeCode, label: row.label,
          calcMethod: row.calcMethod!, config: row.config!, currencyCode: row.currencyCode,
          effectiveFrom: row.effectiveFrom, createdBy: actor.userId, proposalId: row.id,
        });
      }
      const n = await this.repo.markApplied(tx, tenantId, proposalId, definitionId);
      if (n === 0) throw new ChargeRefusedError('CHARGE_PROPOSAL_DECIDED', 'this proposal is no longer approved', {});
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'charge.applied', entityType: 'charge_definition', entityId: row.chargeCode,
        newValue: { proposalId, definitionId, action: row.action, effectiveFrom: row.effectiveFrom, endedDefinitionId: row.supersedesId },
        reason: row.proposalNote, ip,
      });
      this.metrics.inc('payments.charge_applied', { tenant: tenantId, action: row.action });
      return { id: proposalId, status: 'applied' as const, definitionId, chargeCode: row.chargeCode, effectiveFrom: row.effectiveFrom };
    }, { userId: actor.userId });
  }

  list(tenantId: string, actor: ChargeActor): Promise<ChargeProposalRow[]> {
    if (!actor.canManage) throw new ChargeForbiddenError();
    return this.repo.listProposals(tenantId);
  }
}
