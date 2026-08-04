// Unit tests for the PURE tenant-admin-lite logic (features/tenant/tenant-admin). Money built with BigInt (Law 2).
// The server is the authority on every action (no god-mode, Law 11); these helpers only drive the UI/validation.
import { subscriptionTone, needsToApply, isPending, isPendingApproval, disputeStatusTone, disputeActions, buildResolution, dashboardKpis, validateAddFarmer, planFarmerLimit, sortPlansByPrice, expectedResponseAt, rosterCounts, filterRoster, groupAssignmentsByRole, avgOrderMinor, windowRange, planLimitLines, usageRows, isCustomPlan, upgradePlans, approvalCounts, filterApprovals, verifiedApprovalIds, pctOf, formatBytes, reportKindIcon, disputeTab, disputeTabCounts, filterDisputesByTab, daysAgo, isDisputeUrgent, disputeMessageRole, validateBroadcast, BROADCAST_BODY_MAX, campaignTab, campaignTabCounts, filterCampaignsByTab } from '../../features/tenant/tenant-admin';
import type { RoleAssignment, Dispute, Plan } from '@krishalaya/sdk-js';

const plan = (id: string, monthlyPriceMinor: string, limits: Record<string, string>): Plan =>
  ({ id, code: id, version: 1, defaultName: id, countryCode: 'IN', currencyCode: 'INR', monthlyPriceMinor, annualPriceMinor: '0', setupFeeMinor: '0', isPublic: true, isActive: true, limits } as Plan);

describe('planFarmerLimit', () => {
  it('reads the real farmers cap or null when uncapped', () => {
    expect(planFarmerLimit(plan('s', '499900', { farmers: '500' }))).toBe(500);
    expect(planFarmerLimit(plan('e', '0', { max_farmers: '25000' }))).toBe(25000);
    expect(planFarmerLimit(plan('x', '0', {}))).toBeNull();
    expect(planFarmerLimit(plan('y', '0', { farmers: '0' }))).toBeNull();
  });
});

describe('sortPlansByPrice', () => {
  it('orders by monthly price ascending, bigint-safe, without mutating', () => {
    const input = [plan('c', '4999900', {}), plan('a', '499900', {}), plan('b', '1999900', {})];
    expect(sortPlansByPrice(input).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(input.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(sortPlansByPrice(null)).toEqual([]);
  });
});

describe('expectedResponseAt', () => {
  it('adds the SLA window to the real submit time', () => {
    expect(expectedResponseAt('2026-08-15T05:12:00.000Z')).toBe('2026-08-16T05:12:00.000Z');
    expect(expectedResponseAt('2026-08-15T00:00:00.000Z', 48)).toBe('2026-08-17T00:00:00.000Z');
    expect(expectedResponseAt(null)).toBeNull();
    expect(expectedResponseAt('nope')).toBeNull();
  });
});

const asg = (over: Partial<RoleAssignment>): RoleAssignment => ({ id: 'a', userId: 'u', roleCode: 'farmer', kycStatus: 'pending', isActive: false, approvedAt: null, ...over });
const disp = (status: string): Dispute => ({ id: Math.random().toString(), orderId: 'o', raisedBy: 'r', againstUser: null, reasonId: null, description: null, status, sellerRespondBy: null, resolutionType: null, resolutionAmountMinor: null, resolvedBy: null, resolvedAt: null, slaDueAt: null } as Dispute);

describe('subscription helpers', () => {
  it('tones + apply/pending gating', () => {
    expect(subscriptionTone('active')).toBe('success');
    expect(subscriptionTone('past_due')).toBe('danger');
    expect(needsToApply(null)).toBe(true);
    expect(needsToApply({ status: 'active' })).toBe(false);
    expect(isPending({ status: 'pending' })).toBe(true);
    expect(isPending({ status: 'active' })).toBe(false);
  });
});

describe('approvals', () => {
  it('pending = not active + not approved', () => {
    expect(isPendingApproval({ isActive: false, approvedAt: null })).toBe(true);
    expect(isPendingApproval({ isActive: true, approvedAt: null })).toBe(false);
    expect(isPendingApproval({ isActive: false, approvedAt: '2026-01-01' })).toBe(false);
  });
});

describe('disputes', () => {
  it('status tones + action map', () => {
    expect(disputeStatusTone('resolved')).toBe('success');
    expect(disputeStatusTone('under_review')).toBe('accent');
    expect(disputeActions('open')).toEqual(['review']);
    expect(disputeActions('under_review')).toEqual(['escalate', 'resolve']);
    expect(disputeActions('escalated')).toEqual(['resolve']);
    expect(disputeActions('resolved')).toEqual([]);
  });
});

describe('buildResolution', () => {
  it('partial refund needs a positive amount → paise', () => {
    expect(buildResolution('refund_partial', '500')).toEqual({ ok: true, body: { resolutionType: 'refund_partial', resolutionAmountMinor: '50000' } });
    expect(buildResolution('refund_partial', '0')).toEqual({ ok: false, reason: 'amount' });
    expect(buildResolution('refund_partial', '')).toEqual({ ok: false, reason: 'amount' });
  });
  it('non-partial types carry no amount', () => {
    expect(buildResolution('refund_full', '999')).toEqual({ ok: true, body: { resolutionType: 'refund_full' } });
    expect(buildResolution('replace', '')).toEqual({ ok: true, body: { resolutionType: 'replace' } });
  });
  it('rejects an unknown type', () => {
    expect(buildResolution('nope', '')).toEqual({ ok: false, reason: 'type' });
  });
});

describe('dashboardKpis', () => {
  it('counts active farmers, pending approvals, open disputes', () => {
    const k = dashboardKpis({
      assignments: [asg({ isActive: true }), asg({ isActive: true }), asg({ isActive: false, approvedAt: null })],
      disputes: [disp('open'), disp('under_review'), disp('resolved'), disp('withdrawn')],
    });
    expect(k).toEqual({ farmers: 2, pendingApprovals: 1, openDisputes: 2 });
  });
});

describe('rosterCounts + filterRoster', () => {
  const roster = [
    asg({ id: '1', isActive: true, kycStatus: 'verified' }),
    asg({ id: '2', isActive: true, kycStatus: 'pending' }),
    asg({ id: '3', isActive: false, kycStatus: 'pending' }),
    asg({ id: '4', isActive: false, kycStatus: 'verified' }),
  ];
  it('counts total/active/pendingKyc/inactive from real assignments', () => {
    expect(rosterCounts(roster)).toEqual({ all: 4, active: 2, pendingKyc: 2, inactive: 2 });
    expect(rosterCounts(null)).toEqual({ all: 0, active: 0, pendingKyc: 0, inactive: 0 });
  });
  it('filters per tab without mutating', () => {
    expect(filterRoster(roster, 'all').length).toBe(4);
    expect(filterRoster(roster, 'active').map((a) => a.id)).toEqual(['1', '2']);
    expect(filterRoster(roster, 'pending_kyc').map((a) => a.id)).toEqual(['2', '3']);
    expect(filterRoster(roster, 'inactive').map((a) => a.id)).toEqual(['3', '4']);
    expect(roster.map((a) => a.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('groupAssignmentsByRole', () => {
  it('groups by roleCode in first-appearance order, no fabrication', () => {
    const list = [
      asg({ id: '1', roleCode: 'admin' }), asg({ id: '2', roleCode: 'ambassador' }),
      asg({ id: '3', roleCode: 'admin' }), asg({ id: '4', roleCode: 'support' }),
    ];
    const g = groupAssignmentsByRole(list);
    expect(g.map((x) => x.roleCode)).toEqual(['admin', 'ambassador', 'support']);
    expect(g[0].items.map((a) => a.id)).toEqual(['1', '3']);
    expect(groupAssignmentsByRole(null)).toEqual([]);
  });
});

describe('avgOrderMinor', () => {
  it('floors gmv / orders in minor units, bigint-safe (Law 2)', () => {
    expect(avgOrderMinor('1000000', 4)).toBe('250000');
    expect(avgOrderMinor('1000001', 4)).toBe('250000'); // floored
    expect(avgOrderMinor('999', 0)).toBe('0');
    expect(avgOrderMinor(null, 10)).toBe('0');
    expect(avgOrderMinor('abc', 2)).toBe('0');
    expect(avgOrderMinor('1000000', -3)).toBe('0');
  });
});

describe('windowRange', () => {
  const now = Date.parse('2026-07-04T00:00:00.000Z');
  it('maps a window tab to a real ISO from/to range', () => {
    expect(windowRange('7d', now)).toEqual({ from: '2026-06-27T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' });
    expect(windowRange('30d', now).from).toBe('2026-06-04T00:00:00.000Z');
    expect(windowRange('3mo', now).from).toBe('2026-04-05T00:00:00.000Z');
    expect(windowRange('1yr', now).from).toBe('2025-07-04T00:00:00.000Z');
  });
  it('all → open range (server default window)', () => {
    expect(windowRange('all', now)).toEqual({});
  });
});

describe('planLimitLines', () => {
  it('lists real caps sorted by key; -1/0 = unlimited', () => {
    const lines = planLimitLines(plan('g', '499900', { farmers: '5000', listings: '-1', sms: '10000', auctions: '0' }));
    expect(lines.map((l) => l.key)).toEqual(['auctions', 'farmers', 'listings', 'sms']);
    expect(lines.find((l) => l.key === 'farmers')).toEqual({ key: 'farmers', value: '5000', unlimited: false });
    expect(lines.find((l) => l.key === 'listings')!.unlimited).toBe(true);
    expect(lines.find((l) => l.key === 'auctions')!.unlimited).toBe(true);
    expect(planLimitLines(null)).toEqual([]);
  });
});

describe('usageRows', () => {
  it('joins real usage+limits, computes clamped pct, uncapped → null bar', () => {
    const rows = usageRows({ farmers: '5000', sms: '10000', api: '-1' }, { farmers: '1247', sms: '8420' });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.farmers).toEqual({ key: 'farmers', used: 1247, limit: 5000, pct: 1247 / 5000 });
    expect(byKey.sms.pct).toBeCloseTo(0.842, 3);
    expect(byKey.api).toEqual({ key: 'api', used: 0, limit: null, pct: null }); // uncapped
    expect(usageRows(undefined, undefined)).toEqual([]);
  });
  it('clamps over-limit usage to 1', () => {
    expect(usageRows({ x: '10' }, { x: '25' })[0].pct).toBe(1);
  });
});

describe('isCustomPlan + upgradePlans', () => {
  it('flags a zero-priced plan as custom', () => {
    expect(isCustomPlan(plan('e', '0', {}))).toBe(true);
    expect(isCustomPlan(plan('s', '1499900', {}))).toBe(false);
  });
  it('returns higher-priced + custom plans (custom last), excludes current, sorted asc', () => {
    const catalogue = [
      plan('growth', '499900', {}), plan('scale', '1499900', {}), plan('ent', '0', {}), plan('starter', '99900', {}),
    ];
    const up = upgradePlans(catalogue, 'growth', '499900');
    expect(up.map((p) => p.id)).toEqual(['scale', 'ent']); // starter cheaper → excluded; custom last
  });
});

describe('approval queue helpers', () => {
  const queue = [
    asg({ id: '1', kycStatus: 'verified' }),
    asg({ id: '2', kycStatus: 'approved' }),
    asg({ id: '3', kycStatus: 'pending' }),
    asg({ id: '4', kycStatus: 'none' }),
  ];
  it('counts total / verified / pending from real kycStatus', () => {
    expect(approvalCounts(queue)).toEqual({ all: 4, verified: 2, pending: 2 });
    expect(approvalCounts(null)).toEqual({ all: 0, verified: 0, pending: 0 });
  });
  it('filters per tab without mutating', () => {
    expect(filterApprovals(queue, 'all').length).toBe(4);
    expect(filterApprovals(queue, 'verified').map((a) => a.id)).toEqual(['1', '2']);
    expect(filterApprovals(queue, 'pending').map((a) => a.id)).toEqual(['3', '4']);
    expect(queue.map((a) => a.id)).toEqual(['1', '2', '3', '4']);
  });
  it('bulk set = ids of KYC-verified items only', () => {
    expect(verifiedApprovalIds(queue)).toEqual(['1', '2']);
    expect(verifiedApprovalIds([])).toEqual([]);
  });
});

describe('pctOf', () => {
  it('rounds a real share to 0..100; 0 when total is 0', () => {
    expect(pctOf(189, 1247)).toBe(15);
    expect(pctOf(624, 1247)).toBe(50);
    expect(pctOf(0, 0)).toBe(0);
    expect(pctOf(5, 0)).toBe(0);
    expect(pctOf(10, 10)).toBe(100);
  });
});

describe('dispute inbox tabs (155)', () => {
  const mk = (status: string) => ({ status });
  it('buckets statuses into open/review/resolved/other', () => {
    expect(disputeTab('open')).toBe('open');
    expect(disputeTab('awaiting_seller')).toBe('open');
    expect(disputeTab('under_review')).toBe('review');
    expect(disputeTab('escalated')).toBe('review');
    expect(disputeTab('resolved')).toBe('resolved');
    expect(disputeTab('closed')).toBe('resolved');
    expect(disputeTab('withdrawn')).toBe('other');
  });
  it('counts per tab over the loaded page (real, not a fabricated total)', () => {
    const list = ['open', 'awaiting_seller', 'under_review', 'resolved', 'closed', 'withdrawn'].map(mk);
    expect(disputeTabCounts(list)).toEqual({ open: 2, review: 1, resolved: 2 });
    expect(disputeTabCounts(null)).toEqual({ open: 0, review: 0, resolved: 0 });
  });
  it('filters to the selected tab', () => {
    const list = ['open', 'under_review', 'resolved'].map(mk);
    expect(filterDisputesByTab(list, 'review')).toEqual([{ status: 'under_review' }]);
  });
});

describe('daysAgo / isDisputeUrgent (155)', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  it('whole days ago, floored, ≥0; null when missing/bad', () => {
    expect(daysAgo('2026-07-02T12:00:00Z', now)).toBe(2);
    expect(daysAgo('2026-07-04T00:00:00Z', now)).toBe(0);
    expect(daysAgo('2026-07-10T00:00:00Z', now)).toBe(0); // future clamps to 0
    expect(daysAgo(null, now)).toBeNull();
    expect(daysAgo('nonsense', now)).toBeNull();
  });
  it('urgent when SLA breached / within 24h and not resolved', () => {
    expect(isDisputeUrgent('2026-07-04T18:00:00Z', 'open', now)).toBe(true);   // 6h away
    expect(isDisputeUrgent('2026-07-03T00:00:00Z', 'open', now)).toBe(true);   // overdue
    expect(isDisputeUrgent('2026-07-08T00:00:00Z', 'open', now)).toBe(false);  // 4d away
    expect(isDisputeUrgent('2026-07-04T18:00:00Z', 'resolved', now)).toBe(false);
    expect(isDisputeUrgent(null, 'open', now)).toBe(false);
  });
});

describe('campaign tabs (158)', () => {
  const mk = (status: string) => ({ status });
  it('buckets broadcast status into live/scheduled/done', () => {
    expect(campaignTab('sending')).toBe('live');
    expect(campaignTab('queued')).toBe('scheduled');
    expect(campaignTab('sent')).toBe('done');
    expect(campaignTab('failed')).toBe('done');
  });
  it('counts + filters per tab', () => {
    const list = ['sending', 'queued', 'sent', 'failed', 'sent'].map(mk);
    expect(campaignTabCounts(list)).toEqual({ live: 1, scheduled: 1, done: 3 });
    expect(campaignTabCounts(null)).toEqual({ live: 0, scheduled: 0, done: 0 });
    expect(filterCampaignsByTab(list, 'live')).toEqual([{ status: 'sending' }]);
  });
});

describe('validateBroadcast (157)', () => {
  it('requires non-empty title + body within limits; trims', () => {
    expect(validateBroadcast({ title: ' Prices up ', body: ' Check mandi ' })).toEqual({ ok: true, input: { title: 'Prices up', body: 'Check mandi' } });
    expect(validateBroadcast({ title: '', body: 'x' })).toEqual({ ok: false, reason: 'title' });
    expect(validateBroadcast({ title: 't', body: '   ' })).toEqual({ ok: false, reason: 'body' });
    expect(validateBroadcast({ title: 't', body: 'a'.repeat(BROADCAST_BODY_MAX + 1) })).toEqual({ ok: false, reason: 'body' });
    expect(validateBroadcast({ title: 'a'.repeat(200), body: 'x' })).toEqual({ ok: false, reason: 'title' });
  });
});

describe('disputeMessageRole (156)', () => {
  const d = { raisedBy: 'u-raiser', againstUser: 'u-against' };
  it('maps author id to complainant / respondent / moderator', () => {
    expect(disputeMessageRole('u-raiser', d)).toBe('complainant');
    expect(disputeMessageRole('u-against', d)).toBe('respondent');
    expect(disputeMessageRole('u-admin', d)).toBe('moderator');
    expect(disputeMessageRole('', d)).toBe('moderator');
    expect(disputeMessageRole('u-raiser', { raisedBy: 'u-raiser', againstUser: null })).toBe('complainant');
  });
});

describe('formatBytes (154 export-reports)', () => {
  it('formats bytes / KB / MB with the design rounding; degrades junk to —', () => {
    expect(formatBytes(320 * 1024)).toBe('320 KB');
    expect(formatBytes(847 * 1024)).toBe('847 KB');
    expect(formatBytes(Math.round(2.4 * 1024 * 1024))).toBe('2.4 MB');
    expect(formatBytes(Math.round(1.1 * 1024 * 1024))).toBe('1.1 MB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(null)).toBe('—');
  });
});

describe('reportKindIcon (154)', () => {
  it('maps a report kind to a glyph; unknown → document', () => {
    expect(reportKindIcon('gmv')).toBe('📊');
    expect(reportKindIcon('revenue')).toBe('📊');
    expect(reportKindIcon('farmer_activity')).toBe('📈');
    expect(reportKindIcon('compliance')).toBe('💰');
    expect(reportKindIcon('nabard')).toBe('💰');
    expect(reportKindIcon('whatever')).toBe('📄');
    expect(reportKindIcon(undefined)).toBe('📄');
  });
});

describe('validateAddFarmer', () => {
  it('accepts an E.164-ish phone, trims spaces/dashes, keeps name', () => {
    expect(validateAddFarmer({ phone: ' +91 98123-45678 ', fullName: ' Asha ' })).toEqual({ ok: true, input: { phone: '+919812345678', fullName: 'Asha' } });
  });
  it('rejects a bad phone', () => {
    expect(validateAddFarmer({ phone: '123' })).toEqual({ ok: false, reason: 'phone' });
    expect(validateAddFarmer({})).toEqual({ ok: false, reason: 'phone' });
  });
});
