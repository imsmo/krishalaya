// modules/payments/repositories/charge-change.repository.ts · SQL for the charge write path (0141, PC-56 TENANT-3c-2).
// tenant_id in EVERY query (Law 1) + RLS — and 0141 pinned the WRITE side of that policy to the caller's own tenant,
// so nothing here can create a platform-default row even by mistake.
//
// The applied path INSERTS a new dated row and END-DATES the previous one. It never UPDATEs a rule's amounts: W150's
// "effective-dated rows, never edits" is the whole design, and an edited row would silently restate what an already
// issued invoice says its basis was.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ChargeAction, ProposalStatus } from '../domain/charge-change';

export interface ChargeProposalRow {
  id: string; tenantId: string; chargeCode: string; action: ChargeAction; label: string | null;
  calcMethod: string | null; config: Record<string, unknown> | null; currencyCode: string;
  effectiveFrom: string; supersedesId: string | null; status: ProposalStatus;
  proposedBy: string; proposedAt: Date; proposalNote: string;
  decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null;
  appliedAt: Date | null; appliedDefinitionId: string | null;
}

export interface ChargeDefinitionRow {
  id: string; tenantId: string | null; chargeCode: string; label: string | null; calcMethod: string;
  config: Record<string, unknown>; currencyCode: string; effectiveFrom: string; effectiveTo: string | null;
  isActive: boolean;
}

const P_COLS = `id, tenant_id, charge_code, action, label, calc_method, config, currency_code, effective_from::text AS effective_from,
  supersedes_id, status, proposed_by, proposed_at, proposal_note, decided_by, decided_at, decision_note, applied_at, applied_definition_id`;

function toProposal(r: any): ChargeProposalRow {
  return { id: r.id, tenantId: r.tenant_id, chargeCode: r.charge_code, action: r.action, label: r.label,
    calcMethod: r.calc_method, config: r.config, currencyCode: r.currency_code, effectiveFrom: r.effective_from,
    supersedesId: r.supersedes_id, status: r.status, proposedBy: r.proposed_by, proposedAt: r.proposed_at,
    proposalNote: r.proposal_note, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note,
    appliedAt: r.applied_at, appliedDefinitionId: r.applied_definition_id };
}
function toDefinition(r: any): ChargeDefinitionRow {
  return { id: r.id, tenantId: r.tenant_id, chargeCode: r.charge_code, label: r.label, calcMethod: r.calc_method,
    config: r.config, currencyCode: r.currency_code, effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    isActive: r.is_active };
}

@Injectable()
export class ChargeChangeRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The tenant's OWN active row for a code (never the platform default — a proposal supersedes what the tenant owns,
   *  and 'add' is precisely the case where they own nothing yet). Read on the primary inside the deciding tx. */
  async currentTenantDefinition(tx: TxContext, tenantId: string, chargeCode: string): Promise<ChargeDefinitionRow | null> {
    const r = await tx.query(
      `SELECT id, tenant_id, charge_code, label, calc_method, config, currency_code,
              effective_from::text AS effective_from, effective_to::text AS effective_to, is_active
         FROM charge_definitions
        WHERE tenant_id = $1 AND charge_code = $2 AND is_active = true AND deleted_at IS NULL
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY effective_from DESC LIMIT 1`, [tenantId, chargeCode]);
    return r.rows[0] ? toDefinition(r.rows[0]) : null;
  }

  async insertProposal(tx: TxContext, p: {
    id: string; tenantId: string; chargeCode: string; action: ChargeAction; label: string | null;
    calcMethod: string | null; config: Record<string, unknown> | null; currencyCode: string;
    effectiveFrom: string; supersedesId: string | null; proposedBy: string; proposalNote: string;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO charge_change_proposals (id, tenant_id, charge_code, action, label, calc_method, config,
                                            currency_code, effective_from, supersedes_id, proposed_by, proposal_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::date,$10,$11,$12)`,
      [p.id, p.tenantId, p.chargeCode, p.action, p.label, p.calcMethod,
       p.config === null ? null : JSON.stringify(p.config), p.currencyCode, p.effectiveFrom, p.supersedesId,
       p.proposedBy, p.proposalNote]);
  }

  /** The proposal a decision or an apply acts on. Ordered the way the gate cares: applied outranks pending, then the
   *  newest decision — so an old rejection can never hide an application (0139's rule, restated). */
  async currentProposal(tx: TxContext, tenantId: string, chargeCode: string): Promise<ChargeProposalRow | null> {
    const r = await tx.query(
      `SELECT ${P_COLS} FROM charge_change_proposals
        WHERE tenant_id=$1 AND charge_code=$2 AND deleted_at IS NULL
        ORDER BY (status='applied') DESC, (status='pending') DESC, (status='approved') DESC, proposed_at DESC
        LIMIT 1`, [tenantId, chargeCode]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<ChargeProposalRow | null> {
    const r = await tx.query(`SELECT ${P_COLS} FROM charge_change_proposals WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }

  /** The checker's signature. `status='pending'` in the WHERE so a raced second decision updates zero rows. */
  async decide(tx: TxContext, tenantId: string, id: string, d: { status: 'approved' | 'rejected'; decidedBy: string; note: string | null }): Promise<number> {
    const r = await tx.query(
      `UPDATE charge_change_proposals SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='pending' AND deleted_at IS NULL`,
      [id, tenantId, d.status, d.decidedBy, d.note]);
    return r.rowCount ?? 0;
  }

  /** THE ONLY UPDATE THIS MODULE MAKES TO A PRICING ROW, and it touches one column: the end date. Amounts, methods
   *  and configs are never rewritten — a superseded rule keeps saying exactly what it charged. */
  async endDateDefinition(tx: TxContext, tenantId: string, id: string, effectiveTo: string): Promise<number> {
    const r = await tx.query(
      `UPDATE charge_definitions SET effective_to=$3::date, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL
          AND (effective_to IS NULL OR effective_to > $3::date)`, [id, tenantId, effectiveTo]);
    return r.rowCount ?? 0;
  }

  /** Insert the new dated row. `tenant_id` comes from the CALLER's context and is never nullable here: a NULL would
   *  be a platform default, and 0141's RLS write policy refuses one even if this code tried. */
  async insertDefinition(tx: TxContext, d: {
    id: string; tenantId: string; chargeCode: string; label: string | null; calcMethod: string;
    config: Record<string, unknown>; currencyCode: string; effectiveFrom: string; createdBy: string; proposalId: string;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO charge_definitions (id, tenant_id, charge_code, label, calc_method, config, currency_code,
                                       effective_from, is_active, created_by, proposal_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::date,true,$9,$10)`,
      [d.id, d.tenantId, d.chargeCode, d.label, d.calcMethod, JSON.stringify(d.config), d.currencyCode,
       d.effectiveFrom, d.createdBy, d.proposalId]);
  }

  async markApplied(tx: TxContext, tenantId: string, id: string, definitionId: string | null): Promise<number> {
    const r = await tx.query(
      `UPDATE charge_change_proposals SET status='applied', applied_at=now(), applied_definition_id=$3, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='approved' AND deleted_at IS NULL`, [id, tenantId, definitionId]);
    return r.rowCount ?? 0;
  }

  /** W150's charge table: the tenant's own rows AND the platform defaults they fall back to, with the pending
   *  proposal (if any) attached. Bounded — a fee table with more than 200 live rows is a different problem. */
  async listDefinitions(tenantId: string): Promise<Array<ChargeDefinitionRow & { pendingProposalId: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT cd.id, cd.tenant_id, cd.charge_code, cd.label, cd.calc_method, cd.config, cd.currency_code,
              cd.effective_from::text AS effective_from, cd.effective_to::text AS effective_to, cd.is_active,
              (SELECT p.id FROM charge_change_proposals p
                WHERE p.tenant_id = $1 AND p.charge_code = cd.charge_code
                  AND p.status = 'pending' AND p.deleted_at IS NULL LIMIT 1) AS pending_proposal_id
         FROM charge_definitions cd
        WHERE (cd.tenant_id = $1 OR cd.tenant_id IS NULL) AND cd.deleted_at IS NULL
        ORDER BY cd.charge_code, (cd.tenant_id IS NOT NULL) DESC, cd.effective_from DESC
        LIMIT 200`, [tenantId]);
    return r.rows.map((x: any) => ({ ...toDefinition(x), pendingProposalId: x.pending_proposal_id ?? null }));
  }

  /** The proposal history — what was asked, by whom, what the checker said, and which row it produced. */
  async listProposals(tenantId: string, limit = 50): Promise<ChargeProposalRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${P_COLS} FROM charge_change_proposals WHERE tenant_id=$1 AND deleted_at IS NULL
        ORDER BY proposed_at DESC LIMIT $2`, [tenantId, Math.min(Math.max(limit, 1), 100)]);
    return r.rows.map(toProposal);
  }

  /** W150's second table: the statutory rules, READ-ONLY (0141 adds no tenant write path and no tenant_id column).
   *  `legal_ref` is 0140's Authority column; NULL means the citation was not recorded, which the console SAYS. */
  async listTaxRules(tenantId: string, countryCode = 'IN'): Promise<Array<{ taxCode: string; rateBps: number; hsnPrefix: string | null; split: Record<string, unknown>; thresholdMinor: string | null; effectiveFrom: string; legalRef: string | null; categoryId: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT tax_code AS "taxCode", rate_bps AS "rateBps", hsn_prefix AS "hsnPrefix", split,
              threshold_minor::text AS "thresholdMinor", effective_from::text AS "effectiveFrom",
              legal_ref AS "legalRef", category_id AS "categoryId"
         FROM tax_rules
        WHERE country_code = $1 AND is_active = true
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY tax_code, effective_from DESC
        LIMIT 100`, [countryCode]);
    return r.rows;
  }
}
