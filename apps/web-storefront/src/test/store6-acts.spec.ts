// apps/web-storefront/src/test/store6-acts.spec.ts · PC-56 STORE-6a · D1 (founder Q1; survey E7) — EVERY SERVER ACTION IS CLASSIFIED, AND EVERY
// MONEY ACT SAYS WHY. Reads the actions directory with `fs` (never a copied list):
//   • every `export async function` in `src/app/**/actions.ts` has exactly one class in features/store6/acts.ts — an unclassified export fails
//     here, and so does a registry entry whose export no longer exists;
//   • the money list is the founder's 16 (named), the countdown list the sign-in / signup codes and the download links;
//   • every money / countdown act's FORM in the source carries `data-kv-act-class` + `data-kv-needs-signal-reason="<its reason>"` (the Pay button —
//     a client button, not a form — likewise), so the signal words can print the reason beside "— needs signal";
//   • every reason has its words in en / hi / gu; every money / countdown act has its name.
// Mutant M1 (a money act reclassified `content`) turns this red.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { STOREFRONT_ACTS, REASON_KEYS, actsOf, classOf, neverQueued, type ActEntry } from '../features/store6/acts';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const SRC = join(__dirname, '..');
const APP = join(SRC, 'app');
function walk(dir: string): string[] { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const actionFiles = walk(APP).filter((f) => f.endsWith(`${sep}actions.ts`));
const exportsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/^export async function (\w+)\s*\(/gm)].map((m) => m[1]);
const rel = (f: string) => relative(APP, f).split(sep).join('/');
const ALL = actionFiles.flatMap((f) => exportsOf(f).map((name) => ({ file: rel(f), name })));
const ALL_TSX = walk(SRC).filter((f) => /\.tsx$/.test(f) && !f.includes(`${sep}test-render${sep}`));

describe('STORE-6a · D1 · every exported Server Action is classified (E7)', () => {
  it('the scan finds the storefront\'s actions (54 exports in 19 files: 30 under [tenantSlug], 24 under (platform))', () => {
    expect(actionFiles.length).toBe(19);
    expect(ALL.length).toBe(54);
    expect(ALL.filter((a) => a.file.startsWith('[tenantSlug]/')).length).toBe(30);
    expect(ALL.filter((a) => a.file.startsWith('(platform)/')).length).toBe(24);
    // the survey's E7 figure (53) counted `*Action` names; the pay page's status poll `pollOrderPayment` is the 54th export (a read, classified content)
    expect(ALL.filter((a) => a.name.endsWith('Action')).length).toBe(53);
  });

  it('every export has a class — an unclassified one fails here — and every registry entry still exists', () => {
    const unclassified = ALL.filter((a) => classOf(a.file, a.name) === null);
    expect(unclassified).toEqual([]);
    const stale = STOREFRONT_ACTS.filter((e) => !ALL.some((a) => a.file === e.file && a.name === e.name));
    expect(stale).toEqual([]);
    expect(STOREFRONT_ACTS.length).toBe(ALL.length);
    const keys = STOREFRONT_ACTS.map((e) => `${e.file}#${e.name}`);
    expect(new Set(keys).size).toBe(keys.length);                                // one class per export
  });

  it('MONEY = the founder\'s 16 acts, by name (Q1); countdown = the codes and the download links (12); content 22; device 4', () => {
    const money = actsOf('money').map((a) => a.name).sort();
    expect(money).toEqual([
      'acceptOfferAction', 'acceptPriceAction', 'applyCouponAction', 'cancelOrderAction', 'chooseDeliveryAction', 'choosePaymentAction',
      'completeOrderAction', 'counterOfferAction', 'createOrderAttemptAction', 'declineOfferAction', 'makeOfferAction', 'payFromWalletAction',
      'placeBidAction', 'placeOrderAction', 'raiseDisputeAction', 'requestDeletionAction',
    ]);
    expect(money.length).toBe(16);
    expect(actsOf('countdown').length).toBe(12);
    expect(actsOf('countdown').every((a) => ['signInCode', 'signupCode', 'exportLink'].includes(a.reason!))).toBe(true);
    expect(actsOf('content').length).toBe(22);
    expect(actsOf('device').map((a) => a.name).sort()).toEqual(['editFormAction', 'logoutAction', 'resetLoginAction', 'restartSignupAction']);
    expect(neverQueued().length).toBe(28);
  });

  it('every money / countdown act has an id, a reason, its name and its reason in en / hi / gu', () => {
    for (const a of neverQueued()) {
      expect([a.name, typeof a.id, typeof a.reason]).toEqual([a.name, 'string', 'string']);
      for (const cat of [en, hi, gu]) {
        expect([a.name, `store6.act.${a.id}` in cat]).toEqual([a.name, true]);
        expect([a.name, `store6.reason.${a.reason}` in cat]).toEqual([a.name, true]);
      }
    }
    for (const k of REASON_KEYS) for (const cat of [en, hi, gu]) expect([k, `store6.reason.${k}` in cat]).toEqual([k, true]);
    expect(new Set(neverQueued().map((a) => a.reason))).toEqual(new Set(REASON_KEYS));   // every reason is used, none is orphaned
  });
});

describe('STORE-6a · D1 · every money / countdown act\'s form says WHY offline', () => {
  /** The files that import THIS entry's export (from ITS actions module — two modules export `resendCodeAction`) and post a form to it. */
  const usesOf = (a: ActEntry) => ALL_TSX.filter((f) => {
    const src = readFileSync(f, 'utf8');
    if (!src.includes(`<form action={${a.name}}`)) return false;
    return [...src.matchAll(/import \{([^}]*)\} from '([^']+\/actions)'/g)].some((m) =>
      new RegExp(`\\b${a.name}\\b`).test(m[1]) && rel(join(f, '..', `${m[2]}.ts`)) === a.file);
  });
  it.each(neverQueued().filter((a) => a.name !== 'createOrderAttemptAction').map((a) => [`${a.file}#${a.name}`, a] as const))('%s: its <form> carries the class and the reason', (_n, a) => {
    const files = usesOf(a);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const forms = [...src.matchAll(new RegExp(`<form action=\\{${a.name}\\}([^>]*)>`, 'g'))];
      expect(forms.length).toBeGreaterThan(0);
      for (const m of forms) {
        expect([rel(f), m[1]]).toEqual([rel(f), expect.stringContaining(`data-kv-act-class="${a.cls}"`)]);
        expect([rel(f), m[1]]).toEqual([rel(f), expect.stringContaining(`data-kv-needs-signal-reason="${a.reason}"`)]);
      }
    }
  });
  it('the Pay button (a client button that opens the payment sheet — no form) carries the class and the reason itself', () => {
    const src = readFileSync(join(SRC, 'components', 'PayButton.tsx'), 'utf8');
    expect(src).toMatch(/<button type="button" className="kv-btn kv-btn--money"[^>]*data-kv-act-class="money" data-kv-needs-signal-reason="paymentAttempt">/);
  });
  it('no content or device act\'s form claims a money reason', () => {
    for (const a of [...actsOf('content'), ...actsOf('device')]) {
      for (const f of ALL_TSX) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(new RegExp(`<form action=\\{${a.name}\\}([^>]*)>`, 'g'))) expect([a.name, /data-kv-act-class="money"/.test(m[1])]).toEqual([a.name, false]);
      }
    }
  });
});

// PC-56 STORE-6a · §E — the refusal registry (features/store6/refusals.ts): unique ids, every key in en / hi / gu, every surface printed, the chain
// pages counted (7 canon files: W313, W314, W319, W3127–W3130).
import { STORE6A_CHAIN_PAGES, STORE6A_DELTAS, STORE6A_REFUSALS, store6RefusalKeys } from '../features/store6/refusals';
describe('STORE-6a · the refusal registry', () => {
  it('23 refusals, unique ids, every key in the three catalogues; each surface has its list; 7 canon files; the DELTAs named', () => {
    expect(STORE6A_REFUSALS.length).toBe(23);
    expect(new Set(STORE6A_REFUSALS.map((r) => r.id)).size).toBe(23);
    for (const r of STORE6A_REFUSALS) for (const cat of [en, hi, gu]) expect([r.key, r.key in cat]).toEqual([r.key, true]);
    expect(['offline', 'queued', 'install', 'offline_form'].map((s) => store6RefusalKeys(s as never).length)).toEqual([5, 8, 11, 4]);
    expect(STORE6A_CHAIN_PAGES.map((p) => p.file.slice(0, p.file.indexOf('-')))).toEqual(['W313', 'W314', 'W319', 'W3127', 'W3128', 'W3129', 'W3130']);
    expect(STORE6A_DELTAS.length).toBe(8);
  });
});
