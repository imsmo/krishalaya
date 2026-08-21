// apps/web-tenant/src/test/tenant6d5-call.spec.ts · the shared MUTATE pattern, and the call — TENANT-6d-5.
//
// W2521–W2523 describe three screens over two acts the `bmc` module shares: *"Call MCC-AND-03 operator"* and *"Retry"*.
// What is asserted here is what those screens promise an operator standing in front of a warming tank:
//
//   • the confirm step reviews an OBJECT and a REASON, and the reason is what the audit trail will carry — so a blank
//     one cannot reach the button;
//   • the temperature on that screen says whether it IS the tank's condition or is itself the problem;
//   • nobody is ever shown a phone number, and the screen says so out loud;
//   • *"Retry — back to confirm"* returns to the operator's own words, not to an empty box;
//   • the gap card's *"Retry"* is a PAGE LOAD — TENANT-6a's ruling, reused rather than restated;
//   • and the monitor tells the truth about the automatic call: whether a rule watches silence at all, whether its
//     threshold is the number the screen calls a gap, and whether a critical alert can wake anybody.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MAX_REASON, MIN_REASON, MUTATE_STEPS, calleeKey, canConfirm, confirmHref, gapRetryHref, gapRetryIsMutation,
  mutateRefusalKey, mutateStep, mutateStepKey, objectTempKey, reasonState, reasonStateKey, retryToConfirm,
} from '../features/mutate/chain';
import { BMC_CALL_HREF, BMC_HREF, callHref, callOfferKey, quietHoursKey, silenceGapKey } from '../features/dairy/bmc';
import type { DairyBmcMonitor } from '@krishalaya/sdk-js';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/** The refusal codes, read from the API's own domain file — derived, not retyped (TENANT-6d-4's ruling). */
function apiCallRefusals(): string[] {
  const file = fs.readFileSync(path.join(__dirname, '../../../api/src/modules/dairy/domain/bmc-call.ts'), 'utf8');
  const block = file.slice(file.indexOf('export const BMC_CALL_REFUSALS = ['));
  const list = block.slice(block.indexOf('['), block.indexOf('] as const'));
  return [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

const alerting = (over: Partial<DairyBmcMonitor['alerting']> = {}): DairyBmcMonitor['alerting'] => ({
  breachRules: 1, silentRules: 1, recipients: 2, eventCatalogued: true, smsDeliverable: true,
  silenceRuleMinutes: 15, silenceMatchesGap: true, evaluationMinutes: 10,
  criticalCatalogued: true, criticalVoiceDeliverable: true, ...over,
});
const thresholds: DairyBmcMonitor['thresholds'] = { divertC: '7.5', condemnC: '8.0', silenceMinutes: 15 };

/* =========================================================================================================== */
describe('TENANT-6d-5 · the three states', () => {
  it('falls back to CONFIRM for a step nobody named', () => {
    // A truncated or hand-typed link must land on the step that reviews, never on one that claims something happened.
    expect(mutateStep(undefined)).toBe('confirm');
    expect(mutateStep('')).toBe('confirm');
    expect(mutateStep('done')).toBe('confirm');
    expect(mutateStep('review')).toBe('confirm');     // the FORM chain's step name is not this chain's
    for (const s of MUTATE_STEPS) expect(mutateStep(s)).toBe(s);
    expect(MUTATE_STEPS).toEqual(['confirm', 'success', 'failure']);
  });

  it('has copy for each state, and one key per state', () => {
    for (const s of MUTATE_STEPS) expect(hasKey(mutateStepKey(s))).toBe(true);
    expect(mutateStepKey('confirm')).toBe('mutate.step.confirm');
  });

  it('carries the object and the reason into the confirm step, and back to it on a retry', () => {
    const href = confirmHref('/dairy/bmc/call', { unitId: 'u-1', reason: 'tank at 6.9' });
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('step')).toBe('confirm');
    expect(q.get('unitId')).toBe('u-1');
    expect(q.get('reason')).toBe('tank at 6.9');
    // W2523: the retry is the CONFIRM step with the operator's own words still in it — not a blank box at the worst
    // possible moment.
    expect(retryToConfirm('/dairy/bmc/call', { unitId: 'u-1', reason: 'tank at 6.9' })).toBe(href);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-5 · the reason IS the audit row', () => {
  it('tells an empty reason apart from a useless one', () => {
    // Different states, different sentences: a caller who typed nothing needs asking; a caller who typed "ok" needs
    // telling that nobody will understand it in six months.
    expect(reasonState('')).toBe('empty');
    expect(reasonState('   ')).toBe('empty');
    expect(reasonState('ok')).toBe('too_short');
    expect(reasonState('x'.repeat(MAX_REASON))).toBe('ok');
    expect(reasonState('x'.repeat(MAX_REASON + 1))).toBe('too_long');
    expect(reasonState(undefined)).toBe('empty');
    expect(MIN_REASON).toBe(3);
  });

  it('has copy for every unusable state and NONE for the usable one', () => {
    for (const s of ['empty', 'too_short', 'too_long'] as const) {
      expect({ s, has: hasKey(reasonStateKey(s) as string) }).toEqual({ s, has: true });
    }
    // The parity gate refuses a blank catalogue value, so `ok` has no key at all rather than an empty one — a key that
    // renders nothing is a key that will one day render its own name.
    expect(reasonStateKey('ok')).toBeNull();
    expect(hasKey('mutate.reason.ok')).toBe(false);
  });

  it('offers the button only when the server allowed it AND the reason is usable', () => {
    expect(canConfirm({ allowed: true }, 'tank at 6.9 and rising')).toBe(true);
    expect(canConfirm({ allowed: true }, '')).toBe(false);
    expect(canConfirm({ allowed: true }, 'ok')).toBe(false);
    // A reason cannot buy past a server refusal, which is the whole point of the verdict being the server's.
    expect(canConfirm({ allowed: false }, 'tank at 6.9 and rising')).toBe(false);
    expect(canConfirm(null, 'tank at 6.9 and rising')).toBe(false);
  });

  it('has a sentence for every refusal the API can return', () => {
    const codes = apiCallRefusals();
    expect(codes.length).toBeGreaterThanOrEqual(7);
    for (const c of codes) expect({ c, has: hasKey(mutateRefusalKey('bmc', c)) }).toEqual({ c, has: true });
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-5 · the object under review', () => {
  it('never presents a stale reading as the tank\'s condition', () => {
    expect(objectTempKey({ tempC: '3.8', tempIsCurrent: true })).toBe('mutate.bmc.temp.current');
    expect(objectTempKey({ tempC: '6.9', tempIsCurrent: false })).toBe('mutate.bmc.temp.stale');
    expect(objectTempKey({ tempC: null, tempIsCurrent: false })).toBe('mutate.bmc.temp.never');
    for (const k of ['current', 'stale', 'never']) expect(hasKey(`mutate.bmc.temp.${k}`)).toBe(true);
  });

  it('says WHO will be reached — or that the name cannot be verified', () => {
    expect(calleeKey({ operatorName: 'Raju Patel', operatorUnnamed: false })).toBe('mutate.bmc.callee.named');
    // Custody recorded, holder unverifiable against this cooperative's roles (6d-2's join): the call can still be
    // placed, and the screen says which situation it is in rather than printing a name nothing stands behind.
    expect(calleeKey({ operatorName: null, operatorUnnamed: true })).toBe('mutate.bmc.callee.unverified');
    expect(calleeKey({ operatorName: 'Raju Patel', operatorUnnamed: true })).toBe('mutate.bmc.callee.unverified');
    expect(calleeKey(null)).toBe('mutate.bmc.callee.nobody');
    expect(calleeKey({ operatorName: null, operatorUnnamed: false })).toBe('mutate.bmc.callee.nobody');
    for (const k of ['named', 'unverified', 'nobody']) expect(hasKey(`mutate.bmc.callee.${k}`)).toBe(true);
  });

  it('promises, in three languages, that no number is shown to anybody', () => {
    expect(hasKey('mutate.bmc.numberNeverShown')).toBe(true);
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'mutate.bmc.numberNeverShown':")) ?? '';
      expect({ l, long: line.length > 60 }).toEqual({ l, long: true });
    }
    // And the page prints it on the confirm step, where the decision is being made.
    expect(src('app/dairy/bmc/call/page.tsx')).toContain('mutate.bmc.numberNeverShown');
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-5 · "Retry" is two different things', () => {
  it('keeps the telemetry-gap Retry a page load', () => {
    // TENANT-6a's ruling: nothing on this platform can poll a cooler, so a Retry that appeared to fetch a reading
    // would lie about what it did. Exported as functions because a rule living only in JSX is a rule no test reaches.
    expect(gapRetryIsMutation()).toBe(false);
    expect(gapRetryHref(BMC_HREF)).toBe(BMC_HREF);
  });

  it('keeps the failure Retry a return to the confirm step', () => {
    const href = retryToConfirm(BMC_CALL_HREF, { unitId: 'u-1', reason: 'rising' });
    expect(new URLSearchParams(href.split('?')[1]).get('step')).toBe('confirm');
    expect(hasKey('mutate.retry')).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-5 · what the monitor now says about the automatic call', () => {
  it('says nothing only when the canon\'s sentence is true as written', () => {
    expect(silenceGapKey(alerting(), thresholds)).toBeNull();
  });

  it('says NOBODY IS PAGED when no rule watches silence', () => {
    // The screen calls a reading a gap after fifteen minutes; paging is a rule a cooperative writes, and 0165 refuses
    // to invent one for them. So the honest sentence is that nobody is called.
    expect(silenceGapKey(alerting({ silenceRuleMinutes: null, silenceMatchesGap: null, silentRules: 0 }), thresholds))
      .toBe('dairy.bmc.alerting.noSilenceRule');
  });

  it('says so when the rule pages at a different number from the gap it shows', () => {
    expect(silenceGapKey(alerting({ silenceRuleMinutes: 720, silenceMatchesGap: false }), thresholds))
      .toBe('dairy.bmc.alerting.silenceRuleDiffers');
  });

  it('admits that a threshold under the evaluator\'s cadence is checked late', () => {
    expect(silenceGapKey(alerting({ silenceRuleMinutes: 2, silenceMatchesGap: true }), { ...thresholds, silenceMinutes: 2 }))
      .toBe('dairy.bmc.alerting.silenceUnderCadence');
    // Exactly at the cadence is honest, not late.
    expect(silenceGapKey(alerting({ silenceRuleMinutes: 10, silenceMatchesGap: true }), { ...thresholds, silenceMinutes: 10 }))
      .toBeNull();
  });

  it('says when a CRITICAL alert cannot wake anybody — the finding this wave opened with', () => {
    expect(quietHoursKey(alerting())).toBeNull();
    expect(quietHoursKey(alerting({ criticalCatalogued: false }))).toBe('dairy.bmc.alerting.criticalNotCatalogued');
    // Catalogued but with no voice copy: the operator gets a text and a push and no call, which is a different
    // sentence from "nothing will reach you".
    expect(quietHoursKey(alerting({ criticalVoiceDeliverable: false }))).toBe('dairy.bmc.alerting.criticalNoVoice');
    for (const k of ['noSilenceRule', 'silenceRuleDiffers', 'silenceUnderCadence', 'silenceRuleAt', 'checkedEvery',
      'criticalNotCatalogued', 'criticalNoVoice']) {
      expect({ k, has: hasKey(`dairy.bmc.alerting.${k}`) }).toEqual({ k, has: true });
    }
  });

  it('offers the call from every tile, or says the act is not switched on', () => {
    expect(callOfferKey({ callEnabled: true })).toBeNull();
    expect(callOfferKey({ callEnabled: false })).toBe('dairy.bmc.call.notEnabled');
    expect(hasKey('dairy.bmc.call.notEnabled')).toBe(true);
    expect(hasKey('dairy.bmc.tile.call')).toBe(true);
    expect(callHref('u-1')).toBe(`${BMC_CALL_HREF}?step=confirm&unitId=u-1`);
    // Never a button that 404s: the tile checks the flag the read-model reported.
    const monitor = src('app/dairy/bmc/page.tsx');
    expect(monitor).toContain('view.callEnabled && (');
    expect(monitor).toContain('callHref(u.unitId)');
  });

  it('states the flag copy as a promise about the ALARM, not just the button', () => {
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'dairy.bmc.call.notEnabled':")) ?? '';
      expect({ l, mentionsAlerts: line.length > 60 }).toEqual({ l, mentionsAlerts: true });
    }
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-5 · the chain\'s own discipline', () => {
  it('asks the API for the verdict only on the confirm step', () => {
    const page = src('app/dairy/bmc/call/page.tsx');
    const guard = page.indexOf("if (step === 'confirm' && unitId.length > 0)");
    const call = page.indexOf('tenantClient()');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(call);
  });

  it('re-implements no rule in the action, and keeps the reason on a failure', () => {
    const action = src('app/dairy/bmc/call/actions.ts');
    expect(/new RegExp|\.test\(/.test(action)).toBe(false);
    // The VALUES, not just the call: `carryValues('failure', { unitId })` alone would drop the operator's own words at
    // the worst possible moment, and the mutation pass proved an assertion on the function name cannot see that.
    expect(action).toContain("carryValues('failure', values)");
    expect(action).toContain('const values = { unitId, reason }');
    expect(action).toContain('error=${encodeURIComponent(code)}');
    expect(action).toContain('revalidatePath(BOARD)');
  });

  it('drops the reason from the SUCCESS url, because it is in the audit row now', () => {
    // A URL that carries somebody's stated reason around after the act is a URL that leaks it into a browser history
    // and a proxy log.
    const action = src('app/dairy/bmc/call/actions.ts');
    const success = action.slice(action.indexOf('step=success'));
    expect(success).toContain('unitId=');
    expect(success).not.toContain('reason=');
  });

  it('shares the form chain\'s mechanics instead of copying them', () => {
    // `carryValues`, the audit deep-link and the failure copy are ONE implementation across both chains: a second copy
    // is two answers to "what did the operator type", and the one that drifts is the one nobody is looking at.
    const chain = src('features/mutate/chain.ts');
    expect(chain).toContain("from '../forms/chain'");
    expect(chain).not.toContain('new URLSearchParams');
  });
});
