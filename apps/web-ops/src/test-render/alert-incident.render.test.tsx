// apps/web-ops/src/test-render/alert-incident.render.test.tsx · PC-56 OPS-5a · W403 — one breach: its subject by the server's short reference, band,
// peak, the server's timeline with times, duration, the alert's state and how many were told, which acts are recorded and when — NEVER the action
// note, the outcome reason or the buyer's reason (each fixture names a person); the outcome and the buyer's decision in words; a recorded loss
// through formatMoneyMinor in the ROW's own currency; "breach" kept; Q1-A's sentence EXACT in three languages; no act button, no input.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { AlertIncidentView } from '../components/ops5/AlertViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed } from './ops4a-fixtures';
import { BREACH, BREACH_1, BREACH_OPEN, BREACH_USD, FALSE_5A, PERSON } from './ops5a-fixtures';

const page = (over: Partial<React.ComponentProps<typeof AlertIncidentView>> = {}, cat: Record<string, string> = en, lang = 'en') => renderToStaticMarkup(
  <AlertIncidentView t={tr(cat)} lang={lang} state="ok" id={BREACH_1} breach={BREACH} {...over} />);
const Q1 = 'Acknowledging a breach, recording what was done and recording its outcome — including any loss — are done on the organisation\'s cold-chain console, not here.';

describe('PC-56 OPS-5a · alert-incident (W403)', () => {
  const h = page();
  it('Q1-A\'s sentence EXACT, in every language; no act: no form, button, input', () => {
    expect(text(h)).toContain(Q1);
    for (const cat of [hi, gu]) expect(text(page({}, cat))).toContain(cat['ops5.q1.words']);
    expect(/<form|<button|<input|<select|<textarea/.test(h)).toBe(false);
  });
  it('the breach\'s facts: subject and short reference, band, peak, logger, duration from the server\'s seconds, who was told', () => {
    expect(text(h)).toContain('Coolers · reference 0192D2C4');
    expect(text(h)).toContain('2.00 °C to 6.00 °C');
    expect(text(h)).toContain('9.80 °C, above the band · 5 readings outside it');
    expect(text(h)).toContain('Logger LOG-TEST-1');
    expect(text(h)).toContain('12 min 34 s, from the first reading outside the band to the reading back inside it');
    expect(text(h)).toContain('2 people were told when it opened');
    expect(text(h)).toContain(en['ops4.iot.breachRule']);
  });
  it('the server\'s timeline, in order, with times', () => {
    const steps = (h.match(/data-kv-step="(\w+)"/g) ?? []).map((s) => s.replace(/data-kv-step="|"/g, ''));
    expect(steps).toEqual(['firstOut', 'opened', 'acknowledged', 'backInRange', 'action', 'buyerOffered', 'buyerDecided', 'outcome']);   // in time order
    expect(text(h)).toContain('first reading outside the band 2026-11-09 23:58 UTC');
    expect(text(h)).toContain('back inside the band 2026-11-10 00:10 UTC');
  });
  it('E15: which acts are recorded and WHEN — never the action note, the outcome reason or the buyer\'s reason; no buyer named', () => {
    expect(text(h)).toContain('Acknowledged 2026-11-10 00:07 UTC.');
    expect(text(h)).toContain('What was done was recorded 2026-11-10 00:20 UTC, with a note that is not shown on this console.');
    expect(text(h)).toContain('Outcome: a loss recorded, recorded 2026-11-10 01:00 UTC. A reason is recorded with it and is not shown on this console.');
    expect(text(h)).toContain('The buyer decided: accept after a test, 2026-11-10 00:40 UTC. Any reason they gave is not shown here.');
    expect(h).not.toContain(PERSON);
    expect(h).toContain('data-kv-note="exists"'); expect(h).toContain('data-kv-reason="exists"'); expect(h).toContain('data-kv-buyer-reason="exists"');
  });
  it('a recorded loss is the server\'s amount through formatMoneyMinor in the ROW\'s own currency (never a default)', () => {
    expect(text(h)).toContain(`Loss recorded by the organisation: ${formatMoneyMinor('125050', 'INR', 'en')}.`);
    const usd = page({ breach: BREACH_USD });
    expect(text(usd)).toContain(formatMoneyMinor('125050', 'USD', 'en'));
    expect(text(usd)).not.toContain(formatMoneyMinor('125050', 'INR', 'en'));
    expect(page({ breach: { ...BREACH, loss: { minor: '12.5', currency: 'INR' } } })).toContain('data-kv-loss="unreadable"');
    expect(text(page({}, hi, 'hi'))).toContain(formatMoneyMinor('125050', 'INR', 'hi'));
  });
  it('an open breach nobody was told about: still open, "no one was told", nothing recorded, no buyer offer', () => {
    const o = page({ breach: BREACH_OPEN });
    expect(text(o)).toContain('still open: no reading back inside the band yet');
    expect(text(o)).toContain('No one was told: no active breach rule named anyone, and there was no driver to tell.');
    expect(text(o)).toContain('Not acknowledged yet.'); expect(text(o)).toContain('No outcome is recorded yet.'); expect(text(o)).toContain('No choice was offered to a buyer.');
    expect(o).not.toContain('data-kv-loss');
  });
  it('the word "breach" is kept; no cause, door, bump, closure by a person or tolerance claim; refused by name', () => {
    expect(text(h)).toMatch(/breach/i);
    expect(FALSE_5A.test(affirmed(visible(h)))).toBe(false);
    for (const id of ['buyer_name', 'cause', 'door', 'trail_attached', 'bump_not_breach', 'closed_by_person', 'tolerance', 'cause_blocks']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(/ops5\./.test(text(h))).toBe(false);
  });
  it('the states and the links: Back to the alert rules (canon); Retry re-reads THIS breach (its chain); not found; off; error', () => {
    expect(h).toContain('data-kv-edge="W402" href="/iot/alert-rules"');
    expect(h).toContain(`href="/iot/alert-incident?id=${BREACH_1}&amp;act=confirm"`);
    expect(text(page({ state: 'notFound', breach: null }))).toContain('No breach with that reference exists in this organisation.');
    expect(text(page({ state: 'notFound', id: null, breach: null }))).toContain('No such breach');
    expect(page({ state: 'off', breach: null })).toContain('data-kv-off="logistics"');
    expect(page({ state: 'error', breach: null })).toContain(`data-kv-chain-link="retry" href="/iot/alert-incident?id=${BREACH_1}&amp;act=confirm"`);
  });
});
