// modules/partner-console/services/partner-claims.service.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — FACTS, NEVER A CLAIMANT
// (founder Q3 + Q4, 2026-10-18).
//
//   list    — `partner.claims.read`: the claims on THIS insurer's products (0230 `partner_insurance_claims`), scattered over the shards and
//             merged on the µs keyset (created_at, id), OLDEST FIRST (the queue is how long a claim has waited); the status filter is the claim
//             state machine's own list; limit ≤ 100. Claim FACTS only (domain/partner-claims.rules.ts `projectClaim`), the FPO named by its
//             PUBLIC display name, never its tenant id; never a claimant, a note, a surveyor, a payment;
//   get     — one of them; another insurer's or an absent id → 404 `PARTNER_CLAIM_NOT_FOUND` (never "not yours");
//   counts  — COUNTS of the claims filed in a window of IST calendar days [from, to) — by default the current FY (April–March, Asia/Kolkata),
//             the window ANSWERED BY THE DATABASE (`FY_WINDOW_SQL`) — by status, by platform event code (+ not recorded) and the decided
//             counts. No money headline, no ratio, no median, no percentage (founder E10).
// EVERY read writes ONE partner-realm audit row (`partner.claims.read`, counts only — never a claim's figures, never a name): these are
// farmers' loss events (the 1a / 2a rule). Nothing here decides, settles, assigns or flags a claim: no such route exists (founder Q3 / Q6).
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { FY_WINDOW_SQL, isPartnerClaimStatus, mergeClaimCounts, projectClaim, validWindow, type PartnerClaimCounts, type PartnerClaimView } from '../domain/partner-claims.rules';
import { clampPartnerLimit } from '../domain/partner-console.rules';
import { partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);
/** Oldest first on the µs keyset — the merge of the shards' pages. */
const oldestFirst = (a: { created_us: string; id: string }, b: { created_us: string; id: string }) =>
  (a.created_us < b.created_us ? -1 : a.created_us > b.created_us ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

@Injectable()
export class PartnerClaimsService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** ONE partner-realm audit row for one read — counts only. */
  private async trail(s: PartnerSession, surface: 'claims' | 'claim' | 'claims_counts', counts: Record<string, unknown>, entity?: { type: string; id: string }): Promise<void> {
    await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
      tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.claims.read',
      entityType: entity?.type ?? 'financial_partner', entityId: entity?.id ?? s.partnerId,
      newValue: { partnerId: s.partnerId, realm: 'partner', surface, ...counts }, ip: s.ip, requestId: s.requestId,
    }), { userId: s.userId });
    this.metrics.inc('partner_console.claims_read', { partner: s.partnerId, surface });
  }

  private async productNames(partnerId: string): Promise<Map<string, string>> {
    const rows = await this.repo.insuranceProducts(partnerId);
    return new Map(rows.map((r) => [String(r.id), String(r.name ?? '')]));
  }

  async list(s: PartnerSession, q: { status?: string; cursor?: string; limit?: number }): Promise<{ items: PartnerClaimView[]; nextCursor: string | null; limit: number; computedAt: string }> {
    const limit = clampPartnerLimit(q.limit);
    const cursor = decodeKeyset(q.cursor, UUID_RE);
    const status = isPartnerClaimStatus(q.status) ? q.status : undefined;
    const per: Array<Array<Record<string, unknown> & { id: string; created_us: string }>> = [];
    for (let i = 0; i < this.repo.shards; i++) per.push(await this.repo.insuranceClaimsShard(i, s.partnerId, { status, cursor, limit }));
    const rows = per.flat().sort(oldestFirst).slice(0, limit);
    const names = await this.repo.publicTenantNames([...new Set(rows.map((r) => String(r.tenant_id)))]);
    const products = rows.length ? await this.productNames(s.partnerId) : new Map<string, string>();
    const computedAt = new Date().toISOString();
    const items = rows.map((r) => projectClaim(r, { fpoName: names.get(String(r.tenant_id)) ?? null, productName: products.get(String(r.product_id)) ?? null }, computedAt));
    const last = rows[rows.length - 1];
    await this.trail(s, 'claims', { listed: items.length, status: status ?? null, page: cursor ? 'next' : 'first' });
    return { items, nextCursor: rows.length === limit && last ? encodeKeyset(last.created_us, last.id) : null, limit, computedAt };
  }

  async get(s: PartnerSession, id: string): Promise<PartnerClaimView & { computedAt: string }> {
    const row = UUID_RE.test(id) ? await this.repo.insuranceClaim(s.partnerId, id) : null;
    await this.trail(s, 'claim', { found: !!row }, UUID_RE.test(id) ? { type: 'insurance_claim', id } : undefined);
    if (!row) throw partnerRefused('PARTNER_CLAIM_NOT_FOUND');
    const names = await this.repo.publicTenantNames([String(row.tenant_id)]);
    const products = await this.productNames(s.partnerId);
    const computedAt = new Date().toISOString();
    return { ...projectClaim(row, { fpoName: names.get(String(row.tenant_id)) ?? null, productName: products.get(String(row.product_id)) ?? null }, computedAt), computedAt };
  }

  async counts(s: PartnerSession, q: { from?: string; to?: string }): Promise<PartnerClaimCounts> {
    let window: { from: string; to: string };
    if (q.from && q.to) {
      if (!validWindow(q.from, q.to)) throw partnerRefused('PARTNER_CLAIM_WINDOW_INVALID');
      window = { from: q.from, to: q.to };
    } else {
      window = await this.currentFy(s);
    }
    const rows: Array<{ product_id: string; status: string; event_type_code: string | null; n: string }> = [];
    for (let i = 0; i < this.repo.shards; i++) rows.push(...(await this.repo.insuranceClaimCountsShard(i, s.partnerId, window.from, window.to)));
    const out = mergeClaimCounts(rows, window, new Date().toISOString());
    await this.trail(s, 'claims_counts', { from: out.from, to: out.to, claims: out.total });
    return out;
  }

  /** The current FY (April–March, Asia/Kolkata) as IST calendar days — answered by the DATABASE from now(), no application clock. */
  private async currentFy(s: PartnerSession): Promise<{ from: string; to: string }> {
    return this.uow.run(s.partnerId, async (tx) => {
      const r = await tx.query<{ fy_from: string; fy_to: string }>(FY_WINDOW_SQL);
      return { from: String(r.rows[0].fy_from), to: String(r.rows[0].fy_to) };
    }, { userId: s.userId });
  }
}
