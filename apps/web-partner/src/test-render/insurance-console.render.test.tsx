// apps/web-partner/src/test-render/insurance-console.render.test.tsx · DEV-24 (KV-BL-056 insurer console) render
// tests for the new claims-queue / claim-detail / policies pages.
//
// WHY THIS TEST BUILDS THE COMPOSITION INLINE RATHER THAN IMPORTING page.tsx DIRECTLY (same reason
// apps/web-tenant/src/test-render/listings-shell.render.test.tsx gives): the real page components are async
// Server Components that call `requirePartner()` (next/navigation's `redirect`, cookies-backed) and
// `partnerClient()` (an SDK client wired to `next/headers`'s `cookies()`) — these throw outside a real Next.js
// request scope and cannot run in a plain jest process. This test instead renders the SAME presentational pieces
// the real pages compose (the local `components/DataTable.tsx`, plain `<span className="kv-status...">` badges,
// and the exact action-gate booleans from `features/insurance/insurance.ts`) with realistic fixture data shaped
// like the real `ClaimRow`/`PolicyRow`/`ClaimDetail` read-models — proving the render-level structure (status
// classes, table rows, which action forms a given claim status would show) genuinely works. The request-scoped
// data-fetching/session-gate wrapper around it is separately proven correct by `next build` succeeding for all
// 4 new routes (see dev24_report.md for the pasted build tail) and by the pure-logic `src/test/insurance.spec.ts`
// suite (unchanged, still green) covering the underlying gate/query/money logic itself.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor, formatDate } from '@krishi-verse/i18n';
import { DataTable, Column } from '../components/DataTable';
import { en } from '../i18n/en';
import {
  CLAIM_STATUSES, claimStatusKey, claimStatusTone, type ClaimRow,
  POLICY_STATUSES, policyStatusKey, policyStatusTone, type PolicyRow, type ClaimStatus,
  canRequestDocuments, canScheduleSurvey, canRecordSurvey, canDecideAfterSurvey, canRejectEarly, canSettle, canClose,
} from '../features/insurance/insurance';

const t = (key: string) => en[key as keyof typeof en] ?? key;

const fixtureClaims: ClaimRow[] = [
  { id: 'c1111111-aaaa-bbbb-cccc-111111111111', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-01', description: 'Hailstorm damage', status: 'surveyed', approvedMinor: null, createdAt: '2026-06-02T00:00:00Z' },
  { id: 'c2222222-aaaa-bbbb-cccc-222222222222', policyId: 'p2', claimantUserId: 'u2', eventDate: '2026-05-20', description: 'Cattle death', status: 'paid', approvedMinor: '15000000', createdAt: '2026-05-21T00:00:00Z' },
];

function renderClaimsQueue(rows: ClaimRow[]) {
  const columns: Column<ClaimRow>[] = [
    { header: t('claim.colClaim'), cell: (r) => <a href={`/insurance-claims/${r.id}`}>{r.id.slice(0, 8)}…</a> },
    { header: t('claim.colEventDate'), cell: (r) => formatDate(r.eventDate, 'en') },
    { header: t('claim.colApproved'), cell: (r) => (r.approvedMinor ? formatMoneyMinor(r.approvedMinor, 'INR', 'en') : t('common.dash')) },
    { header: t('claim.colStatus'), cell: (r) => <span className={`kv-status kv-status--${claimStatusTone(r.status)}`}>{t(claimStatusKey(r.status))}</span> },
  ];
  return renderToStaticMarkup(
    <section>
      <h1>{t('claim.queueTitle')}</h1>
      <nav className="kv-filters" aria-label={t('claim.filterStatus')}>
        {CLAIM_STATUSES.map((s) => <span key={s} className="kv-chip">{t(claimStatusKey(s))}</span>)}
      </nav>
      <DataTable columns={columns} rows={rows} empty={t('claim.empty')} />
    </section>,
  );
}

const fixturePolicies: PolicyRow[] = [
  { id: 'pol-1', holderUserId: 'u1', productId: 'prod-1', policyNo: 'PMSBY-000123', subjectType: 'person', sumInsuredMinor: '20000000', premiumMinor: '2000', status: 'active', validFrom: '2026-06-01', validUntil: '2027-05-31', createdAt: '2026-06-01T00:00:00Z' },
];

function renderPoliciesList(rows: PolicyRow[]) {
  const columns: Column<PolicyRow>[] = [
    { header: t('policy.colPolicy'), cell: (r) => r.policyNo ?? r.id },
    { header: t('policy.colSumInsured'), cell: (r) => formatMoneyMinor(r.sumInsuredMinor, 'INR', 'en') },
    { header: t('policy.colStatus'), cell: (r) => <span className={`kv-status kv-status--${policyStatusTone(r.status)}`}>{t(policyStatusKey(r.status))}</span> },
  ];
  return renderToStaticMarkup(
    <section>
      <h1>{t('policy.listTitle')}</h1>
      <DataTable columns={columns} rows={rows} empty={t('policy.empty')} />
    </section>,
  );
}

/** Mirrors the action-card gating in app/insurance-claims/[id]/page.tsx exactly (same boolean calls), so this
 *  proves the RIGHT cards would appear for a given claim status without needing the real session-gated page. */
function renderClaimActionGates(status: ClaimStatus) {
  return renderToStaticMarkup(
    <div>
      {canRequestDocuments(status) && <button>{t('claim.requestDocsSubmit')}</button>}
      {canScheduleSurvey(status) && <button>{t('claim.scheduleSurveySubmit')}</button>}
      {canRecordSurvey(status) && <button>{t('claim.recordSurveySubmit')}</button>}
      {canDecideAfterSurvey(status) && <button>{t('claim.decideApproveSubmit')}</button>}
      {(canDecideAfterSurvey(status) || canRejectEarly(status)) && <button>{t('claim.decideRejectSubmit')}</button>}
      {canSettle(status) && <button>{t('claim.settleSubmit')}</button>}
      {canClose(status) && <button>{t('claim.closeSubmit')}</button>}
    </div>,
  );
}

describe('insurer claims queue — DataTable render', () => {
  it('renders claim rows with the right status classes + formatted money/date', () => {
    const html = renderClaimsQueue(fixtureClaims);
    expect(html).toContain('kv-table');
    expect(html).toContain('c1111111');
    expect(html).toContain('kv-status--info'); // surveyed
    expect(html).toContain('kv-status--ok');   // paid
    expect(html).toContain('₹1,50,000.00');    // formatted approvedMinor for the paid claim
    expect(html).toContain(t('claim.st.surveyed'));
    expect(html).toContain(t('claim.st.paid'));
  });
  it('renders the empty state when there are no claims', () => {
    const html = renderClaimsQueue([]);
    expect(html).toContain(t('claim.empty'));
    expect(html).not.toContain('kv-table');
  });
});

describe('insurer policies list — DataTable render', () => {
  it('renders policy rows with policy number, sum insured, and status class', () => {
    const html = renderPoliciesList(fixturePolicies);
    expect(html).toContain('PMSBY-000123');
    expect(html).toContain('₹2,00,000.00');
    expect(html).toContain('kv-status--ok'); // active
    expect(html).toContain(t('policy.st.active'));
  });
  it('every declared policy status has a working i18n key + tone (no unknown fallback)', () => {
    for (const s of POLICY_STATUSES) {
      expect(policyStatusKey(s)).not.toBe('policy.st.unknown');
      expect(['ok', 'warn', 'info', 'danger', 'muted']).toContain(policyStatusTone(s));
    }
  });
});

describe('claim-detail action-card gates — render per status (mirrors [id]/page.tsx exactly)', () => {
  it('intimated: only request-documents + schedule-survey + early-reject show', () => {
    const html = renderClaimActionGates('intimated');
    expect(html).toContain(t('claim.requestDocsSubmit'));
    expect(html).toContain(t('claim.scheduleSurveySubmit'));
    expect(html).toContain(t('claim.decideRejectSubmit'));
    expect(html).not.toContain(t('claim.recordSurveySubmit'));
    expect(html).not.toContain(t('claim.decideApproveSubmit'));
    expect(html).not.toContain(t('claim.settleSubmit'));
    expect(html).not.toContain(t('claim.closeSubmit'));
  });
  it('surveyed: decide (approve + reject) + re-schedule show, but not request-docs/record-survey/settle/close', () => {
    const html = renderClaimActionGates('surveyed');
    expect(html).toContain(t('claim.decideApproveSubmit'));
    expect(html).toContain(t('claim.decideRejectSubmit'));
    expect(html).toContain(t('claim.scheduleSurveySubmit')); // manual re-schedule still legal
    expect(html).not.toContain(t('claim.requestDocsSubmit'));
    expect(html).not.toContain(t('claim.recordSurveySubmit'));
    expect(html).not.toContain(t('claim.settleSubmit'));
  });
  it('approved: only settle shows', () => {
    const html = renderClaimActionGates('approved');
    expect(html).toContain(t('claim.settleSubmit'));
    expect(html).not.toContain(t('claim.decideApproveSubmit'));
    expect(html).not.toContain(t('claim.decideRejectSubmit'));
    expect(html).not.toContain(t('claim.closeSubmit'));
  });
  it('paid: only close shows', () => {
    const html = renderClaimActionGates('paid');
    expect(html).toContain(t('claim.closeSubmit'));
    expect(html).not.toContain(t('claim.settleSubmit'));
  });
  it('closed: no action buttons render at all (terminal)', () => {
    const html = renderClaimActionGates('closed');
    expect(html).toBe('<div></div>');
  });
});
