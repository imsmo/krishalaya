// apps/web-storefront/src/test-render/account.render.test.tsx · PC-56 STORE-4a · C7 — canon W300 "Account" (components/account/AccountScreen.tsx,
// rendered through BOTH chromes' pages):
//   • the name printed (never "—" for a name the API serves); the phone and email MASKED — and masked AGAIN if a value ever arrives bare;
//   • the language as a label beside this site's language; "Reveal" refused by name, the change-phone sentence;
//   • business details: the masked GSTIN + "Verified" + "on every invoice automatically" ONLY when verified; pending says it is not on
//     invoices; the `kyc` switch OFF (404) → said; an error is not "none";
//   • saved methods masked, "no card is ever saved"; the wallet balance from the SERVER in the data's currency;
//   • the shortcuts with the address count (and "50+" at the cap), both chromes' hrefs; the request history; a load error with a Retry.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store4a-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import PlatformAccount from '../app/(platform)/account/page';
import TenantAccount from '../app/[tenantSlug]/account/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, RECEIVER_PHONE, exportRequest } from './store4a-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PlatformAccount({ searchParams: sp }));
const tenantPage = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantAccount({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
beforeEach(() => { reset(); });

describe('STORE-4a · W300 the account — the profile', () => {
  it('the name is PRINTED (never "—"); the phone and email are the server\'s masked forms; the language a label beside the site\'s', async () => {
    const h = await page(); const v = text(h);
    expect(h).toMatch(/data-kv-name="true">Nilesh Shah</);
    expect(v).not.toContain('—</dd>');
    expect(h).toMatch(/data-kv-phone="true">\+9198\*\*\*\*2742</);
    expect(h).toMatch(/data-kv-email="true">n\*\*\*@shahtrading\.in</);
    expect(h).toMatch(/data-kv-language="gu">Gujarati</);
    expect(h).toMatch(/data-kv-site-language="en">English</);
    expect(v).toContain(en['store4a.profile.noticesLanguage']);
  });
  it('a phone or email that ever arrives BARE is masked here — the full number never reaches the page', async () => {
    C.me = { ...C.me, phone: RECEIVER_PHONE, email: 'nilesh@shahtrading.in' };
    const h = await page();
    expect(h).not.toContain(RECEIVER_PHONE); expect(h).not.toContain('9898012742'); expect(h).not.toContain('nilesh@shahtrading.in');
    expect(h).toMatch(/data-kv-phone="true">\+91 98••• ••742</);
    expect(h).toMatch(/data-kv-email="true">n\*\*\*@shahtrading\.in</);
  });
  it('"Reveal" is refused by name; the change-phone sentence is said; no Reveal control exists', async () => {
    const h = await page();
    expect(h).toContain('data-kv-refusal="reveal"');
    expect(text(h)).toContain(en['store4a.refusal.reveal']);
    expect(text(h)).toContain(en['store4a.profile.changePhone']);
    expect(h).not.toMatch(/>Reveal</);
  });
  it('a profile that cannot be read says so with a Retry (W3031–W3033 DECOR) — never a blank profile', async () => {
    C.fail.me = new SdkError('UNAVAILABLE', 503, 'down');
    const h = await page();
    expect(h).toContain('data-kv-state="profile-error"'); expect(h).toContain('data-kv-retry="reload"');
    expect(h).toContain('data-kv-refusal="audit_reload"');
  });
  it('the profile edit offers languages as LABELS (never raw codes) and says it is recorded (field names, masked)', async () => {
    const h = await page();
    expect(h).toMatch(/<option value="hi">Hindi<\/option>/); expect(h).not.toMatch(/<option value="hi">hi<\/option>/);
    expect(text(h)).toContain(en['store4a.profile.auditSentence']);
    expect(h).toMatch(/<input type="hidden" name="chrome" value="platform"/);
  });
});

describe('STORE-4a · W300 business details (founder D5) · methods (D6) · wallet (D8)', () => {
  it('VERIFIED → the masked GSTIN, "Verified" and "on every invoice automatically"', async () => {
    const h = await page();
    expect(h).toContain('data-kv-business="verified"'); expect(h).toContain('24AAACS••••F1Z5');
    expect(h).toContain('data-kv-on-invoice'); expect(text(h)).toContain(en['store4a.business.onInvoice']);
    expect(h).toContain('data-kv-refusal="kyc_auctions"'); expect(h).toContain('data-kv-refusal="licence"');
  });
  it('PENDING → "Under review" and NOT on invoices; the switch OFF (404) → said; an error → said, never "none"', async () => {
    C.kyc = { ...C.kyc, status: 'pending' };
    let h = await page();
    expect(h).toContain('data-kv-kyc-status="pending"'); expect(h).not.toContain('data-kv-on-invoice'); expect(h).toContain('data-kv-not-on-invoice');
    C.fail.kyc = new SdkError('NOT_FOUND', 404, 'nf');
    h = await page(); expect(h).toContain('data-kv-business="off"'); expect(text(h)).toContain(en['store4a.business.off']);
    C.fail.kyc = new SdkError('UNAVAILABLE', 503, 'down');
    h = await page(); expect(h).toContain('data-kv-business="error"'); expect(text(h)).not.toContain(en['store4a.business.none']);
  });
  it('saved methods are MASKED as served (no holder name), and "no card is ever saved" is said', async () => {
    const h = await page();
    expect(h).toContain('data-kv-method="upi_autopay"'); expect(text(h)).toContain('UPI AutoPay ni***@okaxis');
    expect(text(h)).toContain('Bank account for payouts ••4417'); expect(h).not.toContain('Nilesh Shah</li>');
    expect(h).toContain('data-kv-refusal="card"');
  });
  it('the wallet line is the SERVER\'s balance in the currency of the person\'s own money (commitments) — read-only, no arithmetic', async () => {
    const h = await page();
    expect(h).toContain('data-kv-wallet="data"'); expect(h).toContain('data-kv-money="INR"');
    expect(text(h)).toMatch(/Wallet balance ₹1,250\.50/);
    expect(C.calls).toContainEqual(['wallet.balance', 'INR']);
  });
  it('no currency in the person\'s data → the STORE\'s currency, NAMED as such; neither → no wallet line (never a guessed currency)', async () => {
    C.commitments = { ...C.commitments, currencyCode: null, walletMinor: '0' }; C.storeCurrency = 'USD';
    let h = await page();
    expect(h).toContain('data-kv-wallet="store"'); expect(text(h)).toContain(en['store4a.wallet.storeCurrency']); expect(C.calls).toContainEqual(['wallet.balance', 'USD']);
    C.storeFails = true; C.calls = [];
    h = await page();
    expect(h).toContain('data-kv-wallet="none"'); expect(C.calls.filter((c) => c[0] === 'wallet.balance')).toEqual([]);
  });
});

describe('STORE-4a · W300 shortcuts, data rights, what organisations see — both chromes', () => {
  it('Addresses (n) → the book; the doors; both CHROMES build their own hrefs (one component)', async () => {
    const p = await page();
    expect(p).toContain('data-kv-shortcut="addresses" href="/account/addresses">Addresses (2)<');
    expect(p).toContain('data-kv-shortcut="orders" href="/orders"');
    expect(p).toContain('data-kv-cta="download" href="/account/data"'); expect(p).toContain('href="/account/delete"');
    const t = await tenantPage();
    expect(t).toContain('data-kv-chrome="anand-fpo"');
    expect(t).toMatch(/href="\/anand-fpo\/account\/addresses"/); expect(t).toMatch(/href="\/anand-fpo\/orders"/); expect(t).toMatch(/href="\/anand-fpo\/account\/data"/);
    expect(t).toMatch(/<input type="hidden" name="chrome" value="anand-fpo"/);
    expect(t).toMatch(/href="\/notifications\/preferences"/);
  });
  it('at the API\'s cap the count prints "50+" (never a guessed total)', async () => {
    C.addresses = Array.from({ length: 50 }, (_, i) => ({ ...C.addresses[0], id: `0214d000-0000-7000-8000-${String(i).padStart(12, '0')}` }));
    expect(await page()).toContain('href="/account/addresses">Addresses (50+)<');
  });
  it('the request history: the kind, the status, the cooling date for a deletion, the receipt line for a ready export', async () => {
    C.requests = [exportRequest('ready'), { id: 'dsr-2', kind: 'deletion', status: 'open', coolingEndsAt: '2027-01-14T05:00:00.000Z', requestedAt: '2026-10-16T05:00:00.000Z', export: null }];
    const h = await page(); const v = text(h);
    expect(h).toContain('data-kv-dsr="export"'); expect(h).toContain('data-kv-dsr="deletion"');
    expect(v).toContain('file ready, 42 rows'); expect(v).toMatch(/cooling until 14 Jan 2027/);
  });
  it('what organisations see is what their order read carries (your name; never your phone) — "buying history" and "30 days" refused', async () => {
    const h = await page();
    expect(text(h)).toContain(en['store4a.seenBy']);
    for (const id of ['buying_history', 'thirty_days', 'flagged_off', 'helpline']) expect(h).toContain(`data-kv-refusal="${id}"`);
  });
});
