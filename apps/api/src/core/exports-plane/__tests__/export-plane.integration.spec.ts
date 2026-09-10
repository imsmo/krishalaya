// core/exports-plane/__tests__/export-plane.integration.spec.ts · PC-56 TENANT-6e-2, LIVE Postgres.
//
// THE PLANE END TO END AGAINST THE REAL SCHEMA: enqueue → position/ETA → worker tick → ready → the receipt checked
// against the stored bytes (sha256 recomputed, data rows counted) → a signed link → a served fetch with its digest →
// three refused fetches, each a log row → expiry → a stale claim released → another tenant seeing nothing → the real
// dairy dataset, once with its screen's flag off and once on.
//
// WHAT ONLY A REAL DATABASE PROVES HERE: the SECURITY DEFINER standing function answering as kv_relay while the caller
// is kv_app under RLS; the partial unique index coalescing two clicks; `FOR UPDATE SKIP LOCKED` on the claim; the CHECK
// constraints refusing a `ready` row without its receipt; the column-limited UPDATE grant; RLS hiding the neighbour's job.
//
// THE OBJECT STORE IS AN IN-MEMORY STAND-IN. This platform's only storage adapter is S3 through presigned PUT/GET
// (`core/media/s3-presign.service.ts`); no local adapter exists and the suites that touch documents pass `null as any`
// for it (`billing-documents.integration.spec.ts`). This fake implements the two streaming methods the plane uses and
// keeps the bytes, which is what lets the test recompute the digest over what was STORED rather than over what the
// producer said. Named in the wave's report as the one seam the live proof does not cross.
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { z } from 'zod';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../config/app-config';
import { PgPoolProvider } from '../../database/pg-pool.provider';
import { ShardRouter } from '../../sharding/shard-router';
import { PgUnitOfWork } from '../../database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../database/read-replica.pg';
import { PgOutboxWriter } from '../../outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../idempotency/idempotency.service.pg';
import { PromMetrics } from '../../observability/metrics.prom';
import { AuditWriter } from '../../audit/audit.writer';
import { FlagsService } from '../../feature-flags/flags.service';
import { InMemoryCacheService } from '../../cache/cache.service.in-memory';
import { UiMessageRepository } from '../../i18n/ui-message.repository';
import type { ObjectStore } from '../../media/s3-presign.service';

import { DatasetRegistry, DatasetProducer } from '../dataset.registry';
import { ExportJobRepository } from '../export-job.repository';
import { ExportDownloadRepository } from '../export-download.repository';
import { ExportPlaneService, EXPORT_PLANE_FLAG } from '../export-plane.service';
import { ExportWorker } from '../export-worker';
import { EXPORT_LINK_TTL_SEC } from '../domain/export-link';
import { EXPORT_FILE_RETENTION_DAYS } from '../domain/export-job.entity';
import { ExportDownloadRefusedError, ExportFileExpiredError, ExportJobNotFoundError, ExportNotReadyError, ExportPlaneDisabledError } from '../domain/export-plane.errors';
import { ForbiddenError } from '../../../shared/errors/app-error';

import { DairyInsightsRepository } from '../../../modules/dairy/repositories/dairy-insights.repository';
import { DairyQualityRepository } from '../../../modules/dairy/repositories/dairy-quality.repository';
import { DairyInsightsReadModel, INSIGHTS_FLAG } from '../../../modules/dairy/read-models/dairy-insights.read-model';
import { DairyInsightsDataset, DAIRY_INSIGHTS_DATASET } from '../../../modules/dairy/exports/dairy-insights.dataset';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

/** The stand-in object store (see the header). */
class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  failNextPut = false;
  async putObjectStream(key: string, body: Readable, _ct: string, contentLength: number): Promise<void> {
    if (this.failNextPut) { this.failNextPut = false; throw new Error('S3 putObject failed (503)'); }
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks);
    if (b.length !== contentLength) throw new Error(`content-length ${contentLength} != body ${b.length}`);
    this.objects.set(key, b);
  }
  async getObjectStream(key: string): Promise<Readable> {
    const b = this.objects.get(key);
    if (!b) throw new Error('S3 getObject failed (404)');
    return Readable.from([b]);
  }
}

/** A tiny deterministic dataset so the plane is tested apart from dairy's own figures. */
const testProducer: DatasetProducer<{ n: number }> = {
  code: 'test.rows', permission: 'dairy.manage', params: z.object({ n: z.coerce.number().int().min(0).max(10_000) }).strict(),
  datasetName: async () => ({ en: 'test rows', hi: 'test rows', gu: 'ટેસ્ટ' }),
  produce: async (_ctx, p) => ({
    kind: 'file',
    file: {
      header: ['i', 'text'],
      rows: (async function* () { for (let i = 0; i < p.n; i++) yield [i, i % 3 === 0 ? 'a,b' : `row ${i}`]; })(),
      notes: ['a note'], fileSuffix: `${p.n}rows`,
    },
  }),
};

const drain = async (r: Readable): Promise<Buffer> => { const cs: Buffer[] = []; for await (const c of r) cs.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return Buffer.concat(cs); };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

run('PC-56 TENANT-6e-2 · the export plane (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let flagCache: InMemoryCacheService;
  let svc: ExportPlaneService; let worker: ExportWorker; let store: MemoryStore; let downloads: ExportDownloadRepository;
  let jobsRepo: ExportJobRepository;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const desk = randomUUID(); const neighbour = randomUUID(); const member = randomUUID();
  const deskActor = { userId: desk, permissions: new Set(['dairy.manage']) };
  const memberActor = { userId: member, permissions: new Set<string>() };
  const neighbourActor = { userId: neighbour, permissions: new Set(['dairy.manage']) };
  const meta = { ip: '10.0.0.1', userAgent: 'itest' };

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES ($1,'itest',$2,100,'experiment')
                       ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, rollout_pct = 100`, [key, on]);
    await flagCache.del(`flag:${key}`); await flagCache.del('flags:all');
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [desk, neighbour, member]) await makeUser(admin, u);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    flagCache = new InMemoryCacheService();
    const flags = new FlagsService(pools, flagCache);

    const registry = new DatasetRegistry();
    registry.register(testProducer);
    const insightsRepo = new DairyInsightsRepository(replica as never);
    const quality = new DairyQualityRepository(replica as never);
    const rm = new DairyInsightsReadModel(insightsRepo, quality, flags, metrics);
    registry.register(new DairyInsightsDataset(rm, new UiMessageRepository(replica as never)));

    store = new MemoryStore();
    jobsRepo = new ExportJobRepository(replica as never);
    downloads = new ExportDownloadRepository(replica as never);
    svc = new ExportPlaneService(uow, outbox, idem, metrics, registry, store as unknown as ObjectStore, audit, flags, jobsRepo, downloads, config);
    worker = new ExportWorker(uow, outbox, replica as never, metrics, registry, store as unknown as ObjectStore, jobsRepo);

    await setFlag(EXPORT_PLANE_FLAG, true);
    await setFlag(INSIGHTS_FLAG, false);
  }, 240000);

  afterAll(async () => {
    await admin?.query(`UPDATE feature_flags SET is_enabled=false WHERE key IN ($1,$2)`, [EXPORT_PLANE_FLAG, INSIGHTS_FLAG]).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  let first = ''; let second = ''; let bytes: Buffer;

  it('the plane flag OFF refuses the enqueue with a code the page can name — nothing becomes a row', async () => {
    await setFlag(EXPORT_PLANE_FLAG, false);
    await expect(svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: 5 } }, null)).rejects.toBeInstanceOf(ExportPlaneDisabledError);
    await setFlag(EXPORT_PLANE_FLAG, true);
    expect((await admin.query(`SELECT count(*)::int n FROM tenant_export_jobs WHERE tenant_id=$1`, [tenantA])).rows[0].n).toBe(0);
  });

  it('enqueues at position 1 with NO estimate — the platform has never finished an export', async () => {
    const v = await svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: 7 } }, '10.0.0.1');
    first = v.id;
    expect(v.status).toBe('queued');
    expect(v.standing).toEqual({ position: 1, ahead: 0, eta: { kind: 'no_history' } });
    expect(v.receipt).toBeNull(); expect(v.download).toEqual({ kind: 'not_ready' });
    expect(v.requestedBy).toBe(desk);
    const q = await admin.query(`SELECT event_type, payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY created_at`, [first]);
    expect(q.rows.map((r) => r.event_type)).toEqual(['exports.export_queued']);
    const a = await admin.query(`SELECT action FROM audit_log WHERE entity_id=$1 AND action='exports.enqueued'`, [first]);
    expect(a.rowCount).toBe(1);
  });

  it('is idempotent twice over: the same key replays, and a different key for the SAME open request returns the same job', async () => {
    const key = `k-${randomUUID()}`;
    const a = await svc.enqueue(tenantA, deskActor, key, { datasetCode: 'test.rows', params: { n: 7 } }, null);
    const b = await svc.enqueue(tenantA, deskActor, key, { datasetCode: 'test.rows', params: { n: 7 } }, null);
    expect(a.id).toBe(first); expect(b.id).toBe(first);
    // A different requester asking for the same file is a DIFFERENT receipt (it names them), so a different job.
    const other = await svc.enqueue(tenantA, { userId: neighbour, permissions: new Set(['dairy.manage']) }, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: 7 } }, null);
    expect(other.id).not.toBe(first);
    expect(other.standing?.position).toBe(2);
    // Cleanup that one so the FIFO below is deterministic: fail it out of the queue as the worker would on a bad claim.
    await admin.query(`UPDATE tenant_export_jobs SET status='failed', failed_at=now(), failure_code='producer_failed', started_at=now() WHERE id=$1`, [other.id]);
  });

  it('a second request stands behind the first, and the params are canonical', async () => {
    const v = await svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: '3' } }, null);
    second = v.id;
    expect(v.params).toEqual({ n: 3 });   // coerced and STORED canonical
    expect(v.standing).toMatchObject({ position: 2, ahead: 1, eta: { kind: 'no_history' } });
    await expect(svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'nope', params: {} }, null)).rejects.toMatchObject({ code: 'EXPORT_DATASET_UNKNOWN' });
    await expect(svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: -1 } }, null)).rejects.toMatchObject({ code: 'EXPORT_PARAMS_INVALID' });
    await expect(svc.enqueue(tenantA, memberActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: 1 } }, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the worker makes the FIRST file and the receipt matches the bytes: sha256 recomputed, data rows counted', async () => {
    const r = await worker.tick(admin);
    expect(r).toMatchObject({ generated: 1, failed: 0, idle: false });
    const v = await svc.view(tenantA, deskActor, first);
    expect(v.status).toBe('ready');
    expect(v.standing).toBeNull();
    expect(v.receipt).toMatchObject({ fileName: expect.stringMatching(/^test-rows-7rows-\d{4}-\d{2}-\d{2}\.csv$/), rowCount: 7, requestedBy: desk, notes: ['a note'] });
    const key = (await admin.query(`SELECT storage_key, expires_at, generated_at FROM tenant_export_jobs WHERE id=$1`, [first])).rows[0];
    bytes = store.objects.get(key.storage_key)!;
    expect(bytes).toBeDefined();
    expect(sha(bytes)).toBe(v.receipt!.sha256);
    expect(bytes.length).toBe(v.receipt!.byteSize);
    const lines = bytes.toString('utf8').split('\r\n').filter((l) => l.length > 0);
    expect(lines.length - 1).toBe(v.receipt!.rowCount);            // header is not a row
    expect(lines[0]).toBe('\uFEFFi,text'); expect(lines[1]).toBe('0,"a,b"');
    expect(new Date(key.expires_at).getTime() - new Date(key.generated_at).getTime()).toBe(EXPORT_FILE_RETENTION_DAYS * 86_400_000);
    expect(v.download).toEqual({ kind: 'available', linkTtlSec: EXPORT_LINK_TTL_SEC });
    expect(v.fetches).toEqual({ attempts: 0, served: 0, refused: 0, mismatched: 0, lastServedAt: null });
    // The notice, in the same transaction as the receipt, addressed to the requester with the localized name.
    const ev = await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='exports.export_ready'`, [first]);
    expect(ev.rowCount).toBe(1);
    expect(ev.rows[0].payload).toMatchObject({ userId: desk, rows: '7', dataset: { en: 'test rows', gu: 'ટેસ્ટ' }, file: v.receipt!.fileName });
  });

  it('now there is history: the queued job carries an estimate from one observed run', async () => {
    const v = await svc.view(tenantA, deskActor, second);
    expect(v.status).toBe('queued');
    expect(v.standing).toMatchObject({ position: 1, ahead: 0, eta: { kind: 'estimate', sample: 1, runsIncluded: 1, basis: 'median_of_recent_runs' } });
    expect((v.standing!.eta as { seconds: number }).seconds).toBeGreaterThanOrEqual(0);
  });

  it('mints a 15-minute link (audited with its jti) and serves the bytes, logging the fetch with a matching digest', async () => {
    const link = await svc.mintLink(tenantA, deskActor, first, '10.0.0.1');
    expect(link.ttlSec).toBe(900); expect(link.downloadPath).toBe(`/v1/exports/${first}/download`);
    const a = await admin.query(`SELECT new_value FROM audit_log WHERE entity_id=$1 AND action='exports.link_minted'`, [first]);
    expect(a.rows[0].new_value.jti).toBe(link.jti);

    const open = await svc.openDownload(tenantA, deskActor, first, link.token, meta);
    const served = await drain(open.body);
    expect(served.equals(bytes)).toBe(true);
    await open.record({ outcome: 'served', bytesServed: served.length, servedSha256: sha(served) });
    const rows = await admin.query(`SELECT outcome, token_jti, bytes_served, digest_matched, fetched_by, host(ip) AS ip FROM tenant_export_downloads WHERE job_id=$1`, [first]);
    expect(rows.rows).toEqual([{ outcome: 'served', token_jti: link.jti, bytes_served: String(bytes.length), digest_matched: true, fetched_by: desk, ip: '10.0.0.1' }]);
    expect((await svc.view(tenantA, deskActor, first)).fetches).toMatchObject({ attempts: 1, served: 1, refused: 0, mismatched: 0 });
  });

  it('REFUSES an expired link, a missing one and another job\'s — and LOGS every refusal with its jti', async () => {
    const link = await svc.mintLink(tenantA, deskActor, first, null);
    const later = new Date(Date.now() + (EXPORT_LINK_TTL_SEC + 1) * 1000);
    await expect(svc.openDownload(tenantA, deskActor, first, link.token, meta, later)).rejects.toMatchObject({ code: 'EXPORT_DOWNLOAD_REFUSED', outcome: 'refused_expired' });
    await expect(svc.openDownload(tenantA, deskActor, first, null, meta)).rejects.toMatchObject({ outcome: 'refused_no_token' });
    await expect(svc.openDownload(tenantA, deskActor, first, 'not.a-token', meta)).rejects.toMatchObject({ outcome: 'refused_bad_signature' });
    // A link minted for `first` presented on `second` (still queued): wrong job — checked before the job's state.
    await expect(svc.openDownload(tenantA, deskActor, second, link.token, meta)).rejects.toMatchObject({ outcome: 'refused_wrong_job' });
    const log = await admin.query(`SELECT job_id, outcome, token_jti FROM tenant_export_downloads WHERE tenant_id=$1 AND outcome LIKE 'refused_%' ORDER BY fetched_at`, [tenantA]);
    expect(log.rows.map((r) => [r.job_id === first ? 'first' : 'second', r.outcome, r.token_jti === link.jti])).toEqual([
      ['first', 'refused_expired', true], ['first', 'refused_no_token', false], ['first', 'refused_bad_signature', false], ['second', 'refused_wrong_job', true],
    ]);
    expect((await svc.view(tenantA, deskActor, first)).fetches).toMatchObject({ attempts: 4, served: 1, refused: 3 });
    // A link cannot be minted for a job that is not ready.
    await expect(svc.mintLink(tenantA, deskActor, second, null)).rejects.toBeInstanceOf(ExportNotReadyError);
    await expect(svc.openDownload(tenantA, deskActor, second, (await svc.mintLink(tenantA, deskActor, first, null)).token.replace(/./, 'x'), meta)).rejects.toBeInstanceOf(ExportDownloadRefusedError);
  });

  it('THE NEIGHBOUR SEES NOTHING: another tenant\'s job is 404 under RLS, and its fetch log is empty from there', async () => {
    await expect(svc.view(tenantB, neighbourActor, first)).rejects.toBeInstanceOf(ExportJobNotFoundError);
    await expect(svc.mintLink(tenantB, neighbourActor, first, null)).rejects.toBeInstanceOf(ExportJobNotFoundError);
    expect(await downloads.countsFor(tenantB, first)).toMatchObject({ attempts: 0 });
    // A MEMBER of tenant A without the dataset's verb is refused with words (403), not hidden.
    await expect(svc.view(tenantA, memberActor, first)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('retention passes: the sweep expires the file, the receipt stays, the download and the mint say why', async () => {
    await admin.query(`UPDATE tenant_export_jobs SET expires_at = now() - interval '1 minute' WHERE id=$1`, [first]);
    const link = await svc.mintLink(tenantA, deskActor, first, null).catch((e) => e);
    // Past retention but not yet swept: already refused, as file_expired.
    expect(link).toBeInstanceOf(ExportFileExpiredError);
    const r = await worker.tick(admin);
    expect(r.expired).toBe(1);
    const v = await svc.view(tenantA, deskActor, first);
    expect(v.status).toBe('expired');
    expect(v.receipt?.sha256).toBe(sha(bytes));                    // W2554 prints the receipt beside the word
    expect(v.download).toMatchObject({ kind: 'file_expired' });
    expect((await admin.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='exports.export_expired'`, [first])).rowCount).toBe(1);
    // That tick also made the SECOND file (one job per tick, after the sweeps).
    expect(r.generated).toBe(1);
    expect((await svc.view(tenantA, deskActor, second)).status).toBe('ready');
  });

  it('a claim whose pod died is released back to the queue with its attempt counted, then made in the same tick', async () => {
    const v = await svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: 2 } }, null);
    await admin.query(`UPDATE tenant_export_jobs SET status='running', attempts=1, started_at = now() - interval '2 hours', version=version+1 WHERE id=$1`, [v.id]);
    const r = await worker.tick(admin);
    // Order inside a tick: release stale claims → expire → claim the head. The released job IS the head, so one tick does both.
    expect(r).toMatchObject({ released: 1, generated: 1 });
    const after = await svc.view(tenantA, deskActor, v.id);
    expect(after.status).toBe('ready');
    expect(after.attempts).toBe(2);                               // the dead pod's claim is remembered
  });

  it('a storage failure is a coded receipt, not a stack trace', async () => {
    const v = await svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: 'test.rows', params: { n: 4 } }, null);
    store.failNextPut = true;
    const r = await worker.tick(admin);
    expect(r.failed).toBe(1);
    const f = await svc.view(tenantA, deskActor, v.id);
    expect(f.status).toBe('failed'); expect(f.failure).toMatchObject({ code: 'storage_failed' }); expect(f.download).toEqual({ kind: 'failed' });
    expect(f.receipt).toBeNull();
    expect((await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='exports.export_failed'`, [v.id])).rows[0].payload.code).toBe('storage_failed');
  });

  it('a ready row cannot exist without its receipt, and kv_app cannot rewrite what was asked for', async () => {
    const app = new Pool({ connectionString: APP_URL });
    try {
      const superuser = (await app.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
      // The CHECK: a `ready` without a digest is refused by the database whatever writes it.
      await expect(admin.query(`UPDATE tenant_export_jobs SET status='ready', generated_at=now() WHERE id=$1`, [second]).then(() => admin.query(`UPDATE tenant_export_jobs SET status='ready', row_count=NULL WHERE id=$1`, [second]))).rejects.toThrow(/ck_texp_ready/);
      if (!superuser) {
        await app.query('BEGIN');
        await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
        await expect(app.query(`UPDATE tenant_export_jobs SET requested_by=$2 WHERE id=$1`, [second, neighbour])).rejects.toThrow(/permission denied/);
        await app.query('ROLLBACK');
        await app.query('BEGIN');
        await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
        await expect(app.query(`DELETE FROM tenant_export_downloads WHERE job_id=$1`, [first])).rejects.toThrow(/permission denied/);
        await app.query('ROLLBACK');
      }
    } finally { await app.end(); }
  });

  describe('the real dataset: dairy.insights', () => {
    it('with the SCREEN\'s flag off the job fails with dataset_disabled — a file for a screen the tenant cannot see is a way round the flag', async () => {
      const v = await svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: DAIRY_INSIGHTS_DATASET, params: { window: 90 } }, null);
      const r = await worker.tick(admin);
      expect(r.failed).toBe(1);
      const f = await svc.view(tenantA, deskActor, v.id);
      expect(f.status).toBe('failed'); expect(f.failure).toMatchObject({ code: 'dataset_disabled' });
    });
    it('with the flag on and no pours, the file is the window and a sentence — and the receipt names the three refused figures', async () => {
      await setFlag(INSIGHTS_FLAG, true);
      const v = await svc.enqueue(tenantA, deskActor, `k-${randomUUID()}`, { datasetCode: DAIRY_INSIGHTS_DATASET, params: { window: 30 } }, null);
      const r = await worker.tick(admin);
      expect(r.generated).toBe(1);
      const f = await svc.view(tenantA, deskActor, v.id);
      expect(f.status).toBe('ready');
      expect(f.receipt!.fileName).toMatch(/^dairy-insights-30d-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(f.receipt!.notes.some((n) => n.startsWith('payout streak: NOT in this file'))).toBe(true);
      expect(f.receipt!.notes.some((n) => n.startsWith('spoilage: NOT in this file'))).toBe(true);
      const key = (await admin.query(`SELECT storage_key FROM tenant_export_jobs WHERE id=$1`, [v.id])).rows[0].storage_key;
      const text = store.objects.get(key)!.toString('utf8');
      expect(text.split('\r\n')[0]).toBe('\uFEFFsection,metric,value,unit,basis,note');
      expect(text).toContain('history,state,no_data');
      expect(text.split('\r\n').filter((l) => l).length - 1).toBe(f.receipt!.rowCount);
      const ev = await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='exports.export_ready'`, [v.id]);
      expect(ev.rows[0].payload.dataset).toEqual({ en: 'dairy insights', hi: 'dairy insights (doodh sangrah ka saar)', gu: 'ડેરી ઇનસાઇટ્સ' });
    });
  });
});
