// PC-56 TENANT-4d-5 · W120's fourth sentence, once HALF of it is true.
//
// "If a renewal payment fails, service enters a grace period — nothing switches off for 7 days while we retry
// and notify you." One sentence, TWO mechanisms. This wave builds the notify half — seven catalog events,
// templates in en/hi/gu, a recipient in every billing payload — and does NOT build the retry half, because no
// autopay mandate exists for a SaaS subscription anywhere in the payments module. So the screen needs a third
// answer, and the two obvious ones are both wrong: `exists` claims a retry loop, `no_notification` denies a
// message the tenant is about to receive.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MECHANISM_ORDER, MechanismKey, MechanismVerdict, anyMechanismMissing, gapReasonKey, mechanismKey } from '../features/billing/invoices';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');

describe('TENANT-4d-5 · the half-true sentence', () => {
  it('has its OWN reason line, distinct from every other gap', () => {
    expect(gapReasonKey('notify_only')).toBe('bill.gap.notifyOnly');
    // Not collapsed into noMandate: that would drop the promise the platform now actually keeps.
    expect(gapReasonKey('notify_only')).not.toBe(gapReasonKey('no_saas_mandate'));
    // Not left as noNotification: that would tell a tenant we will not contact them, immediately after we did.
    expect(gapReasonKey('notify_only')).not.toBe(gapReasonKey('no_notification'));
    // And every verdict still has exactly one reason line except `exists`, which has none.
    const all: MechanismVerdict[] = ['exists', 'no_saas_mandate', 'not_scheduled', 'no_grace_state', 'no_notification', 'notify_only'];
    const keys = all.map(gapReasonKey);
    expect(keys[0]).toBeNull();
    expect(new Set(keys.slice(1)).size).toBe(all.length - 1);
  });

  it('is STILL A GAP on the sentence itself — the tenant must not read it as "autopay is on"', () => {
    // `mechanismKey` renders the sentence; only 'exists' may render the reassuring one. A tenant who believes
    // autopay is on and finds their subscription expired has been misled by their own console.
    expect(mechanismKey('retryAndNotify', 'notify_only')).toBe('bill.mech.retryAndNotify.gap');
    expect(mechanismKey('retryAndNotify', 'exists')).toBe('bill.mech.retryAndNotify.on');
    const m: Record<MechanismKey, MechanismVerdict> = {
      autopay: 'no_saas_mandate', nextDebit: 'no_saas_mandate', gracePeriod: 'exists', retryAndNotify: 'notify_only',
    };
    expect(anyMechanismMissing(m)).toBe(true);
    expect(MECHANISM_ORDER).toContain('retryAndNotify');
  });

  it('says the sentence in all three launch languages, and says BOTH halves in each', () => {
    for (const l of LOCALES) {
      const d = dict(l);
      expect({ l, has: d.includes("'bill.gap.notifyOnly'") }).toEqual({ l, has: true });
      const line = d.split('\n').find((x) => x.includes("'bill.gap.notifyOnly'")) ?? '';
      // The copy must carry BOTH halves: what we will do (message you) and what we will not (charge you), because
      // the tenant's next action depends entirely on the second. A translation that kept only the reassuring half
      // would recreate the exact defect this verdict exists to avoid, in two of the three launch languages.
      expect({ l, mentionsMessage: /message|sandes|sandesh/i.test(line) }).toEqual({ l, mentionsMessage: true });
      expect({ l, mentionsNoAutoCharge: /automatic charge|automatic/i.test(line) }).toEqual({ l, mentionsNoAutoCharge: true });
      // …and it must not PROMISE a retry in any language. The English copy uses the word "retry" inside a
      // denial ("There is no automatic charge to retry"), which is the point — so the assertion is against the
      // promise forms, not the word. A blunter test on the bare word failed on honest copy, which is the wrong
      // way round for a test guarding honesty.
      expect({ l, promisesRetry: /we (will |are )?(retry|retrying|re-?attempt)/i.test(line) }).toEqual({ l, promisesRetry: false });
    }
  });

  it('leaves the pre-4d-5 gap sentence intact for the flag-off default', () => {
    // Notices ship OFF, so `no_notification` is what every deployment renders on day one and its copy must stay.
    for (const l of LOCALES) expect({ l, has: dict(l).includes("'bill.gap.noNotification'") }).toEqual({ l, has: true });
  });
});
