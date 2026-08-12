// modules/payments/read-models/charge-console.read-model.ts · W150's two tables (PC-56 TENANT-3c-2).
// Replica-backed and tenant-scoped; the tax table is READ-ONLY by construction — `tax_rules` has no tenant_id, no
// write path and no permission, which is W150's own promise ("statutory correctness is our job, not your risk").
//
// TWO THINGS THIS READ SAYS THAT THE CANON'S SCREEN DOES NOT:
//   • which SURFACE each charge code prices, and whether any code path reads it at all (`not_read_by_any_code`) — the
//     promise-with-no-reader check applied to pricing, after this programme found four permissions and two columns
//     that nothing read;
//   • which recorded tax rule each figure on an invoice comes from, and that the canon's "TDS 194Q" is NOT recorded
//     and NOT computed here (it is the BUYER's own deduction — TENANT-3a corrected the same section on W134).
import { Injectable } from '@nestjs/common';
import { ChargeChangeRepository } from '../repositories/charge-change.repository';
import { readerOf, surfaceOf } from '../domain/charge-change';
import { computeCharge, ChargeCalcMethod } from '../domain/charge.calculator';

export interface ChargeConsoleRow {
  id: string; chargeCode: string; label: string | null; surface: string;
  calcMethod: string; config: Record<string, unknown>; currencyCode: string;
  effectiveFrom: string; effectiveTo: string | null; isActive: boolean;
  /** false = the PLATFORM default this tenant falls back to; true = the tenant's own override. */
  isTenantOverride: boolean;
  /** TRUE when this row is the one the resolver would pick today. */
  inForce: boolean;
  pendingProposalId: string | null;
  /** **A ROW THE PRICING ENGINE WOULD THROW ON** — `per_km` passes the column's CHECK and is unimplemented. None
   *  exist (the table had no writer), and the write path refuses it; a pre-existing one is FLAGGED, not hidden. */
  computable: boolean;
}

export interface TaxRuleRow {
  taxCode: string; rateBps: number; hsnPrefix: string | null; split: Record<string, unknown>;
  thresholdMinor: string | null; effectiveFrom: string; legalRef: string | null;
  /** Which code path reads this rule — 'not_read_by_any_code' where none does. */
  readBy: string;
  /** TRUE when the rule is category-scoped (a commodity rate) rather than country-wide. */
  categoryScoped: boolean;
}

@Injectable()
export class ChargeConsoleReadModel {
  constructor(private readonly repo: ChargeChangeRepository) {}

  async charges(tenantId: string, today = new Date().toISOString().slice(0, 10)): Promise<ChargeConsoleRow[]> {
    const rows = await this.repo.listDefinitions(tenantId);
    // Which row the RESOLVER would pick per code: a tenant override beats the platform default, then the latest
    // effective_from — the same order as ChargeDefinitionRepository.resolve, so the console cannot disagree with the
    // engine about what a buyer is being charged today.
    const inForceId = new Map<string, string>();
    for (const r of rows) {
      if (!r.isActive) continue;
      if (r.effectiveFrom > today) continue;
      if (r.effectiveTo && r.effectiveTo < today) continue;
      const key = r.chargeCode;
      const best = rows.find((x) => x.id === inForceId.get(key));
      if (!best) { inForceId.set(key, r.id); continue; }
      const better = (r.tenantId !== null && best.tenantId === null)
        || ((r.tenantId !== null) === (best.tenantId !== null) && r.effectiveFrom > best.effectiveFrom);
      if (better) inForceId.set(key, r.id);
    }
    return rows.map((r) => ({
      id: r.id, chargeCode: r.chargeCode, label: r.label, surface: surfaceOf(r.chargeCode),
      calcMethod: r.calcMethod, config: r.config, currencyCode: r.currencyCode,
      effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isActive: r.isActive,
      isTenantOverride: r.tenantId !== null,
      inForce: inForceId.get(r.chargeCode) === r.id,
      pendingProposalId: r.pendingProposalId,
      computable: isComputable(r.calcMethod as ChargeCalcMethod, r.config),
    }));
  }

  async taxRules(tenantId: string, countryCode = 'IN'): Promise<TaxRuleRow[]> {
    const rows = await this.repo.listTaxRules(tenantId, countryCode);
    return rows.map((r) => ({
      taxCode: r.taxCode, rateBps: r.rateBps, hsnPrefix: r.hsnPrefix, split: r.split ?? {},
      thresholdMinor: r.thresholdMinor, effectiveFrom: r.effectiveFrom, legalRef: r.legalRef,
      readBy: readerOf(r.taxCode), categoryScoped: r.categoryId !== null,
    }));
  }

  proposals(tenantId: string) { return this.repo.listProposals(tenantId); }
}

/** Would the calculator produce a number for this row, or throw? Probed with a token base rather than reasoned about,
 *  so an unimplemented method can never be reported as fine by a list that only checked the method NAME. */
export function isComputable(method: ChargeCalcMethod, config: Record<string, unknown>): boolean {
  try { computeCharge(method, config, { amountMinor: 100_000n, qty: 1 }); return true; } catch { return false; }
}
