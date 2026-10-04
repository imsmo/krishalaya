// modules/logistics/services/cold-chain-ingest.service.ts · PC-56 TENANT-SW-e · F-13 — THE DEVICE INGEST ROUTE (founder decision
// DEVICE-AUTHENTICATED INGEST). The first HTTP ingest surface on this platform: before it, kv_ingest was a NOLOGIN role with grants
// for mandi/weather pipelines and no door.
//
// THE SCHEME (each request):
//   headers  X-KV-Device    the logger's id (a twin_devices row of kind cold_chain_logger)
//            X-KV-Timestamp unix seconds at signing — refused outside ±5 minutes of the server clock (stale / future)
//            X-KV-Nonce     16–64 [A-Za-z0-9_-], once per device — the nonce row (PRIMARY KEY device, nonce) is the replay wall
//            X-KV-Signature v1=<hex HMAC-SHA256(key, `${timestamp}.${nonce}.${raw body}`)>, compared in constant time
//   body     { tempC, humidityPct?, recordedAt (the device's own time; buffered readings keep it), sequenceNo? }
//
// THE KEY: per device, 32 random bytes, issued and SHOWN ONCE on the console, stored sealed with 13a's envelope (AES-256-GCM data
// key under the platform KEK, additional data `device_key:<id>`); one active key per device; the key also binds the SUBJECT the
// logger is mounted on — the body never names a subject, a band or a time of record.
//
// THE ROLE: a dedicated pool that logs in as kv_ingest (INGEST_DATABASE_URL). kv_ingest can do exactly three things (0201): call
// `kv_ingest_device_key` (the tenant, the sealed key and the subject of a device id — nothing else), insert a nonce, insert the
// device columns of a reading. Everything else — the band, the time of record, the excursion flag, the breach, the alert, the
// logger's last reading — the database does in the same transaction. Not configured → 503 COLD_CHAIN_INGEST_NOT_CONFIGURED
// (fail closed; never kv_app). NEVER LOGGED: the key, the signature, the body.
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../../../core/config/app-config';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { openEnvelope, resolveKek } from '../../../core/secrets/secret-envelope';
import { ColdChainIngestRefusedError } from '../domain/logistics.errors';
import { ingestFreshness, readIngestHeaders, verifyIngestSignature } from '../domain/logistics-ops';
import { DeviceReadingSchema } from '../dto/cold-chain.dto';

export const COLD_CHAIN_INGEST_FLAG = 'cold_chain_device_ingest';
export const COLD_CHAIN_INGEST_POOL = Symbol('COLD_CHAIN_INGEST_POOL');

/** The kv_ingest pool, or null when INGEST_DATABASE_URL is not set (the route then answers 503). Lazy: no socket at construction. */
export function ingestPoolFactory(config: AppConfig): Pool | null {
  const { databaseUrl, poolMax } = config.ingest;
  return databaseUrl ? new Pool({ connectionString: databaseUrl, max: poolMax, application_name: 'kv-cold-chain-ingest' }) : null;
}

export interface IngestResult { accepted: true; duplicate: boolean; serverRecordedAt: string | null }

@Injectable()
export class ColdChainIngestService implements OnModuleDestroy {
  private readonly log = new Logger(ColdChainIngestService.name);
  private readonly kek: Buffer;
  constructor(
    @Inject(COLD_CHAIN_INGEST_POOL) private readonly pool: Pool | null,
    config: AppConfig,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);
  }
  async onModuleDestroy() { await this.pool?.end().catch(() => undefined); }

  private refuse(code: string, status: number, message: string): never {
    this.metrics.inc('logistics.cold_chain_ingest_refused', { code });
    throw new ColdChainIngestRefusedError(code, status, message);
  }

  async ingest(headers: Record<string, string | string[] | undefined>, rawBody: string, now = Date.now()): Promise<IngestResult> {
    if (!this.pool) this.refuse('COLD_CHAIN_INGEST_NOT_CONFIGURED', 503, 'The device ingest route is not configured on this deployment');
    const h = readIngestHeaders(headers);
    if (!h.ok) this.refuse(h.code, 401, 'A signed device request carries X-KV-Device, X-KV-Timestamp, X-KV-Nonce and X-KV-Signature');
    const fresh = ingestFreshness(Number(h.ts), now);
    if (fresh !== 'fresh') this.refuse(fresh === 'stale' ? 'INGEST_STALE' : 'INGEST_FUTURE', 401, 'The signed timestamp is more than 5 minutes from the server clock');
    const client = await (this.pool as Pool).connect();
    try {
      await client.query('BEGIN');
      const k = (await client.query(`SELECT tenant_id, key_id, key_enc, subject_type, subject_id, device_status, device_kind FROM kv_ingest_device_key($1::uuid)`, [h.deviceId])).rows[0] as
        { tenant_id: string; key_id: string; key_enc: string; subject_type: string; subject_id: string; device_status: string; device_kind: string } | undefined;
      // one answer for "no such device", "no active key" and "bad signature": a prober learns nothing about which ids exist
      if (!k || k.device_status !== 'registered' || k.device_kind !== 'cold_chain_logger') this.refuse('INGEST_SIGNATURE_INVALID', 401, 'The signature does not verify');
      let key: string;
      try { key = openEnvelope(this.kek, k.key_enc, `device_key:${k.key_id}`); } catch { this.refuse('INGEST_SIGNATURE_INVALID', 401, 'The signature does not verify'); }
      if (!verifyIngestSignature(key, h.ts, h.nonce, rawBody, h.signature)) this.refuse('INGEST_SIGNATURE_INVALID', 401, 'The signature does not verify');
      // the device is who it says; now the flag (per tenant) and the body
      if (!(await this.flags.isEnabled(COLD_CHAIN_INGEST_FLAG, { tenantId: k.tenant_id }).catch(() => false))) this.refuse('COLD_CHAIN_INGEST_OFF', 404, 'Not found');
      let body: unknown;
      try { body = JSON.parse(rawBody); } catch { this.refuse('INGEST_BODY_INVALID', 422, 'The body is not JSON'); }
      const parsed = DeviceReadingSchema.safeParse(body);
      if (!parsed.success) this.refuse('INGEST_BODY_INVALID', 422, 'The body is {tempC, humidityPct?, recordedAt, sequenceNo?}');
      const d = parsed.data;
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [k.tenant_id]);
      // THE REPLAY WALL: the nonce, once per device, in the reading's own transaction
      try {
        await client.query(`INSERT INTO cold_chain_ingest_nonces (device_id, nonce, tenant_id, signed_at) VALUES ($1,$2,$3, to_timestamp($4))`, [h.deviceId, h.nonce, k.tenant_id, Number(h.ts)]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') this.refuse('INGEST_REPLAY', 409, 'This signed request was already received (nonce reused)');
        throw e;
      }
      await client.query('SAVEPOINT reading');
      try {
        await client.query(
          `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, humidity_pct, recorded_at, source, device_id, sequence_no)
           VALUES ($1,$2,$3,$4,$5,$6,'device',$7,$8)`,
          [k.tenant_id, k.subject_type, k.subject_id, d.tempC, d.humidityPct ?? null, d.recordedAt, h.deviceId, d.sequenceNo ?? null]);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT reading');
        // the same reading re-sent after a lost answer (same device, sequence and time): accepted once, idempotently
        if ((e as { code?: string }).code === '23505' && /uq_ccl_device_seq/.test(String((e as Error).message))) {
          await client.query('COMMIT');
          return { accepted: true, duplicate: true, serverRecordedAt: null };
        }
        const m = /\[([A-Z][A-Z0-9_]{2,60})\]/.exec(String((e as Error).message ?? ''));
        if (m) this.refuse(m[1], 422, 'The database refused this reading');
        throw e;
      }
      await client.query('COMMIT');
      this.metrics.inc('logistics.cold_chain_ingest_accepted', {});
      return { accepted: true, duplicate: false, serverRecordedAt: new Date().toISOString() };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!(e instanceof ColdChainIngestRefusedError)) this.log.error(`cold-chain ingest failed: ${(e as Error).message}`);   // never the body, key or signature
      throw e;
    } finally { client.release(); }
  }
}
