// core/exports-plane/__tests__/export-plane.spec.ts · PC-56 TENANT-6e-2 · the plane's pure logic: the state machine,
// the receipt's invariants, position + ETA, the signed link, the CSV sink, canonical params, the projection.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertTransition, canTransition, isDownloadable, isOpen, isTerminal, IllegalExportTransitionError } from '../domain/export-job.state';
import { ExportJob, EXPORT_FILE_RETENTION_DAYS, EXPORT_MAX_ATTEMPTS } from '../domain/export-job.entity';
import { ETA_SAMPLE_SIZE, medianMs, queueStanding } from '../domain/export-eta';
import { deriveLinkKey, EXPORT_LINK_TTL_SEC, mintExportLink, verifyExportLink } from '../domain/export-link';
import { CSV_BOM, CSV_EOL, CsvSink, csvCell, csvLine, exportFileName } from '../domain/csv';
import { ExportPlaneService, canonicalParams, paramsSha256 } from '../export-plane.service';
import { DatasetRegistry } from '../dataset.registry';

const SHA = 'a'.repeat(64);
const receipt = (over: Partial<Parameters<ExportJob['succeed']>[0]> = {}) => ({
  fileName: 'dairy-insights-90d-2026-09-10.csv', contentType: 'text/csv; charset=utf-8', rowCount: 27, sha256: SHA, byteSize: 1234,
  storageKey: 'exports/t/j/dairy-insights-90d-2026-09-10.csv', notes: ['payout streak: NOT in this file'], ...over,
});
const NAME = { en: 'dairy insights', hi: 'dairy insights', gu: 'ડેરી ઇનસાઇટ્સ' };
const fresh = () => ExportJob.create({ id: 'j1', tenantId: 't1', datasetCode: 'dairy.insights', params: { window: 90 }, paramsSha256: SHA, requestedBy: 'u1', now: new Date('2026-09-10T04:00:00Z') });

describe('the state machine (0169 CHECK, mirrored)', () => {
  it('admits exactly the hops the worker makes and refuses everything else', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'ready')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('running', 'queued')).toBe(true);        // a stale claim released
    expect(canTransition('ready', 'expired')).toBe(true);
    for (const bad of [['queued', 'ready'], ['queued', 'failed'], ['ready', 'running'], ['failed', 'queued'], ['expired', 'ready'], ['queued', 'expired']] as const) {
      expect(canTransition(bad[0], bad[1])).toBe(false);
    }
    expect(() => assertTransition('ready', 'queued')).toThrow(IllegalExportTransitionError);
  });
  it('knows which states hold a queue slot and which can be fetched', () => {
    expect(isOpen('queued') && isOpen('running')).toBe(true);
    expect(isOpen('ready') || isOpen('failed') || isOpen('expired')).toBe(false);
    expect(isTerminal('failed') && isTerminal('expired')).toBe(true);
    expect(isTerminal('ready')).toBe(false);
    const now = new Date('2026-09-10T10:00:00Z');
    expect(isDownloadable('ready', new Date('2026-09-10T10:00:01Z'), now)).toBe(true);
    // AT the instant is past it: a file expiring at 10:00:00 is gone at 10:00:00.
    expect(isDownloadable('ready', new Date('2026-09-10T10:00:00Z'), now)).toBe(false);
    expect(isDownloadable('ready', null, now)).toBe(false);
    expect(isDownloadable('queued', new Date('2027-01-01'), now)).toBe(false);
  });
});

describe('the job', () => {
  it('is created queued with an event naming the requester, and claims count attempts', () => {
    const j = fresh();
    expect(j.status).toBe('queued');
    const evts = j.pullEvents();
    expect(evts).toEqual([{ type: 'exports.export_queued', payload: { jobId: 'j1', dataset: 'dairy.insights', userId: 'u1' } }]);
    j.claim(new Date('2026-09-10T04:01:00Z'));
    expect(j.status).toBe('running');
    expect(j.attempts).toBe(1);
    expect(j.toProps().startedAt?.toISOString()).toBe('2026-09-10T04:01:00.000Z');
  });
  it('a released claim goes back to the queue at its ORIGINAL queued_at, and the third claim fails it', () => {
    const j = fresh();
    const queuedAt = j.toProps().queuedAt;
    for (let i = 0; i < EXPORT_MAX_ATTEMPTS; i++) { j.claim(); j.release(); }
    expect(j.attempts).toBe(EXPORT_MAX_ATTEMPTS);
    expect(j.toProps().queuedAt).toBe(queuedAt);
    // MUTATION PASS (E4): a released claim that kept `started_at` would be swept as stale AGAIN on the next tick and
    // released a second time — its attempts counting a death that never happened. Pinned.
    expect(j.toProps().startedAt).toBeNull();
    j.claim();
    expect(j.status).toBe('failed');
    expect(j.toProps().failureCode).toBe('too_many_attempts');
    expect(j.pullEvents().some((e) => e.type === 'exports.export_failed')).toBe(true);
  });
  it('succeed writes every receipt field, stamps the retention, and emits the notice with the requester and the localized name', () => {
    const j = fresh(); j.claim(); j.pullEvents();
    const now = new Date('2026-09-10T04:05:00Z');
    j.succeed(receipt(), NAME, now);
    const p = j.toProps();
    expect(p.status).toBe('ready');
    expect(p.rowCount).toBe(27); expect(p.contentSha256).toBe(SHA); expect(p.byteSize).toBe(1234);
    expect(p.expiresAt?.getTime()).toBe(now.getTime() + EXPORT_FILE_RETENTION_DAYS * 86_400_000);
    const [ready] = j.pullEvents();
    expect(ready.type).toBe('exports.export_ready');
    expect(ready.payload).toMatchObject({ jobId: 'j1', userId: 'u1', dataset: NAME, rows: '27', file: 'dairy-insights-90d-2026-09-10.csv', sha256: SHA });
  });
  it('refuses a receipt that is missing a fact — the entity before the CHECK', () => {
    const j = fresh(); j.claim();
    expect(() => j.succeed(receipt({ sha256: 'nothex' }), NAME)).toThrow(/sha256/);
    expect(() => j.succeed(receipt({ rowCount: -1 }), NAME)).toThrow(/rowCount/);
    expect(() => j.succeed(receipt({ rowCount: 1.5 }), NAME)).toThrow(/rowCount/);
    expect(() => j.succeed(receipt({ fileName: '' }), NAME)).toThrow(/name the file/);
    expect(j.status).toBe('running');   // nothing moved
  });
  it('an expired job keeps its receipt (W2554 prints it beside the word)', () => {
    const j = fresh(); j.claim(); j.succeed(receipt(), NAME); j.pullEvents();
    j.expire(new Date('2026-09-18T00:00:00Z'));
    const p = j.toProps();
    expect(p.status).toBe('expired'); expect(p.contentSha256).toBe(SHA); expect(p.fileName).toBe(receipt().fileName);
    expect(j.pullEvents()[0].type).toBe('exports.export_expired');
  });
  it('fail keeps the code and truncates the detail', () => {
    const j = fresh(); j.claim();
    j.fail('storage_failed', 'x'.repeat(5000));
    expect(j.toProps().failureCode).toBe('storage_failed');
    expect(j.toProps().failureDetail?.length).toBe(2000);
    expect(() => j.fail('producer_failed', null)).toThrow(IllegalExportTransitionError);
  });
});

describe('position and ETA', () => {
  it('position is 1-based and ETA is NULL with no history — unknown is not zero', () => {
    expect(queueStanding({ ahead: 0, sample: 0, medianRunMs: null })).toEqual({ position: 1, ahead: 0, eta: { kind: 'no_history' } });
    expect(queueStanding({ ahead: 4, sample: 0, medianRunMs: null }).eta).toEqual({ kind: 'no_history' });
    // A sample with a median but a zero sample count is a contradiction; the honest answer is still no history.
    expect(queueStanding({ ahead: 0, sample: 0, medianRunMs: 5000 }).eta).toEqual({ kind: 'no_history' });
  });
  it('the estimate covers the jobs ahead AND this one, ceiled to whole seconds', () => {
    const s = queueStanding({ ahead: 2, sample: 7, medianRunMs: 4400 });
    expect(s.position).toBe(3);
    // 3 runs × 4.4 s = 13.2 s → 14, never 13.
    expect(s.eta).toEqual({ kind: 'estimate', seconds: 14, basis: 'median_of_recent_runs', sample: 7, runsIncluded: 3 });
    expect(queueStanding({ ahead: 0, sample: 1, medianRunMs: 1000 }).eta).toMatchObject({ seconds: 1, runsIncluded: 1 });
  });
  it('a negative or fractional "ahead" cannot produce a position below 1', () => {
    expect(queueStanding({ ahead: -3, sample: 1, medianRunMs: 100 }).position).toBe(1);
    expect(queueStanding({ ahead: 2.9, sample: 1, medianRunMs: 100 }).position).toBe(3);
  });
  it('median agrees with percentile_cont on the even case, and ignores garbage', () => {
    expect(medianMs([])).toBeNull();
    expect(medianMs([5])).toBe(5);
    expect(medianMs([1, 100])).toBe(50.5);
    expect(medianMs([9, 1, 5])).toBe(5);
    expect(medianMs([NaN, -1, 3, 1])).toBe(2);
    expect(ETA_SAMPLE_SIZE).toBe(20);
  });
});

describe('the signed link', () => {
  const key = deriveLinkKey('a-secret-that-is-long-enough-for-hkdf');
  const nowSec = 1_800_000_000;
  const expect_ = { jobId: 'job-1', tenantId: 'ten-1', nowSec };

  it('refuses to derive a key from a missing or short secret', () => {
    expect(() => deriveLinkKey('')).toThrow(); expect(() => deriveLinkKey('short')).toThrow();
    // Two derivations of one secret agree; two secrets do not.
    expect(deriveLinkKey('a-secret-that-is-long-enough-for-hkdf').equals(key)).toBe(true);
    expect(deriveLinkKey('another-secret-that-is-long-enough!').equals(key)).toBe(false);
  });
  it('mints a 15-minute token that verifies against its own job and tenant, with its jti', () => {
    const { token, claims } = mintExportLink(key, { jobId: 'job-1', tenantId: 'ten-1', mintedBy: 'u1', nowSec });
    expect(claims.expSec - claims.issuedAtSec).toBe(EXPORT_LINK_TTL_SEC);
    expect(EXPORT_LINK_TTL_SEC).toBe(15 * 60);
    const v = verifyExportLink(key, token, expect_);
    expect(v).toEqual({ ok: true, claims });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('dies AT the fifteenth minute, not after it', () => {
    const { token, claims } = mintExportLink(key, { jobId: 'job-1', tenantId: 'ten-1', mintedBy: 'u1', nowSec });
    expect(verifyExportLink(key, token, { ...expect_, nowSec: nowSec + EXPORT_LINK_TTL_SEC - 1 }).ok).toBe(true);
    const dead = verifyExportLink(key, token, { ...expect_, nowSec: nowSec + EXPORT_LINK_TTL_SEC });
    expect(dead).toEqual({ ok: false, outcome: 'refused_expired', jti: claims.jti });   // the jti survives into the log
  });
  it('names every refusal, and checks the signature BEFORE reading anything the payload says', () => {
    const { token } = mintExportLink(key, { jobId: 'job-1', tenantId: 'ten-1', mintedBy: 'u1', nowSec });
    expect(verifyExportLink(key, null, expect_)).toEqual({ ok: false, outcome: 'refused_no_token', jti: null });
    expect(verifyExportLink(key, '', expect_)).toEqual({ ok: false, outcome: 'refused_no_token', jti: null });
    expect(verifyExportLink(key, 'garbage', expect_).ok).toBe(false);
    expect(verifyExportLink(key, token, { ...expect_, jobId: 'job-2' })).toMatchObject({ ok: false, outcome: 'refused_wrong_job' });
    expect(verifyExportLink(key, token, { ...expect_, tenantId: 'ten-2' })).toMatchObject({ ok: false, outcome: 'refused_wrong_job' });
    // Another key: bad signature, and the jti is NOT reported — an unsigned payload decides nothing, not even a log field.
    const other = deriveLinkKey('another-secret-that-is-long-enough!');
    expect(verifyExportLink(other, token, expect_)).toEqual({ ok: false, outcome: 'refused_bad_signature', jti: null });
    // A tampered payload (same length, different byte) is a bad signature, never a wrong job.
    const [p, s] = token.split('.');
    const flipped = (p[0] === 'A' ? 'B' : 'A') + p.slice(1);
    expect(verifyExportLink(key, `${flipped}.${s}`, expect_)).toMatchObject({ outcome: 'refused_bad_signature' });
    // A signature of the wrong length must be a refusal, not a thrown TypeError (timingSafeEqual would throw).
    expect(verifyExportLink(key, `${p}.${s.slice(0, 10)}`, expect_)).toMatchObject({ outcome: 'refused_bad_signature' });
  });
});

describe('the CSV sink', () => {
  it('quotes RFC 4180 and neutralises formula cells without touching negative numbers', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe(''); expect(csvCell(undefined)).toBe('');
    expect(csvCell(12n)).toBe('12'); expect(csvCell(true)).toBe('true');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('+abc')).toBe("'+abc");
    expect(csvCell('-12.50')).toBe('-12.50');     // a number, left alone
    expect(csvCell('-.5')).toBe('-.5');
    expect(csvLine(['a', 'b'])).toBe(`a,b${CSV_EOL}`);
  });
  it('counts DATA rows (not the header), hashes exactly the bytes written, and refuses misuse', async () => {
    const chunks: Buffer[] = [];
    const sink = new CsvSink((c) => { chunks.push(c); });
    await expect(sink.row(['x'])).rejects.toThrow(/before header/);
    await sink.header(['section', 'metric']);
    await expect(sink.header(['again'])).rejects.toThrow(/twice/);
    await sink.row(['volume', 'per_day']);
    await sink.row(['rate', 'a,b']);
    const facts = sink.finish();
    const bytes = Buffer.concat(chunks);
    expect(facts.rowCount).toBe(2);
    expect(facts.byteSize).toBe(bytes.length);
    expect(facts.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    // MUTATION PASS (C4): asserted against the LITERAL bytes, not the constant — a spec that spelt the line ending as
    // `CSV_EOL` agreed with whatever the constant became. RFC 4180 is CRLF, and the BOM is three bytes at the front.
    expect(bytes.toString('utf8')).toBe('\uFEFFsection,metric\r\nvolume,per_day\r\nrate,"a,b"\r\n');
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_EOL).toBe('\r\n'); expect(CSV_BOM).toBe('\uFEFF');
    expect(() => sink.finish()).toThrow(/twice/);
    await expect(sink.row(['late'])).rejects.toThrow(/after finish/);
  });
  it('file names are safe and never carry a tenant name', () => {
    expect(exportFileName('dairy.insights', '90d', '2026-09-10')).toBe('dairy-insights-90d-2026-09-10.csv');
    expect(exportFileName('A/B C', '../x', '2026-09-10')).toBe('a-b-c-x-2026-09-10.csv');
  });
});

describe('canonical params', () => {
  it('sorts keys at every depth so key order cannot make two requests of one', () => {
    expect(canonicalParams({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(paramsSha256({ window: 90 })).toBe(paramsSha256({ window: 90 }));
    expect(paramsSha256({ window: 90 })).not.toBe(paramsSha256({ window: 30 }));
    expect(paramsSha256({ window: 90 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the registry', () => {
  it('refuses a duplicate code and lists what it holds', () => {
    const r = new DatasetRegistry();
    const p = { code: 'x.y', permission: 'x.read', params: z.object({}).strict(), datasetName: async () => ({ en: 'x' }), produce: async () => ({ kind: 'refused' as const, code: 'dataset_disabled' as const, detail: '' }) };
    r.register(p);
    expect(() => r.register(p)).toThrow(/duplicate/);
    expect(r.codes()).toEqual(['x.y']); expect(r.has('x.y')).toBe(true); expect(r.get('nope')).toBeUndefined();
  });
});

describe('the projection (what the page is handed)', () => {
  const svc = Object.create(ExportPlaneService.prototype) as ExportPlaneService;
  it('a queued job carries its standing and no receipt; a ready one the receipt, fetches and an available link', () => {
    const j = fresh();
    const q = svc.project(j, { position: 1, ahead: 0, eta: { kind: 'no_history' } }, null);
    expect(q.status).toBe('queued'); expect(q.receipt).toBeNull(); expect(q.standing?.eta).toEqual({ kind: 'no_history' }); expect(q.download).toEqual({ kind: 'not_ready' });
    j.claim(); j.succeed(receipt(), NAME, new Date('2026-09-10T04:05:00Z'));
    const r = svc.project(j, { position: 9, ahead: 8, eta: { kind: 'no_history' } }, { attempts: 3, served: 2, refused: 1, mismatched: 0, lastServedAt: null }, new Date('2026-09-10T05:00:00Z'));
    expect(r.standing).toBeNull();                          // a ready job has no position: it is not in the queue
    expect(r.receipt).toMatchObject({ fileName: receipt().fileName, rowCount: 27, sha256: SHA, requestedBy: 'u1', generatedAt: '2026-09-10T04:05:00.000Z' });
    expect(r.fetches?.served).toBe(2);
    expect(r.download).toEqual({ kind: 'available', linkTtlSec: 900 });
  });
  it('past retention but not yet swept reads as file_expired, and a failed job as failed', () => {
    const j = fresh(); j.claim(); j.succeed(receipt(), NAME, new Date('2026-09-01T00:00:00Z'));
    expect(svc.project(j, null, null, new Date('2026-09-10T00:00:00Z')).download).toEqual({ kind: 'file_expired', expiredAt: '2026-09-08T00:00:00.000Z' });
    const f = fresh(); f.claim(); f.fail('storage_failed', 'boom');
    const v = svc.project(f, null, null);
    expect(v.download).toEqual({ kind: 'failed' }); expect(v.failure).toEqual({ code: 'storage_failed', detail: 'boom' }); expect(v.receipt).toBeNull();
  });
});
