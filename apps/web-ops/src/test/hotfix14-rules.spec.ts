// apps/web-ops/src/test/hotfix14-rules.spec.ts · PC-56 HOTFIX-14 · NOBODY SILENCES THE ALARM ALONE (OPS-5 Q3-A, lead-applied 2026-11-10).
// The page is NOT rebuilt here (OPS-5a rebuilds it); these are source + catalogue assertions on what this hotfix changed on /devices/rules:
//   • the approved sentence, printed verbatim, in the three languages;
//   • a quieter change answers 202 `status: 'proposed'` — the action reads the SERVER's status and says "proposed — waiting for a second
//     person" (never a client-side guess), and a pause is no longer reported as "paused";
//   • the open proposal: confirm offered to another person, withdraw to the proposer; the second-person refusals by name;
//   • C-4 corrected: the quiet-hours notice no longer promises an escalation.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const SRC = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const PAGE = read('app/devices/rules/page.tsx');
const ACTIONS = read('app/devices/actions.ts');
const cats: Record<string, Record<string, string>> = { en, hi, gu };

const APPROVED = 'A change that could make an alert quieter — pausing a rule, removing a person, or raising a threshold — takes effect only when a second person confirms it. Until then the current rule keeps alerting. Every change is recorded with who made it and why.';

describe('PC-56 HOTFIX-14 · /devices/rules', () => {
  it('prints the approved sentence verbatim (en), and it exists in hi and gu', () => {
    expect(en['iot.secondPersonNotice']).toBe(APPROVED);
    expect(PAGE).toContain("t.t('iot.secondPersonNotice')");
    for (const l of ['hi', 'gu']) expect([l, (cats[l]['iot.secondPersonNotice'] ?? '').length > 40]).toEqual([l, true]);
  });

  it('a quieter change is shown "proposed — waiting for a second person", by name, in three languages — from the SERVER\'s status', () => {
    expect(en['iot.proposedWaiting']).toBe('Proposed — waiting for a second person');
    expect(en['iot.ok.proposed']).toMatch(/^Proposed — waiting for a second person\./);
    for (const l of ['hi', 'gu']) for (const k of ['iot.proposedWaiting', 'iot.ok.proposed', 'iot.ok.confirmed', 'iot.ok.withdrawn']) expect([l, k, !!cats[l][k] && cats[l][k] !== en[k]]).toEqual([l, k, true]);
    expect(PAGE).toContain("t.t('iot.proposedWaiting')");
    expect(ACTIONS).toMatch(/status === 'proposed' \? 'ok=proposed' : 'ok=patched'/);
    expect(ACTIONS).not.toMatch(/isActive === false \? 'ok=paused'/);   // a pause is no longer reported as done
  });

  it('the open proposal: confirm for another person, withdraw for the proposer, both keyed', () => {
    expect(PAGE).toMatch(/r\.openChange\.proposedByYou \?[\s\S]*withdrawChangeAction[\s\S]*:[\s\S]*confirmChangeAction/);
    expect(ACTIONS).toMatch(/confirmAlertRuleChange\(id, randomUUID\(\)\)/);
    expect(ACTIONS).toMatch(/withdrawAlertRuleChange\(id, randomUUID\(\)\)/);
    expect(ACTIONS).toMatch(/updateAlertRule\(id, [^)]*, randomUUID\(\)\)/);
    expect(ACTIONS).toMatch(/createAlertRule\(built\.value, randomUUID\(\)\)/);
  });

  it('every second-person refusal is shown by name, in three languages', () => {
    const named = ['ALERT_RULE_CONFIRMER_IS_PROPOSER', 'ALERT_RULE_CHANGE_ALREADY_OPEN', 'ALERT_RULE_CHANGE_NOT_OPEN', 'ALERT_RULE_CHANGED_SINCE_PROPOSAL', 'ALERT_RULE_WITHDRAW_NOT_PROPOSER', 'ALERT_RECIPIENT_NOT_MEMBER', 'REASON_REQUIRED'];
    for (const code of named) expect([code, ACTIONS.includes(code)]).toEqual([code, true]);
    for (const k of ['confirmerIsProposer', 'changeAlreadyOpen', 'changeNotOpen', 'changedSinceProposal', 'withdrawNotProposer', 'recipientNotMember', 'reasonRequired', 'r_reason']) {
      expect([k, PAGE.includes(`'${k}'`)]).toEqual([k, true]);
      for (const l of ['en', 'hi', 'gu']) expect([l, k, !!cats[l][`iot.error.${k}`]]).toEqual([l, k, true]);
    }
  });

  it('every pause / resume and every new rule asks why (the form carries a reason the API requires)', () => {
    expect((PAGE.match(/name="reason"/g) ?? []).length).toBe(2);
    expect(PAGE).toMatch(/minLength=\{10\}/);
  });

  it('C-4 corrected: no escalation is promised; a critical alert reaches people in their quiet hours; the channel is only kept with the rule', () => {
    for (const l of ['en', 'hi', 'gu']) expect([l, cats[l]['iot.quietHoursNotice']]).not.toEqual([l, undefined]);
    expect(en['iot.quietHoursNotice']).not.toMatch(/escalat/i);
    expect(en['iot.quietHoursNotice']).toContain('critical');
    expect(en['iot.quietHoursNotice']).toContain('If nobody acknowledges an alert, nobody else is told.');
    expect(hi['iot.quietHoursNotice']).not.toContain('एस्केलेशन');
    expect(gu['iot.quietHoursNotice']).not.toContain('એસ્કેલેશન');
  });

  it('the proposal\'s free-text reason is never printed on this console (house rule)', () => {
    expect(PAGE).not.toMatch(/openChange\.reason|openChange\?\.reason/);
  });
});
