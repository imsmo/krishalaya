// apps/admin-api/src/modules/support-oversight/__tests__/admin2b-support-policy.spec.ts · PC-56 ADMIN-2b.
// A support policy is a promise about how fast somebody's money problem gets answered and who is woken when that
// promise is missed. The tests that matter are the CONTRADICTIONS — combinations that read fine and behave wrongly.
import {
  ROUTING_STRATEGIES, AI_MODES, ESCALATION_CHANNELS, wakesSomebody,
  assertPolicy, deskIsOpen, stepsDueAt, describePolicy, type PolicyInput,
} from '../domain/support-policy';
import { InvalidSupportPolicyError } from '../domain/support-oversight.errors';

/** The seeded v1 shape from migration 0097 — a policy that must always validate. */
const base = (): PolicyInput => ({
  name: 'Default desk policy',
  effectiveFrom: '2026-09-01',
  openHourIst: 9,
  closeHourIst: 21,
  afterHoursSeverities: ['P0', 'P1'],
  routingStrategy: 'least_loaded',
  deskLanguages: ['en', 'hi', 'gu'],
  aiAssistMode: 'suggest',
  aiExcludedSeverities: ['P0', 'P1'],
  slas: [
    { severity: 'P0', firstResponseMinutes: 15, resolutionMinutes: 240 },
    { severity: 'P1', firstResponseMinutes: 60, resolutionMinutes: 480 },
    { severity: 'P2', firstResponseMinutes: 240, resolutionMinutes: 1440 },
    { severity: 'P3', firstResponseMinutes: 480, resolutionMinutes: 4320 },
  ],
  escalations: [
    { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
    { severity: 'P1', afterMinutes: 0, channel: 'sms', targetRole: 'support_lead' },
    { severity: 'P2', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
    { severity: 'P3', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
  ],
});

describe('support policy — the vocabularies', () => {
  it('mirrors the 0097 enums', () => {
    expect([...ROUTING_STRATEGIES]).toEqual(['round_robin', 'least_loaded', 'manual']);
    expect([...AI_MODES]).toEqual(['off', 'suggest', 'auto_reply']);
    expect([...ESCALATION_CHANNELS]).toEqual(['email', 'sms', 'whatsapp', 'call', 'in_app', 'pager']);
  });

  it('knows which channels WAKE somebody — an in-app signal is not a page', () => {
    // treating an in-app badge as a page would let a policy claim night cover it does not have
    expect(wakesSomebody('call')).toBe(true);
    expect(wakesSomebody('sms')).toBe(true);
    expect(wakesSomebody('pager')).toBe(true);
    expect(wakesSomebody('in_app')).toBe(false);
    expect(wakesSomebody('email')).toBe(false);
    expect(wakesSomebody('whatsapp')).toBe(false);
  });

  it('accepts the seeded policy and normalises it', () => {
    const p = assertPolicy(base());
    expect(p.slas.map((s) => s.severity)).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(p.afterHoursSeverities).toEqual(['P0', 'P1']);
    expect(describePolicy(p)).toBe('open 09:00–21:00 IST, least_loaded routing, AI suggest, after hours P0/P1 wakes somebody');
  });
});

describe('THE FOUR CONTRADICTIONS — a policy that reads fine and behaves wrongly', () => {
  it('(1) refuses an SLA with NO CHAIN behind it — the exact state ADMIN-2 had to report on screen', () => {
    const p = base();
    p.escalations = p.escalations.filter((e) => e.severity !== 'P3');
    expect(() => assertPolicy(p)).toThrow(/no escalation step for P3/);
  });

  it('(2) refuses a chain that WAKES somebody at an hour the policy says the desk is shut', () => {
    // P2 is not in afterHoursSeverities, so a call step for P2 would ring a phone at 03:00 while the same policy says
    // the desk closed at 21:00
    const p = base();
    p.escalations = p.escalations.map((e) => (e.severity === 'P2' ? { ...e, channel: 'call' } : e));
    expect(() => assertPolicy(p)).toThrow(/would ring a phone at an hour it says the desk is shut/);
    // the same step as in_app is fine — it lands on a board, it does not wake anybody
    const ok = base();
    expect(assertPolicy(ok).escalations.some((e) => e.severity === 'P2' && e.channel === 'in_app')).toBe(true);
    // and adding P2 to after-hours makes the call legitimate
    const widened = base();
    widened.afterHoursSeverities = ['P0', 'P1', 'P2'];
    widened.escalations = widened.escalations.map((e) => (e.severity === 'P2' ? { ...e, channel: 'call' } : e));
    expect(assertPolicy(widened).escalations.some((e) => e.severity === 'P2' && e.channel === 'call')).toBe(true);
  });

  it('(3) refuses targets that TIGHTEN as severity falls — every ticket would sort wrongly for ever', () => {
    const p = base();
    p.slas = [
      { severity: 'P0', firstResponseMinutes: 60, resolutionMinutes: 240 },
      { severity: 'P1', firstResponseMinutes: 15, resolutionMinutes: 480 },   // faster than P0
      { severity: 'P2', firstResponseMinutes: 240, resolutionMinutes: 1440 },
      { severity: 'P3', firstResponseMinutes: 480, resolutionMinutes: 4320 },
    ];
    expect(() => assertPolicy(p)).toThrow(/P1 must have MORE first-response time than P0/);
  });

  it('(3b) refuses targets that are merely EQUAL — a severity that buys no extra time is not a severity', () => {
    // mutation testing found this: the guard is `<=`, but every case above used a strictly-faster P1, so a mutant
    // loosening it to `<` survived. Equal targets are the subtler bug — the queue sorts by severity while severity
    // means nothing, and no screen anywhere would look wrong.
    const eqFirst = base();
    eqFirst.slas = eqFirst.slas.map((s) => (s.severity === 'P1' ? { ...s, firstResponseMinutes: 15 } : s));
    expect(() => assertPolicy(eqFirst)).toThrow(/P1 must have MORE first-response time than P0/);
    const eqRes = base();
    eqRes.slas = eqRes.slas.map((s) => (s.severity === 'P2' ? { ...s, resolutionMinutes: 480 } : s));
    expect(() => assertPolicy(eqRes)).toThrow(/P2 must have MORE resolution time than P1/);
  });

  it('(4) refuses an AI allowed to auto-answer everything, including a P0 about somebody’s money', () => {
    const p = base();
    p.aiAssistMode = 'auto_reply';
    p.aiExcludedSeverities = [];
    expect(() => assertPolicy(p)).toThrow(/exclude at least P0/);
    // auto_reply with P0 excluded is a real, defensible policy
    const guarded = base();
    guarded.aiAssistMode = 'auto_reply';
    guarded.aiExcludedSeverities = ['P0'];
    expect(assertPolicy(guarded).aiAssistMode).toBe('auto_reply');
  });
});

describe('support policy — the ordinary validations', () => {
  it('refuses a zero-length or inverted day', () => {
    expect(() => assertPolicy({ ...base(), openHourIst: 21, closeHourIst: 21 })).toThrow(/close after it opens/);
    expect(() => assertPolicy({ ...base(), openHourIst: 22, closeHourIst: 9 })).toThrow(/close after it opens/);
    expect(() => assertPolicy({ ...base(), openHourIst: 24 })).toThrow(InvalidSupportPolicyError);
  });

  it('requires every severity to have a target, and refuses duplicates', () => {
    const missing = base();
    missing.slas = missing.slas.filter((s) => s.severity !== 'P2');
    expect(() => assertPolicy(missing)).toThrow(/no SLA for P2/);
    const dup = base();
    dup.slas = [...dup.slas, { severity: 'P0', firstResponseMinutes: 10, resolutionMinutes: 20 }];
    expect(() => assertPolicy(dup)).toThrow(/two SLA rows for P0/);
  });

  it('refuses a resolution promise SOONER than the first response', () => {
    const p = base();
    p.slas = p.slas.map((s) => (s.severity === 'P0' ? { ...s, resolutionMinutes: 10 } : s));
    expect(() => assertPolicy(p)).toThrow(/cannot be sooner than its first response/);
  });

  it('demands a ROLE, not a person — a chain naming a person breaks the day they leave', () => {
    const p = base();
    p.escalations = p.escalations.map((e) => (e.severity === 'P0' ? { ...e, targetRole: 'pooja@krishalaya.co' } : e));
    expect(() => assertPolicy(p)).toThrow(/name a ROLE so the chain survives someone leaving/);
    expect(() => assertPolicy({ ...base(), escalations: [{ severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'x' }] }))
      .toThrow(InvalidSupportPolicyError);
  });

  it('refuses a desk with no language, and a bogus code', () => {
    expect(() => assertPolicy({ ...base(), deskLanguages: [] })).toThrow(/at least one language/);
    expect(() => assertPolicy({ ...base(), deskLanguages: ['klingon'] })).toThrow(/is not a language code/);
    // de-duplicated and lower-cased
    expect(assertPolicy({ ...base(), deskLanguages: ['EN', 'en', 'hi'] }).deskLanguages).toEqual(['en', 'hi']);
  });

  it('refuses duplicate chain steps and an out-of-range delay', () => {
    const dup = base();
    dup.escalations = [...dup.escalations, { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' }];
    expect(() => assertPolicy(dup)).toThrow(/two call steps for P0 at \+0m/);
    const late = base();
    late.escalations = [...late.escalations, { severity: 'P0', afterMinutes: 20000, channel: 'call', targetRole: 'ceo' }];
    expect(() => assertPolicy(late)).toThrow(/afterMinutes must be 0/);
  });

  it('sorts the chain by severity then delay, so the stored order is the read order', () => {
    const p = base();
    p.escalations = [
      { severity: 'P1', afterMinutes: 120, channel: 'call', targetRole: 'support_head' },
      { severity: 'P0', afterMinutes: 30, channel: 'call', targetRole: 'head_of_ops' },
      { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
      { severity: 'P1', afterMinutes: 0, channel: 'sms', targetRole: 'support_lead' },
      { severity: 'P2', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
      { severity: 'P3', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
    ];
    const out = assertPolicy(p).escalations;
    expect(out.map((e) => `${e.severity}+${e.afterMinutes}`)).toEqual(['P0+0', 'P0+30', 'P1+0', 'P1+120', 'P2+0', 'P3+0']);
  });
});

describe('policy helpers used by the console and (later) the pager', () => {
  it('knows when the desk is open', () => {
    const p = { openHourIst: 9, closeHourIst: 21 };
    expect(deskIsOpen(p, 9)).toBe(true);
    expect(deskIsOpen(p, 20)).toBe(true);
    expect(deskIsOpen(p, 21)).toBe(false);      // closing hour is exclusive
    expect(deskIsOpen(p, 3)).toBe(false);
  });

  it('returns the steps DUE at a given lateness, in order', () => {
    const chain = assertPolicy({
      ...base(),
      afterHoursSeverities: ['P0', 'P1'],
      escalations: [
        { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
        { severity: 'P0', afterMinutes: 30, channel: 'call', targetRole: 'head_of_ops' },
        { severity: 'P1', afterMinutes: 0, channel: 'sms', targetRole: 'support_lead' },
        { severity: 'P2', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
        { severity: 'P3', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
      ],
    }).escalations;
    expect(stepsDueAt(chain, 'P0', 0).map((s) => s.targetRole)).toEqual(['support_head']);
    expect(stepsDueAt(chain, 'P0', 29).map((s) => s.targetRole)).toEqual(['support_head']);
    expect(stepsDueAt(chain, 'P0', 30).map((s) => s.targetRole)).toEqual(['support_head', 'head_of_ops']);
    expect(stepsDueAt(chain, 'P1', 500).map((s) => s.targetRole)).toEqual(['support_lead']);
  });

  it('describes a policy with no night cover honestly', () => {
    const p = assertPolicy({
      ...base(), afterHoursSeverities: [],
      escalations: base().escalations.map((e) => ({ ...e, channel: 'in_app' as const })),
    });
    expect(describePolicy(p)).toContain('after hours nothing wakes somebody');
  });
});
