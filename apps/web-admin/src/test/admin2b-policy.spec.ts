// apps/web-admin/src/test/admin2b-policy.spec.ts · PC-56 ADMIN-2b, console side.
//
// WHAT IS WORTH TESTING HERE IS NARROW ON PURPOSE. The four coherence rules live on the server and are NOT duplicated in
// this module (see its header), so there is nothing to assert about them here — asserting a rule this file does not own
// would create the drift the split was designed to avoid.
//
// What IS asserted: that the form's SHAPE parsing turns a bag of strings into exactly the object the server accepts,
// that a cleared row removes a step rather than publishing a blank one, and that the read helpers refuse to invent
// values — a missing target is not "0m", a policy-less console does not print a default day, and a step that could not
// be delivered is counted as undelivered.
import {
  buildPolicy, formSteps, chainFor, humanMinutes, deskHours, matrixIsCoherent,
  severitiesWithoutChain, afterHoursContradictions, noNightCover, undeliveredEvents,
  wakesSomebody, BLANK_STEP_ROWS, SEVERITIES,
  type ChainStep, type FiredEvent, type SlaRow,
} from '../features/support/policy';

/** A complete, valid form. Tests mutate a copy. */
function baseForm(): Record<string, string> {
  return {
    name: 'Desk policy 2026-H2',
    effectiveFrom: '2026-09-01',
    openHourIst: '9', closeHourIst: '21',
    routingStrategy: 'least_loaded',
    deskLanguages: 'en, hi, gu',
    aiAssistMode: 'suggest',
    fr_P0: '15', res_P0: '240',
    fr_P1: '60', res_P1: '480',
    fr_P2: '240', res_P2: '1440',
    fr_P3: '480', res_P3: '4320',
    stepCount: '2',
    step_0_severity: 'P0', step_0_afterMinutes: '0', step_0_channel: 'call', step_0_targetRole: 'support_head',
    step_1_severity: 'P1', step_1_afterMinutes: '30', step_1_channel: 'in_app', step_1_targetRole: 'support_lead',
    notes: '',
  };
}
const multi = (m: Record<string, string[]>) => (n: string) => m[n] ?? [];
const bag = (f: Record<string, string>) => (n: string) => f[n] ?? '';
const build = (f = baseForm(), m: Record<string, string[]> = { afterHoursSeverities: ['P0', 'P1'], aiExcludedSeverities: ['P0', 'P1'] }) =>
  buildPolicy(bag(f), multi(m));

describe('buildPolicy — the happy path', () => {
  it('produces exactly the object the server accepts', () => {
    const r = build();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: 'Desk policy 2026-H2',
      effectiveFrom: '2026-09-01',
      openHourIst: 9, closeHourIst: 21,
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
        { severity: 'P1', afterMinutes: 30, channel: 'in_app', targetRole: 'support_lead' },
      ],
    });
    // an empty notes box is OMITTED, not sent as ''
    expect('notes' in r.value).toBe(false);
  });

  it('normalises languages: trimmed, lower-cased, de-duplicated', () => {
    const f = baseForm(); f.deskLanguages = ' EN , hi ,HI, gu ';
    const r = build(f);
    expect(r.ok && r.value.deskLanguages).toEqual(['en', 'hi', 'gu']);
  });

  it('ignores severities the platform does not accept, whatever the form posts', () => {
    // a hand-crafted POST cannot smuggle a fifth severity past this into the payload
    const r = build(baseForm(), { afterHoursSeverities: ['P0', 'P9', ''], aiExcludedSeverities: ['P4'] });
    expect(r.ok && r.value.afterHoursSeverities).toEqual(['P0']);
    expect(r.ok && r.value.aiExcludedSeverities).toEqual([]);
  });

  it('keeps notes when they are given', () => {
    const f = baseForm(); f.notes = 'Night cover agreed with ops on 2026-08-04.';
    const r = build(f);
    expect(r.ok && r.value.notes).toBe('Night cover agreed with ops on 2026-08-04.');
  });
});

describe('buildPolicy — shape refusals', () => {
  it.each([
    ['name', { name: 'ab' }],
    ['effectiveFrom', { effectiveFrom: '01-09-2026' }],
    ['openHour', { openHourIst: '24' }],
    ['closeHour', { closeHourIst: '25' }],
    ['hourOrder', { openHourIst: '21', closeHourIst: '21' }],
    ['hourOrder', { openHourIst: '22', closeHourIst: '9' }],
    ['routing', { routingStrategy: 'whatever' }],
    ['aiMode', { aiAssistMode: 'yolo' }],
    ['languages', { deskLanguages: '  ,  ' }],
  ])('refuses with %s', (error, patch) => {
    const r = build({ ...baseForm(), ...patch });
    expect(r).toMatchObject({ ok: false, error });
  });

  it('names the bad language rather than saying "invalid"', () => {
    const r = build({ ...baseForm(), deskLanguages: 'en, klingon' });
    expect(r).toMatchObject({ ok: false, error: 'language', at: 'klingon' });
  });

  it('refuses a blank target and says WHICH severity — eight number boxes need pointing at', () => {
    const r = build({ ...baseForm(), fr_P2: '' });
    expect(r).toMatchObject({ ok: false, error: 'target', at: 'P2' });
  });

  it('refuses a non-numeric target rather than parsing it loosely', () => {
    // Number('15abc') is NaN but parseInt would give 15 — a target must be typed, not guessed
    const r = build({ ...baseForm(), fr_P1: '60m' });
    expect(r).toMatchObject({ ok: false, error: 'target', at: 'P1' });
  });

  it('refuses a resolution promise sooner than the first response', () => {
    const r = build({ ...baseForm(), res_P0: '10' });
    expect(r).toMatchObject({ ok: false, error: 'resBeforeFr', at: 'P0' });
  });

  it('refuses an out-of-range target at both ends', () => {
    expect(build({ ...baseForm(), fr_P0: '0' })).toMatchObject({ ok: false, error: 'target', at: 'P0' });
    expect(build({ ...baseForm(), res_P3: '43201' })).toMatchObject({ ok: false, error: 'target', at: 'P3' });
  });
});

describe('buildPolicy — the chain rows', () => {
  it('skips an entirely blank row without complaining — blanks are unused slots', () => {
    const f = baseForm(); f.stepCount = '5';   // rows 2..4 never filled in
    const r = build(f);
    expect(r.ok && r.value.escalations).toHaveLength(2);
  });

  it('treats a CLEARED role as a removed step, because the form is the whole chain', () => {
    const f = baseForm(); f.step_1_targetRole = '';
    const r = build(f);
    expect(r.ok && r.value.escalations).toEqual([
      { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
    ]);
  });

  it('refuses a chain with nothing in it — a policy that pages nobody is the bug this wave removed', () => {
    const f = baseForm(); f.step_0_targetRole = ''; f.step_1_targetRole = '';
    expect(build(f)).toMatchObject({ ok: false, error: 'noSteps' });
  });

  it('reports the ROW NUMBER of a bad step, not just that one is bad', () => {
    expect(build({ ...baseForm(), step_1_severity: 'P9' })).toMatchObject({ ok: false, error: 'stepSeverity', at: '2' });
    expect(build({ ...baseForm(), step_1_channel: 'carrier_pigeon' })).toMatchObject({ ok: false, error: 'stepChannel', at: '2' });
    expect(build({ ...baseForm(), step_1_afterMinutes: '10081' })).toMatchObject({ ok: false, error: 'stepAfter', at: '2' });
    expect(build({ ...baseForm(), step_1_targetRole: 'x' })).toMatchObject({ ok: false, error: 'stepRole', at: '2' });
  });

  it('refuses a step naming a PERSON — the mistake an operator makes by reflex', () => {
    const r = build({ ...baseForm(), step_0_targetRole: 'pooja@krishalaya.co' });
    expect(r).toMatchObject({ ok: false, error: 'stepPerson', at: '1' });
  });

  it('treats a blank delay on a filled row as "at breach" rather than refusing', () => {
    const r = build({ ...baseForm(), step_1_afterMinutes: '' });
    expect(r.ok && r.value.escalations[1].afterMinutes).toBe(0);
  });

  it('catches a duplicate step here, where the row number can be shown', () => {
    // the DB has a unique constraint; a 409 on a form that cannot show the conflict is a dead end
    const f = baseForm(); f.stepCount = '3';
    f.step_2_severity = 'P0'; f.step_2_afterMinutes = '0'; f.step_2_channel = 'call'; f.step_2_targetRole = 'someone_else';
    expect(build(f)).toMatchObject({ ok: false, error: 'stepDuplicate', at: '3' });
  });

  it('allows the same severity and delay on a DIFFERENT channel — sms and a call are two contacts', () => {
    const f = baseForm(); f.stepCount = '3';
    f.step_2_severity = 'P0'; f.step_2_afterMinutes = '0'; f.step_2_channel = 'sms'; f.step_2_targetRole = 'support_head';
    expect(build(f).ok).toBe(true);
  });

  it('carries a step note when one is given', () => {
    const f = baseForm(); f.step_0_notes = 'ring the mobile, not the desk phone';
    const r = build(f);
    expect(r.ok && r.value.escalations[0].notes).toBe('ring the mobile, not the desk phone');
    expect(r.ok && 'notes' in r.value.escalations[1]).toBe(false);
  });

  it('refuses an absurd stepCount rather than looping on it', () => {
    expect(build({ ...baseForm(), stepCount: '5000' })).toMatchObject({ ok: false, error: 'tooManySteps' });
  });
});

describe('formSteps — what the publish form renders', () => {
  const chain: ChainStep[] = [
    { severity: 'P2', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
    { severity: 'P0', afterMinutes: 30, channel: 'call', targetRole: 'head_of_ops' },
    { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
  ];

  it('pre-fills every existing step in firing order, then blanks', () => {
    const rows = formSteps(chain);
    expect(rows).toHaveLength(chain.length + BLANK_STEP_ROWS);
    expect(rows.slice(0, 3).map((r) => `${r!.severity}+${r!.afterMinutes}`)).toEqual(['P0+0', 'P0+30', 'P2+0']);
    expect(rows.slice(3).every((r) => r === null)).toBe(true);
  });

  it('offers blanks even when there is no chain at all', () => {
    expect(formSteps([])).toEqual([null, null, null]);
  });

  it('round-trips: the rows it renders parse back to the same chain', () => {
    // this is the property that matters — a pre-fill that cannot be re-published silently drops somebody's chain
    const rows = formSteps(chain);
    const f = baseForm();
    f.stepCount = String(rows.length);
    rows.forEach((step, i) => {
      f[`step_${i}_severity`] = step?.severity ?? '';
      f[`step_${i}_afterMinutes`] = step ? String(step.afterMinutes) : '';
      f[`step_${i}_channel`] = step?.channel ?? 'in_app';
      f[`step_${i}_targetRole`] = step?.targetRole ?? '';
    });
    const r = build(f);
    expect(r.ok && r.value.escalations).toEqual([
      { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
      { severity: 'P0', afterMinutes: 30, channel: 'call', targetRole: 'head_of_ops' },
      { severity: 'P2', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
    ]);
  });
});

describe('reading helpers refuse to invent values', () => {
  it('humanMinutes gives the shortest honest phrase, and null for nothing', () => {
    expect(humanMinutes(15)).toBe('15m');
    expect(humanMinutes(60)).toBe('1h');
    expect(humanMinutes(90)).toBe('1h 30m');
    expect(humanMinutes(240)).toBe('4h');
    expect(humanMinutes(1440)).toBe('1d');
    expect(humanMinutes(4320)).toBe('3d');
    expect(humanMinutes(1500)).toBe('1d 1h');
    // unknown ≠ zero: a missing target must not read as "0m"
    expect(humanMinutes(null)).toBeNull();
    expect(humanMinutes(undefined)).toBeNull();
    expect(humanMinutes(Number.NaN)).toBeNull();
  });

  it('deskHours prints nothing rather than a default day when there is no policy', () => {
    expect(deskHours({ openHourIst: 9, closeHourIst: 21 })).toBe('09:00–21:00 IST');
    expect(deskHours({ openHourIst: 0, closeHourIst: 24 })).toBe('00:00–24:00 IST');
    expect(deskHours(null)).toBeNull();
  });

  it('chainFor returns one severity in firing order', () => {
    const chain: ChainStep[] = [
      { severity: 'P0', afterMinutes: 120, channel: 'call', targetRole: 'ceo' },
      { severity: 'P1', afterMinutes: 0, channel: 'sms', targetRole: 'support_lead' },
      { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
    ];
    expect(chainFor(chain, 'P0').map((s) => s.afterMinutes)).toEqual([0, 120]);
    expect(chainFor(chain, 'P3')).toEqual([]);
  });

  it('names severities that have a target and NO chain — the condition this wave existed to remove', () => {
    const slas: SlaRow[] = SEVERITIES.map((s) => ({ severity: s, firstResponseMinutes: 10, resolutionMinutes: 20 }));
    const chain: ChainStep[] = [{ severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' }];
    expect(severitiesWithoutChain(slas, chain)).toEqual(['P1', 'P2', 'P3']);
    expect(severitiesWithoutChain(slas, [])).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('spots steps that would ring a phone for a severity excluded from after-hours cover', () => {
    const chain: ChainStep[] = [
      { severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' },
      { severity: 'P2', afterMinutes: 0, channel: 'call', targetRole: 'support_lead' },
      { severity: 'P3', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' },
    ];
    expect(afterHoursContradictions(chain, ['P0']).map((s) => s.severity)).toEqual(['P2']);
    // in_app never contradicts: it lands on a board, it does not wake anybody
    expect(afterHoursContradictions([chain[2]], [])).toEqual([]);
  });

  it('detects a policy with no night cover — a promise of minutes that only holds in office hours', () => {
    const wakes: ChainStep[] = [{ severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head' }];
    const quiet: ChainStep[] = [{ severity: 'P0', afterMinutes: 0, channel: 'in_app', targetRole: 'support_lead' }];
    expect(noNightCover(wakes, ['P0'])).toBe(false);
    expect(noNightCover(quiet, ['P0'])).toBe(true);       // P0 is "covered" by something that wakes nobody
    expect(noNightCover(wakes, [])).toBe(true);           // nothing is in scope after hours
    expect(noNightCover(wakes, ['P1'])).toBe(true);       // the only waking step is for a severity out of scope
  });

  it('knows which channels wake somebody', () => {
    expect(['call', 'sms', 'pager'].every(wakesSomebody)).toBe(true);
    expect(['in_app', 'email', 'whatsapp'].some(wakesSomebody)).toBe(false);
  });

  it('counts fired steps that were never delivered', () => {
    const ev = (status: string): FiredEvent => ({
      id: status, ticketId: 't', severity: 'P0', afterMinutes: 0, channel: 'call', targetRole: 'support_head',
      breachKind: 'first_response', breachedAt: 'x', firedAt: 'y', status,
    });
    const out = undeliveredEvents([ev('recorded'), ev('provider_pending'), ev('failed'), ev('sent')]);
    expect(out.map((e) => e.status)).toEqual(['provider_pending', 'failed']);
  });

  it('matrixIsCoherent refuses equal targets as well as inverted ones', () => {
    const ok: SlaRow[] = [
      { severity: 'P0', firstResponseMinutes: 15, resolutionMinutes: 240 },
      { severity: 'P1', firstResponseMinutes: 60, resolutionMinutes: 480 },
    ];
    expect(matrixIsCoherent(ok)).toBe(true);
    expect(matrixIsCoherent([ok[0], { ...ok[1], firstResponseMinutes: 15 }])).toBe(false);
    expect(matrixIsCoherent([ok[0], { ...ok[1], resolutionMinutes: 240 }])).toBe(false);
    expect(matrixIsCoherent([ok[0], { ...ok[1], firstResponseMinutes: 5 }])).toBe(false);
    // a partial matrix is not incoherent; it is incomplete, which is a different (server-side) refusal
    expect(matrixIsCoherent([ok[0]])).toBe(true);
    expect(matrixIsCoherent([])).toBe(true);
  });
});
