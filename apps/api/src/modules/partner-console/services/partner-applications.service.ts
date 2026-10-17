// modules/partner-console/services/partner-applications.service.ts · PC-56 PARTNER-0 · founder D2 / D3 — WHAT A PARTNER READS AND DECIDES.
//
// READS (on the kv_partner axis — the repository's `withAxis`; never kv_app with a WHERE clause):
//   • list   — the consented applications on this partner's products (status / reviewQueue filters, µs keyset). ONE partner-realm audit row
//              per call with the count (`partner.applications.listed`) — written before the page is returned: no row, no data;
//   • detail — the D2 shape: amount, the product, the purpose CATEGORY (the loan kind), the applicant's own words only after approval, the
//              status, the timestamps, `applicantRef` (= the application id — no applicantUserId, no name), a masked phone only after approval.
//              Its audit row is a TENANT row of the application's organisation, in the read's own transaction. A non-admitted id (another
//              partner's, an absent or expired consent, or no such id) is the SAME 404 — and that probe is audited as a partner-realm row.
// DECISIONS (D3): review (maker) / approve · reject (checker, admin). The application is first read THROUGH THE AXIS (the oracle admits it
// or the answer is 404); its tenant comes from that row — never from the token or the request — and the tenant-side mutation runs in that
// tenant with lenderMutate's rules (state machine, cooling-off, approved ≤ requested), an Idempotency-Key, and the partner person as the actor.
// DISBURSE is refused BY NAME before anything is read (PARTNER_CANNOT_DISBURSE): it moves the FPO's wallet money (Law 2).
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { LoanApplicationService, PartnerDecision } from '../../fintech/services/loan-application.service';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { clampPartnerLimit } from '../domain/partner-console.rules';
import { partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);
const strip = <T extends { cursorTs: string }>(r: T): Omit<T, 'cursorTs'> => { const { cursorTs: _c, ...rest } = r; return rest; };

@Injectable()
export class PartnerApplicationsService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    private readonly loans: LoanApplicationService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async list(s: PartnerSession, q: { status?: string; reviewQueue?: boolean; cursor?: string; limit?: number }) {
    const limit = clampPartnerLimit(q.limit);
    const rows = await this.repo.listApplications(s.partnerId, { status: q.status, reviewQueue: q.reviewQueue, cursor: decodeKeyset(q.cursor, UUID_RE), limit });
    const asOf = new Date().toISOString();
    await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
      tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.applications.listed', entityType: 'financial_partner', entityId: s.partnerId,
      newValue: { partnerId: s.partnerId, realm: 'partner', count: rows.length, status: q.status ?? null, reviewQueue: q.reviewQueue === true, page: q.cursor ? 'next' : 'first' },
      ip: s.ip, requestId: s.requestId,
    }), { userId: s.userId });
    this.metrics.inc('partner_console.applications_listed', { partner: s.partnerId });
    const last = rows[rows.length - 1];
    return { items: rows.map(strip), nextCursor: rows.length === limit && last ? encodeKeyset(last.cursorTs, last.id) : null, asOf, limit };
  }

  async detail(s: PartnerSession, id: string) {
    const row = UUID_RE.test(id) ? await this.repo.applicationDetail(s.partnerId, id, { actorUserId: s.userId, actorRole: actorRole(s),
      newValue: { partnerId: s.partnerId, realm: 'partner' }, ip: s.ip, requestId: s.requestId }) : null;
    if (!row) {
      // the refused probe is a fact worth keeping (a partner walking ids it cannot read) — a partner-realm row, no tenant named
      await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
        tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.application.read_refused', entityType: 'financial_partner', entityId: s.partnerId,
        newValue: { partnerId: s.partnerId, realm: 'partner', applicationRef: UUID_RE.test(id) ? id : null }, ip: s.ip, requestId: s.requestId,
      }), { userId: s.userId });
      throw partnerRefused('PARTNER_APPLICATION_NOT_FOUND');
    }
    return { ...strip(row), asOf: new Date().toISOString() };
  }

  async decide(s: PartnerSession, id: string, kind: PartnerDecision, body: { amountApprovedMinor?: string; coolingOffHours?: number; note?: string }, idemKey: string | undefined) {
    if (!idemKey) throw partnerRefused('PARTNER_IDEMPOTENCY_KEY_REQUIRED');
    const tenantId = UUID_RE.test(id) ? await this.repo.admittedTenant(s.partnerId, id) : null;   // the oracle, on the axis
    if (!tenantId) throw partnerRefused('PARTNER_APPLICATION_NOT_FOUND');
    try {
      const out = await this.loans.partnerDecide(tenantId, { userId: s.userId, canBorrow: false, canManage: true, partnerId: s.partnerId, roles: s.roles }, id, kind, body, idemKey, s.ip);
      this.metrics.inc('partner_console.decided', { kind });
      return this.decisionView(out);
    } catch (e) {
      if ((e as { code?: string })?.code === 'LOAN_APPLICATION_NOT_FOUND') throw partnerRefused('PARTNER_APPLICATION_NOT_FOUND');
      throw e;
    }
  }

  /** What the decision answers: the new state — never the applicant's id or words (the detail read prints those under D2's rules). */
  private decisionView(a: any) {
    return { id: a.id, applicantRef: a.id, status: a.status, amountRequestedMinor: a.amountRequestedMinor, amountApprovedMinor: a.amountApprovedMinor ?? null,
      decisionAt: a.decisionAt ? new Date(a.decisionAt).toISOString() : null, coolingOffUntil: a.coolingOffUntil ? new Date(a.coolingOffUntil).toISOString() : null };
  }

  refuseDisburse(): never { this.metrics.inc('partner_console.disburse_refused'); throw partnerRefused('PARTNER_CANNOT_DISBURSE'); }
}
