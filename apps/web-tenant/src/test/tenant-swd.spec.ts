// apps/web-tenant/src/test/tenant-swd.spec.ts · PC-56 TENANT-SW-d · ONBOARDING PROFILE, HOME, SETUP CALL, AGM PACK, REGISTER IMPORT in the
// console. The pure helpers; every list mirrored from the API's OWN source (a second copy must agree); the pages' promises read from their
// source (no figure computed in the console, no 'INR' literal, no calendar, the public verify page sessionless, Retry a re-read); every
// key ×3 with the same {vars}.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  AGM_ACTS, AGM_ITEMS, AGM_REFUSALS, AGM_SECTION_CODES, AGM_STATUSES, IMPORT_ACTS, IMPORT_STATUSES, LINE_STATUSES, PROFILE_FIELDS, ROW_ERRORS,
  SETUP_CALL_LANGUAGES, SETUP_CALL_STATUSES, SWD_CODES, CONSENT_KINDS, advisoryLine, agmActHref, agmActsFor, agmFigure, agmItemKey, agmRefusalKey,
  draftPayload, importActHref, istLabel, prefill, profileValuesFrom, refusedItems, rowErrorKey, slotFormProblem, swdCodeKey, swdPageState, verifyAgmHref,
} from '../features/swd/console';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const has = (k: string) => CATS.filter(([, c]) => !(k in c)).map(([n]) => `${n} MISSING ${k}`);
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) => src(rel).replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules', rel), 'utf8');
const keysOf = (s: string, start: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf('});', i)).matchAll(/^\s+([A-Z_]+):/gm)].map((m) => m[1]); };
const listOf = (s: string, start: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf('] as const', i)).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]); };

const PAGES = [
  'app/signup/page.tsx', 'app/dashboard/page.tsx', 'app/go/page.tsx', 'app/go/actions.ts',
  'app/insights/governance/agm/page.tsx', 'app/insights/governance/agm/actions.ts', 'app/insights/governance/agm/[id]/page.tsx',
  'app/insights/governance/agm/[id]/act/page.tsx', 'app/insights/governance/agm/[id]/act/actions.ts', 'app/insights/governance/agm/exports/[id]/page.tsx',
  'app/insights/governance/agm/exports/[id]/actions.ts', 'app/insights/governance/agm/exports/[id]/download/route.ts',
  'app/governance/register/import/page.tsx', 'app/governance/register/import/actions.ts', 'app/governance/register/import/[id]/page.tsx',
  'app/governance/register/import/[id]/act/page.tsx', 'app/governance/register/import/[id]/act/actions.ts', 'app/verify/agm/[documentId]/page.tsx',
];

describe('SW-d · every list is the API’s own', () => {
  it('SWD_CODES = the API’s tenancy + governance refusal maps (plus the shared transport codes)', () => {
    const fromApi = [...keysOf(api('tenancy/domain/swd.errors.ts'), 'export const SWD_TENANCY_CODES'), ...keysOf(api('memberships/domain/swd-gov.errors.ts'), 'export const SWD_GOV_CODES')];
    expect(fromApi.length).toBeGreaterThan(50);
    expect(fromApi.filter((c) => !(SWD_CODES as readonly string[]).includes(c))).toEqual([]);
    const extra = (SWD_CODES as readonly string[]).filter((c) => !fromApi.includes(c));
    const TRANSPORT = ['FORBIDDEN', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'REASON_REQUIRED', 'TENANT_PROFILE_INVALID', 'VALIDATION_FAILED', 'unknown'];
    expect(extra.filter((c) => !TRANSPORT.includes(c))).toEqual([]);
  });
  it('AGM refusals, items and row errors mirror the API', () => {
    const agm = api('memberships/domain/agm-pack.ts');
    expect([...AGM_REFUSALS]).toEqual(listOf(agm, 'export const AGM_REFUSALS'));
    const literalItems = [...new Set([...agm.matchAll(/item: '([a-z_]+)'/g)].map((m) => m[1]))];
    const acctItems = [...agm.matchAll(/acct\('([a-z_]+)'/g)].map((m) => m[1]);
    expect([...literalItems, ...acctItems].sort()).toEqual([...AGM_ITEMS].sort());
    const imp = api('memberships/domain/register-import.ts');
    expect([...ROW_ERRORS]).toEqual([...listOf(imp, 'export const ROW_ERRORS'), 'ALREADY_ON_REGISTER']);
  });
  it('the statuses mirror the migration’s CHECKs', () => {
    const mig = fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0200_onboarding_governance_pack.sql'), 'utf8');
    for (const s of [...AGM_STATUSES, ...IMPORT_STATUSES, ...LINE_STATUSES, ...SETUP_CALL_STATUSES]) expect(mig).toContain(`'${s}'`);
    for (const s of AGM_SECTION_CODES) expect(mig).toContain(`'${s}'`);
  });
});

describe('SW-d · the helpers', () => {
  const NOW = new Date('2026-10-04T06:00:00Z'); // 11:30 IST
  it('the setup-call slot: every problem named, IST, ≤ 4 h, ≤ 30 days', () => {
    expect(slotFormProblem('', '10:00', '11:00', NOW)).toBe('missing');
    expect(slotFormProblem('2026-10-04', '11:00', '12:00', NOW)).toBe('not_future');
    expect(slotFormProblem('2026-11-20', '10:00', '11:00', NOW)).toBe('too_far');
    expect(slotFormProblem('2026-10-06', '11:00', '10:00', NOW)).toBe('not_after_start');
    expect(slotFormProblem('2026-10-06', '09:00', '13:30', NOW)).toBe('too_long');
    expect(slotFormProblem('2026-10-06', '10:00', '14:00', NOW)).toBeNull();
    expect(istLabel('2026-10-06T04:30:00Z')).toBe('2026-10-06 10:00');
    expect(istLabel(null)).toBe('');
  });
  it('the profile values: bounded text, a bad district id dropped, the draft carries only what was typed', () => {
    const v = profileValuesFrom((k) => ({ legalName: '  Sabarkantha FPC ', regionId: 'not-a-uuid', pan: '' } as Record<string, string>)[k] ?? null);
    expect(v.legalName).toBe('Sabarkantha FPC'); expect(v.regionId).toBeNull(); expect(v.pan).toBeNull();
    expect(draftPayload(v)).toEqual({ legalName: 'Sabarkantha FPC' });
    expect(prefill({ legalName: 'Old', displayName: 'D' }, { legalName: 'Typed' }).legalName).toBe('Typed');
    expect(Object.keys(prefill({}, null))).toEqual([...PROFILE_FIELDS]);
  });
  it('the GSTIN advisory is a question naming both states, never a block', () => {
    expect(advisoryLine({ kind: 'silent' })).toBeNull();
    expect(advisoryLine({ kind: 'confirm', gstCode: '24', gstStateName: 'Gujarat', districtName: 'Pune', districtStateName: 'Maharashtra', districtStateCode: 'in.mh' }))
      .toEqual({ key: 'swd.profile.advisory.confirm', vars: { code: '24', gstState: 'Gujarat', district: 'Pune', state: 'Maharashtra' } });
    expect(advisoryLine({ kind: 'not_checkable', reason: 'not_india' })?.key).toBe('swd.profile.advisory.notCheckable.not_india');
  });
  it('a refused AGM item draws no figure; an included one prints the API’s numbers through the formatter only', () => {
    const money = (m: string, c: string | null) => `${c}:${m}`;
    expect(agmFigure({ item: 'surplus', status: 'refused', figures: {} }, money)).toBeNull();
    expect(agmFigure({ item: 'gmv', status: 'included', figures: { goodsMinor: '1250000', currency: 'INR', orders: 7 } }, money))
      .toEqual({ key: 'swd.agm.fig.gmv', vars: { amount: 'INR:1250000', orders: 7 } });
    expect(refusedItems([{ item: 'surplus', status: 'refused' }, { item: 'gmv', status: 'included' }])).toEqual(['surplus']);
    expect(agmRefusalKey('NO_COST_LEDGER')).toBe('swd.agm.refusal.NO_COST_LEDGER');
    expect(agmRefusalKey('INVENTED')).toBe('swd.agm.refusal.other');
    expect(agmItemKey('x')).toBe('swd.agm.item.other');
  });
  it('the acts drawn per status: the maker never sees confirm; issued only takes an addendum', () => {
    expect(agmActsFor('proposed', true)).not.toContain('confirm');
    expect(agmActsFor('proposed', false)).toContain('confirm');
    expect(agmActsFor('issued', false)).toEqual(['addendum']);
    expect(agmActsFor('issuing', false)).toEqual([]);
    expect(agmActsFor('withdrawn', false)).toEqual([]);
    for (const a of AGM_ACTS) expect(agmActHref('p1', a)).toContain(`act=${a}`);
    for (const a of IMPORT_ACTS) expect(importActHref('i1', a)).toContain(`act=${a}`);
    expect(verifyAgmHref('AGM-KV-2025-26-1')).toBe('/verify/agm/AGM-KV-2025-26-1');
  });
  it('page states and code keys', () => {
    expect(swdPageState('AGM_RESTRICTED', 403)).toBe('restricted');
    expect(swdPageState('AGM_NOT_FOUND', 404, true)).toBe('notFound');
    expect(swdPageState(undefined, 404)).toBe('flaggedOff');
    expect(swdPageState(undefined, 500)).toBe('error');
    expect(swdCodeKey('IMPORT_CHECKER_IS_MAKER')).toBe('swd.code.IMPORT_CHECKER_IS_MAKER');
    expect(swdCodeKey('SOMETHING_ELSE')).toBe('swd.code.unknown');
    expect(rowErrorKey('FOLIO_TAKEN')).toBe('swd.import.err.FOLIO_TAKEN');
  });
});

describe('SW-d · the pages keep their promises', () => {
  it('no page computes a figure or assumes a currency', () => {
    for (const p of PAGES) expect(`${p}: ${/'INR'|"INR"|₹/.test(code(p))}`).toBe(`${p}: false`);
  });
  it('/go says there is no calendar and shows only the last four digits', () => {
    const go = src('app/go/page.tsx');
    expect(go).toContain("t.t('swd.go.noCalendar')");
    expect(go).toContain('phoneMasked');
    expect(go.replace(/'swd\.[^']+'/g, '')).not.toMatch(/\.phone\b|ownerPhone/);
  });
  it('the public verify page needs no session and shows no figure', () => {
    const v = src('app/verify/agm/[documentId]/page.tsx');
    expect(v).toContain('anonClient()');
    expect(v).not.toContain('requireSession');
    expect(v).not.toMatch(/sections|figures/);
  });
  it('Retry is a re-read: the act actions refuse "retry" as a mutation', () => {
    expect(src('app/insights/governance/agm/[id]/act/actions.ts')).toContain("act === 'retry') redirect(");
    expect(src('app/governance/register/import/[id]/act/actions.ts')).toContain("act === 'retry') redirect(");
  });
  it('the import requires the consent evidence before the API is called', () => {
    const a = src('app/governance/register/import/actions.ts');
    expect(a.indexOf("fail('IMPORT_CONSENT_REQUIRED')")).toBeGreaterThan(0);
    expect(a.indexOf("fail('IMPORT_CONSENT_REQUIRED')")).toBeLessThan(a.indexOf('registerImports.upload('));
  });
  it('the download route proxies the bytes and turns a refusal into a redirect', () => {
    const r = src('app/insights/governance/agm/exports/[id]/download/route.ts');
    expect(r).toContain('openDownload(id, token)');
    expect(r).toContain('NextResponse.redirect');
  });
});

describe('SW-d · every key ×3 with the same {vars}', () => {
  const swd = Object.keys(en).filter((k) => k.startsWith('swd.'));
  it('the catalogues carry the same swd.* keys and placeholders', () => {
    expect(swd.length).toBeGreaterThan(400);
    expect(swd.flatMap(has)).toEqual([]);
    for (const k of swd) for (const [, c] of CATS) expect(`${k} ${vars((c as Record<string, string>)[k]).join(',')}`).toBe(`${k} ${vars((en as Record<string, string>)[k]).join(',')}`);
  });
  it('every key the pages and helpers name exists (literal and per-list)', () => {
    const literal = new Set<string>();
    for (const p of [...PAGES, 'features/swd/console.ts']) for (const m of src(p).matchAll(/'(swd\.[A-Za-z0-9_.]+)'/g)) literal.add(m[1]);
    const lists: string[] = [
      ...SWD_CODES.map((c) => `swd.code.${c}`), ...AGM_ITEMS.flatMap((i) => [`swd.agm.item.${i}`, `swd.agm.method.${i}`]), ...AGM_REFUSALS.map((c) => `swd.agm.refusal.${c}`),
      ...AGM_SECTION_CODES.map((s) => `swd.agm.section.${s}`), ...AGM_STATUSES.map((s) => `swd.agm.status.${s}`), ...AGM_ACTS.map((a) => `swd.agm.act.${a}`),
      ...AGM_ACTS.filter((a) => a !== 'retry').map((a) => `swd.agm.confirm.${a}`), ...AGM_ACTS.map((a) => `swd.agm.done.${a}`),
      ...IMPORT_ACTS.map((a) => `swd.import.act.${a}`), ...IMPORT_ACTS.filter((a) => a !== 'retry').map((a) => `swd.import.confirm.${a}`), ...IMPORT_ACTS.map((a) => `swd.import.done.${a}`),
      ...IMPORT_STATUSES.map((s) => `swd.import.status.${s}`), ...LINE_STATUSES.map((s) => `swd.import.line.${s}`), ...ROW_ERRORS.map((c) => `swd.import.err.${c}`),
      ...CONSENT_KINDS.map((c) => `swd.import.consent.${c}`), ...SETUP_CALL_LANGUAGES.map((l) => `swd.go.lang.${l}`), ...SETUP_CALL_STATUSES.map((s) => `swd.go.status.${s}`),
      ...PROFILE_FIELDS.map((f) => `swd.profile.field.${f}`), ...['flaggedOff', 'restricted', 'notFound', 'error'].flatMap((s) => [`swd.state.${s}.title`, `swd.state.${s}.body`]),
      ...Array.from({ length: 12 }, (_, i) => `swd.month.${i + 1}`),
    ];
    expect([...literal, ...lists].flatMap(has)).toEqual([]);
  });
  it('the console’s method sentences are the seed’s (one source for the pack’s methods)', () => {
    const seed = fs.readFileSync(path.join(__dirname, '../../../../db/seeds/core/0028_ui_messages_governance_pack.sql'), 'utf8');
    for (const i of AGM_ITEMS) expect(seed).toContain(`'agm.method.${i}', 'en', '${(en as Record<string, string>)[`swd.agm.method.${i}`].replace(/'/g, "''")}'`);
  });
});
