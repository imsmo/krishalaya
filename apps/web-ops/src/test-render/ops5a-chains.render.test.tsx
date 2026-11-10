// apps/web-ops/src/test-render/ops5a-chains.render.test.tsx · PC-56 OPS-5a — the alert chain (W3292–W3294), built by its two openers:
//   from W402, REAL: confirm = the change form for one rule (a key minted, a reason required), a new rule, or the open proposal — confirm offered
//   ONLY to another person, withdraw ONLY to the proposer; success = what the SERVER did; failure = the refusal by name and the act's retry;
//   Back → W402. From W403, PARITY-DECOR: the confirm state's one link IS a re-read of the breach; Back → W403 (never W402: the canon's defect).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangeDoneNote, ChangeFailureNote, ChangeForm, NewRuleForm, ProposalReview } from '../components/ops5/AlertViews';
import { Ops5Chain } from '../components/ops5/Ops5Chain';
import { OPS5_CHAINS } from '../features/ops5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed } from './ops4a-fixtures';
import { BREACH_1, CHANGE_1, FALSE_5A, P1, P2, P3, R_BREACH, R_SILENT, RULES, RULES_MINE } from './ops5a-fixtures';

const act = async () => undefined;
const KEY = '0192d2c4-4e70-7000-8000-000000000001';
const W403 = `/iot/alert-incident?id=${BREACH_1}`;
const chain = (c: 'alert_act' | 'incident_act', s: string, page: string, child?: React.ReactNode, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<Ops5Chain t={tr(cat)} chain={c} state={s} page={page}>{child}</Ops5Chain>);

describe('PC-56 OPS-5a · the alert chain from W402 (REAL)', () => {
  it('confirm: the change form for one rule — a key minted, every field optional but the reason; never the ids the rule holds', () => {
    const h = chain('alert_act', 'confirm', '/iot/alert-rules', <ChangeForm t={tr(en)} rule={RULES[0]} idemKey={KEY} action={act} error={null} />);
    expect(h).toContain('data-kv-chain="alert_act" data-kv-chain-kind="REAL" data-kv-chain-state="confirm"');
    expect(h).toContain(`name="id" value="${R_BREACH}"`); expect(h).toContain(`name="key" value="${KEY}"`);
    for (const f of ['isActive', 'ruleName', 'cooldownMinutes', 'add', 'remove', 'windowHours', 'minBreaches', 'subjectType', 'reason']) expect([f, h.includes(`name="${f}"`)]).toEqual([f, true]);
    expect(h).not.toContain('name="silentHours"');   // only the fields of THIS rule's kind
    expect(h).toMatch(/name="reason"[^>]*minLength="10"[^>]*required/);
    expect(text(h)).toContain('The server decides: a change that could make an alert quieter waits for a second person; any other change applies at once. Both are recorded.');
    expect(text(h)).toContain(en['ops5.alerts.secondPersonNotice']);
    for (const id of [P1, P2, P3]) expect(h).not.toContain(id);
    expect(h).toContain('<option value="pause">Pause the rule</option>');
    expect(chain('alert_act', 'confirm', '/iot/alert-rules', <ChangeForm t={tr(en)} rule={RULES[1]} idemKey={KEY} action={act} error="lastRecipient" />))
      .toContain('A rule must keep at least one person.');
    expect(h).toContain('data-kv-back="/iot/alert-rules"');
  });
  it('confirm (a new rule): applies at once, recorded; a reason required; no preferred channel offered (nothing reads it)', () => {
    const h = chain('alert_act', 'confirm', '/iot/alert-rules', <NewRuleForm t={tr(en)} idemKey={KEY} action={act} error={null} />);
    expect(text(h)).toContain('A new rule only adds alerts, so it applies at once, recorded with who made it and why.');
    expect(h).toMatch(/name="reason"[^>]*required/); expect(h).toContain('name="recipients"');
    expect(h).not.toContain('name="channelHint"');
  });
  it('confirm (the open proposal): proposed by ANOTHER → confirm only; proposed by YOU → withdraw only; never the reason', () => {
    const other = chain('alert_act', 'confirm', '/iot/alert-rules', <ProposalReview t={tr(en)} rule={RULES[1]} idemKey={KEY} confirmAction={act} withdrawAction={act} />);
    expect(other).toContain('data-kv-offer="confirm"'); expect(other).not.toContain('data-kv-offer="withdraw"');
    expect(other).toContain(`name="changeId" value="${CHANGE_1}"`); expect(other).toContain(`name="rule" value="${R_SILENT}"`); expect(other).toContain(`name="key" value="${KEY}"`);
    expect(text(other)).toContain('Confirm, as the second person');
    const mine = chain('alert_act', 'confirm', '/iot/alert-rules', <ProposalReview t={tr(en)} rule={RULES_MINE[1]} idemKey={KEY} confirmAction={act} withdrawAction={act} />);
    expect(mine).toContain('data-kv-offer="withdraw"'); expect(mine).not.toContain('data-kv-offer="confirm"');
    expect(text(mine)).toContain('You proposed this; another person must confirm it.');
    for (const h of [other, mine]) { expect(h).not.toContain('said to quiet it'); expect(text(h)).toContain('The reason given is recorded with the proposal and is not shown on this console.'); }
    expect(text(chain('alert_act', 'confirm', '/iot/alert-rules', <ProposalReview t={tr(en)} rule={null} idemKey={KEY} confirmAction={act} withdrawAction={act} />))).toContain('This proposal is not waiting any more.');
  });
  it('success: what the SERVER did — proposed (waiting for a second person), applied, created, confirmed, withdrawn; never "paused"', () => {
    const say = (d: Parameters<typeof ChangeDoneNote>[0]['done']) => text(chain('alert_act', 'success', '/iot/alert-rules', <ChangeDoneNote t={tr(en)} done={d} />));
    expect(say('proposed')).toContain('Proposed — waiting for a second person. Until another person confirms it, the rule stays exactly as it is.');
    expect(say('applied')).toContain('Applied at once, recorded with who made it and why: this change cannot make an alert quieter.');
    expect(say('confirmed')).toContain('Confirmed. The change is now in force, recorded with the names of both people.');
    expect(say('withdrawn')).toContain('Withdrawn. The rule was not changed.');
    expect(say('created')).toContain('Rule made.');
    expect(/paused/i.test(say('proposed'))).toBe(false);
  });
  it('failure: the refusal BY NAME, nothing changed, the act\'s retry; Back → W402', () => {
    const h = chain('alert_act', 'failure', '/iot/alert-rules', <ChangeFailureNote t={tr(en)} reason="confirmerIsProposer" retryHref={`/iot/alert-rules?act=confirm&rule=${R_SILENT}`} />);
    expect(h).toContain('data-kv-failure="confirmerIsProposer"');
    expect(text(h)).toContain('You proposed this change, so a second person must confirm it.');
    expect(text(h)).toContain('The rule is exactly as it was.');
    expect(h).toContain(`data-kv-real="retry" href="/iot/alert-rules?act=confirm&amp;rule=${R_SILENT}"`);
    expect(h).toContain('data-kv-back="/iot/alert-rules"');
    for (const r of ['changeAlreadyOpen', 'changedSinceProposal', 'withdrawNotProposer', 'recipientNotMember', 'reasonRequired'] as const)
      expect(text(chain('alert_act', 'failure', '/iot/alert-rules', <ChangeFailureNote t={tr(en)} reason={r} retryHref="/iot/alert-rules" />))).toContain(en[`ops5.failure.${r}`]);
  });
  it('the chains\' zero-sum / on-call / audit-view sentences are refused BY NAME, never printed', () => {
    const h = chain('alert_act', 'success', '/iot/alert-rules', <ChangeDoneNote t={tr(en)} done="applied" />);
    for (const id of ['act_zero_sum', 'act_on_call', 'act_audit_view', 'escalation']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(FALSE_5A.test(affirmed(visible(h)))).toBe(false);
  });
});

describe('PC-56 OPS-5a · the alert chain from W403 (PARITY-DECOR)', () => {
  it.each(['confirm', 'success', 'failure'])('%s: PARITY-DECOR, Q1-A\'s sentence, Back → THIS breach (never W402); no control', (st) => {
    const h = chain('incident_act', st, W403);
    expect(h).toContain(`data-kv-chain="incident_act" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="${st}"`);
    expect(h).toContain(`data-kv-back="/iot/alert-incident?id=${BREACH_1}"`);
    expect((h.match(/data-kv-back="/g) ?? []).length).toBe(1);
    expect(h).not.toContain('data-kv-back="/iot/alert-rules"');
    expect(text(h)).toContain(en['ops5.q1.words']);
    expect(/<form|<input|<button|<select/.test(h)).toBe(false);
    if (st === 'confirm') expect(h).toContain(`data-kv-real="reread" href="/iot/alert-incident?id=${BREACH_1}"`); else expect(h).not.toContain('data-kv-real="reread"');
    for (const id of ['act_zero_sum', 'act_on_call', 'incident_audit', 'incident_close', 'closed_by_person']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(FALSE_5A.test(affirmed(visible(h)))).toBe(false);
  });
  // NAMED UPDATE (PC-56 OPS-5b): OPS5_CHAINS now also holds 5b's two insights chains (rendered in ops5b-chains.render.test.tsx); THIS test is
  // the 5a pair, selected by wave — still every state of both, in hi and gu.
  it('every state of both chains renders its own title in hi / gu', () => {
    const fiveA = OPS5_CHAINS.filter((c) => c.wave === '5a');
    expect(fiveA.map((c) => c.id)).toEqual(['alert_act', 'incident_act']);
    for (const c of fiveA) for (const cat of [hi, gu]) for (const st of c.states)
      expect(text(chain(c.id as 'alert_act' | 'incident_act', st, c.id === 'alert_act' ? '/iot/alert-rules' : W403, null, cat))).toContain(cat[`${c.key(st)}.title`]);
  });
});
