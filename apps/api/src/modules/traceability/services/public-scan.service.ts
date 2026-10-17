// modules/traceability/services/public-scan.service.ts · the ANONYMOUS farm-to-fork QR read and its VERIFY read.
// No auth: possession of the unguessable qr_token is the capability. Reads via a SECURITY DEFINER function — the ONLY RLS-bypass path.
//
// PC-56 HOTFIX-7 · B10 (projection half) + B25 (survey STORE-5 F-8): live organisations only; meta allow-listed per step; the platform
// kill-switch refuses FIRST, then the lot's organisation's own `traceability` flag (OFF → TRACE_NOT_PUBLISHED — OFF is not "not found").
//
// PC-56 STORE-5b · B10 / B11 / D3 / D4 / D8 — THE PUBLIC TRACE, V3:
//   • the read is `trace_scan_v3` (migration 0219): the organisation, product, village/district, events with their HASHES and VERSIONS, the
//     seal and the lot's certificates; `publicLot` (domain/trace-public.ts) is the only door from that row to the answer;
//   • D8 — a lot whose organisation is NOT live: the function answers `{live:false, wasLive}` and nothing of the lot: WAS live (suspended,
//     archived, terminated, removed) → 404 TRACE_NO_LONGER_PUBLISHED (the page says "no longer published", noindex); never live (pending /
//     trial) → 404 TRACE_SCAN_NOT_FOUND (the HOTFIX-7 answer kept); an unknown token → TRACE_SCAN_NOT_FOUND;
//   • `verify` (B11): the same gate, then `verifyChain` (domain/trace-chain.ts) over the v3 events — per event `recomputed: ok | mismatch |
//     unverifiable_v1`, `chain: ok | broken_at` + `brokenAt`, the seal with `matchesHead`. Computed here, from the database's own text of each
//     instant (`atUs`) — never a client's.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { TraceLotRepository } from '../repositories/trace-lot.repository';
import { ScanNotFoundError, TraceNoLongerPublishedError, TraceNotPublishedError } from '../domain/traceability.errors';
import { publicLot, PublicLot } from '../domain/trace-public';
import { ChainEvent, verifyChain, VerifiedEvent } from '../domain/trace-chain';

const TOKEN_RE = /^[A-Za-z0-9_-]{6,40}$/;   // anchored — reject junk before touching the DB
export const TRACEABILITY_FLAG = 'traceability';

/** The public provenance (v3): the organisation, never a person; no uuid but the certificates' ids. */
export type PublicProvenance = PublicLot;

/** W304's answer: the chain, recomputed by the server. */
export interface PublicVerification {
  qrToken: string;
  organisation: { displayName: string; slug: string };
  events: VerifiedEvent[];
  chain: 'ok' | 'broken_at';
  brokenAt: number | null;
  v1Count: number;
  anchor: { value: string | null; anchoredAt: string | null; anchoredEventCount: number | null; matchesHead: boolean };
  /** the formula version the page prints */
  formula: 'v2';
}

/** A LIVE v3 row, the gate passed (the service's own; never leaves the module). */
export interface LiveTraceRow { row: Record<string, unknown>; tenantId: string; lotId: string }

@Injectable()
export class PublicScanService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly flags: FlagsService,
    private readonly lots: TraceLotRepository,
  ) {}

  /** THE GATE every public read (and the export) passes: the platform kill-switch, the token's shape, the row, the organisation live, the
   *  organisation's own flag. Throws the named refusal; answers the live row. */
  async liveRow(qrToken: string): Promise<LiveTraceRow> {
    if (await this.flags.isKillSwitched(TRACEABILITY_FLAG)) throw new TraceNotPublishedError();   // platform-wide OFF — nothing is read
    if (!TOKEN_RE.test(qrToken)) throw new ScanNotFoundError();
    const row = await this.uow.run('', (tx) => this.lots.scan(tx, qrToken));   // RLS-bypass via trace_scan_v3()
    if (!row) throw new ScanNotFoundError();                                     // an unknown token
    if (row.live === false) {                                                    // D8: the lot exists, its organisation is not live
      if (row.wasLive === true) { this.metrics.inc('trace.scan_no_longer_published'); throw new TraceNoLongerPublishedError(); }
      throw new ScanNotFoundError();                                             // never live (pending / trial): nothing was ever published
    }
    const tenantId = typeof row.tenantId === 'string' ? row.tenantId : null;
    const lotId = typeof row.lotId === 'string' ? row.lotId : null;
    if (!tenantId || !lotId || !(await this.flags.isEnabled(TRACEABILITY_FLAG, { tenantId }))) {
      this.metrics.inc('trace.scan_not_published');
      throw new TraceNotPublishedError();
    }
    return { row, tenantId, lotId };
  }

  async scan(qrToken: string): Promise<PublicProvenance> {
    this.metrics.inc('trace.scan');
    const { row } = await this.liveRow(qrToken);
    return publicLot(row);
  }

  async verify(qrToken: string): Promise<PublicVerification> {
    this.metrics.inc('trace.verify');
    const { row, lotId } = await this.liveRow(qrToken);
    const v = verificationOf(row, lotId);
    if (v.chain !== 'ok') this.metrics.inc('trace.verify_mismatch');
    return v;
  }
}

/** PURE: the v3 events as the chain walk reads them (the SQL-filtered meta — what the API hashed — never the re-judged public meta). */
export function chainEventsOf(row: Record<string, unknown>): ChainEvent[] {
  const events = Array.isArray(row.events) ? (row.events as Array<Record<string, unknown>>) : [];
  return events.map((e, i) => ({
    no: typeof e.no === 'number' ? e.no : Number(e.no ?? i + 1),
    eventCode: String(e.eventCode ?? ''),
    at: typeof e.at === 'string' ? e.at : String(e.at ?? ''),
    atUs: String(e.atUs ?? ''),
    hashVersion: Number(e.hashVersion ?? 1),
    eventHash: typeof e.eventHash === 'string' ? e.eventHash : null,
    meta: e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta) ? (e.meta as Record<string, unknown>) : {},
    metaHidden: e.metaHidden === true,
  }));
}

/** PURE: the live v3 row → W304's answer. */
export function verificationOf(row: Record<string, unknown>, lotId: string): PublicVerification {
  const anchor = (row.anchor ?? {}) as Record<string, unknown>;
  const org = (row.organisation ?? {}) as Record<string, unknown>;
  const v = verifyChain(lotId, chainEventsOf(row), {
    value: typeof anchor.value === 'string' ? anchor.value : null,
    anchoredAt: typeof anchor.anchoredAt === 'string' ? anchor.anchoredAt : null,
    anchoredEventCount: anchor.anchoredEventCount == null ? null : Number(anchor.anchoredEventCount),
  });
  return {
    qrToken: String(row.qrToken ?? ''),
    organisation: { displayName: typeof org.displayName === 'string' ? org.displayName : '', slug: typeof org.slug === 'string' ? org.slug : '' },
    events: v.events, chain: v.chain, brokenAt: v.brokenAt, v1Count: v.v1Count, anchor: v.anchor, formula: 'v2',
  };
}
