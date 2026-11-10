// apps/web-ops/src/test-render/insights.render.test.tsx · PC-56 OPS-5b · W369 — the organisation's milk, in numbers: every verdict kind the read
// returns, as the server words it; Q2-A and Q4-A EXACT (Q4 on every pour group, the scope on every other group); the payout refusal in words;
// money through formatMoneyMinor in the read's OWN currency (a JPY fixture: never an 'INR' fallback); kg by moving the decimal point; NO "%",
// "streak", "target", "nightly", no "of N" count, no card name (person-shaped fixture), no member; each state (ok, empty, not enough history,
// unavailable, switched off ×2, refused, error → its Retry is the re-read chain).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { InsightsView } from '../components/ops5/InsightsViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { CARD_NAME, NOT_ENABLED, NO_DATA, READY, READY_OTHER, READY_THIRD, SHORT, UNAVAILABLE } from './ops5b-fixtures';

const KEY = '0192d2c4-4e70-7000-8000-0000000000b5';
const act = async () => undefined;
type P = Partial<React.ComponentProps<typeof InsightsView>>;
const page = (over: P = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <InsightsView t={tr(cat)} lang="en" w={90} state="ok" data={READY} idemKey={KEY} exportAction={act} exportError={null} {...over} />);
const Q2 = 'This page shows the whole organisation\'s totals. It names no member and ranks no one.';
const Q4 = 'These figures are for the whole organisation, from every centre\'s recorded pours. Figures for one centre are not computed yet.';
const FORBIDDEN_WORDS = /%|streak|target|nightly|as-of|stamped|leaderboard of neighbours|centre manager/i;
const ALL = [page(), page({ data: READY_OTHER }), page({ data: READY_THIRD }), page({ data: NO_DATA }), page({ data: SHORT }), page({ data: UNAVAILABLE }), page({ data: NOT_ENABLED }),
  page({ state: 'off', data: null }), page({ state: 'forbidden', data: null }), page({ state: 'error', data: null })];

describe('PC-56 OPS-5b · insights (W369)', () => {
  const h = page();
  it('Q2-A and Q4-A EXACT; Q4 on every pour group and the scope on every other group; signed in as you', () => {
    expect(text(h)).toContain(Q2);
    expect((text(h).split(Q4).length - 1)).toBe(6);
    const groups = Array.from(h.matchAll(/data-kv-group="([a-z]+)"/g)).map((m) => m[1]);
    expect(groups).toEqual(['volume', 'rate', 'pourers', 'cycles', 'shifts', 'premium', 'bonus', 'cards', 'spoilage']);
    expect((h.match(/data-kv-scope="organisation"/g) ?? []).length).toBe(9);
    expect((h.match(/data-kv-scope-pours="no"/g) ?? []).length).toBe(3);   // cycles, cards, spoilage — not pours, so not "from … pours"
    expect(text(h)).toContain(en['ops5.ins.scopeOrganisation']);
    expect(text(h)).toContain('Signed in as you.');
    for (const cat of [hi, gu]) { const x = text(page({}, cat)); expect(x).toContain(cat['ops5.ins.q2']); expect(x).toContain(cat['ops5.ins.q4']); }
  });
  it('every figure as the server words it: kg by the decimal point, the rate and the bonus through formatMoneyMinor in the read\'s currency', () => {
    expect(text(h)).toContain('1234.567 kg'); expect(text(h)).toContain('111111.030 kg'); expect(text(h)).toContain('was 1141.851 kg');
    expect(text(h)).toContain('87 days with pours, in a window of 90 days');
    expect(text(h)).toContain(formatMoneyMinor('4712', 'INR', 'en')); expect(text(h)).toContain(`was ${formatMoneyMinor('4749', 'INR', 'en')}`);
    expect(text(h)).toContain(formatMoneyMinor('1987650', 'INR', 'en'));
    expect(h).toContain('data-kv-fact="active"'); expect(text(h)).toMatch(/Poured in the window 171/); expect(text(h)).toMatch(/New 13/); expect(text(h)).toMatch(/Came back 3/); expect(text(h)).toMatch(/Kept pouring 155/);
    expect(text(h)).toContain('was 166');
    expect(text(h)).toContain('57 pourers were paid a bonus for reaching a slab on the cards in force; 171 poured in the window.');
    expect(text(h)).toContain(en['ops5.ins.premium.prev.basis_unknown']);
    expect(text(h)).toContain(en['ops5.ins.bonus.slabsOn']);
    expect(h).toContain('data-kv-buckets="2"'); expect(text(h)).toContain('2026-08-13 to 2026-08-18'); expect(text(h)).toContain('4100.000 kg'); expect(text(h)).toContain('7120.500 kg');
    expect(text(h)).toContain('Buffalo · cards in force: 2 · from 2026-10-01 · from 2026-07-01 · more than one card is in force');
    expect(text(h)).toContain('Cow · cards in force: 1 · from 2026-09-01');
    expect(text(h)).toContain('From 2026-08-13 to 2026-11-10 (90 days). Compared with 2026-05-15 to 2026-08-12. The window ends today, a day still in progress.');
  });
  it('the payout figure is the server\'s refusal, in words, with its two facts; spoilage is refused in words', () => {
    expect(text(h)).toContain('This platform does not record the day a payment arrived, so it cannot say whether money was paid on time.');
    expect(h).toContain('data-kv-payout="not_recorded"');
    expect(text(h)).toMatch(/Cycles closed in the window 6/); expect(text(h)).toMatch(/Closed with every bill approved 5/);
    expect(text(h)).toContain(en['ops5.ins.spoilage.refused']);
    for (const col of ['paid_at', 'settled_at']) expect(h).not.toContain(col);
  });
  it('the other verdict kinds: from_zero, both_zero, no_previous, no_pours, inconsistent, no_pourers, would_qualify, no_slabs, slabs off; a JPY read is JPY (never an INR fallback)', () => {
    const o = page({ data: READY_OTHER }); const th = page({ data: READY_THIRD });
    expect(text(o)).toContain('nothing in the previous window'); expect(text(o)).toContain(en['ops5.ins.rate.noPours']);
    expect(o).toContain('data-kv-pourers="inconsistent"'); expect(text(o)).toContain(en['ops5.ins.pourers.inconsistent']);
    expect(text(o)).toContain('9 pourers had a pour that reaches the lowest fat slab on the cards in force; 40 poured in the window.');
    expect(text(o)).toContain(en['ops5.ins.premium.prev.no_slabs']); expect(text(o)).toContain(en['ops5.ins.bonus.slabsOff']); expect(text(o)).toContain(en['ops5.ins.cards.none']);
    expect(text(o)).toContain(formatMoneyMinor('0', 'JPY', 'en')); expect(o).toContain('data-kv-money="JPY"'); expect(o).not.toContain('data-kv-money="INR"'); expect(text(o)).not.toContain('₹');
    expect(text(th)).toContain('nothing in either window'); expect(text(th)).toContain('no previous window was read');
    expect(text(th)).toContain(en['ops5.ins.pourers.none']); expect(text(th)).toContain(en['ops5.ins.premium.no_slabs']);
    expect(text(th)).toContain('Previous window: 2 pourers reached the lowest fat slab; 11 poured; no bonus was paid then.'); expect(text(th)).toContain(en['ops5.ins.shifts.none']);
  });
  it('NO %, streak, target, nightly, stamp, rank or role anywhere on the page (refusals included); no "of N" count; no card name; no member', () => {
    for (const x of ALL) {
      expect(FORBIDDEN_WORDS.test(text(x))).toBe(false);
      expect(/\b\d+ of \d+\b|\bof \d+ (members?|pourers?)\b/i.test(text(x))).toBe(false);
      expect(x).not.toContain(CARD_NAME);
      expect(/membership|member code|#\d{3,}/i.test(visible(x))).toBe(false);
    }
    for (const cat of [hi, gu]) for (const d of [READY, READY_OTHER]) expect(/%/.test(text(page({ data: d }, cat)))).toBe(false);
  });
  it('the window filter: three links (GET), the one in force marked; the export form keyed with the window on screen', () => {
    expect((h.match(/data-kv-window="/g) ?? []).length).toBe(3);
    expect(h).toContain('href="/insights?window=30"'); expect(h).toContain('href="/insights?window=180"');
    expect(h).toMatch(/aria-current="page" data-kv-window="90"/);
    expect(h).toContain('name="window" value="90"'); expect(h).toContain(`name="key" value="${KEY}"`);
    expect(text(h)).toContain(en['ops5.ins.export.statement']);
    expect(text(page({ exportError: 'off' }))).toContain(en['ops5.ins.export.error.off']);
    expect(text(page({ exportError: 'forbidden' }))).toContain(en['ops5.ins.export.error.forbidden']);
  });
  it('each state: empty, not enough history, unavailable, switched off (dairy, insights), refused, error — and error\'s Retry is the re-read chain', () => {
    const states = ALL.map((x) => /data-kv-state="([a-z_]+)"/.exec(x)?.[1]);
    expect(states).toEqual(['ready', 'ready', 'ready', 'no_data', 'not_enough_history', 'unavailable', 'not_enabled', 'off', 'forbidden', 'error']);
    expect(text(page({ data: NO_DATA }))).toContain('No pour is recorded from 2025-08-13 to 2026-11-10.');
    expect(text(page({ data: SHORT }))).toContain('The pours recorded so far cover 12 days; these figures need 30 days — two full payment cycles.');
    expect(text(page({ data: SHORT }))).toContain('Pourers in this window so far: 19.');
    expect(text(page({ data: SHORT }))).toContain(Q4);
    expect(text(page({ data: UNAVAILABLE }))).toContain(en['ops5.ins.unavailable']);
    expect(text(page({ data: NOT_ENABLED }))).toContain(en['ops5.ins.off.insights']); expect(page({ data: NOT_ENABLED })).not.toContain('name="key"');
    expect(text(page({ state: 'off', data: null }))).toContain(en['ops5.ins.off.dairy']);
    expect(text(page({ state: 'forbidden', data: null }))).toContain(en['ops5.ins.forbidden.body']);
    const err = page({ state: 'error', data: null });
    expect(err).toContain('data-kv-chain-link="retry" href="/insights?act=confirm&amp;window=90"');
    for (const x of ALL) { expect(text(x)).toContain(Q2); expect(x).toContain('data-kv-refused="insights"'); }
  });
  it('the refusals BY NAME (each once): schedule, centre, member total, reasons, shares, quality, watch, payout speed, cooler, goals, leaderboard, search', () => {
    for (const id of ['ins_chrome', 'centre_figures', 'compute_schedule', 'member_total', 'quiet_reasons', 'no_shares', 'quality_figures', 'member_watch', 'payout_timing',
      'cooler_dispatch', 'goals', 'leaderboard', 'search']) expect([id, (h.match(new RegExp(`data-kv-refusal="${id}"`, 'g')) ?? []).length]).toEqual([id, 1]);
  });
});
