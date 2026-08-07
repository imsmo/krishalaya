// apps/web-admin/src/test/admin8b-residency-migration.spec.ts · PC-56 ADMIN-8b console spec.
//
// The view logic that decides what a reader BELIEVES. Three of these tests exist because the honest reading and the
// convenient reading differ:
//   • an empty log means opposite things depending on whether the log was running (the wave's whole finding);
//   • an UNKNOWN preflight check is drawn louder than a failed one, and offers no waiver;
//   • only `done` means the tenant's data moved.
import {
  attestationClass, attestationKey, canOpenCell, checkClass, checkKey, checkState, claimKey, cleanupKey,
  dataLocationKey, emptyLogClass, emptyLogKey, executorNoticeKey, freezeClass, freezeKey, gateClass, jobClass, jobKey,
  outcomeClass, planStatusClass, planStatusKey, postureClass, postureKey, provisioningClass, provisioningKey,
  refusalIsBoundary, refusalKey, regulationClass, regulationKey, showWaiver, smokeClass, smokeKey, stepKey,
  triggerKey, PROVISIONING_STEPS,
} from '../features/cells/residency-migration';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;

describe('ADMIN-8b · the empty log', () => {
  // **THE FINDING OF THE WAVE, AS AN ASSERTION.** "Nothing was attempted" and "nothing was ever recorded" render the same
  // in W033 today, and they are opposite findings.
  it('says two different things depending on whether the log was ever running', () => {
    expect(emptyLogKey(null)).toBe('rz.log.neverRecorded');
    expect(emptyLogKey('2026-01-01T00:00:00Z')).toBe('rz.log.nothingAttempted');
    expect(emptyLogKey(null)).not.toBe(emptyLogKey('2026-01-01T00:00:00Z'));
  });

  it('draws "never recorded" as danger and a covered window as ordinary', () => {
    expect(emptyLogClass(null)).toContain('is-danger');
    expect(emptyLogClass('2026-01-01T00:00:00Z')).not.toContain('is-danger');
  });
});

describe('ADMIN-8b · refusals', () => {
  // Only two of the four refusals ARE the boundary. An attestation counting "the cell did not exist" as protection
  // would be claiming credit for a typo.
  it.each([
    ['residency_lock', true],
    ['country_mismatch', true],
    ['cell_missing', false],
    ['profile_not_ratified', false],
  ])('%s is a boundary refusal: %s', (refusal, expected) => {
    expect(refusalIsBoundary(refusal as string)).toBe(expected);
  });

  it('renders an unrecognised refusal rather than dropping it', () => {
    expect(refusalKey('something_new')).toBe('rz.refused.other');
    expect(dict[refusalKey('something_new')]).toBeTruthy();
  });

  // I first wrote this expecting DANGER and the code said WARN — and the code is right. A cross-border transfer
  // permitted under a recorded legal basis is LAWFUL; what is alarming is a permitted transfer with no basis, and that
  // is flagged in danger on the attestation where the count lives. Painting every permitted row red would teach an
  // operator that the loud colour means "unusual" rather than "wrong".
  it('draws a PERMITTED transfer apart from a blocked one, without calling it a violation', () => {
    expect(outcomeClass('allowed')).toContain('is-warn');
    expect(outcomeClass('allowed')).not.toContain('is-ok');
    expect(outcomeClass('blocked')).toContain('is-ok');
    expect(outcomeClass('allowed')).not.toBe(outcomeClass('blocked'));
    // The danger belongs to the basis-less subset, and it is stated there.
    expect(dict['rz.attest.withoutBasis']).toMatch(/no lawful transfer without one/i);
  });
});

describe('ADMIN-8b · the attestation', () => {
  it('makes "cannot attest" the loudest verdict', () => {
    expect(attestationClass('no_evidence')).toContain('is-danger');
    expect(attestationClass('unknown')).toContain('is-danger');
    expect(attestationClass('clean')).toContain('is-ok');
  });

  // A clean verdict and an unattestable one must never share a label — the whole point is that they are different.
  it('never renders no_evidence with the clean label', () => {
    expect(attestationKey('no_evidence')).not.toBe(attestationKey('clean'));
    expect(dict[attestationKey('transfers_occurred')]).toBeTruthy();
  });

  it('carries every claim as a whole sentence, so the compliance record reads identically everywhere', () => {
    for (const c of ['no_cross_border_transfers', 'transfers_under_basis', 'cannot_attest']) {
      expect(dict[claimKey(c)]).toBeTruthy();
      expect(dict[claimKey(c)].length).toBeGreaterThan(40);
    }
  });

  it('falls back to the cannot-attest claim for an unrecognised claim rather than to the clean one', () => {
    expect(claimKey('whatever')).toBe('rz.claim.cannot_attest');
  });
});

describe('ADMIN-8b · country posture', () => {
  // "The boundary holds" and "there is nothing here to protect" are different statements.
  it('distinguishes no_cells from blocked', () => {
    expect(postureKey('no_cells')).not.toBe(postureKey('blocked'));
    expect(postureClass('partial')).toContain('is-danger');
    expect(postureClass('blocked')).toContain('is-ok');
    // A country with no cells is neither good news nor bad news.
    expect(postureClass('no_cells')).not.toContain('is-ok');
    expect(postureClass('no_cells')).not.toContain('is-danger');
  });

  it('does not dress a draft profile as a profile', () => {
    expect(regulationKey('draft')).toBe('rz.reg.draft');
    expect(regulationClass('draft')).not.toContain('is-ok');
    expect(regulationClass('ratified')).toContain('is-ok');
    expect(regulationClass('none')).toContain('is-danger');
  });

  it('draws a closed market-entry gate as a warning and an open one as ok', () => {
    expect(gateClass(true)).toContain('is-ok');
    expect(gateClass(false)).not.toContain('is-ok');
  });
});

describe('ADMIN-8b · where the data is', () => {
  // The most consequential cell in the migrations table. A console that got this wrong would tell somebody their data
  // is in a country it is not in.
  it.each(['queued', 'copying', 'verifying', 'cutover', 'rolled_back', 'failed'])(
    '%s still reads as the SOURCE', (s) => {
      expect(dataLocationKey(s)).toBe('rz.where.source');
    });

  it('only done reads as the target', () => {
    expect(dataLocationKey('done')).toBe('rz.where.target');
  });

  it('renders every pipeline state, and an unknown one visibly', () => {
    for (const s of ['queued', 'copying', 'verifying', 'cutover', 'done', 'rolled_back', 'failed']) {
      expect(dict[jobKey(s)]).toBeTruthy();
    }
    expect(jobKey('teleporting')).toBe('rz.job.unknown');
    expect(jobClass('cutover')).toContain('is-danger');   // the tenant is offline
  });
});

describe('ADMIN-8b · the executor that does not exist', () => {
  // A console rendering `queued` as though something were about to pick it up would be the sixth
  // status-recording-an-act-nobody-performs on this platform.
  it('returns a notice while the executor is absent, and none once it exists', () => {
    expect(executorNoticeKey(false)).toBe('rz.executor.absent');
    expect(executorNoticeKey(true)).toBeNull();
  });

  it('states plainly that there is no machine', () => {
    expect(dict['rz.executor.absent']).toMatch(/there is no machine/i);
  });
});

describe('ADMIN-8b · the write freeze', () => {
  // Two independent facts — running/finished and within/over budget — and FOUR distinct readings. An over-budget
  // RUNNING freeze is the one somebody must see immediately: the tenant is offline and the promise is already broken.
  it('separates running-over from finished-over', () => {
    expect(freezeKey('running', true)).toBe('rz.freeze.runningOver');
    expect(freezeKey('finished', true)).toBe('rz.freeze.finishedOver');
    expect(freezeKey('running', true)).not.toBe(freezeKey('finished', true));
  });

  it('escalates only the running-over case to danger', () => {
    expect(freezeClass('running', true)).toContain('is-danger');
    expect(freezeClass('running', false)).toContain('is-warn');
    expect(freezeClass('finished', true)).toContain('is-warn');
    expect(freezeClass('finished', false)).toContain('is-ok');
    expect(freezeClass('unreadable', false)).toContain('is-danger');
  });

  it('renders each cleanup verdict, and an unrecognised one without inventing a state', () => {
    for (const k of ['not_applicable', 'holding', 'due', 'done']) expect(dict[cleanupKey(k)]).toBeTruthy();
    expect(cleanupKey('shredded')).toBe('rz.cleanup.not_applicable');
  });
});

describe('ADMIN-8b · the preflight', () => {
  it('reports a check that did not run as unknown, never as a pass', () => {
    expect(checkState({ ok: true })).toBe('pass');
    expect(checkState({ ok: false })).toBe('blocked');
    expect(checkState({ ok: false, unknown: true })).toBe('unknown');
  });

  // **UNKNOWN IS LOUDER THAN BLOCKED**, which inverts the usual severity ordering and is deliberate: a failure is a known
  // problem with a next step; an unrun guard is a blind one.
  it('draws unknown louder than blocked', () => {
    expect(checkClass('unknown')).toContain('is-danger');
    expect(checkClass('blocked')).toContain('is-warn');
    expect(checkClass('pass')).toContain('is-ok');
  });

  it('offers no waiver for an unwaivable check', () => {
    expect(showWaiver('no_open_payouts', 'blocked')).toBe(false);
    expect(showWaiver('no_live_auctions', 'blocked')).toBe(true);
  });

  // Waiving a check that did not run is asserting a result nobody has.
  it('offers no waiver for an unknown check, even a waivable one', () => {
    expect(showWaiver('no_live_auctions', 'unknown')).toBe(false);
    expect(showWaiver('within_window_budget', 'unknown')).toBe(false);
  });

  it('offers no waiver for a passing check', () => {
    expect(showWaiver('no_live_auctions', 'pass')).toBe(false);
  });

  it('names all four checks', () => {
    for (const c of ['no_open_payouts', 'no_live_auctions', 'outbox_drained', 'within_window_budget']) {
      expect(dict[checkKey(c)]).toBeTruthy();
    }
    expect(checkKey('vibes')).toBe('rz.check.other');
  });

  it('tells the operator that a blank input means unknown rather than zero', () => {
    expect(dict['rz.pf.blankIsUnknown']).toMatch(/never treated as zero/i);
  });
});

describe('ADMIN-8b · the plan', () => {
  it('renders a trigger as a sentence, never as raw json', () => {
    expect(triggerKey({ kind: 'utilisation', percent: 70 })).toBe('rz.trigger.utilisation');
    expect(triggerKey({ kind: 'market_entry', country: 'BD' })).toBe('rz.trigger.market_entry');
    expect(triggerKey({ kind: 'manual' })).toBe('rz.trigger.manual');
    // An unrecognised trigger still reads as a sentence rather than leaking jsonb into the table.
    expect(triggerKey({ kind: 'phase_of_moon' })).toBe('rz.trigger.other');
    expect(triggerKey({})).toBe('rz.trigger.other');
  });

  it('does not colour a gated step as done', () => {
    expect(planStatusClass('gated')).toContain('is-warn');
    expect(planStatusClass('done')).toContain('is-ok');
    expect(planStatusKey('nonsense')).toBeTruthy();
    expect(dict[planStatusKey('nonsense')]).toBeTruthy();
  });

  // The forecast is absent and the absence is named — a projection line drawn with no growth model behind it would be
  // a plan somebody could act on.
  it('names the missing forecast rather than drawing one', () => {
    expect(dict['rz.plan.noForecast']).toMatch(/\{delta\}/);
    expect(dict['rz.plan.noForecast']).toMatch(/nothing/i);
  });
});

describe('ADMIN-8b · provisioning', () => {
  it('keeps the checklist in W038 order', () => {
    expect([...PROVISIONING_STEPS]).toEqual(['infra', 'shards', 'residency', 'smoke', 'default_flag', 'open']);
    for (const s of PROVISIONING_STEPS) expect(dict[stepKey(s)]).toBeTruthy();
    expect(stepKey('sacrifice')).toBe('rz.step.other');
  });

  // **A CELL NOBODY HAS PROVED WORKS MUST NOT OPEN**, and `ck_cpr_open_needs_smoke` makes that a database fact.
  it('permits opening only after a PASSED smoke test', () => {
    expect(canOpenCell('passed', 'ready')).toBe(true);
    expect(canOpenCell('failed', 'ready')).toBe(false);
    expect(canOpenCell(null, 'ready')).toBe(false);
    expect(canOpenCell('passed', 'open')).toBe(false);      // already open
    expect(canOpenCell('passed', 'abandoned')).toBe(false);
  });

  it('draws a not-run smoke as a warning rather than as neutral', () => {
    expect(smokeClass('passed')).toContain('is-ok');
    expect(smokeClass('failed')).toContain('is-danger');
    expect(smokeClass(null)).toContain('is-warn');
    expect(dict[smokeKey(null)]).toBeTruthy();
  });

  it('renders every provisioning status', () => {
    for (const s of ['drafting', 'awaiting_infra', 'smoke', 'ready', 'open', 'abandoned']) {
      expect(dict[provisioningKey(s)]).toBeTruthy();
    }
    expect(provisioningClass('open')).toContain('is-ok');
  });

  // The console never applies infrastructure, and the sentence saying so must survive a refactor of this page.
  it('states that this console never holds cloud credentials', () => {
    expect(dict['rz.prov.noApply']).toMatch(/cloud credentials/i);
  });

  it('explains why a drafted profile does not open a market', () => {
    expect(dict['rz.prov.gateNote']).toMatch(/draft/i);
    expect(dict['rz.prov.noEligibleCountry']).toMatch(/profile comes before/i);
  });
});

describe('ADMIN-8b · the unsigned attestation', () => {
  // W033 calls this an attestation and there is still no signing key. A document labelled "signed" without one would be
  // worse than an honest unsigned record.
  it('says it is not signed', () => {
    expect(dict['rz.attest.unsigned']).toMatch(/NOT SIGNED/);
    expect(dict['rz.attest.unsigned']).toMatch(/no signing key/i);
  });
});
