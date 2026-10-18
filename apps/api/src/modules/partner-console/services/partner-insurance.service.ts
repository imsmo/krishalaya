// modules/partner-console/services/partner-insurance.service.ts · PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK (founder Q6, 2026-10-18).
//
//   products   — `partner.insurance.read`: this insurer's OWN products (0228 `partner_insurance_products()`, shard 0) with the policies on each by
//                status (merged over the shards); its own pricing terms as data, the formula typed (integer bps / flat minor / not priceable);
//                subsidy and commission "recorded on the product; nothing is charged against it today" (founder Q4 — the console's words);
//   policies   — keyset (created µs, id), newest first, status filter from the state machine's own list, limit ≤ 100: policy FACTS only —
//                policy number (NULL today: nobody issues on the platform, Q5), the product, the FPO's PUBLIC display name, subject TYPE,
//                sum insured, the farmer's premium share as stored, valid dates, status, created. Never a holder, a subject, a payment, a name
//                of a person, a phone; never the FPO's tenant id (founder Q6);
//   policy     — one of them; another insurer's or an absent id → 404 `PARTNER_POLICY_NOT_FOUND` (never "not yours");
//   dashboard  — in force (active) count + Σ sum insured, proposed (awaiting the farmer's payment), FPOs with a policy, products, computedAt.
//                A bank partner holding the permission gets zeros, not an error (the NAV never shows a bank the insurer group).
//   issuance   — PC-56 PARTNER-2b (founder Q5): the QUEUE — the `proposed` policies on this insurer's products (the proposals awaiting the
//                farmer's premium payment), keyset newest first, the queue row's allow-list (policy, product, the FPO's public name, subject
//                type, sum insured, the premium the farmer will pay, proposed-at, the cover window if any). A READ: the insurer issues nothing on
//                the platform (cover starts when the farmer's payment is confirmed) — no issue act, no export, no run exists behind it.
// EVERY read writes ONE partner-realm audit row (`partner.insurance.read`, counts only — never a policy's figures, never a name): these are
// farmers' records (the 1a dashboard precedent; keys / webhooks reads were not audited because they are the partner's own configuration).
// The platform's `insurance` flag gates every route (PartnerInsuranceFlagGuard), the console's `partner_console` flag gates the realm.
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import {
  InsuranceCountsShard, isPartnerPolicyStatus, ISSUANCE_STATUS, mergeCounts, projectPolicy, projectProduct, projectQueueRow, PartnerInsuranceDashboard, PartnerPolicyView,
  PartnerProductView, PartnerQueueRowView,
} from '../domain/partner-insurance.rules';
import { clampPartnerLimit } from '../domain/partner-console.rules';
import { partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);

@Injectable()
export class PartnerInsuranceService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** ONE partner-realm audit row for one read — counts only. */
  private async trail(s: PartnerSession, surface: 'products' | 'policies' | 'policy' | 'dashboard' | 'issuance', counts: Record<string, unknown>, entity?: { type: string; id: string }): Promise<void> {
    await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
      tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.insurance.read',
      entityType: entity?.type ?? 'financial_partner', entityId: entity?.id ?? s.partnerId,
      newValue: { partnerId: s.partnerId, realm: 'partner', surface, ...counts }, ip: s.ip, requestId: s.requestId,
    }), { userId: s.userId });
    this.metrics.inc('partner_console.insurance_read', { partner: s.partnerId, surface });
  }

  private async perProduct(partnerId: string): Promise<Record<string, Record<string, number>>> {
    const shards: InsuranceCountsShard[] = [];
    for (let i = 0; i < this.repo.shards; i++) shards.push(await this.repo.insuranceCountsShard(i, partnerId));
    return mergeCounts(shards).perProduct;
  }

  private async productNames(partnerId: string): Promise<Map<string, string>> {
    const rows = await this.repo.insuranceProducts(partnerId);
    return new Map(rows.map((r) => [String(r.id), String(r.name ?? '')]));
  }

  async products(s: PartnerSession): Promise<{ items: PartnerProductView[]; computedAt: string }> {
    const rows = await this.repo.insuranceProducts(s.partnerId);
    const counts = await this.perProduct(s.partnerId);
    const items = rows.map((r) => projectProduct(r, counts[String(r.id)] ?? {}));
    const computedAt = new Date().toISOString();
    await this.trail(s, 'products', { products: items.length });
    return { items, computedAt };
  }

  async product(s: PartnerSession, id: string): Promise<PartnerProductView & { computedAt: string }> {
    const rows = UUID_RE.test(id) ? await this.repo.insuranceProducts(s.partnerId) : [];
    const row = rows.find((r) => String(r.id) === id);
    await this.trail(s, 'products', { products: row ? 1 : 0, found: !!row }, UUID_RE.test(id) ? { type: 'insurance_product', id } : undefined);
    if (!row) throw partnerRefused('PARTNER_PRODUCT_NOT_FOUND');
    const counts = await this.perProduct(s.partnerId);
    return { ...projectProduct(row, counts[id] ?? {}), computedAt: new Date().toISOString() };
  }

  async policies(s: PartnerSession, q: { status?: string; cursor?: string; limit?: number }): Promise<{ items: PartnerPolicyView[]; nextCursor: string | null; limit: number; computedAt: string }> {
    const limit = clampPartnerLimit(q.limit);
    const cursor = decodeKeyset(q.cursor, UUID_RE);
    const status = isPartnerPolicyStatus(q.status) ? q.status : undefined;
    const per: Array<Array<Record<string, unknown> & { id: string; created_us: string }>> = [];
    for (let i = 0; i < this.repo.shards; i++) per.push(await this.repo.insuranceBookShard(i, s.partnerId, { status, cursor, limit }));
    const rows = per.flat()
      .sort((a, b) => (a.created_us < b.created_us ? 1 : a.created_us > b.created_us ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);
    const names = await this.repo.publicTenantNames([...new Set(rows.map((r) => String(r.tenant_id)))]);
    const products = rows.length ? await this.productNames(s.partnerId) : new Map<string, string>();
    const items = rows.map((r) => projectPolicy(r, { fpoName: names.get(String(r.tenant_id)) ?? null, productName: products.get(String(r.product_id)) ?? null }));
    const last = rows[rows.length - 1];
    const computedAt = new Date().toISOString();
    await this.trail(s, 'policies', { listed: items.length, status: status ?? null, page: cursor ? 'next' : 'first' });
    return { items, nextCursor: rows.length === limit && last ? encodeKeyset(last.created_us, last.id) : null, limit, computedAt };
  }

  /** PC-56 PARTNER-2b · the issuance QUEUE: the `proposed` policies on this insurer's products, newest first (µs keyset). ONE audit row. */
  async issuance(s: PartnerSession, q: { cursor?: string; limit?: number }): Promise<{ items: PartnerQueueRowView[]; nextCursor: string | null; limit: number; computedAt: string }> {
    const limit = clampPartnerLimit(q.limit);
    const cursor = decodeKeyset(q.cursor, UUID_RE);
    const per: Array<Array<Record<string, unknown> & { id: string; created_us: string }>> = [];
    for (let i = 0; i < this.repo.shards; i++) per.push(await this.repo.insuranceBookShard(i, s.partnerId, { status: ISSUANCE_STATUS, cursor, limit }));
    const rows = per.flat()
      .sort((a, b) => (a.created_us < b.created_us ? 1 : a.created_us > b.created_us ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);
    const names = await this.repo.publicTenantNames([...new Set(rows.map((r) => String(r.tenant_id)))]);
    const products = rows.length ? await this.productNames(s.partnerId) : new Map<string, string>();
    const items = rows.map((r) => projectQueueRow(r, { fpoName: names.get(String(r.tenant_id)) ?? null, productName: products.get(String(r.product_id)) ?? null }));
    const last = rows[rows.length - 1];
    const computedAt = new Date().toISOString();
    await this.trail(s, 'issuance', { listed: items.length, status: ISSUANCE_STATUS, page: cursor ? 'next' : 'first' });
    return { items, nextCursor: rows.length === limit && last ? encodeKeyset(last.created_us, last.id) : null, limit, computedAt };
  }

  async policy(s: PartnerSession, id: string): Promise<PartnerPolicyView & { computedAt: string }> {
    const row = UUID_RE.test(id) ? await this.repo.insurancePolicy(s.partnerId, id) : null;
    await this.trail(s, 'policy', { found: !!row }, UUID_RE.test(id) ? { type: 'insurance_policy', id } : undefined);
    if (!row) throw partnerRefused('PARTNER_POLICY_NOT_FOUND');
    const names = await this.repo.publicTenantNames([String(row.tenant_id)]);
    const products = await this.productNames(s.partnerId);
    return { ...projectPolicy(row, { fpoName: names.get(String(row.tenant_id)) ?? null, productName: products.get(String(row.product_id)) ?? null }), computedAt: new Date().toISOString() };
  }

  async dashboard(s: PartnerSession): Promise<PartnerInsuranceDashboard> {
    const shards: InsuranceCountsShard[] = [];
    for (let i = 0; i < this.repo.shards; i++) shards.push(await this.repo.insuranceCountsShard(i, s.partnerId));
    const m = mergeCounts(shards);
    const products = (await this.repo.insuranceProducts(s.partnerId)).length;
    const out: PartnerInsuranceDashboard = {
      computedAt: new Date().toISOString(),
      policies: m.policies, inForce: m.inForce, proposed: m.proposed, fpos: m.fpos, products,
    };
    await this.trail(s, 'dashboard', { policies: out.policies, inForce: out.inForce.count, proposed: out.proposed, fpos: out.fpos, products });
    return out;
  }
}
