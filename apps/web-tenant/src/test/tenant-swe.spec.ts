// apps/web-tenant/src/test/tenant-swe.spec.ts · PC-56 TENANT-SW-e · CARRIERS, PICKUP SLOTS, VILLAGE RUN, COLD CHAIN in the console.
// The pure helpers; every list mirrored from the API's OWN source (a second copy must agree); F-19 — every API route these pages use has
// an SDK method; the pages' promises read from their source (no figure computed, no currency literal, the device key never in a URL,
// the member's link sessionless, refused figures printed through their sentence); every key ×3 with the same {vars}.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  BREACH_ACTS, BREACH_OUTCOMES, BUYER_DECISIONS, COLD_STATUSES, COLD_SUBJECT_TYPES, PARTNER_KINDS, REFUSED_CODES, RUN_ACTS, RUN_STATUSES, SWE_CODES,
  bandLabel, breachActInput, breachActRefusal, carrierInput, carrierRefusals, durationParts, failedCodes, istToday, maskTail, nextRunDate, planCarry,
  planRefusals, proposalCarry, proposalRefusals, proposalSlots, ratioLabel, readBreachActDraft, readCarrierDraft, readPlanDraft, readProposalDraft,
  refusedKey, sweCodeKey, swePageState, thresholdRefusal,
} from '../features/swe/console';
import { dropPointRefusals, readDropPointDraft } from '../features/swe/drop-point';
import { LOGISTICS_NAV, currentNavKey } from '../features/logistics/nav';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) => src(rel).replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules', rel), 'utf8');
const listOf = (s: string, start: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf('] as const', i)).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]); };
const sdk = fs.readFileSync(path.join(__dirname, '../../../../packages/sdk-js/src/resources/logistics-ops.ts'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0201_logistics_ops.sql'), 'utf8');

const OPS = 'app/ops/logistics';
const PAGES = [
  `${OPS}/carriers/page.tsx`, `${OPS}/carriers/new/page.tsx`, `${OPS}/carriers/new/actions.ts`, `${OPS}/carriers/act/page.tsx`, `${OPS}/carriers/act/actions.ts`,
  `${OPS}/slots/page.tsx`, `${OPS}/slots/propose/page.tsx`, `${OPS}/slots/propose/actions.ts`, `${OPS}/slots/act/page.tsx`, `${OPS}/slots/act/actions.ts`,
  'app/slot-proposal/[id]/page.tsx', 'app/slot-proposal/[id]/actions.ts',
  `${OPS}/routes/[id]/page.tsx`, `${OPS}/routes/[id]/plan/page.tsx`, `${OPS}/routes/[id]/plan/actions.ts`, `${OPS}/routes/[id]/act/page.tsx`, `${OPS}/routes/[id]/act/actions.ts`,
  `${OPS}/routes/[id]/drop-point/page.tsx`, `${OPS}/routes/[id]/drop-point/actions.ts`,
  `${OPS}/cold-chain/page.tsx`, `${OPS}/cold-chain/[id]/page.tsx`, `${OPS}/cold-chain/[id]/actions.ts`, `${OPS}/cold-chain/threshold/page.tsx`, `${OPS}/cold-chain/threshold/actions.ts`,
  `${OPS}/cold-chain/breaches/page.tsx`, `${OPS}/cold-chain/breaches/actions.ts`, `${OPS}/cold-chain/breaches/act/page.tsx`, `${OPS}/cold-chain/breaches/act/actions.ts`,
  `${OPS}/cold-chain/devices/page.tsx`, `${OPS}/cold-chain/devices/actions.ts`, `${OPS}/cold-chain/devices/key/page.tsx`, `${OPS}/cold-chain/devices/key/IssueKeyPanel.tsx`,
  `${OPS}/cold-chain/exports/[id]/page.tsx`, `${OPS}/cold-chain/exports/[id]/actions.ts`, `${OPS}/cold-chain/exports/[id]/download/route.ts`,
];

describe('SW-e · every list is the API’s own', () => {
  it('partner kinds, run statuses / acts, breach acts / outcomes, buyer decisions mirror the API', () => {
    expect([...PARTNER_KINDS]).toEqual(listOf(api('logistics/domain/logistics-partner.entity.ts'), 'export const PARTNER_KINDS'));
    const run = api('logistics/domain/route-run.state.ts');
    expect([...RUN_STATUSES]).toEqual(listOf(run, 'export const RUN_STATUSES'));
    expect([...RUN_ACTS]).toEqual(listOf(run, 'export const RUN_ACTS'));
    const ops = api('logistics/domain/logistics-ops.ts');
    expect([...BREACH_ACTS]).toEqual(listOf(ops, 'export const BREACH_ACTS'));
    expect([...BREACH_OUTCOMES]).toEqual(listOf(ops, 'export const BREACH_OUTCOMES'));
    expect([...BUYER_DECISIONS]).toEqual(listOf(ops, 'export const BUYER_DECISIONS'));
  });
  it('every refused-by-name code the domain names is one the console can print', () => {
    const ops = api('logistics/domain/logistics-ops.ts');
    const i = ops.indexOf('export const REFUSED_BY_NAME'); const block = ops.slice(i, ops.indexOf('} as const', i));
    const named = [...block.matchAll(/: '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(10);
    expect(named.filter((c) => !(REFUSED_CODES as readonly string[]).includes(c))).toEqual([]);
    expect(ops).toContain("'NO_ACTION_RECORDED'");
  });
  it('every database refusal the screens can meet is a code the console prints a sentence for, and each is real', () => {
    const dbCodes = new Set([...migration.matchAll(/\[([A-Z][A-Z0-9_]{3,})\]/g)].map((m) => m[1]));
    const services = ['logistics/domain/logistics.errors.ts', 'logistics/services/slot-proposal.service.ts', 'logistics/services/village-run.service.ts',
      'logistics/services/cold-chain.service.ts', 'logistics/services/logistics-partner.service.ts', 'logistics/services/ops-otp.service.ts'].map(api).join('\n');
    const TRANSPORT = ['FEATURE_DISABLED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'IDEMPOTENCY_CONFLICT', 'REASON_REQUIRED', 'PICKUP_SLOT_INVALID', 'VEHICLE_INVALID', 'PARTNER_INVALID'];
    const unknown = SWE_CODES.filter((c) => !dbCodes.has(c) && !services.includes(`'${c}'`) && !TRANSPORT.includes(c));
    expect(unknown).toEqual([]);
    for (const c of ['RUN_CHECKER_IS_DRAFTER', 'PARCEL_FEE_ONCE', 'PICKUP_SLOT_NOT_YOURS', 'SLOT_PROPOSAL_NOT_SELLER', 'COLD_CHAIN_MANUAL_TIME_IS_SERVER', 'RIDER_NOT_DELIVERY_PARTNER']) expect(dbCodes.has(c)).toBe(true);
  });
  it('subject kinds and statuses match the API', () => {
    const svc = api('logistics/services/cold-chain.service.ts') + api('logistics/repositories/cold-chain-ops.repository.ts');
    for (const s of COLD_STATUSES) expect(svc).toContain(`'${s}'`);
    for (const s of COLD_SUBJECT_TYPES) expect(migration).toContain(`'${s}'`);
  });
});

describe('SW-e · F-19: every route a page uses has an SDK method', () => {
  const ROUTES: Array<[string, string]> = [
    ['GET', 'logistics/partners'], ['POST', 'logistics/partners'], ['PATCH', 'logistics/partners/'], ['POST', '/active'],
    ['GET', 'logistics/slots/desk'], ['GET', 'logistics/slots/suggestions/'], ['GET', 'logistics/slots/proposals'], ['POST', 'logistics/slots/proposals'], ['POST', '/withdraw'],
    ['GET', 'me/pickup-slot-proposals'], ['POST', '/accept'], ['POST', '/decline'], ['GET', 'pickup-slot-proposals/'], ['POST', '/code'], ['POST', '/decide'],
    ['GET', 'routes/'], ['GET', '/runs'], ['GET', '/candidates'], ['POST', '/drop-points'], ['POST', '/deactivate'], ['POST', '/acts/'], ['POST', '/handovers'], ['POST', '/collect'],
    ['POST', "this.p('readings')"], ['GET', "this.p('readings')"], ['POST', "this.p('thresholds')"], ['GET', "this.p('subjects')"], ['GET', 'subjects/'], ['GET', "this.p('breaches')"],
    ['GET', "this.p('loggers')"], ['POST', "this.p('loggers')"], ['POST', '/keys'], ['POST', '/keys/revoke'], ['POST', 'exports/trail'], ['POST', 'exports/breaches'],
    ['GET', 'me/cold-chain-offers'], ['POST', '/decision'],
  ];
  it.each(ROUTES)('%s …%s', (verb, frag) => {
    const lines = sdk.split('\n').filter((l) => l.includes(`'${verb}'`) && l.includes(frag));
    expect(lines.length).toBeGreaterThan(0);
  });
  it('the API controller declares each of the routes the SDK calls', () => {
    const ctl = api('logistics/controllers/v1/logistics-ops.controller.ts') + api('logistics/controllers/v1/routes.controller.ts') + api('logistics/controllers/v1/partners.controller.ts');
    for (const p of ["'logistics/slots'", "'me/pickup-slot-proposals'", "'pickup-slot-proposals'", "'logistics/village-run'", "'me/cold-chain-offers'", "'ingest/cold-chain'", "'logistics/cold-chain'", "'logistics/partners'"]) expect(ctl).toContain(p);
    for (const p of ["@Get('desk')", "@Get('suggestions/:sellerId')", "@Post('runs/:runId/acts/:act')", "@Get('subjects/:type/:id')", "@Post('loggers/:id/keys')", "@Post('exports/trail')", "@Post('exports/breaches')"]) expect(ctl).toContain(p);
  });
});

describe('SW-e · the helpers', () => {
  it('codes and refusals map to sentences; unknowns fall back', () => {
    expect(sweCodeKey('RUN_CHECKER_IS_DRAFTER')).toBe('swe.code.RUN_CHECKER_IS_DRAFTER');
    expect(sweCodeKey('WHATEVER')).toBe('swe.code.unknown');
    expect(refusedKey('NO_PROMISED_DELIVERY_TIME')).toBe('swe.refused.NO_PROMISED_DELIVERY_TIME');
    expect(refusedKey('X')).toBe('swe.refused.unknown');
    expect(swePageState(404, true)).toBe('flaggedOff'); expect(swePageState(404, false)).toBe('notFound'); expect(swePageState(403, true)).toBe('restricted'); expect(swePageState(500, true)).toBe('error');
    expect(failedCodes('A_B,<script>,X')).toEqual(['A_B']);
  });
  it('figures are the API’s, formatted only', () => {
    expect(ratioLabel({ numerator: 13, denominator: 32, bps: 4062 })).toBe('13 / 32 (40.6%)');
    expect(ratioLabel(null)).toBeNull();
    expect(bandLabel({ minC: '2.0', maxC: '8.0' })).toBe('2.0–8.0 °C');
    expect(durationParts(600)).toEqual({ value: 10, unit: 'minutes' });
    expect(durationParts(9000)).toEqual({ value: 2.5, unit: 'hours' });
  });
  it('the carrier draft: a rider names a user and no phone; a 3PL brings no vehicle; the phone leaves masked', () => {
    const rider = readCarrierDraft({ partnerKind: 'rider', defaultName: 'Ramesh', riderUserId: '0190a0a0-0000-7000-8000-000000000001', contactPhone: '+919812345678' });
    expect(carrierRefusals(rider).map((r) => r.code)).toEqual(['riderPhone']);
    const pl = readCarrierDraft({ partnerKind: '3pl', defaultName: 'Delhivery', providerCode: 'delhivery', regNo: 'GJ01AB1234' });
    expect(carrierRefusals(pl).map((r) => r.code)).toEqual(['noVehicleFor3pl']);
    const fleet = readCarrierDraft({ partnerKind: 'tenant_fleet', defaultName: 'Our van', regNo: 'gj01ab1234', capacityKg: '800', isRefrigerated: 'yes', contactPhone: '+919812345678' });
    expect(carrierRefusals(fleet)).toEqual([]);
    expect(carrierInput(fleet)).toEqual({ partnerKind: 'tenant_fleet', defaultName: 'Our van', providerCode: null, riderUserId: null, supportsColdChain: false, contactPhone: '+919812345678', vehicle: { regNo: 'GJ01AB1234', capacityKg: 800, isRefrigerated: true } });
    expect(maskTail('+919812345678')).toBe('••••5678');
  });
  it('the slot proposal: windows named, ordered, unique; a reason of 10', () => {
    const d = readProposalDraft({ sellerUserId: '0190a0a0-0000-7000-8000-000000000001', w0d: '2', w0s: '09:00', w0e: '11:00', w1d: '2', w1s: '09:00', w1e: '11:00', w2d: '4', w2s: '12:00', w2e: '10:00', reason: 'short' });
    expect(proposalRefusals(d).map((r) => `${r.field}:${r.code}`)).toEqual(['w1:duplicate', 'w2:order', 'reason:reason']);
    const ok = readProposalDraft({ sellerUserId: '0190a0a0-0000-7000-8000-000000000001', w0d: '1', w0s: '07:00', w0e: '09:00', reason: 'collection van passes at 8' });
    expect(proposalRefusals(ok)).toEqual([]);
    expect(proposalSlots(ok)).toEqual([{ weekday: 1, start: '07:00', end: '09:00' }]);
    expect(readProposalDraft(proposalCarry(ok))).toEqual(ok);
  });
  it('the loading plan: the run day, not in the past, active drop points, a reason', () => {
    const dp = '0190a0a0-0000-7000-8000-0000000000d1'; const sh = '0190a0a0-0000-7000-8000-0000000000a1';
    const d = readPlanDraft({ runDate: '2026-10-08', [`p_${sh}`]: dp, reason: 'Thursday village run', bogus: 'x' });
    expect(d.assignments).toEqual([{ shipmentId: sh, dropPointId: dp }]);
    expect(planRefusals(d, 4, '2026-10-04', [dp])).toEqual([]);
    expect(planRefusals(d, 3, '2026-10-04', [dp]).map((r) => r.code)).toEqual(['runDay']);
    expect(planRefusals(d, 4, '2026-10-09', [dp]).map((r) => r.code)).toEqual(['past']);
    expect(planRefusals(d, 4, '2026-10-04', []).map((r) => r.code)).toEqual(['dropPoint']);
    expect(readPlanDraft(planCarry(d))).toEqual(d);
    expect(nextRunDate('2026-10-04', 4)).toBe('2026-10-08');
    expect(nextRunDate('2026-10-08', 4)).toBe('2026-10-08');
    expect(istToday(Date.parse('2026-10-04T20:00:00Z'))).toBe('2026-10-05');
  });
  it('the breach acts: a note for an action, an outcome + reason; a loss only with its amount and currency', () => {
    expect(breachActRefusal('acknowledge', readBreachActDraft({}))).toBeNull();
    expect(breachActRefusal('record_action', readBreachActDraft({ note: 'short' }))).toBe('note');
    expect(breachActRefusal('record_outcome', readBreachActDraft({ outcome: 'loss_recorded', reason: 'milk curdled at drop', lossMinor: '0' }))).toBe('loss');
    expect(breachActRefusal('record_outcome', readBreachActDraft({ outcome: 'loss_recorded', reason: 'milk curdled at drop', lossMinor: '125000', lossCurrency: 'inr' }))).toBeNull();
    expect(breachActRefusal('record_outcome', readBreachActDraft({ outcome: 'none', reason: 'within tolerance', lossMinor: '5' }))).toBe('lossOnly');
    expect(breachActInput('record_outcome', readBreachActDraft({ outcome: 'accepted', reason: 'buyer accepted' }))).toEqual({ outcome: 'accepted', reason: 'buyer accepted' });
  });
  it('the band form and the drop-point form', () => {
    expect(thresholdRefusal('8', '2', 'reason long enough')).toBe('inverted');
    expect(thresholdRefusal('2', '8.55', 'reason long enough')).toBe('number');
    expect(thresholdRefusal('-2.5', '8', 'reason long enough')).toBeNull();
    const v = '0190a0a0-0000-7000-8000-0000000000b1';
    expect(dropPointRefusals(readDropPointDraft({ sequence: '1', regionId: v, name: 'Panchayat office', ambassadorUserId: v, windowStart: '09:00', windowEnd: '08:00' }), [v]).map((r) => r.code)).toEqual(['window']);
  });
  it('the sub-nav reaches every SW-e screen', () => {
    expect(LOGISTICS_NAV.find((i) => i.key === 'carriers')?.href).toBe('/ops/logistics/carriers');
    expect(LOGISTICS_NAV.find((i) => i.key === 'coldChain')?.href).toBe('/ops/logistics/cold-chain');
    expect(LOGISTICS_NAV.find((i) => i.key === 'slots')?.href).toBe('/ops/logistics/slots');
    expect(currentNavKey('/ops/logistics/cold-chain/breaches')).toBe('coldChain');
  });
});

describe('SW-e · the pages keep their promises', () => {
  it('every page exists', () => { for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true); });
  it('no page computes a figure or names a currency', () => {
    for (const p of PAGES) {
      const c = code(p);
      expect(c).not.toMatch(/'INR'|"INR"|₹/);
      expect(c).not.toMatch(/\.reduce\(|Math\.round\([^)]*\/[^)]*\)\s*\*\s*100/);
    }
  });
  it('the device key lives only in the client component’s state — never a URL, a redirect or storage', () => {
    const panel = code(`${OPS}/cold-chain/devices/key/IssueKeyPanel.tsx`); const actions = code(`${OPS}/cold-chain/devices/actions.ts`);
    expect(panel).toContain("'use client'");
    expect(panel).not.toMatch(/localStorage|sessionStorage|document\.cookie|router\.push|location\.href\s*=/);
    const issue = actions.slice(actions.indexOf('export async function issueKeyAction'), actions.indexOf('export async function revokeKeyAction'));
    expect(issue).not.toContain('redirect(');
    expect(issue).not.toMatch(/console\./);
  });
  it('the member’s link is sessionless and its code travels only in a POST body', () => {
    const page = code('app/slot-proposal/[id]/page.tsx'); const actions = code('app/slot-proposal/[id]/actions.ts');
    expect(page).not.toContain('requireSession'); expect(actions).not.toContain('requireSession');
    expect(page).toContain('anonClient'); expect(actions).toContain('anonClient');
    expect(actions).not.toMatch(/[?&]code=/);
  });
  it('a manual reading sends no band and no time; the run is confirmed by the API’s wall, not the page', () => {
    const a = code(`${OPS}/cold-chain/[id]/actions.ts`);
    const rec = a.slice(a.indexOf('recordReading('), a.indexOf('recordReading(') + 200);
    expect(rec).not.toMatch(/allowedMin|allowedMax|recordedAt|band/);
    expect(code(`${OPS}/routes/[id]/act/page.tsx`)).toContain('run.acts.includes');
  });
  it('refused figures are printed through their sentence', () => {
    expect(code(`${OPS}/carriers/page.tsx`)).toContain("refusedKey(c.onTime.code)");
    expect(code(`${OPS}/slots/page.tsx`)).toContain('refusedKey(r.pickupFirstAttempt.code)');
    expect(code(`${OPS}/routes/[id]/page.tsx`)).toContain('refusedKey(page.refused.freightVsAdHoc)');
    expect(code(`${OPS}/cold-chain/breaches/page.tsx`)).toContain('refusedKey(w.medianAlertToAction.code)');
  });
});

describe('SW-e · i18n', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('swe.'));
  it('every swe.* key exists in hi and gu with the same {vars}', () => {
    expect(keys.length).toBeGreaterThan(450);
    for (const k of keys) for (const [n, c] of CATS) { expect([n, k, k in c]).toEqual([n, k, true]); expect([n, k, vars((c as Record<string, string>)[k])]).toEqual([n, k, vars((en as Record<string, string>)[k])]); }
  });
  it('every code and refusal has its sentence', () => {
    for (const c of SWE_CODES) expect(`swe.code.${c}` in en).toBe(true);
    for (const c of REFUSED_CODES) expect(`swe.refused.${c}` in en).toBe(true);
    for (const s of [...RUN_STATUSES.map((x) => `swe.run.status.${x}`), ...RUN_ACTS.map((x) => `swe.run.act.${x}`), ...BREACH_OUTCOMES.map((x) => `swe.cold.outcome.${x}`),
      ...COLD_STATUSES.map((x) => `swe.cold.status.${x}`), ...COLD_SUBJECT_TYPES.map((x) => `swe.cold.kind.${x}`), ...PARTNER_KINDS.map((x) => `swe.carriers.kind.${x}`)]) expect(s in en).toBe(true);
  });
  it('every static key a page uses exists', () => {
    for (const p of PAGES) for (const m of code(p).matchAll(/(?:t\.t|L)\('((?:swe|form|mutate|common|swa|dairy)\.[A-Za-z0-9_.]+)'/g)) expect([p, m[1], m[1] in en]).toEqual([p, m[1], true]);
  });
});
