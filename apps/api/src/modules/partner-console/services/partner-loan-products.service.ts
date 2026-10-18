// modules/partner-console/services/partner-loan-products.service.ts · PC-56 PARTNER-2c · THE LENDER'S SHELF (founder Q7, 2026-10-18).
//
//   list  — `partner.applications.read`: THIS lender's own loan products' terms (0229 `partner_loan_product_terms()`, shard 0) with, per
//           product, the COUNT of this lender's CONSENTED applications created in the last 30 days (0225's consent axis, scattered over the
//           shards and added — the 1a dashboard's shape), and `computedAt`;
//   get   — one of them (the same terms + its count); another lender's or an absent id → 404 `PARTNER_LOAN_PRODUCT_NOT_FOUND` (never "not
//           yours").
// A READ: nothing writes `loan_products` from the partner realm (the platform authors products — founder Q7); there is no POST / PATCH route.
// EVERY call writes ONE partner-realm audit row (`partner.products.read`, counts only): the shelf is the partner's own configuration (the 1b
// rule would not audit it) BUT its 30-day figure counts applicants' records (the 1a rule audits those reads) — so it is audited.
// The `partner_console` flag gates the realm. The platform's `fintech` flag is a TENANT-scoped module switch and is NOT consulted here — the
// 1a lending dashboard does not consult it either (the partner realm has no tenant to evaluate it for).
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { UUID_RE } from '../../../shared/pagination/us-keyset';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { mergeShelfCounts, projectLoanProduct, SHELF_WINDOW_DAYS, type PartnerLoanProductView } from '../domain/partner-loan-products.rules';
import { partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);

@Injectable()
export class PartnerLoanProductsService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** ONE partner-realm audit row for one read — counts only (never a term, an application id or a person). */
  private async trail(s: PartnerSession, surface: 'shelf' | 'product', counts: Record<string, unknown>, entity?: { type: string; id: string }): Promise<void> {
    await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
      tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.products.read',
      entityType: entity?.type ?? 'financial_partner', entityId: entity?.id ?? s.partnerId,
      newValue: { partnerId: s.partnerId, realm: 'partner', surface, ...counts }, ip: s.ip, requestId: s.requestId,
    }), { userId: s.userId });
    this.metrics.inc('partner_console.products_read', { partner: s.partnerId, surface });
  }

  /** The consented applications per product in the window, every shard added. */
  private async windowCounts(partnerId: string): Promise<Record<string, number>> {
    const shards: Array<Record<string, number>> = [];
    for (let i = 0; i < this.repo.shards; i++) shards.push(await this.repo.loanApplicationsWindowShard(i, partnerId, SHELF_WINDOW_DAYS));
    return mergeShelfCounts(shards);
  }

  async list(s: PartnerSession): Promise<{ items: PartnerLoanProductView[]; computedAt: string; windowDays: number }> {
    const rows = await this.repo.loanProductTerms(s.partnerId);
    const counts = rows.length ? await this.windowCounts(s.partnerId) : {};
    const items = rows.map((r) => projectLoanProduct(r, counts[String(r.id)] ?? 0));
    const computedAt = new Date().toISOString();
    await this.trail(s, 'shelf', { products: items.length, applications30d: items.reduce((a, p) => a + p.applications30d, 0) });
    return { items, computedAt, windowDays: SHELF_WINDOW_DAYS };
  }

  async get(s: PartnerSession, id: string): Promise<PartnerLoanProductView & { computedAt: string; windowDays: number }> {
    const ok = UUID_RE.test(id);
    const row = ok ? (await this.repo.loanProductTerms(s.partnerId, id))[0] ?? null : null;
    const n = row ? (await this.windowCounts(s.partnerId))[id] ?? 0 : 0;
    await this.trail(s, 'product', { found: !!row, applications30d: n }, ok ? { type: 'loan_product', id } : undefined);
    if (!row) throw partnerRefused('PARTNER_LOAN_PRODUCT_NOT_FOUND');
    return { ...projectLoanProduct(row, n), computedAt: new Date().toISOString(), windowDays: SHELF_WINDOW_DAYS };
  }
}
