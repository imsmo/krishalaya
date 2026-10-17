// apps/web-storefront/src/test/sweep-facts.spec.ts · PC-56 STORE-SWEEP-a · C1 / C3 (founders D1 / D2 / D3 / D7) — THE FACTS ARE DATA, AND THE PAGES'
// FIGURES CANNOT DRIFT FROM THE CODE THAT RUNS.
//   • factLine: a set value prints, an empty / blank / non-string / a figure that is not a whole number ≥ 1 is "unpublished" (mutant M5b — "" read
//     as set — turns this red); a mailbox is a mailto link only when it is one address;
//   • the grievance block, the five mailboxes and the legal lines read the right fields, in order;
//   • DRIFT: the 24-hour window (order.entity.ts), the 5-minute zero-sum monitor (recon-zero-sum.job.ts) and the 15-minute counts
//     (storefront-public-stats.job.ts) the pages print are read from the source files that run them;
//   • the registries: every refusal has a key in all three catalogues and says no; every quality rule and trust claim has its keys; the 5 canon files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { factLine, grievanceLines, legalLines, mailboxLines, mailtoHref } from '../features/sweep/facts';
import { QUALITY_RULES, QUALITY_WINDOW_HOURS, disputesState, rulesFor } from '../features/sweep/quality-rules';
import { STATS_EVERY_MINUTES, TRUST_CLAIMS, ZERO_SUM_EVERY_MINUTES, refusedClaims, trueClaims } from '../features/sweep/trust-claims';
import { SWEEP_CANON_FILES, SWEEP_DELTAS, SWEEP_REFUSALS, sweepRefusalKeys } from '../features/sweep/refusals';
import { HELP_ENTRIES, helpEntries, moneyCases } from '../features/sweep/help';

const REPO = join(__dirname, '..', '..', '..', '..');
const EMPTY: PlatformFacts = {
  legal: { entityName: null, registeredOffice: null },
  grievance: { officerName: null, address: null, email: null, ackHours: null, resolveDays: null },
  contact: { securityEmail: null, partnersEmail: null, pressEmail: null, generalEmail: null },
};

describe('STORE-SWEEP-a · the facts', () => {
  it('factLine: set → printed (trimmed); empty, blank, null, a non-figure → unpublished', () => {
    expect(factLine('  Registered office, one line ')).toEqual({ kind: 'set', value: 'Registered office, one line' });
    expect(factLine(48)).toEqual({ kind: 'set', value: '48' });
    for (const v of ['', '   ', null, undefined, 0, -3, 1.5, Number.NaN]) expect([v, factLine(v as never)]).toEqual([v, { kind: 'unpublished' }]);
  });
  it('a mailbox is a mailto link only when it is one address', () => {
    expect(mailtoHref(factLine('grievance@example.test'))).toBe('mailto:grievance@example.test');
    expect(mailtoHref(factLine('write to the office'))).toBeNull();
    expect(mailtoHref(factLine(''))).toBeNull();
  });
  it('the grievance block, the five mailboxes and the legal lines: all unpublished when the facts are empty, in order', () => {
    expect(grievanceLines(EMPTY).map((g) => g.id)).toEqual(['officer', 'address', 'email', 'ack', 'resolve']);
    expect(mailboxLines(EMPTY).map((m) => m.id)).toEqual(['general', 'press', 'partners', 'security', 'grievance']);
    expect(legalLines(EMPTY).map((l) => l.id)).toEqual(['entity', 'office']);
    for (const l of [...grievanceLines(EMPTY), ...mailboxLines(EMPTY), ...legalLines(EMPTY)]) expect(l.line.kind).toBe('unpublished');
  });
  it('a set fact reads the RIGHT field (the grievance mailbox appears in both lists; figures only where set)', () => {
    const f: PlatformFacts = { ...EMPTY, grievance: { ...EMPTY.grievance, email: 'grievance@example.test', ackHours: 48 }, contact: { ...EMPTY.contact, pressEmail: 'press@example.test' } };
    expect(grievanceLines(f).find((g) => g.id === 'email')!.line).toEqual({ kind: 'set', value: 'grievance@example.test' });
    expect(grievanceLines(f).find((g) => g.id === 'ack')!.line).toEqual({ kind: 'set', value: '48' });
    expect(grievanceLines(f).find((g) => g.id === 'resolve')!.line.kind).toBe('unpublished');
    expect(mailboxLines(f).filter((m) => m.line.kind === 'set').map((m) => m.id)).toEqual(['press', 'grievance']);
  });
});

describe('STORE-SWEEP-a · the printed figures cannot drift from the code that runs', () => {
  it('the quality window: order.entity.ts QUALITY_WINDOW_MS = 24 h', () => {
    const src = readFileSync(join(REPO, 'apps/api/src/modules/orders/domain/order.entity.ts'), 'utf8');
    const m = src.match(/const QUALITY_WINDOW_MS = (\d+) \* 3600_000;/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(QUALITY_WINDOW_HOURS);
  });
  it('the zero-sum monitor: recon-zero-sum.job.ts intervalSec', () => {
    const src = readFileSync(join(REPO, 'apps/worker/src/jobs/recon-zero-sum.job.ts'), 'utf8');
    const m = src.match(/intervalSec: (\d+),/);
    expect(Number(m![1]) / 60).toBe(ZERO_SUM_EVERY_MINUTES);
  });
  it('the public counts: storefront-public-stats.job.ts STOREFRONT_PUBLIC_STATS_MS', () => {
    const src = readFileSync(join(REPO, 'apps/api/src/core/tenancy-context/storefront-public-stats.job.ts'), 'utf8');
    const m = src.match(/STOREFRONT_PUBLIC_STATS_MS = (\d+) \* 60_000;/);
    expect(Number(m![1])).toBe(STATS_EVERY_MINUTES);
  });
  it('the whole-payment rule: dispute-money-state.ts PARTIAL_FREEZE_BUILT is still false; RESOLUTION_TYPES is still the four the page names', () => {
    expect(readFileSync(join(REPO, 'apps/api/src/modules/disputes/domain/dispute-money-state.ts'), 'utf8')).toMatch(/export const PARTIAL_FREEZE_BUILT = false;/);
    expect(readFileSync(join(REPO, 'apps/api/src/modules/disputes/domain/disputes.events.ts'), 'utf8'))
      .toMatch(/RESOLUTION_TYPES = \['refund_full', 'refund_partial', 'replacement', 'rejected'\] as const;/);
    expect(readFileSync(join(REPO, 'apps/api/src/modules/orders/domain/order-clocks.ts'), 'utf8')).toMatch(/QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT = true;/);
  });
});

describe('STORE-SWEEP-a · the registries', () => {
  const CATS = { en, hi, gu } as Record<string, Record<string, string>>;
  it('every refusal: a unique id, a key in all three catalogues, at least one surface; every English one says no', () => {
    expect(new Set(SWEEP_REFUSALS.map((r) => r.id)).size).toBe(SWEEP_REFUSALS.length);
    for (const r of SWEEP_REFUSALS) {
      expect(r.surfaces.length).toBeGreaterThan(0);
      for (const c of Object.values(CATS)) expect([r.key, typeof c[r.key]]).toEqual([r.key, 'string']);
      expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bnobody\b/i.test(en[r.key])]).toEqual([r.key, true]);
    }
    expect(SWEEP_REFUSALS.length).toBe(57);   // PC-56 STORE-SWEEP-b: + 22 (tracking 11 · language 4 · errors 2 · empty 1 · degraded 4)
    expect(sweepRefusalKeys('help').length).toBe(9);
    expect(sweepRefusalKeys('contact').length).toBe(7);
    expect(sweepRefusalKeys('contact_store').length).toBe(6);
    expect(sweepRefusalKeys('about').length).toBe(4);
    expect(sweepRefusalKeys('quality').length).toBe(10);
    expect(sweepRefusalKeys('trust').length).toBe(9);
  });
  it('the carried ids are kept (1b, 1c, 3a): trace_demo, ussd_voice_languages, partnerships_desk, regrade, partial_refund, escrow_freeze, fee_ladder', () => {
    for (const id of ['trace_demo', 'ussd_voice_languages', 'partnerships_desk', 'regrade', 'partial_refund', 'escrow_freeze', 'fee_ladder']) {
      expect(SWEEP_REFUSALS.map((r) => r.id)).toContain(id);
    }
  });
  it('every quality rule names its mechanism and a key ×3; every refusal it names exists', () => {
    const ids = new Set(SWEEP_REFUSALS.map((r) => r.id));
    for (const q of QUALITY_RULES) {
      expect(q.key).toBe(`sweep.quality.rule.${q.id}`);
      for (const c of Object.values(CATS)) expect(typeof c[q.key]).toBe('string');
      expect(q.evidence.length).toBeGreaterThan(10);
      for (const r of q.refused) expect([q.id, r, ids.has(r)]).toEqual([q.id, r, true]);
    }
    expect(rulesFor('tenant', 'off').some((r) => r.disputes)).toBe(false);
    expect(rulesFor('tenant', 'unknown').some((r) => r.disputes)).toBe(false);
    expect(rulesFor('tenant', 'on').length).toBe(QUALITY_RULES.length);
    expect(rulesFor('platform', 'unknown').length).toBe(QUALITY_RULES.length);
    expect([disputesState(null), disputesState({}), disputesState({ disputes: true })]).toEqual(['unknown', 'off', 'on']);
  });
  it('every TRUE trust claim has its claim + mechanism keys ×3; every refused one points at a refusal on the trust page', () => {
    for (const c of trueClaims()) for (const cat of Object.values(CATS)) { expect(typeof cat[c.key]).toBe('string'); expect(typeof cat[c.mechanismKey]).toBe('string'); }
    for (const id of refusedClaims()) expect(SWEEP_REFUSALS.find((r) => r.id === id)?.surfaces).toContain('trust');
    expect(TRUST_CLAIMS.filter((c) => c.verdict === 'true').length).toBe(8);
  });
  it('the help registry: the money answer per chrome / flag; the platform-only question never under a store', () => {
    expect(moneyCases('platform', { online_payments: false })).toEqual({ cases: ['online', 'on_delivery'], unknown: false });
    expect(moneyCases('tenant', { online_payments: true })).toEqual({ cases: ['online'], unknown: false });
    expect(moneyCases('tenant', { online_payments: false })).toEqual({ cases: ['on_delivery'], unknown: false });
    expect(moneyCases('tenant', {})).toEqual({ cases: ['on_delivery'], unknown: false });
    expect(moneyCases('tenant', null)).toEqual({ cases: ['online', 'on_delivery'], unknown: true });
    expect(helpEntries('tenant').some((e) => e.platformOnly)).toBe(false);
    expect(helpEntries('platform').length).toBe(HELP_ENTRIES.length);
  });
  it('the 5 SWEEP-a canon files (SW-b appends its 5) and the DELTAs', () => {
    // PC-56 STORE-SWEEP-b appended its 5 (the panel's last ten)
    expect(SWEEP_CANON_FILES.map((f) => f.file)).toEqual(['W308-store-about.html', 'W309-store-quality-promise.html', 'W310-store-trust-data.html', 'W311-store-help-center.html', 'W312-store-contact.html',
      'W292-store-tracking.html', 'W316-store-error-canon.html', 'W317-store-empty-canon.html', 'W320-store-degraded-service.html', 'W323-store-language.html']);
    expect(SWEEP_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['quality_route', 'trust_route', 'help_language_link', 'chrome_split']));
  });
});
