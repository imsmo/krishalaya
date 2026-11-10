// apps/web-ops/src/test/hotfix14-rules.spec.ts · PC-56 HOTFIX-14 · NOBODY SILENCES THE ALARM ALONE (OPS-5 Q3-A, lead-applied 2026-11-10).
// NAMED UPDATE (PC-56 OPS-5a): HOTFIX-14 changed the OW-7 page `/devices/rules`; OPS-5a deletes that page (a 307 to W402, `/iot/alert-rules`) and
// rebuilds the act as the REAL alert chain. Every assertion below is KEPT, re-pointed at the page that now carries it — its keys renamed
// `iot.` → `ops5.` with their values unchanged; none is dropped or loosened:
//   • the approved sentence, printed verbatim, in the three languages;
//   • a quieter change answers 202 `status: 'proposed'` — the action reads the SERVER's status and says "proposed — waiting for a second
//     person" (never a client-side guess), and a pause is never reported as done;
//   • the open proposal: confirm offered to another person, withdraw to the proposer, both keyed; the second-person refusals by name;
//   • C-4 corrected: the quiet-hours notice promises no escalation.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CHANGE_REFUSALS } from '../features/ops5/alerts';

const SRC = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const VIEW = read('components/ops5/AlertViews.tsx');
const PAGE = read('app/iot/alert-rules/page.tsx');
const ACTIONS = read('app/iot/alert-rules/actions.ts');
const ALERTS = read('features/ops5/alerts.ts');
const cats: Record<string, Record<string, string>> = { en, hi, gu };

const APPROVED = 'A change that could make an alert quieter — pausing a rule, removing a person, or raising a threshold — takes effect only when a second person confirms it. Until then the current rule keeps alerting. Every change is recorded with who made it and why.';

describe('PC-56 HOTFIX-14 · the alert rule change (now W402, /iot/alert-rules)', () => {
  it('prints the approved sentence verbatim (en), and it exists in hi and gu', () => {
    expect(en['ops5.alerts.secondPersonNotice']).toBe(APPROVED);
    expect(VIEW).toMatch(/RULES_STATEMENTS = \['ops5\.alerts\.secondPersonNotice'/);
    expect(read('features/ops5/refusals.ts')).toMatch(/id: 'alert_act'[^\n]*statement: 'ops5\.alerts\.secondPersonNotice'/);
    for (const l of ['hi', 'gu']) expect([l, (cats[l]['ops5.alerts.secondPersonNotice'] ?? '').length > 40]).toEqual([l, true]);
    for (const cat of [en, hi, gu]) expect(Object.keys(cat).some((k) => k.startsWith('iot.'))).toBe(false);   // the old keys left with their page
  });

  it('a quieter change is shown "proposed — waiting for a second person", by name, in three languages — from the SERVER\'s status', () => {
    expect(en['ops5.alerts.proposedWaiting']).toBe('Proposed — waiting for a second person');
    expect(en['ops5.done.proposed']).toMatch(/^Proposed — waiting for a second person\./);
    for (const l of ['hi', 'gu']) for (const k of ['ops5.alerts.proposedWaiting', 'ops5.done.proposed', 'ops5.done.confirmed', 'ops5.done.withdrawn']) expect([l, k, !!cats[l][k] && cats[l][k] !== en[k]]).toEqual([l, k, true]);
    expect(VIEW).toContain("t.t('ops5.alerts.proposedWaiting')");
    expect(ACTIONS).toMatch(/done=\$\{status === 'proposed' \? 'proposed' : 'applied'\}/);
    expect(ACTIONS).not.toMatch(/paused/);   // a pause is never reported as done
  });

  it('the open proposal: confirm for another person, withdraw for the proposer, both keyed', () => {
    expect(VIEW).toMatch(/c\.proposedByYou \?[\s\S]*withdrawAction[\s\S]*:[\s\S]*confirmAction/);
    // [OPS-5a builder, mutant M8] the regex above also matched `!c.proposedByYou ?` (the offers swapped) — STRENGTHENED: the condition is the bare flag.
    expect(VIEW).toMatch(/\{c\.proposedByYou \? \(\s*<form action=\{withdrawAction\}[\s\S]*?\) : \(\s*<form action=\{confirmAction\}/);
    expect(ACTIONS).toMatch(/confirmAlertRuleChange\(changeId as string, key as string\)/);
    expect(ACTIONS).toMatch(/withdrawAlertRuleChange\(changeId as string, key as string\)/);
    expect(ACTIONS).toMatch(/updateAlertRule\(id as string, [^)]*, key as string\)/);
    expect(ACTIONS).toMatch(/createAlertRule\(built\.value, key as string\)/);
    expect((ACTIONS.match(/const key = keyParam\(/g) ?? []).length).toBe(4);   // every act refuses a missing key before it calls the API
    expect((PAGE.match(/idemKey=\{randomUUID\(\)\}/g) ?? []).length).toBe(3);   // the key minted when each form is shown
  });

  it('every second-person refusal is shown by name, in three languages', () => {
    const named = ['ALERT_RULE_CONFIRMER_IS_PROPOSER', 'ALERT_RULE_CHANGE_ALREADY_OPEN', 'ALERT_RULE_CHANGE_NOT_OPEN', 'ALERT_RULE_CHANGED_SINCE_PROPOSAL', 'ALERT_RULE_WITHDRAW_NOT_PROPOSER', 'ALERT_RECIPIENT_NOT_MEMBER', 'REASON_REQUIRED'];
    for (const code of named) expect([code, ALERTS.includes(code) && typeof CHANGE_REFUSALS[code] === 'string']).toEqual([code, true]);
    for (const k of ['confirmerIsProposer', 'changeAlreadyOpen', 'changeNotOpen', 'changedSinceProposal', 'withdrawNotProposer', 'recipientNotMember', 'reasonRequired']) {
      expect([k, Object.values(CHANGE_REFUSALS).includes(k)]).toEqual([k, true]);
      for (const l of ['en', 'hi', 'gu']) expect([l, k, !!cats[l][`ops5.failure.${k}`]]).toEqual([l, k, true]);
    }
    for (const l of ['en', 'hi', 'gu']) expect([l, !!cats[l]['ops5.form.error.reason']]).toEqual([l, true]);   // the form's own reason refusal (was r_reason)
  });

  it('every change and every new rule asks why (the form carries a reason the API requires)', () => {
    expect((VIEW.match(/name="reason"/g) ?? []).length).toBe(2);
    expect((VIEW.match(/name="reason" className="kv-textarea" rows=\{2\} minLength=\{10\} maxLength=\{500\} required/g) ?? []).length).toBe(2);
  });

  it('C-4 corrected: no escalation is promised; a critical alert reaches people in their quiet hours; the channel is only kept with the rule', () => {
    for (const l of ['en', 'hi', 'gu']) expect([l, cats[l]['ops5.alerts.quietHoursNotice']]).not.toEqual([l, undefined]);
    expect(en['ops5.alerts.quietHoursNotice']).not.toMatch(/escalat/i);
    expect(en['ops5.alerts.quietHoursNotice']).toContain('critical');
    expect(en['ops5.alerts.quietHoursNotice']).toContain('If nobody acknowledges an alert, nobody else is told.');
    expect(hi['ops5.alerts.quietHoursNotice']).not.toContain('एस्केलेशन');
    expect(gu['ops5.alerts.quietHoursNotice']).not.toContain('એસ્કેલેશન');
  });

  it('the proposal\'s free-text reason is never printed on this console (house rule)', () => {
    expect(VIEW).not.toMatch(/openChange\.reason|openChange\?\.reason|\bc\.reason\b/);
    const asRules = ALERTS.slice(ALERTS.indexOf('export function asRules'), ALERTS.indexOf('export function kindKey'));
    expect(/\breason\b/.test(asRules.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'))).toBe(false);   // asRules never copies it
  });
});
