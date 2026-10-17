// apps/web-storefront/src/test/store5b-trace.spec.ts · PC-56 STORE-5b · C7 — the trace pages' pure half.
//   (1) the step-label map is EXHAUSTIVE over the API's TRACE_STEPS (read from apps/api by path — the trace-meta.spec parity precedent): a new
//       step without a label turns this red; the meta label keys mirror the API's allow-list; every key exists in en / hi / gu;
//   (2) the canonical text the verify page explains equals the API's: the SHARED vectors (apps/api shared/hash/__fixtures__) — canonicalJson
//       and the formula's input, hashed here with node:crypto, reproduce the API's v2 chain hashes;
//   (3) the helpers: short hash, the organisation-only farmer line, the seal state, paths under both chromes, own-lot, the platform route (no
//       brand-domain literal), the export view and its failures, the carried key, the certificate helpers;
//   (4) the refusal registry: every key in three languages, each surface printed, 12 chain-page verdicts; the listing chip's self_declared.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  TRACE_STEPS, TRACE_STEP_KEYS, TRACE_META_LABEL_KEYS, stepLabelKey, metaLines, shortHash, farmerLine, placeLine, sealState, traceHref, traceDownloadHref,
  certificateHref, certificateLookupHref, isOwnLot, platformTraceHref, platformCertificateHref, traceExportView, exportFailureOf, carriedExportKey, traceFailureOf,
} from '../features/store5b/trace';
import { canonicalJson, hashInput, verdictKey, chainSummary } from '../features/store5b/verify';
import { statusKey, meaningKey, roleKey, subjectKey, typeLabel, certFailureOf, lookupInput, CERT_STATUSES } from '../features/store5b/certificate';
import { STORE5B_REFUSALS, STORE5B_CHAIN_PAGES, STORE5B_DELTAS, store5bRefusalKeys } from '../features/store5b/refusals';
import { lotFacts } from '../features/store2a/listing';

const API = join(__dirname, '..', '..', '..', 'api', 'src');
const CATS = { en, hi, gu } as const;
const has = (k: string) => Object.values(CATS).every((c) => k in c);

describe('STORE-5b · (1) the step labels are exhaustive over the API\'s TRACE_STEPS', () => {
  it('the API source\'s TRACE_STEPS equals the mirror; every step has a label key in three languages; an unknown code never prints raw', () => {
    const src = readFileSync(join(API, 'modules', 'traceability', 'domain', 'traceability.events.ts'), 'utf8');
    const arr = src.match(/export const TRACE_STEPS = \[([^\]]*)\] as const/)?.[1] ?? '';
    const apiSteps = [...arr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(apiSteps.length).toBeGreaterThan(0);
    expect([...TRACE_STEPS]).toEqual(apiSteps);
    for (const s of apiSteps) { expect(TRACE_STEP_KEYS[s as keyof typeof TRACE_STEP_KEYS]).toBe(`trace.step.${s}`); expect([s, has(`trace.step.${s}`)]).toEqual([s, true]); }
    expect(stepLabelKey('weighed_at_bridge')).toBe('trace.step.unknown'); expect(has('trace.step.unknown')).toBe(true);
  });
  it('the meta label keys mirror the API\'s allow-list (every allow-listed key but `unit`, which prints with the quantity) and exist ×3', () => {
    const src = readFileSync(join(API, 'modules', 'traceability', 'domain', 'trace-meta.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const TRACE_META_ALLOW'), src.indexOf('});', src.indexOf('export const TRACE_META_ALLOW')));
    const keys = new Set([...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
    keys.delete('unit');
    expect(Object.keys(TRACE_META_LABEL_KEYS).sort()).toEqual([...keys].sort());
    for (const k of Object.values(TRACE_META_LABEL_KEYS)) expect([k, has(k)]).toEqual([k, true]);
  });
});

describe('STORE-5b · (2) the canonical text the page explains is the API\'s (shared vectors)', () => {
  const V = JSON.parse(readFileSync(join(API, 'shared', 'hash', '__fixtures__', 'canonical-json.vectors.json'), 'utf8')) as {
    canonical: Array<{ name: string; value: unknown; canonical: string }>;
    chainV2: Array<{ prev: string; lotId: string; eventCode: string; meta: Record<string, unknown>; at: string; input: string; hash: string }>;
  };
  it.each(V.canonical.map((c) => [c.name, c.value, c.canonical] as const))('canonical: %s', (_n, value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });
  it('the formula\'s input, hashed, reproduces every v2 chain hash the API wrote', () => {
    for (const c of V.chainV2) {
      expect(hashInput(c.prev, c.lotId, c.eventCode, c.meta, c.at)).toBe(c.input);
      expect(createHash('sha256').update(hashInput(c.prev, c.lotId, c.eventCode, c.meta, c.at)).digest('hex')).toBe(c.hash);
    }
  });
  it('the verdict and summary sentences', () => {
    expect([verdictKey('ok'), verdictKey('unverifiable_v1'), verdictKey('mismatch'), verdictKey('??')]).toEqual(['store5b.verify.ok', 'store5b.verify.v1', 'store5b.verify.mismatch', 'store5b.verify.mismatch']);
    expect(chainSummary({ chain: 'broken_at', brokenAt: 3, v1Count: 0, events: [1, 2, 3] })).toEqual({ key: 'store5b.verify.brokenAt', vars: { n: 3 } });
    expect(chainSummary({ chain: 'ok', brokenAt: null, v1Count: 1, events: [1, 2] }).key).toBe('store5b.verify.okWithV1');
    expect(chainSummary({ chain: 'ok', brokenAt: null, v1Count: 2, events: [1, 2] }).key).toBe('store5b.verify.allV1');
    expect(chainSummary({ chain: 'ok', brokenAt: null, v1Count: 0, events: [] }).key).toBe('store5b.verify.noEvents');
  });
});

describe('STORE-5b · (3) the helpers', () => {
  const P = { kind: 'platform' } as const; const T = { kind: 'tenant', slug: 'anand-fpo' } as const;
  const ID = '0219c000-0000-7000-8000-0000000c0001';
  it('short hash, meta lines (quantity + unit together, unknown keys dropped), the farmer line (organisation + place only), the seal', () => {
    expect(shortHash('3f9a71c04b8de2261a97f3305d8842aa19c6e0b7d54f9a8830125e6d7b4ac21e')).toBe('3f9a…c21e');
    expect(shortHash(null)).toBe('');
    expect(metaLines({ variety: 'GG-20', quantity: 25, unit: 'quintal', phone: '9898012742' } as never)).toEqual([
      { key: 'variety', labelKey: 'trace.meta.variety', value: 'GG-20' }, { key: 'quantity', labelKey: 'trace.meta.quantity', value: '25 quintal' }]);
    expect(farmerLine('Anand FPO', { village: 'Vanthali', district: 'Junagadh' })).toEqual({ key: 'store5b.trace.grownBy', vars: { org: 'Anand FPO', place: 'Vanthali, Junagadh' } });
    expect(farmerLine('Anand FPO', null)).toEqual({ key: 'store5b.trace.grownByOrg', vars: { org: 'Anand FPO' } });
    expect(placeLine({ village: null, district: 'Junagadh' })).toBe('Junagadh');
    expect(sealState({ matchesHead: true, anchoredAt: '2026-10-17T00:00:00Z' })).toBe('sealed');
    expect(sealState({ matchesHead: false, anchoredAt: '2026-10-17T00:00:00Z' })).toBe('not_sealed');
    expect(sealState({ matchesHead: true, anchoredAt: null })).toBe('not_sealed');
    expect([traceFailureOf('TRACE_NO_LONGER_PUBLISHED', 404), traceFailureOf('TRACE_NOT_PUBLISHED', 404), traceFailureOf('X', 404), traceFailureOf('X', 503)]).toEqual(['no_longer', 'not_published', 'not_found', 'error']);
  });
  it('paths under both chromes; own lot; the platform route with the configured origin and never a brand literal', () => {
    expect(traceHref(P, 'KVTR9J4K2M')).toBe('/trace/KVTR9J4K2M');
    expect(traceHref(T, 'KVTR9J4K2M', 'verify')).toBe('/anand-fpo/trace/KVTR9J4K2M/verify');
    expect(traceHref(T, 'KVTR9J4K2M', 'export', { job: ID })).toBe(`/anand-fpo/trace/KVTR9J4K2M/export?job=${ID}`);
    expect(traceHref(T, '../evil')).toBe('/trace');
    expect(traceDownloadHref(P, 'KVTR9J4K2M', ID, 'a'.repeat(20))).toBe(`/trace/KVTR9J4K2M/export/${ID}/download?token=${'a'.repeat(20)}`);
    expect(traceDownloadHref(P, 'KVTR9J4K2M', 'nope', 'a'.repeat(20))).toBe('/trace/KVTR9J4K2M/export');
    expect(certificateHref(T, ID, { lot: 'KVTR9J4K2M' })).toBe(`/anand-fpo/certificates/${ID}?lot=KVTR9J4K2M`);
    expect(certificateLookupHref(P, { no: 'NPOP-1', org: 'anand-fpo' })).toBe('/certificates?no=NPOP-1&org=anand-fpo');
    expect(certificateLookupHref(T, { no: 'NPOP-1', org: 'other' })).toBe('/anand-fpo/certificates?no=NPOP-1');
    expect([isOwnLot(P, 'x'), isOwnLot(T, 'anand-fpo'), isOwnLot(T, 'other'), isOwnLot(T, null)]).toEqual([true, true, false, false]);
    expect(platformTraceHref('', 'KVTR9J4K2M')).toBe('/trace/KVTR9J4K2M');
    expect(platformTraceHref('https://market.example/', 'KVTR9J4K2M', 'verify')).toBe('https://market.example/trace/KVTR9J4K2M/verify');
    expect(platformTraceHref('javascript:alert(1)', 'KVTR9J4K2M')).toBe('/trace/KVTR9J4K2M');
    expect(platformCertificateHref('', ID)).toBe(`/certificates/${ID}`);
    const src = readFileSync(join(__dirname, '..', 'features', 'store5b', 'trace.ts'), 'utf8');
    expect(src).not.toMatch(/krishalaya\.in/i);
  });
  it('the export view (position, ETA, receipt "You", the download TTL), the failures by name, the carried key', () => {
    const v = traceExportView({ id: 'j', status: 'ready', receipt: { fileName: 'f.csv', rowCount: 4, sha256: 's', generatedAt: 'g', requestedBy: 'me' }, download: { kind: 'available', linkTtlSec: 900 } }, 'me');
    expect([v.phase, v.receipt?.requestedByYou, v.downloadable, v.linkTtlSec]).toEqual(['ready', true, true, 900]);
    const q = traceExportView({ id: 'j', status: 'queued', standing: { position: 3, eta: { kind: 'no_history' } } }, null);
    expect([q.position, q.etaSeconds]).toEqual([3, null]);
    expect([exportFailureOf('TRACE_EXPORT_UNAVAILABLE', 503), exportFailureOf(null, 401), exportFailureOf('TRACE_NO_LONGER_PUBLISHED', 404), exportFailureOf('X', 500)]).toEqual(['unavailable', 'signin', 'no_longer', 'server']);
    expect(carriedExportKey('trace-export:0219d000-0000-4000-8000-000000000001')).toBe('trace-export:0219d000-0000-4000-8000-000000000001');
    expect(carriedExportKey('dsr-export:0219d000-0000-4000-8000-000000000001')).toBeNull();
  });
  it('the certificate helpers: statuses + meanings ×3, named roles (never a raw code), subjects, the vocabulary label, failures, the form', () => {
    for (const s of CERT_STATUSES) { expect(has(statusKey(s))).toBe(true); expect(has(meaningKey(s))).toBe(true); }
    expect([roleKey('tenant_admin'), roleKey('fpo_coordinator'), roleKey('support_agent'), roleKey(null)]).toEqual(['store5b.cert.role.tenant_admin', 'store5b.cert.role.fpo_coordinator', 'store5b.cert.role.staff', 'store5b.cert.role.staff']);
    expect(subjectKey('tenant')).toBe('store5b.cert.subject.tenant'); expect(subjectKey('moon')).toBe('store5b.cert.subject.unknown');
    expect(typeLabel('npop', [{ code: 'npop', name: 'NPOP (India Organic)' }])).toBe('NPOP (India Organic)'); expect(typeLabel('gap', [])).toBe('gap');
    expect([certFailureOf('CERTIFICATE_NOT_PUBLISHED', 404), certFailureOf('CERTIFICATE_NOT_FOUND', 404), certFailureOf('TENANT_REQUIRED', 400), certFailureOf('X', 500)]).toEqual(['not_published', 'not_found', 'need_org', 'error']);
    expect(lookupInput({ no: '  NPOP-1 ', org: 'Anand-FPO' })).toEqual({ no: 'NPOP-1', org: 'anand-fpo' });
    expect(lookupInput({ org: '../x' })).toEqual({ no: null, org: null });
  });
});

describe('STORE-5b · (4) the refusal registry and the listing chip', () => {
  it('every refusal key exists in en / hi / gu and says no (en); each of the five surfaces prints at least one; ids are unique', () => {
    for (const r of STORE5B_REFUSALS) { expect([r.key, has(r.key)]).toEqual([r.key, true]); expect([r.key, /\bno\b|\bnot\b|\bnever\b|\bnothing\b/i.test(en[r.key as keyof typeof en])]).toEqual([r.key, true]); }
    for (const s of ['trace', 'trace_verify', 'trace_export', 'certificate', 'dairy_trace'] as const) expect(store5bRefusalKeys(s).length).toBeGreaterThan(0);
    expect(new Set(STORE5B_REFUSALS.map((r) => r.id)).size).toBe(STORE5B_REFUSALS.length);
    expect(STORE5B_REFUSALS.length).toBe(20);
  });
  it('12 chain pages (W303–W306, W3086–W3088, W3154–W3158) with their verdicts; the DELTAs named', () => {
    expect(STORE5B_CHAIN_PAGES.map((p) => p.file.split('-')[0]).sort()).toEqual(['W303', 'W304', 'W305', 'W306', 'W3086', 'W3087', 'W3088', 'W3154', 'W3155', 'W3156', 'W3157', 'W3158'].sort());
    expect(STORE5B_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['csv_not_json', 'no_verification_yet', 'certificate_form', 'export_back', 'chrome', 'sold_line']));
  });
  it('the listing chip: a certified claim no certificate covers reads self_declared (the API\'s value, printed — never re-judged here)', () => {
    const base = { gradeConfirmed: null, harvestDate: null, qrToken: null, quantityAvailable: 1, quantityTotal: 1, minOrderQty: 1, unitCode: 'kg', district: null, attributes: [] };
    expect(lotFacts({ ...base, organicClaim: 'self_declared' } as never).organic).toBe('self_declared');
    expect(lotFacts({ ...base, organicClaim: 'certified' } as never).organic).toBe('certified');
    for (const k of ['browse.organic.self_declared', 'lot.organic.self_declared']) expect(has(k)).toBe(true);
  });
});
