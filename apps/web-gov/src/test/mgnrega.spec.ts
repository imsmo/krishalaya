// apps/web-gov/src/test/mgnrega.spec.ts · GW-5 (PC-55 B2). Pins how the console PRESENTS a statutory clock and a
// worker's remaining entitlement. The API owns the authoritative arithmetic (labour/domain/mgnrega.rules.ts); these
// specs exist so the display can never quietly contradict it — a household reading "4 days left" when the deadline
// has passed, or "80 days remaining" when the state says otherwise, is the failure mode being guarded.
import {
  DEMAND_STATUSES, isDemandStatus, WORK_STATUSES, isWorkStatus, EXPORT_REPORTS, isExportReport,
  demandUrgency, canAllot, canEnd, buildDemand, buildDemandTransition, ledgerClaim, capView, totalWorks,
} from '../features/mgnrega/program';

describe('vocabularies mirror the API', () => {
  it('demand statuses match 0091’s CHECK constraint', () => {
    expect([...DEMAND_STATUSES]).toEqual(['demanded', 'allotted', 'withdrawn', 'closed']);
    expect(isDemandStatus('demanded')).toBe(true);
    expect(isDemandStatus('pending')).toBe(false);
  });
  it('work statuses match mgnrega_works', () => {
    expect([...WORK_STATUSES]).toEqual(['planned', 'active', 'completed', 'suspended']);
    expect(isWorkStatus('active')).toBe(true);
    expect(isWorkStatus('archived')).toBe(false);
  });
  it('export reports match the API’s allow-list (an unknown report never leaves the console)', () => {
    expect([...EXPORT_REPORTS]).toEqual(['job_cards', 'works', 'demands']);
    expect(isExportReport('job_cards')).toBe(true);
    expect(isExportReport('everything')).toBe(false);
    expect(isExportReport(undefined)).toBe(false);
  });
});

describe('demandUrgency — the household waiting longest must be impossible to miss', () => {
  it('trusts the API’s overdue flag first', () => {
    expect(demandUrgency({ status: 'demanded', overdue: true, daysUntilDue: 2 })).toBe('overdue');
  });
  it('re-derives overdue from a negative countdown when the flag is absent', () => {
    expect(demandUrgency({ status: 'demanded', daysUntilDue: -1 })).toBe('overdue');
    expect(demandUrgency({ status: 'demanded', daysUntilDue: 0 })).toBe('due_soon'); // the due day is still in time
  });
  it('flags the last three days as due soon, and nothing beyond that', () => {
    expect(demandUrgency({ status: 'demanded', daysUntilDue: 3 })).toBe('due_soon');
    expect(demandUrgency({ status: 'demanded', daysUntilDue: 4 })).toBe('open');
    expect(demandUrgency({ status: 'demanded', daysUntilDue: 15 })).toBe('open');
  });
  it('a demand that ended is never shown as a running clock', () => {
    for (const status of ['allotted', 'withdrawn', 'closed']) {
      expect(demandUrgency({ status, overdue: true, daysUntilDue: -30 })).toBe('closed');
    }
  });
  it('only an open demand offers allot / end (mirrors canAllotDemand server-side)', () => {
    expect(canAllot({ status: 'demanded' })).toBe(true);
    expect(canEnd({ status: 'demanded' })).toBe(true);
    for (const status of ['allotted', 'withdrawn', 'closed']) {
      expect(canAllot({ status })).toBe(false);
      expect(canEnd({ status })).toBe(false);
    }
  });
});

describe('buildDemand — the date IS the entitlement', () => {
  const CARD = '00000000-0000-7000-8000-000000000001';
  const base = { jobCardId: CARD, demandedOn: '2026-08-01', daysRequested: '20', applicants: '', note: '' };

  it('accepts a back-dated demand (a desk records what the household actually asked, when they asked)', () => {
    const r = buildDemand(base, '2026-08-06');
    expect(r).toEqual({ ok: true, value: { jobCardId: CARD, demandedOn: '2026-08-01', daysRequested: 20 } });
  });
  it('refuses a future demand — a clock cannot start before the ask', () => {
    expect(buildDemand({ ...base, demandedOn: '2026-08-07' }, '2026-08-06')).toEqual({ ok: false, error: 'future' });
  });
  it('refuses a malformed date, a bad job card id, and days outside the guarantee', () => {
    expect(buildDemand({ ...base, demandedOn: '01-08-2026' }, '2026-08-06')).toEqual({ ok: false, error: 'date' });
    expect(buildDemand({ ...base, jobCardId: 'not-an-id' }, '2026-08-06')).toEqual({ ok: false, error: 'jobCard' });
    expect(buildDemand({ ...base, daysRequested: '0' }, '2026-08-06')).toEqual({ ok: false, error: 'days' });
    expect(buildDemand({ ...base, daysRequested: '101' }, '2026-08-06')).toEqual({ ok: false, error: 'days' });
    // '10.5' must be REFUSED, not truncated to 10 — the operator typed something we cannot faithfully record.
    expect(buildDemand({ ...base, daysRequested: '10.5' }, '2026-08-06')).toEqual({ ok: false, error: 'days' });
    expect(buildDemand({ ...base, daysRequested: ' 20 ' }, '2026-08-06').ok).toBe(true);
    expect(buildDemand({ ...base, applicants: '2.5' }, '2026-08-06')).toEqual({ ok: false, error: 'applicants' });
  });
  it('treats applicants as optional but bounded, and trims a note', () => {
    const ok = buildDemand({ ...base, applicants: '4', note: '  came with the mate  ' }, '2026-08-06');
    expect(ok.ok && ok.value.applicants).toBe(4);
    expect(ok.ok && ok.value.note).toBe('came with the mate');
    expect(buildDemand({ ...base, applicants: '0' }, '2026-08-06')).toEqual({ ok: false, error: 'applicants' });
    expect(buildDemand({ ...base, applicants: '21' }, '2026-08-06')).toEqual({ ok: false, error: 'applicants' });
    const blank = buildDemand({ ...base, applicants: '   ' }, '2026-08-06');
    expect(blank.ok && 'applicants' in blank.value).toBe(false);
  });
});

describe('buildDemandTransition — an allotment must point at real work', () => {
  const WORK = '00000000-0000-7000-8000-0000000000aa';
  it('requires a work id to allot', () => {
    expect(buildDemandTransition({ to: 'allotted', workId: '', allottedOn: '', reason: '' })).toEqual({ ok: false, error: 'workId' });
    expect(buildDemandTransition({ to: 'allotted', workId: WORK, allottedOn: '', reason: '' }))
      .toEqual({ ok: true, value: { to: 'allotted', workId: WORK } });
    expect(buildDemandTransition({ to: 'allotted', workId: WORK, allottedOn: '2026-08-06', reason: '' }))
      .toEqual({ ok: true, value: { to: 'allotted', workId: WORK, allottedOn: '2026-08-06' } });
  });
  it('demands a reason to CLOSE without work, but not to record a household’s own withdrawal', () => {
    expect(buildDemandTransition({ to: 'closed', workId: '', allottedOn: '', reason: '  ' })).toEqual({ ok: false, error: 'reason' });
    expect(buildDemandTransition({ to: 'closed', workId: '', allottedOn: '', reason: 'no sanctioned work in the panchayat' }))
      .toEqual({ ok: true, value: { to: 'closed', reason: 'no sanctioned work in the panchayat' } });
    expect(buildDemandTransition({ to: 'withdrawn', workId: '', allottedOn: '', reason: '' }))
      .toEqual({ ok: true, value: { to: 'withdrawn' } });
  });
  it('refuses an unknown transition', () => {
    expect(buildDemandTransition({ to: 'deleted', workId: '', allottedOn: '', reason: '' })).toEqual({ ok: false, error: 'to' });
  });
});

describe('honest labelling of the state ledger and the 100-day cap', () => {
  it('an unavailable provider NEVER reads as synced', () => {
    expect(ledgerClaim({ available: true })).toBe('synced');
    expect(ledgerClaim({ available: false })).toBe('platform_only');
    expect(ledgerClaim({})).toBe('platform_only');
    expect(ledgerClaim(undefined)).toBe('platform_only');
    expect(ledgerClaim(null)).toBe('platform_only');
  });

  it('the HIGHER count is what the cap uses — never the flattering one', () => {
    expect(capView(30, 45)).toEqual({ usedForCap: 45, remaining: 55, higher: 'state' });
    expect(capView(60, 12)).toEqual({ usedForCap: 60, remaining: 40, higher: 'platform' });
    expect(capView(20, 20)).toEqual({ usedForCap: 20, remaining: 80, higher: 'equal' });
  });
  it('a missing state figure is treated as zero, not as agreement', () => {
    // 18.5 observed → 18 WHOLE days charged against the guarantee (the part day is not charged), so 82 remain.
    // This is the same arithmetic as the API's daysRemaining(), which floors the used days for the worker's benefit.
    expect(capView(18.5, null)).toEqual({ usedForCap: 18.5, remaining: 82, higher: 'platform' });
  });
  it('part days are floored when charged against the guarantee (never rounded up against the worker)', () => {
    expect(capView(99.5, null).remaining).toBe(1);   // 99 whole days used ⇒ 1 left, not 0
    expect(capView(100, null).remaining).toBe(0);
    expect(capView(140, null).remaining).toBe(0);    // never negative
  });

  it('totalWorks sums only what was returned (no invented statuses)', () => {
    expect(totalWorks({ planned: 2, active: 3 })).toBe(5);
    expect(totalWorks({})).toBe(0);
    expect(totalWorks(undefined)).toBe(0);
    expect(totalWorks(null)).toBe(0);
  });
});
