// apps/web-storefront/src/test/store4a-account.spec.ts · PC-56 STORE-4a · C7 — the PURE half of the account, the address book and the data rights:
// the chrome href helper (both chromes, one path builder), the profile view (masked twice over), business / methods / wallet views, the
// address form codec (the ONE copy shared with checkout), the edit patch and diff, the draft codec, the named failures, the export and deletion
// state models, the refusal registry (every key in three languages; each English refusal says no), the catalogue rules (no digit, no currency
// sign, no person placeholder in a STORE-4a value), and the no-money-arithmetic grep over the STORE-4a sources.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  accountHref, chromeOf, chromeField, downloadHref, shortcutHrefs, tenantChrome, PLATFORM_CHROME, profileView, maskedPhone, maskedEmail, languageKey,
  businessView, methodRows, walletCurrency, addressCount, dsrStatusKey,
} from '../features/store4a/account';
import {
  accountAddressValues, checkAccountAddress, accountAddressBody, accountAddressPatch, withKeptPhone, addressDiff, valuesOfAddress, encodeAddressDraft,
  decodeAddressDraft, accountAddressFieldKey, checkAddress, DELIVERY_NOTE_MAX,
} from '../features/address/form';
import * as checkout from '../features/store2c/checkout';
import * as addressForm from '../features/address/form';
import { bookCard, labelText, addressFailureOf, readKey, removesDefault } from '../features/store4a/addresses';
import { exportView, etaMinutes, canRequestExport, exportFailureKey, downloadErrorKey, deletionView, openDeletion, deleteFailureOf } from '../features/store4a/data-rights';
import { STORE4A_REFUSALS, STORE4A_DELTAS, STORE4A_CHAIN_PAGES, store4aRefusalKeys } from '../features/store4a/refusals';

const CATS = { en, hi, gu } as const;
const U = '0214d000-0000-7000-8000-000000000001';
const L = '0214e000-0000-7000-8000-000000000002';

describe('STORE-4a · the chrome (founder Q13 — both real, one path builder)', () => {
  it('the platform\'s /account… and an organisation\'s /<slug>/account…', () => {
    const t = tenantChrome('anand-fpo');
    expect(accountHref(PLATFORM_CHROME)).toBe('/account'); expect(accountHref(t)).toBe('/anand-fpo/account');
    expect(accountHref(t, 'addresses', { ok: 'removed' })).toBe('/anand-fpo/account/addresses?ok=removed');
    expect(accountHref(PLATFORM_CHROME, { edit: U })).toBe(`/account/addresses/${U}/edit`);
    expect(accountHref(PLATFORM_CHROME, { edit: 'nope' })).toBe('/account/addresses');
    expect(downloadHref(t, U, 'abcdefghijklmnopqrstuvwxyz.sig')).toBe(`/anand-fpo/account/data/${U}/download?token=abcdefghijklmnopqrstuvwxyz.sig`);
    expect(downloadHref(t, U, 'x y')).toBe('/anand-fpo/account/data');
    expect(shortcutHrefs(t)).toEqual({ orders: '/anand-fpo/orders', offers: '/anand-fpo/offers', bids: '/anand-fpo/auctions/bids', preferences: '/notifications/preferences' });
  });
  it('the hidden chrome field round-trips; anything malformed is the platform (never a path a form typed)', () => {
    expect(chromeOf(chromeField(tenantChrome('anand-fpo')))).toEqual({ kind: 'tenant', slug: 'anand-fpo' });
    for (const bad of ['', 'platform', '../x', 'A B', null, 42]) expect(chromeOf(bad)).toEqual(PLATFORM_CHROME);
  });
});

describe('STORE-4a · the profile, business, methods and wallet views', () => {
  it('the name from fullName (else displayName); a bare phone / email is masked here; the language a label key', () => {
    expect(profileView({ fullName: ' Nilesh Shah ', phone: '+9198****2742', email: 'n***@x.in', languageCode: 'gu' })).toEqual({ name: 'Nilesh Shah', phone: '+9198****2742', email: 'n***@x.in', languageCode: 'gu', languageKey: 'store4a.lang.gu' });
    expect(profileView({ displayName: 'Asha' })?.name).toBe('Asha'); expect(profileView({})?.name).toBeNull();
    expect(maskedPhone('+919898012742')).toBe('+91 98••• ••742'); expect(maskedEmail('nilesh@x.in')).toBe('n***@x.in');
    expect(languageKey('ta')).toBeNull();
  });
  it('business: "on every invoice" only for VERIFIED with a GSTIN; 404 = the switch off; any other failure = error', () => {
    expect(businessView({ ok: true, value: { status: 'verified', gstinMasked: '24AA••' } }).onInvoice).toBe(true);
    expect(businessView({ ok: true, value: { status: 'pending', gstinMasked: '24AA••' } }).onInvoice).toBe(false);
    expect(businessView({ ok: true, value: { status: 'verified', gstinMasked: null } }).onInvoice).toBe(false);
    expect(businessView({ ok: false, status: 404 }).state).toBe('off'); expect(businessView({ ok: false, status: 503 }).state).toBe('error');
  });
  it('methods: only masked values are drawn (a bare handle or account number never is)', () => {
    expect(methodRows({ mandates: [{ id: 'm', handleMasked: 'ni***@ok' }, { id: 'raw', handleMasked: 'nilesh@okaxis' }], accounts: [{ id: 'b', kind: 'bank', last4: '4417', ifsc: 'H' }, { id: 'x', kind: 'bank', last4: '123456' }] }).map((r) => r.id)).toEqual(['m', 'b']);
  });
  it('wallet currency: the person\'s data first, else the store\'s (named), else none — never a literal', () => {
    expect(walletCurrency('INR', 'USD')).toEqual({ currency: 'INR', source: 'data' });
    expect(walletCurrency(null, 'USD')).toEqual({ currency: 'USD', source: 'store' });
    expect(walletCurrency(null, null)).toBeNull(); expect(walletCurrency('inr', 'x')).toBeNull();
    expect(addressCount(3)).toEqual({ n: 3, capped: false }); expect(addressCount(50)).toEqual({ n: 50, capped: true });
    expect(dsrStatusKey('in_progress')).toBe('store4a.dsr.status.in_progress'); expect(dsrStatusKey('weird')).toBe('store4a.dsr.status.unknown');
  });
});

describe('STORE-4a · the address form (the ONE copy shared with checkout)', () => {
  it('checkout re-exports the SAME functions — one copy of the postal rule, the refusals, the body and the card', () => {
    for (const n of ['POSTAL_CODE_RE', 'addressValues', 'checkAddress', 'addressBody', 'addressFieldKey', 'addressCard'] as const) expect((checkout as Record<string, unknown>)[n]).toBe((addressForm as Record<string, unknown>)[n]);
  });
  const v = (o: Partial<Record<string, string>> = {}) => accountAddressValues((k) => ({ line1: 'Plot 14', pincode: '362001', countryCode: 'in', labelId: L, deliveryNote: 'Gate 2', ...o } as Record<string, string>)[k]);
  it('2c\'s refusals + the note\'s bound + a label the page offered; the country upper-cased and required', () => {
    expect(checkAccountAddress(v(), new Set([L]))).toEqual({});
    expect(v().countryCode).toBe('IN');
    expect(checkAccountAddress(v({ deliveryNote: 'n'.repeat(DELIVERY_NOTE_MAX + 1) }), new Set([L]))).toEqual({ deliveryNote: 'note_too_long' });
    expect(checkAccountAddress(v({ labelId: U }), new Set([L]))).toEqual({ labelId: 'label' });
    expect(checkAccountAddress(v({ countryCode: '' }), new Set([L]))).toEqual({ countryCode: 'country' });
    expect(checkAddress(v({ pincode: '123' }))).toEqual({ pincode: 'postal' });
    expect(accountAddressFieldKey('note_too_long')).toBe('store4a.address.err.noteTooLong'); expect(accountAddressFieldKey('postal')).toBe('store2c.address.err.postal');
    expect(accountAddressBody(v())).toEqual({ line1: 'Plot 14', pincode: '362001', countryCode: 'IN', labelId: L, deliveryNote: 'Gate 2' });
  });
  it('the edit patch sends ONLY what changes (an untouched edit sends nothing); a cleared note / label is null; a blank phone keeps the current', () => {
    const current = valuesOfAddress({ line1: 'Plot 14', pincode: '362001', countryCode: 'IN', contactPhone: '+919898012742', labelId: L, deliveryNote: 'Gate 2' });
    expect(accountAddressPatch(current, withKeptPhone(current, { ...current, contactPhone: '' }))).toEqual({});
    expect(accountAddressPatch(current, { ...current, deliveryNote: '', labelId: '' })).toEqual({ deliveryNote: null, labelId: null });
    expect(accountAddressPatch(current, { ...current, deliveryNote: 'Gate 3' })).toEqual({ deliveryNote: 'Gate 3' });
    const d = addressDiff(current, { ...current, contactPhone: '+919898000111', deliveryNote: 'Gate 3' });
    expect(d).toEqual([{ field: 'contactPhone', from: '+91 98••• ••742', to: '+91 98••• ••111' }, { field: 'deliveryNote', from: 'Gate 2', to: 'Gate 3' }]);
  });
  it('the draft codec: re-validated, and a draft for another address or the other mode is ignored', () => {
    const raw = encodeAddressDraft({ v: 1, mode: 'edit', id: U, values: v(), errors: { pincode: 'postal' }, failure: 'server' });
    expect(decodeAddressDraft(raw, 'edit', U)?.errors).toEqual({ pincode: 'postal' });
    expect(decodeAddressDraft(raw, 'edit', L)).toBeNull(); expect(decodeAddressDraft(raw, 'create', null)).toBeNull(); expect(decodeAddressDraft('garbage', 'edit', U)).toBeNull();
  });
  it('the book: the card masks the receiver; the label by code; the named failures; the render key', () => {
    const c = bookCard({ id: U, line1: 'Plot 14', pincode: '362001', contactPhone: '+919898012742', labelCode: 'farm', isDefault: true, deliveryNote: ' Gate 2 ' });
    expect([c.phoneMasked, c.deliveryNote, c.labelCode]).toEqual(['+91 98••• ••742', 'Gate 2', 'farm']);
    expect(labelText('farm', 'Farm (org)', (k) => `T:${k}`)).toBe('T:store4a.label.farm'); expect(labelText('silo', 'Silo', (k) => k)).toBe('Silo');
    expect(removesDefault([c], U)).toBe(true);
    expect([addressFailureOf('ADDRESS_LABEL_UNKNOWN', 422), addressFailureOf('VALIDATION_FAILED', 422), addressFailureOf('ADDRESS_NOT_FOUND', 404), addressFailureOf('CONFLICT', 409), addressFailureOf(null, 500)]).toEqual(['label', 'validation', 'not_found', 'concurrency', 'server']);
    expect(readKey('address:0214cafe-0000-4000-8000-000000000001')).not.toBeNull(); expect(readKey('address:../x')).toBeNull();
  });
});

describe('STORE-4a · the data rights state models (founder D1 / D2 / D3)', () => {
  const req = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'd', kind: 'export', status: 'in_progress', export: { jobId: 'j', status, standing: status === 'queued' ? { position: 2, eta: { kind: 'estimate', seconds: 61 } } : null,
    receipt: status === 'ready' ? { fileName: 'f.csv', rowCount: 9, sha256: 's', generatedAt: 'g', requestedBy: 'me' } : null, download: status === 'ready' ? { kind: 'available', linkTtlSec: 900 } : { kind: 'not_ready' }, failure: status === 'failed' ? { code: 'storage_failed' } : null, ...extra } });
  it('exportView: the plane\'s state, as it is; the receipt is "you" only for the requester; the link TTL from the plane', () => {
    expect(exportView([], 'me').phase).toBe('none');
    const q = exportView([req('queued')], 'me'); expect([q.phase, q.position, q.etaSeconds]).toEqual(['queued', 2, 61]); expect(etaMinutes(q.etaSeconds)).toBe(2);
    const r = exportView([req('ready')], 'me'); expect([r.phase, r.receipt?.requestedByYou, r.downloadable, r.linkTtlSec]).toEqual(['ready', true, true, 900]);
    expect(exportView([req('ready')], 'other').receipt?.requestedByYou).toBe(false);
    expect(exportView([req('failed')], 'me').failureCode).toBe('storage_failed');
    expect(etaMinutes(null)).toBeNull();
    expect([canRequestExport(q), canRequestExport(exportView([req('expired')], 'me')), canRequestExport(exportView([], null))]).toEqual([false, true, true]);
    expect(exportFailureKey('storage_failed')).toBe('store4a.data.failure.storage_failed'); expect(exportFailureKey('weird')).toBe('store4a.data.failure.generic');
    expect(downloadErrorKey('refused_expired')).toBe('store4a.data.downloadError.linkExpired');
  });
  it('deletionView draws a money line only above zero (compared, never computed); the open request; the named failures', () => {
    const v = deletionView({ openOrders: 1, escrowMinor: '0', walletMinor: '5000', currencyCode: 'INR', multiCurrency: false, invoiceCount: 3, blocked: true, retentionYears: 8, coolingDays: 90 });
    expect([v.escrowMinor, v.walletMinor]).toEqual([null, '5000']);
    expect(openDeletion([{ id: 'x', kind: 'deletion', status: 'open', coolingEndsAt: 'c' }])).toEqual({ id: 'x', status: 'open', coolingEndsAt: 'c' });
    expect(openDeletion([{ id: 'x', kind: 'deletion', status: 'completed' }])).toBeNull();
    expect([deleteFailureOf('DSR_BLOCKED', 409), deleteFailureOf('CONFLICT', 409), deleteFailureOf(null, 500)]).toEqual(['blocked', 'concurrency', 'server']);
  });
});

describe('STORE-4a · the refusal registry and the catalogues', () => {
  it('every refusal key exists in en / hi / gu, and every English refusal says no / not / never / cannot', () => {
    expect(STORE4A_REFUSALS.length).toBe(12);
    for (const r of STORE4A_REFUSALS) {
      for (const cat of Object.values(CATS)) expect([r.key, typeof (cat as Record<string, string>)[r.key]]).toEqual([r.key, 'string']);
      expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bcannot\b/i.test((en as Record<string, string>)[r.key])]).toEqual([r.key, true]);
    }
    for (const s of ['account', 'addresses', 'address_form', 'data', 'delete'] as const) expect(store4aRefusalKeys(s).length).toBeGreaterThan(0);
  });
  it('the 14 canon files are listed, each once; the DELTAs name the deletion chain, the one CSV, both chromes and the W316 links', () => {
    const files = STORE4A_CHAIN_PAGES.map((p) => p.file);
    expect(files).toEqual(['W300-store-account.html', 'W301-store-addresses.html', 'W3029-store-account-export-queued.html', 'W3030-store-account-export-ready.html',
      'W3031-store-account-mutate-confirm.html', 'W3032-store-account-mutate-success.html', 'W3033-store-account-mutate-failure.html', 'W3034-store-addresses-form-form-error.html',
      'W3035-store-addresses-form-review.html', 'W3036-store-addresses-form-success.html', 'W3037-store-addresses-form-failure.html', 'W3038-store-addresses-mutate-confirm.html',
      'W3039-store-addresses-mutate-success.html', 'W3040-store-addresses-mutate-failure.html']);
    expect(STORE4A_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['deletion_chain', 'one_csv', 'both_chromes', 'keyset_caps', 'chain_back_links']));
  });
  it.each(Object.entries(CATS))('%s: no digit, no currency sign, no person placeholder in a STORE-4a value; the five labels by code', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store4a.'));
    expect(keys.length).toBe(192);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      expect([k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([k, false]);
      expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|fullName|owner|buyer)\}/i.test(v)]).toEqual([k, false]);
    }
    for (const code of ['home', 'farm', 'shop', 'warehouse', 'delivery']) expect(typeof (cat as Record<string, string>)[`store4a.label.${code}`]).toBe('string');
  });
});

describe('STORE-4a · no money arithmetic in the STORE-4a sources', () => {
  const ROOT = path.join(__dirname, '..');
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'features/store4a')).map((f) => path.join(ROOT, 'features/store4a', f)),
    ...fs.readdirSync(path.join(ROOT, 'components/account')).map((f) => path.join(ROOT, 'components/account', f)),
  ];
  it.each(files.map((f) => [path.relative(ROOT, f), f]))('%s: no +, -, * or / on a minor amount and no BigInt arithmetic', (_rel, f) => {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/Minor\s*[-+*/]\s*[\w(]/);
    expect(src).not.toMatch(/[\w)]\s*[-+*/]\s*\w*Minor\b/);
    expect(src).not.toMatch(/BigInt\([^)]*\)\s*[-+*/]/);
  });
});
