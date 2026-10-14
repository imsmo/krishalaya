// apps/web-storefront/src/test-render/signup.render.test.tsx · PC-56 STORE-1c — canon W307 /for-organisations and its chain pages, rendered
// state by state from the real page (a server component awaited for its tree). Proves, in the markup an organisation receives:
//   • FLAGGED OFF (org_self_signup false): the "platform switch" card BEFORE any form, and no form at all;
//   • THE FORM (W307): breadcrumb Home → /, the D4 fields (name · type from the registry · your name · phone · language), NO member-count
//     field (refused in one line), the district said to come next, the glance = the LIVE verified count (or nothing while not counted);
//   • FORM-ERROR (W2466 / W3064): the same form, every refusal against its field, every value kept (from the server-held cookie);
//   • CODE: the masked phone, the server's TTL (never "10 minutes"), the resend gated by the server's seconds;
//   • REVIEW (W2467 / W3065): read-only, masked phone, the type's NAME, the trial length from the policy, a UUID key minted at render;
//   • DONE (W2468 / W3066): created (address, private until verified, trial end date, console link or "not configured"); RESUMED;
//   • FAILURE (W2469 / W3067) ×3: switched off (code not used), the route's rate limit with its wait, unavailable — each with Retry carrying
//     the SAME key the first attempt used (W2470–W2472: an idempotent replay, no confirm page);
//   • every §E refusal printed by name in kv-refused; no phone number in ANY href, on any state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const KEY = '0190a8b2-0000-7000-8000-00000000c0de';
const TYPE = '0190a8b2-0000-7000-8000-0000000000f0';
const PHONE = '+919812345742';
const mock: { lang: string; pending: unknown; flags: unknown; stats: unknown; plans: unknown; types: unknown; consoleUrl: string | null } = {
  lang: 'en', pending: null, flags: null, stats: null, plans: null, types: null, consoleUrl: null,
};
const fail = () => { throw Object.assign(new Error('api'), { status: 503 }); };

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  permanentRedirect: (to: string) => { throw new Error(`PERMANENT ${to}`); },
}));
jest.mock('../lib/env', () => ({
  env: {
    publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: true, siteUrl: '', platformTenantSlug: null,
    razorpayKeyId: null, platformCountry: 'IN',
    get tenantAppUrl() { return mock.consoleUrl; },
  },
}));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => mock.lang, getTranslator: () => new T(mock.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/signup-flow', () => ({ readPendingSignup: () => mock.pending }));
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({
    storefront: {
      flags: async () => (mock.flags instanceof Error ? fail() : mock.flags),
      stats: async () => (mock.stats instanceof Error ? fail() : mock.stats),
      plans: async () => (mock.plans instanceof Error ? fail() : mock.plans),
    },
    lookups: { values: async () => (mock.types instanceof Error ? fail() : mock.types) },
  }),
}));
jest.mock('../app/(platform)/for-organisations/actions', () => ({
  startSignupAction: async () => undefined, resendCodeAction: async () => undefined, editFormAction: async () => undefined,
  confirmCodeAction: async () => undefined, submitSignupAction: async () => undefined, restartSignupAction: async () => undefined,
}));

import ForOrganisationsPage from '../app/(platform)/for-organisations/page';
import TenantsSignupPage from '../app/(platform)/tenants-signup/page';
import { STORE1C_REFUSALS } from '../features/home/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';

const VALUES = { orgName: 'Bhavnagar Kisan FPC', orgTypeId: TYPE, fullName: 'Kavita Ben', typed: '98123 45742', lang: 'gu' };
const TYPES = [{ id: TYPE, code: 'fpo', name: 'FPO (Farmer Producer Organisation)', sortOrder: 1, meta: {} }, { id: '0190a8b2-0000-7000-8000-0000000000f1', code: 'coop', name: 'Cooperative', sortOrder: 2, meta: {} }];
const now = () => Math.floor(Date.now() / 1000);

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await ForOrganisationsPage({ searchParams: sp }));
}
function noPhoneInAnyHref(html: string) {
  expect(html).not.toContain('9812345742');
  for (const m of html.matchAll(/href="([^"]*)"/g)) expect([m[1], /\d{7,}/.test(m[1])]).toEqual([m[1], false]);
}

beforeEach(() => {
  mock.lang = 'en'; mock.pending = null; mock.flags = { org_self_signup: true }; mock.consoleUrl = null;
  mock.stats = { liveListings: 40, verifiedOrganisations: 312, districts: 9, computedAt: new Date(Date.now() - 5 * 60_000).toISOString() };
  mock.plans = { country: 'IN', plans: [], trialDays: 14 };
  mock.types = TYPES;
});

describe('STORE-1c · W307 — before the form', () => {
  it('FLAGGED OFF: the platform-switch card, and NO form (the canon\'s "for this tenant/plan" is refused by name)', async () => {
    mock.flags = { org_self_signup: false };
    const html = await render();
    expect(html).toContain('data-kv-state="flagged-off"');
    expect(text(html)).toContain(en['signup.off.title']);
    expect(text(html)).toContain(en['signup.off.body']);
    expect(html).not.toContain('<form');
    expect(text(html)).toContain(en['signup.refused.flag']);
  });

  it('a FAILED flags read does not hide the form (the API is the gate) — error ≠ off', async () => {
    mock.flags = new Error('down');
    const html = await render();
    expect(html).not.toContain('data-kv-state="flagged-off"');
    expect(html).toContain('data-kv-step="form"');
  });
});

describe('STORE-1c · W307 — the form', () => {
  it('breadcrumb Home → /, the D4 fields, no member-count field, the district said to come next, the LIVE verified count', async () => {
    const html = await render();
    expect(html).toMatch(/<ol class="kv-crumb"><li><a href="\/">Home<\/a><\/li><li aria-current="page">Open your storefront<\/li><\/ol>/);
    for (const name of ['orgName', 'orgTypeId', 'fullName', 'phone', 'lang']) expect(html).toContain(`name="${name}"`);
    expect(html).not.toMatch(/name="(members|memberCount|district)"/);
    expect(text(html)).toContain(en['signup.form.members']);
    expect(text(html)).toContain(en['signup.form.district']);
    expect(text(html)).toContain('312 organisations verified on Krishalaya so far.');
    expect(html).toContain('<option value="0190a8b2-0000-7000-8000-0000000000f0">FPO (Farmer Producer Organisation)</option>');
    expect(text(html)).toContain(en['signup.get.verified']);           // TRUE since STORE-1b
    expect(text(html)).toContain('The trial runs 14 days.');           // from the policy, not a literal
    expect(html).toContain('href="/pricing"');
    // the canon's false claims are absent as OFFERS (the kv-refused block names some of them — to refuse them)
    const offered = text(html.slice(0, html.indexOf('data-kv-refused="W307"')));
    expect(offered).not.toMatch(/Anand FPO|1,240|1800|partners@|valid 10 minutes|12 languages|sandbox money|escrow|USSD|missed-call|resolution desk/i);
    expect(text(html)).not.toMatch(/1800|partners@krishalaya|valid 10 minutes|escrow/i);
  });

  it('not counted yet → no glance line (never a measured-looking zero); a failed type list says so and offers no submit', async () => {
    mock.stats = { liveListings: 0, verifiedOrganisations: 0, districts: 0, computedAt: null };
    mock.types = new Error('down');
    const html = await render();
    expect(html).not.toContain('data-kv-glance');
    expect(html).toContain('data-kv-state="types-unavailable"');
    expect(html).not.toMatch(/<button type="submit"[^>]*>Create my storefront/);
  });

  it('FORM-ERROR (W2466/W3064): every refusal against its field, values KEPT, the fix-fields line; no phone in any href', async () => {
    mock.pending = { ...VALUES, orgName: 'ab', fullName: 'K' };
    const html = await render({ step: 'form', e: 'org_short.name_short.phone_digits', need: '10', have: '9', dial: '91' });
    expect(html).toContain('data-kv-state="form-error"');
    expect(html).toMatch(/id="kv-su-org"[^>]*aria-invalid="true" aria-describedby="kv-su-orgName-err"[^>]*value="ab"/);
    expect(html).toMatch(/id="kv-su-orgName-err"[^>]*>At least 3 characters, in any language\.</);
    expect(html).toMatch(/id="kv-su-fullName-err"[^>]*>Enter your full name \(at least 2 characters\)\.</);
    expect(html).toMatch(/id="kv-su-phone-err"[^>]*>This needs 10 digits after \+91 — this one has 9\.</);
    expect(html).toContain('value="98123 45742"');                       // the typed phone stays in the FIELD (never in a URL)
    expect(html).toMatch(/<option value="gu" lang="gu" selected="">/);
    noPhoneInAnyHref(html);
  });

  it('a NAME TAKEN (SIGNUP_SLUG_UNAVAILABLE) comes back to the form, values kept, first-come said', async () => {
    mock.pending = { ...VALUES, phone: PHONE };
    const html = await render({ step: 'form', err: 'taken' });
    expect(html).toContain('data-kv-err="taken"');
    expect(text(html)).toContain(en['signup.err.taken']);
    expect(html).toContain('value="Bhavnagar Kisan FPC"');
    noPhoneInAnyHref(html);
  });
});

describe('STORE-1c · W307 — the code step', () => {
  it('masked phone, the server\'s TTL, resend gated by the server\'s seconds; no raw phone anywhere', async () => {
    mock.pending = { ...VALUES, phone: PHONE, sentAt: now(), ttlSec: 300, resendAt: now() + 25 };
    const html = await render({ step: 'code' });
    expect(html).toContain('data-kv-step="code"');
    expect(text(html)).toContain('Sent by SMS to +91 98••• ••742 · valid for 5 min');
    expect(html).toMatch(/<button type="submit" class="kv-btn--link" disabled="" aria-live="polite">Send a new code in 2[45] s<\/button>/);
    expect(html).not.toContain(PHONE);
    noPhoneInAnyHref(html);
  });

  it('a wrong code says the tries left (and nothing was created)', async () => {
    mock.pending = { ...VALUES, phone: PHONE, sentAt: now(), ttlSec: 300, resendAt: now() };
    const html = await render({ step: 'code', err: 'code_wrong', left: '3' });
    expect(text(html)).toContain("That code doesn't match — 3 tries left on this code. Nothing was created.");
  });
});

describe('STORE-1c · W307 — review (W2467/W3065)', () => {
  it('read-only: name, the type\'s NAME, your name, MASKED phone, language; trial from the policy; a UUID key minted at render', async () => {
    mock.pending = { ...VALUES, phone: PHONE, code: '123456', sentAt: now(), ttlSec: 300 };
    const html = await render({ step: 'review' });
    expect(html).toContain('data-kv-step="review"');
    expect(html).toContain('<dd data-kv-review="orgName">Bhavnagar Kisan FPC</dd>');
    expect(html).toContain('<dd data-kv-review="orgType">FPO (Farmer Producer Organisation)</dd>');
    expect(html).toContain('<dd data-kv-review="phone">+91 98••• ••742</dd>');
    expect(html).toContain('<dd data-kv-review="lang">ગુજરાતી</dd>');
    expect(text(html)).toContain('A free trial of 14 days starts today.');
    expect(html).toMatch(/<input type="hidden" name="idem" value="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"\/>/);
    expect(html).not.toContain('123456');                                // the code never reaches the page
    expect(html).not.toMatch(/<input(?![^>]*type="hidden")[^>]*name="orgName"/);   // nothing editable on the review
    noPhoneInAnyHref(html);
  });

  it('no trial setting → the length is said to come at creation (never "14 days" from a literal)', async () => {
    mock.plans = { country: 'IN', plans: [], trialDays: null };
    mock.pending = { ...VALUES, phone: PHONE, code: '123456' };
    const html = await render({ step: 'review' });
    expect(text(html)).toContain(en['signup.review.trialUnknown']);
    expect(text(html)).not.toMatch(/14 days|14-day/);
  });
});

describe('STORE-1c · W307 — done (W2468/W3066)', () => {
  it('created: the name, the address /<slug> private until verified, the trial end date; console "not configured" when unset', async () => {
    mock.pending = { ...VALUES, typed: '', done: { org: 'Bhavnagar Kisan FPC', slug: 'bhavnagar-kisan-fpc', trialEndsOn: '2026-10-28', resumed: false } };
    const html = await render({ step: 'done' });
    expect(html).toContain('data-kv-outcome="created"');
    expect(text(html)).toContain('Bhavnagar Kisan FPC is created.');
    expect(text(html)).toContain('Your storefront address is /bhavnagar-kisan-fpc. It stays private until your organisation is verified');
    expect(text(html)).toContain('Your free trial ends on 28 October 2026.');
    expect(html).toContain('data-kv-console="missing"');
    noPhoneInAnyHref(html);
  });

  it('created + a console origin → "Open your console" → <origin>/login (sign in again by OTP — said)', async () => {
    mock.consoleUrl = 'https://console.example/';
    mock.pending = { ...VALUES, typed: '', done: { org: 'Bhavnagar Kisan FPC', slug: 'bhavnagar-kisan-fpc', trialEndsOn: null, resumed: false } };
    const html = await render({ step: 'done' });
    expect(html).toContain('<a href="https://console.example/login" class="kv-btn" data-kv-console="link">Open your console</a>');
    expect(text(html)).toContain(en['signup.done.consoleHow']);
  });

  it('RESUMED: "this phone already administers <org>" — nothing new created, no address or trial claimed', async () => {
    mock.pending = { ...VALUES, typed: '', done: { org: 'Junagadh Kisan Producer Co', slug: 'junagadh-kisan', trialEndsOn: null, resumed: true } };
    const html = await render({ step: 'done' });
    expect(html).toContain('data-kv-outcome="resumed"');
    expect(text(html)).toContain('This phone already administers Junagadh Kisan Producer Co.');
    expect(text(html)).not.toContain('is created');
    expect(text(html)).toContain(en['signup.refused.names']);           // the canon's resolution desk, refused by name
  });
});

describe('STORE-1c · W307 — failure (W2469/W3067) and the Retry replay (W2470–W2472)', () => {
  const failed = () => ({ ...VALUES, phone: PHONE, code: '123456', idem: KEY });

  it('switched off at submit (SIGNUP_DISABLED): the off card + "your code was not used"; no form', async () => {
    mock.pending = failed();
    const html = await render({ step: 'failure', err: 'disabled' });
    expect(html).toContain('data-kv-state="flagged-off"');
    expect(text(html)).toContain(en['signup.off.codeKept']);
    expect(html).not.toContain('name="idem"');
  });

  it('the route\'s rate limit with its wait; Retry carries the SAME key the first attempt used', async () => {
    mock.pending = failed();
    const html = await render({ step: 'failure', err: 'rate_signup', n: '3600' });
    expect(text(html)).toContain('Too many sign-ups from this connection. Try again in 60 min.');
    expect(html).toContain(`<input type="hidden" name="idem" value="${KEY}"/>`);
    expect(text(html)).toContain(en['signup.failure.retryNote']);
  });

  it('unavailable (Law 12): nothing changed, Retry with the same key, back to the form, start again; on-call refused by name', async () => {
    mock.pending = failed();
    const html = await render({ step: 'failure', err: 'unavailable' });
    expect(html).toContain('data-kv-step="failure"');
    expect(text(html)).toContain(en['signup.err.unavailable']);
    expect(text(html)).toContain(en['signup.failure.lede']);
    expect(html).toContain(`value="${KEY}"`);
    expect(text(html)).toContain(en['signup.failure.back']);
    expect(text(html)).toContain(en['signup.refused.oncall']);
    expect(text(html)).not.toMatch(/page the on-call|Confirm this action/i);
    noPhoneInAnyHref(html);
  });
});

describe('STORE-1c · W307 — refused by name, on every state', () => {
  it.each(['form', 'code', 'review', 'done', 'failure'])('?step=%s prints every rendered §E refusal in kv-refused', async (step) => {
    mock.pending = { ...VALUES, phone: PHONE, code: '123456', idem: KEY, sentAt: now(), ttlSec: 300, done: { org: 'X FPC', slug: 'x-fpc', trialEndsOn: null, resumed: false } };
    const html = await render({ step, ...(step === 'failure' ? { err: 'unavailable' } : {}) });
    const block = html.slice(html.indexOf('data-kv-refused="W307"'));
    for (const r of STORE1C_REFUSALS.filter((x) => x.answer === 'rendered')) {
      expect([r.id, block.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
    }
    expect(text(block)).toContain('custom domains come later');
    expect(text(block)).toContain(en['signup.refused.desk']);
    noPhoneInAnyHref(html);
  });

  it('in Hindi and Gujarati too — the page speaks the reader\'s language, the platform name interpolated', async () => {
    for (const lang of ['hi', 'gu']) {
      mock.lang = lang;
      const html = await render();
      expect(html).not.toContain('Open your organisation');
      expect(text(html)).toContain(lang === 'hi' ? 'कृषालय' : 'કૃષાલય');
    }
  });
});

describe('STORE-1c · C1 — the old address', () => {
  it('/tenants-signup answers a PERMANENT redirect to /for-organisations (printed links and bookmarks still land)', () => {
    expect(() => TenantsSignupPage()).toThrow('PERMANENT /for-organisations');
  });
});
