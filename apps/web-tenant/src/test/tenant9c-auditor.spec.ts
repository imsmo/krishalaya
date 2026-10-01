// apps/web-tenant/src/test/tenant9c-auditor.spec.ts · PC-56 TENANT-9c · THE AUDITOR REALM, in the console.
// The helpers; the pages' own promises read from their source (no client JS, the key minted on the confirm page, every
// canon screen has a route, no "verified" composed anywhere); every list mirrored from the API's OWN source; and every key a
// page can ask for exists ×3 — the literal ones and every dynamic family.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  AUDITOR_DATASETS, AUDITOR_HREF, AUDITOR_REFUSED_BY_NAME, CHAIN_VERDICTS, ENQUEUE_FAILURES, EXPORTS_HREF, LEDGER_HREF, LEG_KINDS,
  MAX_EXPORT_WINDOW_DAYS, MAX_LIVE_WINDOW_DAYS, NEW_EXPORT_HREF, PACK_HREF, PACK_SECTIONS, PAGE_REFUSALS, READ_PURPOSES, SCOPE_HREFS,
  WINDOW_REFUSALS, chainKey, datasetKey, dayOrUndefined, enqueueFailureKey, exportDownloadHref, exportHref, footKey, hashLinkKey,
  hashLinkTone, integrityLines, ledgerHref, legKindKey, newExportHref, purposeKey, realmState, realmStateKey, refusedKey,
  retryIsMutation, roleCellKey, scopeKey, sectionKey, shortHash, sideKey, signedTerms, windowFilters, windowRefusalKey,
} from '../features/auditor/realm';
import { buildAuditQuery } from '../features/audit/viewer';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src', rel), 'utf8');
const listOf = (s: string, start: string, end: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z_.]+)'/g)].map((m) => m[1]); };
const PAGES = [
  'app/auditor/page.tsx', 'app/auditor/loading.tsx', 'app/auditor/ledger/page.tsx', 'app/auditor/compliance-pack/page.tsx',
  'app/auditor/exports/page.tsx', 'app/auditor/exports/new/page.tsx', 'app/auditor/exports/new/actions.ts',
  'app/auditor/exports/[id]/page.tsx', 'app/auditor/exports/[id]/actions.ts', 'app/auditor/exports/[id]/download/route.ts',
  'app/auditor/reveal/page.tsx', 'app/auditor/reveal/actions.ts',
];

describe('routes (W200, W201, W436, W437, W2498–W2502)', () => {
  it('every canon screen has a route', () => {
    for (const p of PAGES) expect([p, fs.existsSync(path.join(__dirname, '..', p))]).toEqual([p, true]);
    expect([AUDITOR_HREF, LEDGER_HREF, PACK_HREF, EXPORTS_HREF, NEW_EXPORT_HREF]).toEqual(['/auditor', '/auditor/ledger', '/auditor/compliance-pack', '/auditor/exports', '/auditor/exports/new']);
    expect(exportHref('a b')).toBe('/auditor/exports/a%20b');
    expect(exportDownloadHref('j1', 'p.s')).toBe('/auditor/exports/j1/download?token=p.s');
    expect(newExportHref('ledger.entries', { from: '2026-04-01', to: '2026-09-30' })).toBe('/auditor/exports/new?step=confirm&dataset=ledger.entries&from=2026-04-01&to=2026-09-30');
    expect(newExportHref('compliance.pack', { from: '2026-07-01', to: '2026-09-30', section: 'gst' })).toBe('/auditor/exports/new?step=confirm&dataset=compliance.pack&from=2026-07-01&to=2026-09-30&section=gst');
  });
  it('no client JS, no inline handler, no physical left/right CSS; every write under the key the CONFIRM page minted', () => {
    for (const p of PAGES) {
      const s = src(p);
      expect([p, /'use client'/.test(s)]).toEqual([p, false]);
      expect([p, /\son[A-Z][a-zA-Z]+=\{/.test(s)]).toEqual([p, false]);
      expect([p, /(margin|padding|border)-?(Left|Right|left|right)|textAlign: '(left|right)'|float: '(left|right)'/.test(s)]).toEqual([p, false]);
    }
    expect(src('app/auditor/exports/new/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(src('app/auditor/exports/new/actions.ts')).toMatch(/enqueueExport\(\{ datasetCode: dataset as AuditorDatasetCode, params \}, key\)/);
    expect(src('app/auditor/exports/new/actions.ts')).toMatch(/formData\.get\('idempotencyKey'\)/);
  });
  it('no page composes the word "verified" over the ledger; the shared chain and the signature are refused by name', () => {
    for (const p of PAGES) expect([p, /auditor\.[a-z.]*verified|'verified'/.test(src(p))]).toEqual([p, false]);
    for (const k of Object.keys(en).filter((x) => x.startsWith('auditor.'))) expect([k, /\bverified\b|\bverifiable\b/i.test(en[k as keyof typeof en] as string) && !/not|never|cannot|no /i.test(en[k as keyof typeof en] as string)]).toEqual([k, false]);
    expect(src('app/auditor/page.tsx')).toMatch(/refusedKey\('sharedChain'\)/);
    expect(src('app/auditor/exports/page.tsx')).toMatch(/auditor\.exports\.unsigned/);
    expect(src('app/auditor/exports/[id]/page.tsx')).toMatch(/UNSIGNED_EXPORT_KEY/);
  });
  it('the reveal carries a GRANT in the URL, never a value', () => {
    const a = src('app/auditor/reveal/actions.ts');
    expect(a).toMatch(/redirect\(`\/auditor\?entry=\$\{id\}&reveal=\$\{encodeURIComponent\(grant\)\}`\)/);
    expect(a).not.toMatch(/newValue|oldValue/);
    expect(src('app/auditor/page.tsx')).toMatch(/audit\.get\(selected, undefined, \{ revealGrant: grant \}\)/);
  });
  it('the credit-note console reads the money verb, not report.view', () => {
    expect(src('app/invoices/[id]/page.tsx')).toMatch(/tenantHasPerm\('payments\.credit_note\.issue'\)/);
    expect(en['invd.creditBlocked.noPermission' as keyof typeof en]).toMatch(/payments\.credit_note\.issue/);
  });
  it('the trail sends the cooperative\'s DAYS, not UTC instants', () => {
    expect(buildAuditQuery({ from: '2026-07-01', to: '2026-07-13' })).toEqual({ from: '2026-07-01', to: '2026-07-13' });
    expect(en['aud.list.when' as keyof typeof en]).not.toMatch(/UTC/);
    expect(hi['aud.list.when' as keyof typeof hi]).not.toMatch(/UTC/);
    expect(gu['aud.list.when' as keyof typeof gu]).not.toMatch(/UTC/);
  });
});

describe('the lists are the API\'s own', () => {
  it('refusals, purposes, datasets, sections, bounds, leg kinds, chain verdicts', () => {
    expect([...AUDITOR_REFUSED_BY_NAME]).toEqual(listOf(api('modules/audit/domain/auditor-realm.ts'), 'AUDITOR_REFUSED_BY_NAME = [', '] as const'));
    expect([...READ_PURPOSES]).toEqual(listOf(api('modules/audit/domain/auditor-realm.ts'), 'READ_PURPOSES = [', '] as const'));
    expect([...AUDITOR_DATASETS]).toEqual(['audit.trail', 'ledger.entries', 'compliance.pack']);
    expect(api('modules/audit/domain/auditor-exports.ts')).toMatch(/AUDIT_TRAIL_DATASET = 'audit\.trail'[\s\S]*LEDGER_ENTRIES_DATASET = 'ledger\.entries'[\s\S]*COMPLIANCE_PACK_DATASET = 'compliance\.pack'/);
    expect([...PACK_SECTIONS]).toEqual(listOf(api('modules/audit/domain/auditor-exports.ts'), 'PACK_SECTIONS = [', '] as const'));
    expect(MAX_LIVE_WINDOW_DAYS).toBe(Number(/MAX_LIVE_WINDOW_DAYS = (\d+)/.exec(api('modules/audit/domain/auditor-realm.ts'))![1]));
    expect(MAX_EXPORT_WINDOW_DAYS).toBe(Number(/MAX_EXPORT_WINDOW_DAYS = (\d+)/.exec(api('modules/audit/domain/auditor-realm.ts'))![1]));
    expect([...LEG_KINDS]).toEqual(listOf(api('modules/payments/domain/auditor-ledger.ts'), 'export type LegKind =', ';'));
    expect([...CHAIN_VERDICTS].sort()).toEqual(['chain_break', 'empty', 'hash_mismatch', 'incomplete', 'intact']);
    expect([...WINDOW_REFUSALS]).toEqual(listOf(api('modules/audit/domain/auditor-realm.ts'), 'export type WindowRefusal =', ';'));
    for (const c of ENQUEUE_FAILURES) expect([c, api('core/exports-plane/domain/export-plane.errors.ts').includes(`'${c}'`) || api('modules/audit/domain/auditor.errors.ts').includes(`'${c}'`) || api('core/auth/auditor-read-only.guard.ts').includes(`'${c}'`) || c === 'FORBIDDEN']).toEqual([c, true]);
  });
});

describe('the helpers', () => {
  it('filters: unknown values are no filter', () => {
    expect(windowFilters({})).toEqual({});
    expect(windowFilters({ from: '2026-04-01', to: '2026-06-30', cursor: 'abc_-1', txnType: 'payout' })).toEqual({ from: '2026-04-01', to: '2026-06-30', cursor: 'abc_-1', txnType: 'payout' });
    expect(windowFilters({ from: '2026-02-30', to: '13/07/2026', cursor: 'a b', txnType: 'DROP TABLE' })).toEqual({});
    expect(windowFilters({ from: ['2026-04-01'] })).toEqual({});
    expect(dayOrUndefined('2028-02-29')).toBe('2028-02-29');
    expect(dayOrUndefined('2026-02-29')).toBeUndefined();
    expect(ledgerHref({})).toBe('/auditor/ledger');
    expect(ledgerHref({ from: '2026-04-01', txnType: 'payout' }, 'n1')).toBe('/auditor/ledger?from=2026-04-01&txnType=payout&cursor=n1');
  });
  it('a refusal is a named state', () => {
    expect(realmState('AUDITOR_REALM_OFF')).toBe('flaggedOff');
    expect(realmState('EXPORT_PLANE_DISABLED')).toBe('flaggedOff');
    expect(realmState('AUDITOR_SCOPE_ONLY')).toBe('restricted');
    expect(realmState(undefined, 403)).toBe('restricted');
    expect(realmState('AUDIT_WINDOW_REFUSED')).toBe('window');
    expect(realmState('EXPORT_JOB_NOT_FOUND')).toBe('notFound');
    expect(realmState('BOOM', 500)).toBe('error');
    expect(windowRefusalKey('WINDOW_TOO_WIDE')).toBe('auditor.window.WINDOW_TOO_WIDE');
    expect(windowRefusalKey('x')).toBe('auditor.window.other');
    expect(enqueueFailureKey('EXPORT_TOO_MANY_OPEN')).toBe('auditor.chain.failure.EXPORT_TOO_MANY_OPEN');
    expect(enqueueFailureKey('???')).toBe('auditor.chain.failure.generic');
  });
  it('the ledger\'s words: a withheld link is never a tick', () => {
    expect(hashLinkKey({ kind: 'withheld', reason: 'shared_stripe' })).toBe('auditor.link.withheld.shared_stripe');
    expect(hashLinkTone({ kind: 'withheld', reason: 'shared_stripe' })).toBe('muted');
    expect(hashLinkKey({ kind: 'linked', genesis: true, prevHash: null, entryHash: 'a' })).toBe('auditor.link.linkedGenesis');
    expect(hashLinkKey({ kind: 'linked', genesis: false, prevHash: 'b', entryHash: 'a' })).toBe('auditor.link.linked');
    expect(hashLinkTone({ kind: 'linked', genesis: false, prevHash: 'b', entryHash: 'a' })).toBe('ok');
    expect(hashLinkKey({ kind: 'chain_break', prevHash: 'b', predecessorHash: 'c', entryHash: 'a' })).toBe('auditor.link.chain_break');
    expect(hashLinkTone({ kind: 'hash_mismatch', prevHash: null, entryHash: 'a' })).toBe('danger');
    expect(footKey({ complete: false, foots: false })).toBe('auditor.foot.incomplete');
    expect(footKey({ complete: true, foots: true })).toBe('auditor.foot.foots');
    expect(footKey({ complete: true, foots: false })).toBe('auditor.foot.notFoot');
    expect(signedTerms(['-4466000', '134000', '4332000'])).toEqual([{ sign: '−', absMinor: '4466000', first: true }, { sign: '+', absMinor: '134000', first: false }, { sign: '+', absMinor: '4332000', first: false }]);
    expect(shortHash('9f2a1b3c'.repeat(8))).toBe('9f2a1b3c…1b3c');
    expect(shortHash(null)).toBeNull();
    expect(sideKey('Dr')).toBe('auditor.leg.side.Dr'); expect(sideKey('?')).toBe('auditor.leg.side.zero');
    expect(legKindKey('nope')).toBe('auditor.leg.kind.other_tenant');
    expect(chainKey('weird')).toBe('auditor.chain.incomplete');
  });
  it('the integrity tile: checked and withheld as separate lines — the shared chain always says it was NOT checked', () => {
    const lines = integrityLines({ zeroSum: { checked: 3, foot: 2, notFoot: 1, incomplete: 0 }, ownAccounts: [{ accountCode: 'main', entryCount: 4, balanceEqualsSum: true, chain: 'intact', chainChecked: 4, headMatches: true }], sharedChains: { verdict: 'unverifiable', reason: 'shared_stripe', legsWithheldOnPage: 2 }, checkedAt: 'this_read' });
    expect(lines.map((l) => l.key)).toEqual(['auditor.integrity.zeroSum', 'auditor.integrity.notFoot', 'auditor.chain.intact', 'auditor.head.matches', 'auditor.balance.equal', 'auditor.integrity.shared']);
    expect(lines[0].tone).toBe('danger');
    expect(lines[lines.length - 1].tone).toBe('muted');
    const none = integrityLines({ zeroSum: { checked: 0, foot: 0, notFoot: 0, incomplete: 2 }, ownAccounts: [], sharedChains: { verdict: 'unverifiable', reason: 'shared_stripe', legsWithheldOnPage: 0 }, checkedAt: 'this_read' });
    expect(none.map((l) => [l.key, l.tone])).toEqual([['auditor.integrity.zeroSum', 'muted'], ['auditor.integrity.incomplete', 'muted'], ['auditor.integrity.noOwnAccount', 'muted'], ['auditor.integrity.shared', 'muted']]);
    const bad = integrityLines({ zeroSum: { checked: 1, foot: 1, notFoot: 0, incomplete: 0 }, ownAccounts: [{ accountCode: 'main', entryCount: 4, balanceEqualsSum: false, chain: 'chain_break', headMatches: null }], sharedChains: { verdict: 'unverifiable', reason: 'shared_stripe', legsWithheldOnPage: 0 }, checkedAt: 'this_read' });
    expect(bad.map((l) => [l.key, l.tone]).slice(1, 4)).toEqual([['auditor.chain.chain_break', 'danger'], ['auditor.head.notJudged', 'muted'], ['auditor.balance.drift', 'danger']]);
  });
  it('roles, retry, scope links', () => {
    expect(roleCellKey({ actorRole: null })).toBe('auditor.role.notRecorded');
    expect(roleCellKey({ actorRole: 'auditor' })).toBeNull();
    expect(retryIsMutation()).toBe(false);
    expect(Object.keys(SCOPE_HREFS)).toEqual(['ledger', 'trail', 'kyc', 'governance', 'reports']);
    for (const r of Object.values(PAGE_REFUSALS).flat()) expect((AUDITOR_REFUSED_BY_NAME as readonly string[]).includes(r)).toBe(true);
  });
});

describe('i18n: every key a page can ask for exists in en, hi and gu', () => {
  it('the literal keys', () => {
    const keys = new Set<string>();
    for (const p of [...PAGES, 'features/auditor/realm.ts']) for (const m of src(p).matchAll(/t\.t\('([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(150);
    for (const k of keys) three(k);
  });
  it('every dynamic family', () => {
    for (const r of AUDITOR_REFUSED_BY_NAME) three(refusedKey(r));
    for (const s of ['flaggedOff', 'restricted', 'window', 'notFound', 'error'] as const) three(realmStateKey(s));
    for (const w of [...WINDOW_REFUSALS, 'other']) three(windowRefusalKey(w));
    for (const k of LEG_KINDS) three(legKindKey(k));
    for (const s of ['Dr', 'Cr', 'zero']) three(sideKey(s));
    for (const c of CHAIN_VERDICTS) three(chainKey(c));
    for (const r of ['shared_stripe', 'member_wallet', 'other_tenant'] as const) three(hashLinkKey({ kind: 'withheld', reason: r }));
    for (const k of ['auditor.link.linked', 'auditor.link.linkedGenesis', 'auditor.link.hash_mismatch', 'auditor.link.chain_break']) three(k);
    for (const k of ['auditor.foot.foots', 'auditor.foot.notFoot', 'auditor.foot.incomplete']) three(k);
    for (const k of ['auditor.integrity.zeroSum', 'auditor.integrity.notFoot', 'auditor.integrity.incomplete', 'auditor.integrity.noOwnAccount', 'auditor.integrity.shared']) three(k);
    for (const k of ['auditor.head.matches', 'auditor.head.differs', 'auditor.head.notJudged', 'auditor.balance.equal', 'auditor.balance.drift']) three(k);
    for (const k of ['ok', 'danger', 'muted']) three(`auditor.tone.${k}`);
    for (const k of Object.keys(SCOPE_HREFS)) three(scopeKey(k));
    for (const p of [...READ_PURPOSES, 'other']) three(purposeKey(p));
    for (const d of [...AUDITOR_DATASETS, 'other']) three(datasetKey(d));
    for (const s of [...PACK_SECTIONS, 'other']) three(sectionKey(s));
    for (const d of AUDITOR_DATASETS) three(`auditor.chain.holds.${d.replace('.', '_')}`);
    for (const c of [...ENQUEUE_FAILURES, 'generic']) three(`auditor.chain.failure.${c}`);
    for (const s of ['queued', 'running', 'ready', 'expired', 'failed']) three(`auditor.exports.status.${s}`);
    for (const s of ['intra', 'inter', 'unknown']) three(`auditor.pack.gst.supply.${s}`);
    for (const e of ['NO_PERMISSION', 'REVEAL_REASON_TOO_SHORT', 'AUDIT_ENTRY_NOT_FOUND', 'AUDITOR_READ_ONLY', 'reveal']) three(`auditor.reveal.error.${e}`);
    three('auditor.role.notRecorded'); three('auditor.unsigned');
  });
  it('the interpolations match across languages', () => {
    for (const k of Object.keys(en).filter((x) => x.startsWith('auditor.'))) {
      const vars = (s: string) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect([k, vars(hi[k as keyof typeof hi] as string)]).toEqual([k, vars(en[k as keyof typeof en] as string)]);
      expect([k, vars(gu[k as keyof typeof gu] as string)]).toEqual([k, vars(en[k as keyof typeof en] as string)]);
    }
  });
});
