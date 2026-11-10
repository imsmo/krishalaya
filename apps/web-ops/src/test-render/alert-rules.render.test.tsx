// apps/web-ops/src/test-render/alert-rules.render.test.tsx · PC-56 OPS-5a · W402 — the alert rules: each rule as it is (kind and threshold in words,
// HOW MANY people it names — never who, cooldown, on or paused, last evaluated, its last recorded change: when and whether by you), its open proposal
// (fields and direction, when, by you or another — never the reason), what each rule sent (when, how many told, acknowledged or not), the breach
// alerts linked to W403; Q3-A's sentence EXACT; the "no breach rule" sentence when true; no escalation, maker-checker, phone or versions claim.
// A paused rule prints "Paused". The rule's NAME is the one free text printed (name-shaped fixture, said so).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertRulesView } from '../components/ops5/AlertViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed } from './ops4a-fixtures';
import { BREACH_1, CHANGE_1, FALSE_5A, FIRED, P1, P2, P3, PERSON, R_BREACH, R_SILENT, RULES, RULES_MINE, RULE_NAME } from './ops5a-fixtures';

const page = (over: Partial<React.ComponentProps<typeof AlertRulesView>> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <AlertRulesView t={tr(cat)} state="ok" rules={RULES} fired={FIRED} {...over} />);
const Q3 = 'A change that could make an alert quieter — pausing a rule, removing a person, or raising a threshold — takes effect only when a second person confirms it. Until then the current rule keeps alerting. Every change is recorded with who made it and why.';

describe('PC-56 OPS-5a · alert-rules (W402)', () => {
  const h = page();
  it('Q3-A\'s sentence EXACT; the quiet-hours and who-is-told facts; signed in as you', () => {
    expect(text(h)).toContain(Q3);
    expect(text(h)).toContain(en['ops5.alerts.quietHoursNotice']);
    expect(text(h)).toContain(en['ops5.alerts.rulesTellBreach']);
    expect(text(h)).toContain('Signed in as you.');
    for (const cat of [hi, gu]) expect(text(page({}, cat))).toContain(cat['ops5.alerts.secondPersonNotice']);
  });
  it('each rule as it is: kind and threshold in words, people as a COUNT, cooldown, on or paused, last evaluated, last change', () => {
    expect((h.match(/data-kv-rule="/g) ?? []).length).toBe(2);
    expect(text(h)).toContain('when 3 or more readings outside the band — from the logger or typed by a person — are recorded within 12 hours');
    expect(h).toContain('data-kv-people="3"'); expect(text(h)).toContain('3 people');
    expect(text(h)).toContain('45 minutes between two alerts about the same thing');
    expect(text(h)).toContain('when a registered logger\'s last signed reading was received more than 40 minutes ago');
    expect(h).toContain(`data-kv-rule="${R_SILENT}" data-kv-active="no"`); expect(text(h)).toContain('Paused');
    expect(text(h)).toContain('2026-11-10 02:40 UTC'); expect(text(h)).toContain('not evaluated yet');
    expect(text(h)).toContain('a proposal confirmed 2026-11-09 11:05 UTC · by another person of this organisation');
    expect(text(h)).toContain('changed 2026-11-08 07:15 UTC · by you');
    expect(text(page({ rules: [{ ...RULES[0], lastChange: null }] }))).toContain('No change to this rule is recorded.');
  });
  it('E15: no person\'s id or name — never a recipient, an author, a proposer, an acknowledger, a typed label or a proposal\'s reason; the RULE NAME is the one exception', () => {
    for (const id of [P1, P2, P3]) expect(h).not.toContain(id);
    expect(text(h)).not.toContain(`${PERSON} said`);
    expect(text(h)).not.toContain(`${PERSON} typed`);
    // the one exception, pinned: a rule's own name is its identity
    expect(text(h)).toContain(RULE_NAME);
    expect((text(h).match(new RegExp(PERSON, 'g')) ?? []).length).toBe(1);
  });
  it('the open proposal: the fields and which way, when, proposed by another — "Review the proposed change" links its chain state; no reason', () => {
    expect(h).toContain(`data-kv-open-change="${CHANGE_1}" data-kv-proposed-by-you="no"`);
    expect(text(h)).toContain('Proposed — waiting for a second person');
    expect(text(h)).toContain('Cooldown — could make alerts quieter');
    expect(text(h)).toContain('A person removed — could make alerts quieter');
    expect(text(h)).toContain('proposed 2026-11-10 01:30 UTC · Another person proposed this; you may confirm it as the second person.');
    expect(h).toContain(`href="/iot/alert-rules?act=confirm&amp;change=${CHANGE_1}&amp;rule=${R_SILENT}"`);
    expect(h).toContain(`href="/iot/alert-rules?act=confirm&amp;rule=${R_BREACH}"`);   // a rule with no proposal offers "Propose a change"
    expect(text(page({ rules: RULES_MINE }))).toContain('You proposed this; another person must confirm it.');
    expect(/<form|<button|<input|<select|<textarea/.test(h)).toBe(false);   // the page itself only reads; the act is its chain
  });
  it('what each rule sent: when, the rating, how many were told, acknowledged or not; the breach alerts link their file (W403); silences to W404', () => {
    expect(text(h)).toContain('sent 2026-11-10 02:40 UTC · Critical');
    expect(text(h)).toContain('3 people told · acknowledged 2026-11-10 02:52 UTC');
    expect(text(h)).toContain('3 people told · not acknowledged');
    expect(h).toContain(`data-kv-breach-alert="${BREACH_1}"`);
    expect(h).toContain(`href="/iot/alert-incident?id=${BREACH_1}"`);
    expect(text(h)).toContain('1 logger silence alerts are among the latest alerts.');
    expect(h).toContain('href="/iot/device-health"');
    expect(text(page({ fired: null }))).toContain('The alerts sent could not be read just now.');
  });
  it('the "no breach rule" sentence ONLY when no active breach rule exists (0201: then only a shipment\'s driver is told)', () => {
    expect(h).not.toContain('data-kv-no-rule');
    const none = page({ rules: [RULES[1]] });
    expect(text(none)).toContain('No breach rule is active, so when the server opens a breach it tells no one — except the driver, when the breach is on a shipment that has one. The breach is still recorded.');
    expect(text(page({ rules: [{ ...RULES[0], isActive: false }] }))).toContain(en['ops5.alerts.noBreachRule']);
    expect(text(page({ rules: [] }))).toContain('This organisation has no alert rule.');
  });
  it('no false claim: escalation, maker-checker, phone, versions, platform defaults, run-now — refused by name, never offered', () => {
    expect(FALSE_5A.test(affirmed(visible(h)))).toBe(false);
    for (const id of ['device_type_table', 'rule_severity', 'rings_phone', 'escalation', 'versions', 'platform_defaults', 'later_wins', 'any_ops_user', 'run_now']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(/run the rules now/i.test(visible(h))).toBe(false);
    expect(/ops5\./.test(text(h))).toBe(false);   // every key resolves
  });
  it('the states: off, forbidden, error with a re-read', () => {
    expect(page({ state: 'off' })).toContain('data-kv-off="logistics"');
    expect(page({ state: 'forbidden' })).toContain('data-kv-off="permission"');
    expect(page({ state: 'error' })).toContain('data-kv-chain-link="retry" href="/iot/alert-rules"');
  });
});
