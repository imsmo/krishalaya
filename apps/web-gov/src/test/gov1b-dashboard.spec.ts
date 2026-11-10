// apps/web-gov/src/test/gov1b-dashboard.spec.ts · PC-56 GOV-1b — the dashboard's pure pieces (features/gov1/dashboard.ts): the page's state
// from the overview read (ok / no scheme / switched off / refused / error), which chain a query opens, the status words — and that it holds
// the API's eight counted statuses in the API's order (drafts are never counted).
import type { GovOverview } from '@krishalaya/sdk-js';
import { DASH_STATUSES, dashChain, dashState, statusKey } from '../features/gov1/dashboard';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const o = (count: number): GovOverview => ({ window: { kind: 'all_time', draftsCounted: false }, computedAt: '2026-11-10T00:00:00.000Z', schemes: { count },
  byScheme: [], totals: { total: 0, byStatus: {} as GovOverview['totals']['byStatus'] }, queues: [] });

describe('PC-56 GOV-1b · the dashboard (pure)', () => {
  it('the state: 404 → off, 403 → forbidden, any other failure → error; an answer → ok, or no_scheme when the authority runs none', () => {
    expect(dashState(null, 404)).toBe('off'); expect(dashState(null, 403)).toBe('forbidden');
    expect(dashState(null, 500)).toBe('error'); expect(dashState(null, 401)).toBe('error'); expect(dashState(null, null)).toBe('error');
    expect(dashState(o(2), null)).toBe('ok'); expect(dashState(o(0), null)).toBe('no_scheme');
  });
  it('the chains: ?do=define → the DECOR form chain; ?do=reread → the re-read; nothing else opens one', () => {
    expect(dashChain({ do: 'define', act: 'review' })).toBe('dashboard_form'); expect(dashChain({ do: ['reread'] })).toBe('dashboard_reread');
    expect(dashChain({ act: 'confirm' })).toBeNull(); expect(dashChain(undefined)).toBeNull(); expect(dashChain({ do: 'approve' })).toBeNull();
  });
  it('the eight counted statuses (never draft), each with words in en/hi/gu; an unknown status prints a dash', () => {
    expect([...DASH_STATUSES]).toEqual(['submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed']);
    for (const cat of [en, hi, gu]) for (const st of DASH_STATUSES) expect([st, typeof cat[statusKey(st)]]).toEqual([st, 'string']);
    expect(statusKey('draft')).toBe('common.dash'); expect(statusKey('x')).toBe('common.dash');
  });
});
