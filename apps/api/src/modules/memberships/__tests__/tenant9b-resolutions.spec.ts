// modules/memberships/__tests__/tenant9b-resolutions.spec.ts · PC-56 TENANT-9b · THE RESOLUTIONS — the rules, pure.
//
// What this pins (the live half is tenant9b-resolutions.integration.spec.ts):
//   • the RESULT — outcomeOf (0182's coop_resolution_outcome line for line), the pass rule's two comparators at their exact
//     boundaries, the special-majority setting's fallbacks, and resultView's branches: an OPEN vote is today's, a CLOSED
//     vote is its snapshot or "not recorded" — never today's roll (F-13);
//   • the BALLOT — a choice must be declared for the type; board_election is refused by name (no candidate table);
//   • the ACTS — open / close / withdraw verdicts in the order a person hears them, the second person on special and
//     dividend-class closes, the reason vocabulary, the window claim, the note bounds — and the state machine equals 0182's;
//   • the DRAFT REVIEW — every refusal, the formula the canon draws (per-share rate, patronage % with cap over a DECLARED
//     fiscal year), money at the currency's own scale, the diff on an edit;
//   • the payout formulas and the controller's shape (flagged, keyed, no old open/close routes).
import * as fs from 'fs';
import * as path from 'path';
import {
  GovernanceCatalogue, actVerdict, ballotVerdict, bpToPct, buildDraftReview, carries, choicesFor, DraftFacts, fiscalYearWindow,
  isCivilDateTime, needsSecondPerson, outcomeOf, passRuleFor, pctToBp, resultView, specialMajorityFrom, DEFAULT_SPECIAL,
} from '../domain/resolution-rules';
import { RESOLUTION_MOVES, actsFrom, canMove, isFinal } from '../domain/resolution.state';
import { allocate, parseFormula, allocationsTotal } from '../domain/coop-payout.rules';

const CAT: GovernanceCatalogue = {
  types: [
    { code: 'agm_vote', dividendClass: false, modelled: true },
    { code: 'dividend', dividendClass: true, modelled: true },
    { code: 'patronage_bonus', dividendClass: true, modelled: true },
    { code: 'board_election', dividendClass: false, modelled: false },
  ],
  choices: [
    { code: 'for', types: ['agm_vote', 'dividend', 'patronage_bonus'], inFavour: true },
    { code: 'against', types: ['agm_vote', 'dividend', 'patronage_bonus'], inFavour: false },
    { code: 'abstain', types: ['agm_vote', 'dividend', 'patronage_bonus'], inFavour: false },
  ],
  closeReasons: ['window_ended', 'all_have_voted', 'agm_declared'],
  withdrawReasons: ['drafting_error', 'superseded', 'legal_advice', 'board_decision'],
};
const FOR = ['for'];
const ORD = passRuleFor('ordinary', { quorumBp: 3300 }, DEFAULT_SPECIAL);
const SPC = passRuleFor('special', { quorumBp: 3300 }, DEFAULT_SPECIAL);
const votes = (f: number, a: number, ab = 0) => [{ choice: 'for', votes: f }, { choice: 'against', votes: a }, { choice: 'abstain', votes: ab }].filter((r) => r.votes > 0);
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const migration = () => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0182_resolutions.sql'), 'utf8');

describe('TENANT-9b · the pass rule — two comparators, exact at the boundary', () => {
  it('ordinary = MORE than half of cast (1e\'s inFavour × 2 > cast)', () => {
    expect(ORD).toEqual({ quorumBp: 3300, num: 1, den: 2, strict: true });
    expect(carries(5, 10, ORD)).toBe(false);   // exactly half does not carry
    expect(carries(6, 10, ORD)).toBe(true);
    expect(carries(1, 1, ORD)).toBe(true);
  });
  it('special = AT LEAST the declared fraction (2/3 by default) — exactly two-thirds carries', () => {
    expect(SPC).toEqual({ quorumBp: 3300, num: 2, den: 3, strict: false });
    expect(carries(2, 3, SPC)).toBe(true);
    expect(carries(200, 300, SPC)).toBe(true);
    expect(carries(199, 300, SPC)).toBe(false);
    expect(carries(6666, 10_000, SPC)).toBe(false);  // 66.66% is not two-thirds (a basis-point threshold would have said yes)
  });
  it('both rules carry the cooperative\'s OWN quorum (0130), never a literal', () => {
    expect(passRuleFor('special', { quorumBp: 5000 }, DEFAULT_SPECIAL).quorumBp).toBe(5000);
    expect(passRuleFor('ordinary', { quorumBp: 5000 }, DEFAULT_SPECIAL).quorumBp).toBe(5000);
    expect(passRuleFor('special', { quorumBp: 3300 }, { num: 3, den: 4 })).toEqual({ quorumBp: 3300, num: 3, den: 4, strict: false });
  });
  it('a broken special-majority setting falls back to two-thirds, never to a simple majority', () => {
    expect(specialMajorityFrom({ 'governance.special_majority_num': 3, 'governance.special_majority_den': 4 })).toEqual({ num: 3, den: 4 });
    expect(specialMajorityFrom({ 'governance.special_majority_num': '3', 'governance.special_majority_den': '4' })).toEqual({ num: 3, den: 4 });
    for (const [n, d] of [[1, 2], [1, 3], [3, 3], [4, 3], [0, 3], [2, 1], [2.5, 3]] as const) {
      expect(specialMajorityFrom({ 'governance.special_majority_num': n, 'governance.special_majority_den': d })).toEqual(DEFAULT_SPECIAL);
    }
    expect(specialMajorityFrom(null)).toEqual(DEFAULT_SPECIAL);
    expect(specialMajorityFrom({})).toEqual(DEFAULT_SPECIAL);
  });
});

describe('TENANT-9b · outcomeOf — 0182\'s coop_resolution_outcome, line for line', () => {
  it('not_recorded whenever the snapshot is incomplete — never a number from today', () => {
    expect(outcomeOf(votes(10, 0), FOR, null, ORD)).toBe('not_recorded');
    expect(outcomeOf(votes(10, 0), FOR, 20, null)).toBe('not_recorded');
  });
  it('zero ballots or nobody eligible is failed — a closed resolution decided, and nothing carried', () => {
    expect(outcomeOf([], FOR, 100, ORD)).toBe('failed');
    expect(outcomeOf(votes(5, 0), FOR, 0, ORD)).toBe('failed');
  });
  it('quorum is turnout ≥ quorum, in floor basis points', () => {
    expect(outcomeOf(votes(33, 0), FOR, 100, ORD)).toBe('passed');   // 3300 ≥ 3300
    expect(outcomeOf(votes(32, 0), FOR, 100, ORD)).toBe('failed');
    expect(outcomeOf(votes(1, 0), FOR, 3, ORD)).toBe('passed');      // 3333 ≥ 3300
    expect(outcomeOf(votes(10, 0), FOR, 31, ORD)).toBe('failed');    // floor(3225.8) = 3225
  });
  it('abstentions are CAST (they count toward quorum and against the fraction) — 1e\'s "of cast"', () => {
    expect(outcomeOf(votes(5, 4, 1), FOR, 10, ORD)).toBe('failed');  // 5 of 10 cast is not more than half
    expect(outcomeOf(votes(6, 3, 1), FOR, 10, ORD)).toBe('passed');
    expect(outcomeOf(votes(6, 0, 4), FOR, 10, SPC)).toBe('failed');  // 6/10 < 2/3
    expect(outcomeOf(votes(7, 0, 3), FOR, 10, SPC)).toBe('passed');
  });
  it('an undeclared choice can never be "in favour" — only the declared in-favour codes count', () => {
    expect(outcomeOf([{ choice: 'yes', votes: 10 }], FOR, 10, ORD)).toBe('failed');
  });
});

describe('TENANT-9b · resultView — an OPEN vote is today\'s; a CLOSED vote is its own snapshot (F-13)', () => {
  const closed = { status: 'closed', eligibleAtClose: 100, rule: ORD, ruleFixedAt: 'open' as const, outcome: 'passed' };
  it('closed: the denominator is eligible_at_close — whatever today\'s roll says', () => {
    const v = resultView(closed, votes(40, 10), FOR, 9999, passRuleFor('ordinary', { quorumBp: 9000 }, DEFAULT_SPECIAL));
    expect(v.basis).toBe('snapshot');
    expect(v.tally?.eligible).toBe(100);
    expect(v.tally?.turnoutBp).toBe(5000);
    expect(v.tally?.quorumBp).toBe(3300);       // the rule fixed at open, not today's 9000
    expect(v.outcome).toBe('passed');
    expect(v.disagreement).toBe(false);
  });
  it('closed: a recorded outcome the arithmetic disagrees with is FLAGGED, never silently replaced', () => {
    const v = resultView({ ...closed, outcome: 'failed' }, votes(40, 10), FOR, null, ORD);
    expect(v.outcome).toBe('failed');
    expect(v.disagreement).toBe(true);
  });
  it('a recorded "not_recorded" is the fact even beside a complete snapshot — never recomputed into a result', () => {
    const v = resultView({ ...closed, outcome: 'not_recorded' }, votes(40, 10), FOR, 9999, ORD);
    expect(v).toMatchObject({ basis: 'not_recorded', outcome: 'not_recorded' });
    expect(v.tally?.passed).toBeNull();
  });
  it('closed before 0130 (no denominator): not recorded, no tally at all', () => {
    const v = resultView({ status: 'closed', eligibleAtClose: null, rule: null, ruleFixedAt: null, outcome: 'not_recorded' }, votes(40, 10), FOR, 9999, ORD);
    expect(v).toMatchObject({ basis: 'not_recorded', outcome: 'not_recorded', tally: null });
  });
  it('closed between 0130 and 0182 (a denominator, no rule): turnout printable, result not', () => {
    const v = resultView({ status: 'closed', eligibleAtClose: 80, rule: null, ruleFixedAt: null, outcome: 'not_recorded' }, votes(40, 0), FOR, 9999, ORD);
    expect(v.basis).toBe('not_recorded');
    expect(v.tally?.turnoutBp).toBe(5000);
    expect(v.tally?.passed).toBeNull();
    expect(v.tally?.quorumMet).toBe(false);
  });
  it('open: today\'s roll, the rule fixed at open (or, opened before 0182, today\'s)', () => {
    const v = resultView({ status: 'open', eligibleAtClose: null, rule: SPC, ruleFixedAt: 'open', outcome: null }, votes(2, 1), FOR, 9, ORD);
    expect(v.basis).toBe('live');
    expect(v.tally).toMatchObject({ cast: 3, eligible: 9, turnoutBp: 3333, quorumMet: true, passed: true });   // 2/3 under SPECIAL
    const legacy = resultView({ status: 'open', eligibleAtClose: null, rule: null, ruleFixedAt: null, outcome: null }, votes(2, 1), FOR, 9, ORD);
    expect(legacy.rule).toEqual(ORD);
    // The rule FIXED at open decides an open vote, not today's: 3 for / 2 against carries an ordinary vote, not a special one.
    const fixed = resultView({ status: 'open', eligibleAtClose: null, rule: SPC, ruleFixedAt: 'open', outcome: null }, votes(3, 2), FOR, 9, ORD);
    expect(fixed.tally?.passed).toBe(false);
    expect(resultView({ status: 'open', eligibleAtClose: null, rule: ORD, ruleFixedAt: 'open', outcome: null }, votes(3, 2), FOR, 9, SPC).tally?.passed).toBe(true);
  });
  it('draft / withdrawn: nothing was decided', () => {
    expect(resultView({ status: 'draft', eligibleAtClose: null, rule: null, ruleFixedAt: null, outcome: null }, [], FOR, 5, ORD).basis).toBe('none');
    expect(resultView({ status: 'withdrawn', eligibleAtClose: null, rule: ORD, ruleFixedAt: 'open', outcome: null }, votes(1, 0), FOR, 5, ORD).basis).toBe('none');
  });
});

describe('TENANT-9b · the ballot — a choice is one the resolution DECLARES', () => {
  it('for / against / abstain on a motion; anything else refused', () => {
    expect(choicesFor(CAT, 'dividend')).toEqual(['for', 'against', 'abstain']);
    expect(ballotVerdict(CAT, 'agm_vote', 'for')).toBeNull();
    expect(ballotVerdict(CAT, 'agm_vote', 'yes')).toBe('CHOICE_UNDECLARED');
    expect(ballotVerdict(CAT, 'agm_vote', 'FOR')).toBe('CHOICE_UNDECLARED');
  });
  it('board_election: no candidate table — refused by name, whatever was typed', () => {
    expect(choicesFor(CAT, 'board_election')).toEqual([]);
    expect(ballotVerdict(CAT, 'board_election', 'Kavita Ben D.')).toBe('BOARD_ELECTION_NOT_MODELLED');
    expect(ballotVerdict(CAT, 'board_election', 'for')).toBe('BOARD_ELECTION_NOT_MODELLED');
  });
});

describe('TENANT-9b · the state machine — the same moves 0182\'s trigger allows', () => {
  it('draft → open → closed; draft|open → withdrawn; closed and withdrawn are final', () => {
    expect(canMove('open', 'draft')).toBe(true);
    expect(canMove('open', 'open')).toBe(false);
    expect(canMove('close', 'open')).toBe(true);
    expect(canMove('close', 'draft')).toBe(false);
    expect(canMove('withdraw', 'draft')).toBe(true);
    expect(canMove('withdraw', 'open')).toBe(true);
    for (const a of ['open', 'close', 'withdraw'] as const) { expect(canMove(a, 'closed')).toBe(false); expect(canMove(a, 'withdrawn')).toBe(false); }
    expect(isFinal('closed') && isFinal('withdrawn') && !isFinal('open') && !isFinal('draft')).toBe(true);
    expect(actsFrom('draft')).toEqual(['open', 'withdraw']);
    expect(actsFrom('open')).toEqual(['close', 'withdraw']);
    expect(actsFrom('closed')).toEqual([]);
  });
  it('0182\'s guard states exactly these moves (read from the migration)', () => {
    const sql = migration();
    expect(sql).toContain(`(OLD.status = 'draft' AND NEW.status IN ('open', 'withdrawn'))`);
    expect(sql).toContain(`(OLD.status = 'open'  AND NEW.status IN ('closed', 'withdrawn'))`);
    expect(sql).toContain(`IF OLD.status IN ('closed', 'withdrawn') THEN`);
    const moves = Object.entries(RESOLUTION_MOVES).map(([, m]) => `${m.from.join('|')}→${m.to}`).sort();
    expect(moves).toEqual(['draft|open→withdrawn', 'draft→open', 'open→closed']);
  });
  it('0182 computes the outcome with the same comparators outcomeOf uses', () => {
    const sql = migration();
    expect(sql).toContain('n_for * p_den > n_cast * p_num');
    expect(sql).toContain('n_for * p_den >= n_cast * p_num');
    expect(sql).toContain('turnout := (n_cast * 10000) / p_eligible;');
    expect(sql).toContain(`NEW.outcome := coop_resolution_outcome(`);
  });
});

describe('TENANT-9b · actVerdict — permission → state → rule → second person → reason', () => {
  const now = new Date('2026-07-19T13:00:00.000Z');
  const admin = { userId: 'u-admin', canManage: true };
  const other = { userId: 'u-other', canManage: true };
  const base = { status: 'draft', resolutionType: 'agm_vote', majority: 'ordinary', votingCloses: '2026-07-20T12:30:00.000Z', openedBy: null as string | null };
  const note = { note: 'AGM item 4, as minuted' };
  it('open: a draft opens with a note; not without one; never twice', () => {
    expect(actVerdict('open', base, admin, note, CAT, now)).toMatchObject({ allowed: true, refusals: [] });
    expect(actVerdict('open', base, admin, {}, CAT, now).refusals).toEqual(['NOTE_REQUIRED']);
    expect(actVerdict('open', base, admin, { note: 'ok' }, CAT, now).refusals).toEqual(['NOTE_REQUIRED']);
    expect(actVerdict('open', base, admin, { note: 'x'.repeat(301) }, CAT, now).refusals).toEqual(['NOTE_TOO_LONG']);
    expect(actVerdict('open', { ...base, status: 'open' }, admin, note, CAT, now).refusals).toEqual(['NOT_A_DRAFT']);
  });
  it('open: no permission is said first; a board_election and a window already past are refused by name', () => {
    expect(actVerdict('open', base, { userId: 'm', canManage: false }, note, CAT, now).refusals[0]).toBe('NO_PERMISSION');
    expect(actVerdict('open', { ...base, resolutionType: 'board_election' }, admin, note, CAT, now).refusals).toEqual(['BOARD_ELECTION_NOT_MODELLED']);
    expect(actVerdict('open', { ...base, votingCloses: '2026-07-19T12:59:59.000Z' }, admin, note, CAT, now).refusals).toEqual(['WINDOW_ALREADY_ENDED']);
  });
  it('close: a declared reason; "window ended" only once it has', () => {
    const open = { ...base, status: 'open', openedBy: 'u-admin' };
    expect(actVerdict('close', open, admin, { ...note, reasonCode: 'agm_declared' }, CAT, now).allowed).toBe(true);
    expect(actVerdict('close', open, admin, note, CAT, now).refusals).toEqual(['REASON_REQUIRED']);
    expect(actVerdict('close', open, admin, { ...note, reasonCode: 'because' }, CAT, now).refusals).toEqual(['REASON_UNKNOWN']);
    expect(actVerdict('close', open, admin, { ...note, reasonCode: 'window_ended' }, CAT, now).refusals).toEqual(['WINDOW_NOT_ENDED']);
    expect(actVerdict('close', { ...open, votingCloses: null }, admin, { ...note, reasonCode: 'window_ended' }, CAT, now).refusals).toEqual(['WINDOW_NOT_ENDED']);
    expect(actVerdict('close', { ...open, votingCloses: '2026-07-19T12:00:00.000Z' }, admin, { ...note, reasonCode: 'window_ended' }, CAT, now).allowed).toBe(true);
    expect(actVerdict('close', base, admin, { ...note, reasonCode: 'agm_declared' }, CAT, now).refusals).toEqual(['NOT_OPEN']);
  });
  it('close: a SPECIAL or DIVIDEND-CLASS resolution needs a person other than its opener', () => {
    for (const s of [{ resolutionType: 'dividend', majority: 'ordinary' }, { resolutionType: 'patronage_bonus', majority: 'ordinary' }, { resolutionType: 'agm_vote', majority: 'special' }]) {
      const open = { ...base, ...s, status: 'open', openedBy: 'u-admin' };
      expect(needsSecondPerson(CAT, open)).toBe(true);
      const mine = actVerdict('close', open, admin, { ...note, reasonCode: 'agm_declared' }, CAT, now);
      expect(mine).toMatchObject({ allowed: false, refusals: ['SECOND_PERSON_REQUIRED'], secondPerson: true });
      expect(actVerdict('close', open, other, { ...note, reasonCode: 'agm_declared' }, CAT, now).allowed).toBe(true);
    }
    const ordinary = { ...base, status: 'open', openedBy: 'u-admin' };
    expect(needsSecondPerson(CAT, ordinary)).toBe(false);
    expect(actVerdict('close', ordinary, admin, { ...note, reasonCode: 'agm_declared' }, CAT, now).allowed).toBe(true);
    // Opened before 0182 — no opener recorded: the rule cannot name a person nobody wrote down (named, not invented).
    expect(actVerdict('close', { ...ordinary, resolutionType: 'dividend', openedBy: null }, admin, { ...note, reasonCode: 'agm_declared' }, CAT, now).allowed).toBe(true);
  });
  it('withdraw: draft or open, a declared reason; never once decided', () => {
    expect(actVerdict('withdraw', base, admin, { ...note, reasonCode: 'drafting_error' }, CAT, now).allowed).toBe(true);
    expect(actVerdict('withdraw', { ...base, status: 'open' }, admin, { ...note, reasonCode: 'superseded' }, CAT, now).allowed).toBe(true);
    expect(actVerdict('withdraw', base, admin, { ...note, reasonCode: 'agm_declared' }, CAT, now).refusals).toEqual(['REASON_UNKNOWN']);
    expect(actVerdict('withdraw', { ...base, status: 'closed' }, admin, { ...note, reasonCode: 'superseded' }, CAT, now).refusals).toEqual(['ALREADY_DECIDED']);
    expect(actVerdict('open', { ...base, status: 'withdrawn' }, admin, note, CAT, now).refusals).toEqual(['ALREADY_DECIDED']);
  });
});

describe('TENANT-9b · the draft review (W2741–W2744) — what will be STORED, and every reason it would not be', () => {
  const facts = (over: Partial<DraftFacts> = {}): DraftFacts => ({
    canManage: true, catalogue: CAT, zone: 'Asia/Kolkata', currency: { code: 'INR', minorUnits: 2 }, fyMonth: 4,
    bylaws: { quorumBp: 3300 }, special: DEFAULT_SPECIAL, opensAt: '2026-07-05T03:30:00.000Z', closesAt: '2026-07-19T12:30:00.000Z',
    now: new Date('2026-07-01T00:00:00.000Z'), current: null, ...over,
  });
  const motion = { title: 'Adopt digital AGM notices', resolutionType: 'agm_vote', votingOpens: '2026-07-05T09:00', votingCloses: '2026-07-19T18:00' };
  const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field ?? '-'}:${x.code}`);

  it('a plain motion is ready: the window as instants in the cooperative\'s zone, the declared ballot, the rule', () => {
    const r = buildDraftReview(motion, facts());
    expect(r.ready).toBe(true);
    expect(r.window).toEqual({ zone: 'Asia/Kolkata', opensCivil: '2026-07-05T09:00', closesCivil: '2026-07-19T18:00', opensAt: '2026-07-05T03:30:00.000Z', closesAt: '2026-07-19T12:30:00.000Z' });
    expect(r.fields.find((f) => f.name === 'votingCloses')).toMatchObject({ stored: '2026-07-19T12:30:00.000Z', normalised: true });
    expect(r.choices).toEqual(['for', 'against', 'abstain']);
    expect(r.rule).toEqual(ORD);
    expect(r.secondPersonToClose).toBe(false);
    expect(r.payload).toBeNull();
    expect(r.diff).toBeNull();
    expect(r.fields.map((f) => f.name)).not.toContain('formulaMode');   // a motion carries no money fields
  });
  it('every refusal at once — title, type, majority, dates', () => {
    expect(codes(buildDraftReview({}, facts({ canManage: false })))).toEqual(['-:NO_PERMISSION', 'title:TITLE_REQUIRED', 'resolutionType:TYPE_REQUIRED']);
    expect(codes(buildDraftReview({ ...motion, title: 'ab' }, facts()))).toEqual(['title:TITLE_TOO_SHORT']);
    expect(codes(buildDraftReview({ ...motion, title: 'x'.repeat(251) }, facts()))).toEqual(['title:TOO_LONG']);
    expect(codes(buildDraftReview({ ...motion, title: 'Adopt <b>notices</b>' }, facts()))).toEqual(['title:TEXT_HAS_MARKUP']);
    expect(codes(buildDraftReview({ ...motion, body: '<script>' }, facts()))).toEqual(['body:TEXT_HAS_MARKUP']);
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'referendum' }, facts()))).toEqual(['resolutionType:TYPE_UNKNOWN']);
    expect(codes(buildDraftReview({ ...motion, majority: 'unanimous' }, facts()))).toEqual(['majority:MAJORITY_UNKNOWN']);
    expect(codes(buildDraftReview({ ...motion, votingOpens: '2026-02-30T09:00' }, facts()))).toEqual(['votingOpens:DATE_INVALID']);
    expect(codes(buildDraftReview({ ...motion, votingCloses: '19/07/2026' }, facts()))).toEqual(['votingCloses:DATE_INVALID']);
    expect(codes(buildDraftReview(motion, facts({ closesAt: '2026-07-05T03:30:00.000Z' })))).toEqual(['votingCloses:WINDOW_ORDER']);
    expect(codes(buildDraftReview(motion, facts({ now: new Date('2026-07-20T00:00:00.000Z') })))).toEqual(['votingCloses:CLOSES_IN_PAST']);
  });
  it('board_election is refused by name at drafting — no candidate table exists', () => {
    const r = buildDraftReview({ ...motion, resolutionType: 'board_election' }, facts());
    expect(codes(r)).toEqual(['resolutionType:BOARD_ELECTION_NOT_MODELLED']);
    expect(r.choices).toEqual([]);
  });
  it('a special majority shows its fraction and that a second person closes it', () => {
    const r = buildDraftReview({ ...motion, majority: 'special' }, facts());
    expect(r.rule).toEqual(SPC);
    expect(r.secondPersonToClose).toBe(true);
  });
  it('a dividend-class resolution MUST carry a formula; a motion must NOT', () => {
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'dividend' }, facts()))).toEqual(['formulaMode:FORMULA_REQUIRED']);
    expect(codes(buildDraftReview({ ...motion, formulaMode: 'equal_split', potAmount: '1000' }, facts())))
      .toEqual(['formulaMode:FORMULA_NOT_FOR_TYPE', 'potAmount:FORMULA_NOT_FOR_TYPE']);
  });
  it('W198 "Dividend 8%": a per-share rate — 8 → 800 bp', () => {
    const r = buildDraftReview({ ...motion, resolutionType: 'dividend', formulaMode: 'per_share_rate', ratePct: '8' }, facts());
    expect(r.ready).toBe(true);
    expect(r.payload).toEqual({ mode: 'per_share_rate', rateBp: 800, currencyCode: 'INR' });
    expect(r.secondPersonToClose).toBe(true);
  });
  it('W198 "1.2% of member\'s FY sales, cap ₹2,500/member": patronage % with a cap over the DECLARED fiscal year', () => {
    const r = buildDraftReview({ ...motion, resolutionType: 'patronage_bonus', formulaMode: 'patronage_pct', ratePct: '1.2', capAmount: '2500', fiscalYear: '2025' }, facts());
    expect(r.ready).toBe(true);
    expect(r.payload).toEqual({ mode: 'patronage_pct', rateBp: 120, capMinor: '250000', fiscalYear: 2025, currencyCode: 'INR' });
    expect(r.formula).toMatchObject({ fiscalYearFrom: '2025-04-01', fiscalYearToExclusive: '2026-04-01', capMinor: '250000' });
    expect(r.fields.find((f) => f.name === 'capAmount')?.stored).toBe('2500.00');
    // A July–June cooperative's FY 2025 is a different window — never an assumed April.
    expect(buildDraftReview({ ...motion, resolutionType: 'patronage_bonus', formulaMode: 'patronage_pct', ratePct: '1.2', fiscalYear: '2025' }, facts({ fyMonth: 7 })).formula)
      .toMatchObject({ fiscalYearFrom: '2025-07-01', fiscalYearToExclusive: '2026-07-01', capMinor: null });
  });
  it('a fiscal-year formula on a cooperative with NO declared fiscal year is refused by name', () => {
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'patronage_bonus', formulaMode: 'patronage_pct', ratePct: '1.2', fiscalYear: '2025' }, facts({ fyMonth: null }))))
      .toEqual(['fiscalYear:FY_NOT_DECLARED']);
  });
  it('money at the CURRENCY\'s scale — INR 2, JPY 0; a fraction past the scale refused; no currency, no money form', () => {
    const pot = (amt: string, cur: DraftFacts['currency']) => buildDraftReview({ ...motion, resolutionType: 'dividend', formulaMode: 'equal_split', potAmount: amt }, facts({ currency: cur }));
    expect(pot('420000', { code: 'INR', minorUnits: 2 }).payload).toEqual({ mode: 'equal_split', potMinor: '42000000', currencyCode: 'INR' });
    expect(pot('420000', { code: 'JPY', minorUnits: 0 }).payload).toEqual({ mode: 'equal_split', potMinor: '420000', currencyCode: 'JPY' });
    expect(codes(pot('100.005', { code: 'INR', minorUnits: 2 }))).toEqual(['potAmount:POT_INVALID']);
    expect(codes(pot('0', { code: 'INR', minorUnits: 2 }))).toEqual(['potAmount:POT_INVALID']);
    expect(codes(pot('-5', { code: 'INR', minorUnits: 2 }))).toEqual(['potAmount:POT_INVALID']);
    expect(codes(pot('1000', null))).toEqual(['-:CURRENCY_UNKNOWN', 'potAmount:POT_INVALID']);
  });
  it('a value typed into a field the mode does not read is refused, not silently dropped', () => {
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'dividend', formulaMode: 'per_share_rate', ratePct: '8', potAmount: '1000' }, facts())))
      .toEqual(['potAmount:FIELD_NOT_FOR_MODE']);
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'dividend', formulaMode: 'per_share_rate', ratePct: '101' }, facts()))).toEqual(['ratePct:RATE_INVALID']);
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'dividend', formulaMode: 'vibes' }, facts()))).toEqual(['formulaMode:FORMULA_MODE']);
    expect(codes(buildDraftReview({ ...motion, resolutionType: 'patronage_bonus', formulaMode: 'patronage_pct', ratePct: '1', capAmount: '0', fiscalYear: '1999' }, facts())))
      .toEqual(['capAmount:CAP_INVALID', 'fiscalYear:FISCAL_YEAR_INVALID']);
  });
  it('an EDIT shows the diff of changed fields only, and a non-draft is NOT_A_DRAFT', () => {
    const current = { status: 'draft', title: 'Adopt digital AGM notices', body: null, resolutionType: 'agm_vote', majority: 'ordinary', votingOpensCivil: '2026-07-05T09:00', votingClosesCivil: '2026-07-18T18:00', payload: {} };
    const r = buildDraftReview(motion, facts({ current }));
    expect(r.diff).toEqual([{ field: 'votingCloses', before: '2026-07-18T18:00', after: '2026-07-19T18:00' }]);
    expect(codes(buildDraftReview(motion, facts({ current: { ...current, status: 'open' } })))).toEqual(['-:NOT_A_DRAFT']);
  });
  it('the small parsers', () => {
    expect([pctToBp('1.2'), pctToBp('8'), pctToBp('0.01'), pctToBp('100'), pctToBp('100.01'), pctToBp('0'), pctToBp('1.234'), pctToBp('x')]).toEqual([120, 800, 1, 10_000, null, null, null, null]);
    expect([bpToPct(120), bpToPct(800), bpToPct(1), bpToPct(1250)]).toEqual(['1.2', '8', '0.01', '12.5']);
    expect([isCivilDateTime('2026-07-19T18:00'), isCivilDateTime('2026-07-19T24:00'), isCivilDateTime('2026-13-01T00:00'), isCivilDateTime('2026-07-19 18:00'), isCivilDateTime('2028-02-29T00:00'), isCivilDateTime('2026-02-29T00:00')])
      .toEqual([true, false, false, false, true, false]);
    expect(fiscalYearWindow(2025, 1)).toEqual({ from: '2025-01-01', toExclusive: '2026-01-01' });
    expect(fiscalYearWindow(2025, 12)).toEqual({ from: '2025-12-01', toExclusive: '2026-12-01' });
  });
});

describe('TENANT-9b · the payout formulas the canon draws (F-14)', () => {
  it('parseFormula accepts the two rate modes and refuses broken ones by code', () => {
    expect(parseFormula({ mode: 'per_share_rate', rateBp: 800 })).toEqual({ ok: true, value: { mode: 'per_share_rate', rateBp: 800 } });
    expect(parseFormula({ mode: 'patronage_pct', rateBp: 120, capMinor: '250000', fiscalYear: 2025 }).ok).toBe(true);
    expect(parseFormula({ mode: 'patronage_pct', rateBp: 120, fiscalYear: 2025 })).toEqual({ ok: true, value: { mode: 'patronage_pct', rateBp: 120, capMinor: null, fiscalYear: 2025 } });
    expect(parseFormula({ mode: 'per_share_rate', rateBp: 0 })).toMatchObject({ ok: false, code: 'FORMULA_RATE' });
    expect(parseFormula({ mode: 'per_share_rate', rateBp: 10_001 })).toMatchObject({ ok: false, code: 'FORMULA_RATE' });
    expect(parseFormula({ mode: 'per_share_rate', rateBp: '800' })).toMatchObject({ ok: false, code: 'FORMULA_RATE' });
    expect(parseFormula({ mode: 'patronage_pct', rateBp: 120 })).toMatchObject({ ok: false, code: 'FORMULA_FISCAL_YEAR' });
    expect(parseFormula({ mode: 'patronage_pct', rateBp: 120, fiscalYear: 2025, capMinor: '0' })).toMatchObject({ ok: false, code: 'FORMULA_CAP' });
  });
  it('a per-share rate pays floor(holding × rate); the total IS the sum', () => {
    const out = allocate({ mode: 'per_share_rate', rateBp: 800 }, [{ userId: 'a', basisMinor: '800000' }, { userId: 'b', basisMinor: '199' }]);
    expect(out).toEqual([{ userId: 'a', amountMinor: '64000' }, { userId: 'b', amountMinor: '15' }]);   // 15.92 → 15
    expect(allocationsTotal(out)).toBe('64015');
  });
  it('a patronage percentage is capped per member', () => {
    const out = allocate({ mode: 'patronage_pct', rateBp: 120, capMinor: '250000', fiscalYear: 2025 },
      [{ userId: 'small', basisMinor: '10000000' }, { userId: 'big', basisMinor: '50000000' }, { userId: 'none', basisMinor: '0' }]);
    expect(out).toEqual([{ userId: 'small', amountMinor: '120000' }, { userId: 'big', amountMinor: '250000' }, { userId: 'none', amountMinor: '0' }]);
    const uncapped = allocate({ mode: 'patronage_pct', rateBp: 120, capMinor: null, fiscalYear: 2025 }, [{ userId: 'big', basisMinor: '50000000' }]);
    expect(uncapped[0].amountMinor).toBe('600000');
  });
});

describe('TENANT-9b · the routes — flagged, keyed, one write path', () => {
  const src = () => read('controllers/v1/governance.controller.ts');
  it('the controller is behind the memberships flag (Law 10)', () => {
    expect(src()).toContain(`@FeatureFlag('memberships')`);
    expect(src()).toContain('FeatureFlagGuard');
  });
  it('the old open / close routes are gone — the act is one route, through the confirm', () => {
    expect(src()).not.toMatch(/@Post\(':id\/open'\)/);
    expect(src()).not.toMatch(/@Post\(':id\/close'\)/);
    expect(src()).toContain(`@Post(':id/acts/:act')`);
  });
  it('every write route takes the Idempotency-Key (Law 3)', () => {
    const s = src();
    for (const m of ['create(', 'update(', 'act(', 'payoutPrepare(', 'payoutConfirm(', 'payoutCancel(']) {
      const at = s.indexOf(`  ${m}`);
      expect(at).toBeGreaterThan(-1);
      expect(s.slice(at, s.indexOf('\n  }', at))).toContain('needKey(key)');
    }
  });
  it('the payout run has no "confirmedBy" in the maker\'s body any more', () => {
    expect(src()).not.toContain('confirmedBy');
  });
  it('every query on coop_resolutions / coop_votes is bound to the tenant in its own SQL — RLS is the net, not the plan (Law 1)', () => {
    const repo = read('repositories/governance.repository.ts');
    const sqls = [...repo.matchAll(/`([^`]*\b(?:FROM|UPDATE|INTO)\s+coop_(?:resolutions|votes)\b[^`]*)`/g)].map((m) => m[1]);
    expect(sqls.length).toBeGreaterThan(10);
    for (const q of sqls) expect([q.slice(0, 60), /tenant_id\s*=\s*\$\d|INSERT INTO coop_(resolutions|votes) \([^)]*tenant_id/.test(q)]).toEqual([q.slice(0, 60), true]);
    // …and a query that reads an ALIASED table binds THAT alias (a bound sub-select beside an unbound outer read is not a bind).
    for (const q of sqls) {
      for (const m of q.matchAll(/FROM coop_(resolutions|votes) ([a-z])\b/g)) {
        expect([q.slice(0, 60), new RegExp(`\\b${m[2]}\\.tenant_id\\s*=\\s*\\$\\d`).test(q)]).toEqual([q.slice(0, 60), true]);
      }
    }
  });
  it('results() counts today\'s roll ONLY for an open resolution', () => {
    const s = read('services/governance.service.ts');
    const r = s.slice(s.indexOf('async results('));
    expect(r).toMatch(/res\.status === 'open' \? await this\.repo\.eligibleCount\(/);
  });
});
