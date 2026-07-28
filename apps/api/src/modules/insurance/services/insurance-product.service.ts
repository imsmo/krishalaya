// modules/insurance/services/insurance-product.service.ts · read-only product catalogue + IRDAI-partner
// gating (KV-BL-052, screens 282-285's product/partner surfacing). Mirrors
// modules/fintech/services/financial-partner.service.ts's read-only browse pattern exactly.
//
// PARTNER-GATING (Law 11): `financial_partners` is GLOBAL reference data already owned/exported by
// FintechModule's FinancialPartnerService — this service depends on that exported SERVICE (never builds a
// duplicate parallel repository against the same shared table) and narrows every partner query to
// `partnerKind: 'insurer'`. `regulatorRef` (the IRDAI/RBI licence number field) is rendered AS-IS, only when
// the underlying row actually carries one — never a fabricated "IRDAI certified" badge (Law 12).
import { Injectable } from '@nestjs/common';
import { FinancialPartnerService } from '../../fintech/services/financial-partner.service';
import { InsuranceProductRepository } from '../repositories/insurance-product.repository';
import { InsuranceProductNotFoundError, InsurancePartnerNotFoundError, PartnerNotAnInsurerError } from '../domain/insurance.errors';

@Injectable()
export class InsuranceProductService {
  constructor(
    private readonly partners: FinancialPartnerService,
    private readonly products: InsuranceProductRepository,
  ) {}

  /** IRDAI-partner list — always filtered to insurer-kind partners, never the full financial_partners panel. */
  async listPartners(tenantId: string, q: { activeOnly: boolean }) {
    return this.partners.listPartners(tenantId, { partnerKind: 'insurer', activeOnly: q.activeOnly });
  }

  async getPartner(tenantId: string, id: string) {
    const p = await this.partners.getPartner(tenantId, id).catch(() => null);
    if (!p) throw new InsurancePartnerNotFoundError(id);
    if (p.partnerKind !== 'insurer') throw new PartnerNotAnInsurerError(id);
    return p;
  }

  async listProducts(tenantId: string, q: { partnerId?: string; productKindId?: string; activeOnly: boolean; afterId: string | null; limit: number }) {
    // Gate: if a partnerId filter is supplied, it must resolve to a real insurer (never silently return an
    // empty list for a bank/NBFC id typo'd into this endpoint — 404 is the honest response).
    if (q.partnerId) await this.getPartner(tenantId, q.partnerId);
    const rows = await this.products.list(tenantId, q);
    const items = rows.map((p) => p.toJSON());
    const last = items[items.length - 1];
    return { items, nextAfterId: items.length === q.limit && last ? last.id : null };
  }

  async getProduct(tenantId: string, id: string) {
    const p = await this.products.getById(tenantId, id);
    if (!p) throw new InsuranceProductNotFoundError(id);
    return p.toJSON();
  }

  /** Internal (service-to-service) read used by InsurancePolicyService.propose — returns the domain entity
   *  (not JSON) so the caller can invoke premiumCalc(). Also re-asserts the partner is an insurer (defence in
   *  depth: a product's partner_id could in theory point at a non-insurer row if the admin surface mis-typed
   *  it — this is the same IRDAI gate applied at enrolment time, not just at browse time). */
  async getActiveProductForEnrolment(tenantId: string, id: string) {
    const p = await this.products.getById(tenantId, id);
    if (!p || !p.isActive) throw new InsuranceProductNotFoundError(id);
    await this.getPartner(tenantId, p.partnerId); // throws PartnerNotAnInsurerError if mis-tagged
    return p;
  }
}
