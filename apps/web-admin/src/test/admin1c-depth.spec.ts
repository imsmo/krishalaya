// apps/web-admin/src/test/admin1c-depth.spec.ts · PC-56 ADMIN-1c console gates.
// Subscription writes (what the next invoice will say), the plan-version diff (a price list before it is published),
// the tenant tab strip, and the invoice-list chips. The recurring question: does the screen ever state something the
// platform does not actually know?
import {
  BILLING_CYCLES, canChangeSubscription, changeBlockedReason, buildPlanChange, buildAddon, cancelToggleAction,
  hasPdfLink, humanBytes,
} from '../features/billing/subscription-write';
import {
  previousVersion, fieldChanges, featureDelta, limitChanges, diffAgainstPrevious, isRegressive, type VersionRow,
} from '../features/plans/version-diff';
import { TENANT_TABS, tenantTabs, isTenantTab, activeTab, unscopedTabs } from '../features/tenants/tabs';
import { invoiceChipCounts, invoiceTotalCount, invoiceSavedViews, invoiceListHref } from '../features/billing/billing';

const PLAN_A = '018f0000-0000-7000-8000-00000000000a';
const PLAN_B = '018f0000-0000-7000-8000-00000000000b';
const toMinor = (major: string): string | undefined => {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(major.trim());
  if (!m) return undefined;
  return String(BigInt(m[1]) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0')));
};

// ---------------------------------------------------------------- subscription writes

describe('subscription writes — the console never commits the platform to an unstated price', () => {
  it('offers the controls only while the subscription can change, and names the reason otherwise', () => {
    for (const s of ['trialing', 'active', 'past_due', 'paused']) expect(canChangeSubscription(s)).toBe(true);
    for (const s of ['cancelled', 'expired', '', null]) expect(canChangeSubscription(s)).toBe(false);
    expect(changeBlockedReason('active', true)).toBe('none');
    expect(changeBlockedReason('cancelled', true)).toBe('finished');
    expect(changeBlockedReason(null, false)).toBe('no_subscription');
    expect([...BILLING_CYCLES]).toEqual(['monthly', 'annual']);
  });

  const plan = { planId: PLAN_B, priceMajor: '4990', billingCycle: 'monthly', reason: 'upgrade agreed on call' };

  it('requires an explicit price and keeps it integer minor units', () => {
    expect(buildPlanChange(plan, PLAN_A, toMinor)).toEqual({
      ok: true,
      value: { planId: PLAN_B, priceMinor: '499000', billingCycle: 'monthly', immediate: false, reason: 'upgrade agreed on call' },
    });
    expect(buildPlanChange({ ...plan, priceMajor: '4990.50' }, PLAN_A, toMinor)).toEqual({
      ok: true,
      value: { planId: PLAN_B, priceMinor: '499050', billingCycle: 'monthly', immediate: false, reason: 'upgrade agreed on call' },
    });
    // zero is refused: a free period is a DISCOUNT on a real price, so the platform still knows what happens after
    for (const bad of ['0', '0.00', '', 'free', '-10']) {
      expect(buildPlanChange({ ...plan, priceMajor: bad }, PLAN_A, toMinor)).toEqual({ ok: false, error: 'price' });
    }
  });

  it('refuses a no-op change before the operator types anything else', () => {
    expect(buildPlanChange(plan, PLAN_B, toMinor)).toEqual({ ok: false, error: 'samePlan' });
    expect(buildPlanChange({ ...plan, planId: 'not-a-uuid' }, PLAN_A, toMinor)).toEqual({ ok: false, error: 'plan' });
    expect(buildPlanChange({ ...plan, billingCycle: 'weekly' }, PLAN_A, toMinor)).toEqual({ ok: false, error: 'cycle' });
    expect(buildPlanChange({ ...plan, reason: 'no' }, PLAN_A, toMinor)).toEqual({ ok: false, error: 'reason' });
  });

  it('validates the discount and only sends it when stated', () => {
    const withDiscount = buildPlanChange({ ...plan, discountPct: '12.5' }, PLAN_A, toMinor);
    expect(withDiscount.ok && withDiscount.value.discountPct).toBe('12.5');
    expect(buildPlanChange({ ...plan, discountPct: '120' }, PLAN_A, toMinor)).toEqual({ ok: false, error: 'discount' });
    expect(buildPlanChange({ ...plan, discountPct: 'half' }, PLAN_A, toMinor)).toEqual({ ok: false, error: 'discount' });
    // absent means "leave the negotiated discount alone" — the server COALESCEs, so the key must not be sent as null
    const none = buildPlanChange(plan, PLAN_A, toMinor);
    expect(none.ok && 'discountPct' in none.value).toBe(false);
  });

  it('carries `immediate` explicitly, because it decides whether the CURRENT period is touched', () => {
    const now = buildPlanChange({ ...plan, immediate: true }, PLAN_A, toMinor);
    expect(now.ok && now.value.immediate).toBe(true);
  });

  const addon = { addonCode: 'extra_language', quantity: '2', priceMajor: '990', startsOn: '2026-09-01', reason: 'agreed with CSM' };

  it('ALLOWS a zero-priced add-on (a goodwill gesture) but not a broken date order', () => {
    const free = buildAddon({ ...addon, priceMajor: '0' }, toMinor);
    expect(free.ok && free.value.priceMinor).toBe('0');
    expect(buildAddon({ ...addon, endsOn: '2026-12-31' }, toMinor).ok).toBe(true);
    expect(buildAddon({ ...addon, endsOn: '2026-08-01' }, toMinor)).toEqual({ ok: false, error: 'order' });
    expect(buildAddon({ ...addon, endsOn: '2026-09-01' }, toMinor)).toEqual({ ok: false, error: 'order' });
    expect(buildAddon({ ...addon, startsOn: '01/09/2026' }, toMinor)).toEqual({ ok: false, error: 'startsOn' });
  });

  it('defaults a blank quantity to 1 and refuses nonsense', () => {
    const one = buildAddon({ ...addon, quantity: '' }, toMinor);
    expect(one.ok && one.value.quantity).toBe(1);
    for (const q of ['0', '-2', '1.5', '20000']) {
      expect(buildAddon({ ...addon, quantity: q }, toMinor)).toEqual({ ok: false, error: 'quantity' });
    }
  });

  it('offers REVOKE when a cancellation is already scheduled — a change of mind is not a new subscription', () => {
    expect(cancelToggleAction(false)).toBe('schedule');
    expect(cancelToggleAction(null)).toBe('schedule');
    expect(cancelToggleAction(true)).toBe('revoke');
  });
});

// ---------------------------------------------------------------- invoice PDF link

describe('invoice PDF — a blank link is no link', () => {
  it('treats an empty url as unavailable rather than rendering an anchor to nowhere', () => {
    expect(hasPdfLink({ url: 'https://example.test/x' })).toBe(true);
    expect(hasPdfLink({ url: '  ' })).toBe(false);
    expect(hasPdfLink({})).toBe(false);
    expect(hasPdfLink(null)).toBe(false);
  });

  it('shows a size only when it is real — "0 KB" beside a document reads as broken', () => {
    expect(humanBytes('512')).toBe('512 B');
    expect(humanBytes('2048')).toBe('2.0 KB');
    expect(humanBytes('1572864')).toBe('1.5 MB');
    expect(humanBytes('0')).toBeNull();
    expect(humanBytes('')).toBeNull();
    expect(humanBytes('lots')).toBeNull();
  });
});

// ---------------------------------------------------------------- plan version diff

describe('plan version diff — a price list, shown before it is published', () => {
  const v = (over: Partial<VersionRow> = {}): VersionRow => ({
    id: 'p1', code: 'growth', version: 5, defaultName: 'Growth', currency: 'INR',
    monthlyPriceMinor: '499000', annualPriceMinor: '4990000', setupFeeMinor: '0', isPublic: true,
    features: [{ code: 'whatsapp', isIncluded: true }, { code: 'auctions', isIncluded: false }],
    limits: { farmers: '1000', listings: '500' }, ...over,
  });

  it('resolves the previous version by highest-below, not by version minus one', () => {
    const all = [v({ id: 'p1', version: 5 }), v({ id: 'p0', version: 2 }), v({ id: 'px', version: 9 }), { ...v(), id: 'other', code: 'starter', version: 4 }];
    expect(previousVersion(v({ id: 'p1', version: 5 }), all)?.version).toBe(2);   // v3/v4 never existed
    expect(previousVersion(v({ id: 'first', version: 1 }), all)).toBeNull();
  });

  it('reports money and flag changes without computing anything about them', () => {
    const changes = fieldChanges(v(), v({ monthlyPriceMinor: '599000', isPublic: false }));
    expect(changes).toEqual([
      { field: 'monthlyPriceMinor', from: '499000', to: '599000' },
      { field: 'isPublic', from: 'true', to: 'false' },
    ]);
    // an absent price is null, never "0" — an absent price must not read as free
    expect(fieldChanges(v(), v({ annualPriceMinor: null }))).toEqual([{ field: 'annualPriceMinor', from: '4990000', to: null }]);
    expect(fieldChanges(v(), v({ currency: 'USD' }))).toEqual([{ field: 'currency', from: 'INR', to: 'USD' }]);
  });

  it('splits feature changes four ways, because taking something away is not the same as adding', () => {
    const after = v({
      features: [
        { code: 'whatsapp', isIncluded: false },   // switched OFF — the support-ticket case
        { code: 'auctions', isIncluded: true },    // switched ON
        { code: 'iot', isIncluded: true },         // new
      ],
    });
    expect(featureDelta(v(), after)).toEqual({ added: ['iot'], removed: [], included: ['auctions'], excluded: ['whatsapp'] });
    const dropped = v({ features: [{ code: 'whatsapp', isIncluded: true }] });
    expect(featureDelta(v(), dropped).removed).toEqual(['auctions']);
  });

  it('reports a vanished limit as null — not unlimited, not zero', () => {
    expect(limitChanges(v(), v({ limits: { farmers: '2000' } })))
      .toEqual([{ code: 'farmers', from: '1000', to: '2000' }, { code: 'listings', from: '500', to: null }]);
  });

  it('says "nothing changed" only when there is something to compare against', () => {
    const all = [v({ id: 'p0', version: 4 })];
    const same = diffAgainstPrevious(v({ id: 'p1', version: 5 }), [{ ...v({ version: 4 }), id: 'p0' }]);
    expect(same.identical).toBe(true);                        // publishing an identical version is usually a mistake
    const first = diffAgainstPrevious(v({ version: 1, id: 'only' }), []);
    expect(first.previous).toBeNull();
    expect(first.identical).toBe(false);                      // "nothing to compare" ≠ "nothing changed"
    void all;
  });

  it('flags a REGRESSIVE change — the one that quietly takes something away', () => {
    const priceRise = diffAgainstPrevious(v({ id: 'p1', version: 5, monthlyPriceMinor: '599000' }), [{ ...v({ version: 4 }), id: 'p0' }]);
    expect(isRegressive(priceRise)).toBe(false);              // a price rise is a deliberate commercial decision
    const featureOff = diffAgainstPrevious(
      v({ id: 'p1', version: 5, features: [{ code: 'whatsapp', isIncluded: false }, { code: 'auctions', isIncluded: false }] }),
      [{ ...v({ version: 4 }), id: 'p0' }],
    );
    expect(isRegressive(featureOff)).toBe(true);
    const limitCut = diffAgainstPrevious(v({ id: 'p1', version: 5, limits: { farmers: '500', listings: '500' } }), [{ ...v({ version: 4 }), id: 'p0' }]);
    expect(isRegressive(limitCut)).toBe(true);
  });
});

// ---------------------------------------------------------------- tenant tabs + invoice chips

describe('tenant tabs — deep links, and honest about which ones narrow to this tenant', () => {
  const ID = '018f0000-0000-7000-8000-000000000001';

  it('offers the canon\'s five concerns plus the profile itself', () => {
    expect([...TENANT_TABS]).toEqual(['profile', 'billing', 'subscription', 'flags', 'integrations', 'audit']);
    const tabs = tenantTabs(ID);
    expect(tabs.find((t) => t.key === 'billing')?.href).toBe(`/billing/invoices?tenantId=${ID}`);
    expect(tabs.find((t) => t.key === 'audit')?.href).toBe(`/compliance/audit?entityType=tenant&entityId=${ID}`);
    expect(isTenantTab('subscription')).toBe(true);
    expect(isTenantTab('modules')).toBe(false);
  });

  it('MARKS the tabs that cannot be filtered to this tenant', () => {
    // a global kill-switch shown under one tenant's name would be read as that tenant's setting
    expect(unscopedTabs(ID)).toEqual(['flags', 'integrations']);
    expect(tenantTabs(ID).filter((t) => t.scoped).map((t) => t.key)).toEqual(['profile', 'billing', 'subscription', 'audit']);
  });

  it('resolves the active tab by longest match', () => {
    expect(activeTab(`/tenants/${ID}`, ID)).toBe('profile');
    expect(activeTab(`/tenants/${ID}/subscription`, ID)).toBe('subscription');
    expect(activeTab('/billing/invoices', ID)).toBe('billing');
    expect(activeTab('/compliance/audit', ID)).toBe('audit');
    expect(activeTab('/flags', ID)).toBe('flags');
  });
});

describe('invoice chips — a count we do not have is not zero', () => {
  it('returns undefined for a status the rollup did not mention', () => {
    const chips = invoiceChipCounts({ issued: 204, paid: 1034 });
    expect(chips.find((c) => c.status === 'issued')?.n).toBe(204);
    expect(chips.find((c) => c.status === 'overdue')?.n).toBeUndefined();
    expect(invoiceChipCounts(null).every((c) => c.n === undefined)).toBe(true);
    expect(invoiceTotalCount({ issued: 204, paid: 1034 })).toBe(1238);
    expect(invoiceTotalCount(null)).toBeUndefined();
    expect(invoiceTotalCount({})).toBeUndefined();
  });

  it('points "needs chasing" at the collection queue instead of faking a due-date filter', () => {
    // the invoice list has no due-date param; the queue answers the question properly
    expect(invoiceSavedViews().find((v) => v.key === 'needs_chasing')?.href).toBe('/billing/dunning');
  });

  it('keeps every filter in the list URL', () => {
    expect(invoiceListHref({ status: 'overdue', tenantId: 't1', cursor: 'c' })).toBe('/billing/invoices?status=overdue&tenantId=t1&cursor=c');
    expect(invoiceListHref({})).toBe('/billing/invoices');
  });
});
