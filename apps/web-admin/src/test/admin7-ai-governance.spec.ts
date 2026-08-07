// apps/web-admin/src/test/admin7-ai-governance.spec.ts (PC-56 ADMIN-7)
import {
  adviceClass, adviceKey, ageMinutes, capacityClass, capacityKey, caveatKeys, claimAction, claimKey,
  deltaKey, formatGap, formatRate, formatThreshold, gapClass, gateClass, gateKey, gateStatusClass,
  gateStatusKey, kindClass, kindKey, legacyKey, nextStepKey, outputSummary, overriddenClass,
  overrideRateClass, reviewerRealmKey, rollbackClass, rollbackKey, showApproveTransition, showWithdraw,
  tileText, unauditedClass, unauditedKey, verdictClass, verdictKey, windowTooWide,
} from '../features/ai-governance/ai-governance';

describe('the verdict', () => {
  it('draws INCONCLUSIVE as a warning, never as neutral', () => {
    // The most consequential styling choice on this plane: an audit that could not establish fairness is not an audit
    // that established it, and grey would let a reader skim past a model nobody has actually cleared.
    expect(verdictClass('inconclusive')).toContain('is-warn');
    expect(verdictClass('pass')).toContain('is-ok');
    expect(verdictClass('fail')).toContain('is-danger');
  });
  it('draws an UNRECOGNISED verdict as danger, not neutral', () => {
    expect(verdictClass('probably_fine')).toContain('is-danger');
    expect(verdictKey('probably_fine')).toBe('ai.verdict.unknown');
  });
});

describe('the gap against the policy', () => {
  it('marks a gap AT the limit as a breach, matching the server', () => {
    // A console drawing 5.00pp as acceptable while the server refuses it would have an operator arguing with a screen.
    expect(gapClass(5, 5)).toContain('is-danger');
    expect(gapClass(4.99, 5)).not.toContain('is-danger');
  });
  it('warns as a gap approaches the limit', () => {
    expect(gapClass(4.2, 5)).toContain('is-warn');
    expect(gapClass(1, 5)).toContain('is-ok');
  });
  it('treats a non-finite gap as danger', () => {
    expect(gapClass(NaN, 5)).toContain('is-danger');
  });
  it('renders an absent gap as a dash, never as 0.0pp', () => {
    // "0.0pp" is a claim of perfect parity; a dash is the absence of a measurement, and on a fairness board those must
    // not render alike.
    for (const v of [null, undefined, NaN, Infinity]) expect(formatGap(v as number)).toBe('—');
    expect(formatGap(2.45)).toBe('2.5pp');
  });
});

describe('the gate badge', () => {
  it('has exactly one green state', () => {
    expect(gateClass(true)).toContain('is-ok');
    expect(gateClass(false)).toContain('is-danger');
  });
  it('keys every closed reason, and falls back rather than showing a raw code', () => {
    expect(gateKey(true)).toBe('ai.gate.open');
    for (const r of ['never_audited', 'audit_failed', 'audit_inconclusive', 'audit_stale', 'slices_unapproved']) {
      expect(gateKey(false, r)).toBe(`ai.gate.${r}`);
    }
    expect(gateKey(false, 'something_new')).toBe('ai.gate.closed');
    expect(gateKey(false, null)).toBe('ai.gate.closed');
  });
});

describe('the approve control — maker-checker BY ABSENCE', () => {
  it('is drawn only when the server says so', () => {
    // A disabled Approve teaches an operator that they nearly have the right to promote their own model.
    expect(showApproveTransition(true)).toBe(true);
    expect(showApproveTransition(false)).toBe(false);
  });
  it('SHOWS Withdraw whenever a proposal is open, including to its maker', () => {
    // Withdrawing your own proposal is noticing your own mistake, and needing a colleague to stop a promotion would make
    // the safe action the expensive one — the same asymmetry ADMIN-6b argued for returning a payout batch.
    expect(showWithdraw('production')).toBe(true);
    expect(showWithdraw(null)).toBe(false);
  });
});

describe('the unaudited census', () => {
  it('draws a model in production with no audit as an incident', () => {
    expect(unauditedClass(true)).toContain('is-danger');
    expect(unauditedClass(false)).toContain('is-warn');
    expect(unauditedKey(true)).toBe('ai.unaudited.inProduction');
  });
  it('names the old column as a USAGE ROLLUP rather than as an audit', () => {
    // The column the unwired job would have filled holds counts and an override rate and NO SLICES, under a name that
    // reads as diligence.
    expect(legacyKey('usage_rollup')).toBe('ai.legacy.usage_rollup');
    expect(legacyKey('absent')).toBe('ai.legacy.absent');
    expect(legacyKey('something_new')).toBe('ai.legacy.unrecognised');
  });
});

describe('the rollout gates', () => {
  it('draws INSUFFICIENT and UNMEASURED as warnings, never as ok', () => {
    // A tick over a metric nothing measures is the defect this whole programme keeps finding.
    expect(gateStatusClass('insufficient')).toContain('is-warn');
    expect(gateStatusClass('unmeasured')).toContain('is-warn');
    expect(gateStatusClass('pass')).toContain('is-ok');
    expect(gateStatusClass('fail')).toContain('is-danger');
  });
  it('keys each status and falls back', () => {
    expect(gateStatusKey('unmeasured')).toBe('ai.gateStatus.unmeasured');
    expect(gateStatusKey('novel')).toBe('ai.gateStatus.unknown');
  });
  it('classes the advice by severity', () => {
    expect(adviceClass('blocked')).toContain('is-danger');
    expect(adviceClass('proceed_with_caveats')).toContain('is-warn');
    expect(adviceClass('proceed')).toContain('is-ok');
    expect(adviceKey('novel')).toBe('ai.advice.blocked');
  });
});

describe('the auto-rollback panel', () => {
  it('draws an UNENFORCED rollback as a caution, not as reassurance', () => {
    // W088 promises an automatic rollback; nothing performs one. A neutral note would let a reader believe the platform
    // will catch a regression on its own — the fifth status-claiming-an-act-nobody-does.
    expect(rollbackClass(false, false)).toContain('is-warn');
    expect(rollbackKey(false, false)).toBe('ai.rollback.notEnforced');
  });
  it('escalates to DANGER when the criteria are breached and nothing will act', () => {
    // The worst combination and the one that needs a human right now.
    expect(rollbackClass(false, true)).toContain('is-danger');
    expect(rollbackKey(false, true)).toBe('ai.rollback.firesButNotEnforced');
  });
  it('is plain once enforced', () => {
    expect(rollbackClass(true, false)).toBe('kv-note');
    expect(rollbackKey(true, false)).toBe('ai.rollback.armed');
  });
  it('says the ladder is topped out rather than offering 100%', () => {
    expect(nextStepKey(null)).toBe('ai.canary.atTop');
    expect(nextStepKey(50)).toBe('ai.canary.next');
  });
});

describe('the queue', () => {
  it('draws a fraud flag as urgent regardless of its priority number', () => {
    // The number is set by the producer; the consequence — a farmer's listing off the market — is not.
    expect(kindClass('fraud_flag')).toContain('is-danger');
    expect(kindClass('low_confidence_grade')).toContain('is-warn');
    expect(kindClass('dispute_triage')).toBe('kv-badge');
    expect(kindKey('novel_kind')).toBe('ai.kind.other');
  });
  it('offers TAKE OVER as its own action, distinct from TAKE', () => {
    // Taking a case off a colleague should be a visible act with its own wording rather than an ordinary Take.
    expect(claimAction('claimable')).toBe('take');
    expect(claimAction('stale_claim')).toBe('takeover');
    expect(claimAction('held_by_you')).toBe('decide');
    expect(claimAction('held_by_other')).toBeNull();
    expect(claimAction('already_decided')).toBeNull();
  });
  it('keys every claim state', () => {
    for (const k of ['claimable', 'held_by_other', 'held_by_you', 'stale_claim', 'already_decided']) {
      expect(claimKey(k)).toBe(`ai.claim.${k}`);
    }
    expect(claimKey('novel')).toBe('ai.claim.unknown');
  });
  it('names WHICH REALM decided', () => {
    // `ck_ai_review_one_reviewer` makes exactly one non-null on a resolved case, and showing a platform decision as a
    // tenant's would be a forgery — the finding 0112 fixed for moderation reports.
    expect(reviewerRealmKey(null, 'admin1')).toBe('ai.reviewer.platform');
    expect(reviewerRealmKey('user1', null)).toBe('ai.reviewer.tenant');
    expect(reviewerRealmKey(null, null)).toBe('ai.reviewer.none');
  });
  it('returns NULL for an unreadable age rather than 0', () => {
    // "Arrived this second" and "we cannot read when this arrived" must not render alike on a queue whose job is to show
    // what has waited.
    expect(ageMinutes('nope', Date.now())).toBeNull();
    expect(ageMinutes(null, Date.now())).toBeNull();
    expect(ageMinutes(new Date(Date.now() - 22 * 60_000).toISOString(), Date.now())).toBe(22);
  });
  it('never reports a negative age', () => {
    // A clock skew between the server and the browser should not produce "-3 min waiting".
    expect(ageMinutes(new Date(Date.now() + 60_000).toISOString(), Date.now())).toBe(0);
  });
});

describe('the overview tiles', () => {
  it('renders an unknown as words and a dash', () => {
    expect(tileText({ known: false, reason: 'no_rows_today' })).toEqual({ value: '—', unknownKey: 'ai.tile.noRows' });
    expect(tileText({ known: false, reason: 'other' })).toEqual({ value: '—', unknownKey: 'ai.tile.notRecorded' });
  });
  it('renders a KNOWN zero as 0 with no unknown note', () => {
    // The distinction the tile type exists for.
    expect(tileText({ known: true, value: 0 })).toEqual({ value: '0', unknownKey: null });
  });
  it('groups a large count en-IN', () => {
    expect(tileText({ known: true, value: 184206 }).value).toBe('1,84,206');
  });
  it('draws a HIGH override rate as a warning, not a success', () => {
    // It is easy to read "humans are catching things" as reassurance; what it means is that the model is wrong that often
    // and every case cost somebody time. The thresholds match the rollout gate's ceiling so one screen cannot call
    // acceptable what another refuses.
    expect(overrideRateClass(0.15)).toContain('is-danger');
    expect(overrideRateClass(0.08)).toContain('is-warn');
    expect(overrideRateClass(0.03)).toContain('is-ok');
    expect(overrideRateClass(null)).toBe('kv-badge');
  });
  it('formats a rate from the FRACTION the server sends', () => {
    expect(formatRate(0.048)).toBe('4.8%');
    expect(formatRate(null)).toBe('—');
    expect(formatRate(NaN)).toBe('—');
  });
});

describe('the decision explorer', () => {
  it('refuses a window wider than the partition limit', () => {
    expect(windowTooWide('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z', 31)).toBe(true);
    expect(windowTooWide('2026-07-01T00:00:00Z', '2026-07-20T00:00:00Z', 31)).toBe(false);
  });
  it('treats an UNPARSEABLE window as too wide, not as fine', () => {
    // Returning false would send the query and let the server reject it — survivable, but NaN must not read as a narrow
    // window, and the form can say so first.
    expect(windowTooWide('nope', '2026-07-20T00:00:00Z', 31)).toBe(true);
  });
  it('is silent when either bound is absent, so the server applies its default', () => {
    expect(windowTooWide(undefined, '2026-07-20T00:00:00Z', 31)).toBe(false);
    expect(windowTooWide('2026-07-01T00:00:00Z', undefined, 31)).toBe(false);
  });
  it('summarises an output without ever rendering [object Object]', () => {
    // A cell that says that in a governance log teaches an operator to stop reading the column.
    expect(outputSummary({ grade: 'FAQ', confidence: 0.94 })).toBe('grade: FAQ');
    expect(outputSummary({ flag: 'price_manipulation_suspected' })).toBe('flag: price_manipulation_suspected');
    expect(outputSummary({ unknownShape: { nested: 1 }, another: 2 })).toBe('unknownShape, another');
    expect(outputSummary({})).toBe('—');
    expect(outputSummary(null)).toBe('—');
    expect(outputSummary('a plain string')).toBe('a plain string');
    expect(outputSummary(42)).toBe('42');
  });
  it('draws an override as a NOTE rather than an error', () => {
    // An override is the system working as designed and is the training signal W085 is built on; red would make a healthy
    // human-in-the-loop look like a fault.
    expect(overriddenClass(true)).toContain('is-warn');
    expect(overriddenClass(true)).not.toContain('is-danger');
    expect(overriddenClass(false)).toBe('kv-badge');
  });
});

describe('the threshold impact', () => {
  it('formats a threshold to four decimals, matching numeric(5,4)', () => {
    expect(formatThreshold(0.85)).toBe('0.8500');
    expect(formatThreshold(null)).toBe('—');
    expect(formatThreshold(NaN)).toBe('—');
  });
  it('UNKNOWN CAPACITY IS A CAUTION, NOT A CLEARANCE', () => {
    // There is no reviewer-capacity record on this platform, so a green tick over an unknown would be the console
    // inventing a fact.
    expect(capacityClass('unknown')).toContain('is-warn');
    expect(capacityClass('exceeds')).toContain('is-danger');
    expect(capacityClass('fits')).toContain('is-ok');
    expect(capacityKey('novel')).toBe('ai.capacity.unknown');
  });
  it('distinguishes "no change" from "we cannot say"', () => {
    // A threshold raised on the strength of the first when the second is true is how a review desk silently falls behind.
    expect(deltaKey(null)).toBe('ai.delta.unknown');
    expect(deltaKey({ perWindow: 0, direction: 'none' })).toBe('ai.delta.none');
    expect(deltaKey({ perWindow: 412, direction: 'more' })).toBe('ai.delta.more');
    expect(deltaKey({ perWindow: 412, direction: 'fewer' })).toBe('ai.delta.fewer');
  });
});

describe('the proxy caveats', () => {
  it('keys each known caveat and falls back for an unknown one', () => {
    // Every screen that prints a gap must be able to print what the gap is made of. A gap presented as accuracy would be
    // the most misleading number in this console.
    expect(caveatKeys(['under_review_looks_like_accuracy', 'novel']))
      .toEqual(['ai.caveat.under_review_looks_like_accuracy', 'ai.caveat.other']);
  });
});
