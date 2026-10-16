// modules/traceability/services/public-scan.service.ts · the ANONYMOUS farm-to-fork QR read.
// No auth: possession of the unguessable qr_token IS the capability. Reads via a SECURITY DEFINER function — the ONLY RLS-bypass path.
//
// PC-56 HOTFIX-7 · B10 (projection half) + B25 (survey STORE-5 F-8) — THE PUBLIC TRACE, V2:
//   • the read is `trace_scan_v2` (migration 0217): NULL unless the lot's organisation is publicly live (`public_tenant_live` — a trial or
//     suspended organisation's lot answers 404 like an unknown token); meta keys allow-listed per step; the organisation's display name; no
//     listingId / declaredInputs / certificateIds;
//   • the flag: a platform-wide kill-switch refuses FIRST, before any row is read (TRACE_NOT_PUBLISHED); then the row is read and `traceability`
//     is asked WITH the lot's tenant — OFF for that organisation → 404 TRACE_NOT_PUBLISHED (a named reason: OFF is not "not found"; an unknown
//     token stays TRACE_SCAN_NOT_FOUND);
//   • the answer: `tenantId` is consumed for the flag and STRIPPED; every event's meta is re-filtered by each key's VALUE rule
//     (domain/trace-meta.ts `publicMeta` — the SQL keeps keys, values are judged here: a phone hidden in a "variety" is dropped).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { TraceLotRepository } from '../repositories/trace-lot.repository';
import { ScanNotFoundError, TraceNotPublishedError } from '../domain/traceability.errors';
import { publicMeta } from '../domain/trace-meta';

const TOKEN_RE = /^[A-Za-z0-9_-]{6,40}$/;   // anchored — reject junk before touching the DB
export const TRACEABILITY_FLAG = 'traceability';

/** The public provenance (v2): the organisation, never a person; no uuid. */
export interface PublicProvenance {
  qrToken: string; organisation: { displayName: string }; createdAt: string; anchored: boolean;
  events: Array<{ eventCode: string; at: string; meta: Record<string, string | number> }>;
}

@Injectable()
export class PublicScanService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly flags: FlagsService,
    private readonly lots: TraceLotRepository,
  ) {}

  async scan(qrToken: string): Promise<PublicProvenance> {
    if (await this.flags.isKillSwitched(TRACEABILITY_FLAG)) throw new TraceNotPublishedError();   // platform-wide OFF — nothing is read
    if (!TOKEN_RE.test(qrToken)) throw new ScanNotFoundError();
    this.metrics.inc('trace.scan');
    const row = await this.uow.run('', (tx) => this.lots.scan(tx, qrToken));   // RLS-bypass via trace_scan_v2()
    if (!row) throw new ScanNotFoundError();                                     // unknown token, or the organisation is not live
    const tenantId = typeof row.tenantId === 'string' ? row.tenantId : null;
    if (!tenantId || !(await this.flags.isEnabled(TRACEABILITY_FLAG, { tenantId }))) {
      this.metrics.inc('trace.scan_not_published');
      throw new TraceNotPublishedError();
    }
    return toPublic(row);
  }
}

/** PURE: the v2 row → the public answer (tenantId dropped; meta re-judged per key). */
export function toPublic(row: Record<string, unknown>): PublicProvenance {
  const org = (row.organisation ?? {}) as { displayName?: unknown };
  const events = Array.isArray(row.events) ? (row.events as Array<Record<string, unknown>>) : [];
  return {
    qrToken: String(row.qrToken ?? ''),
    organisation: { displayName: typeof org.displayName === 'string' ? org.displayName : '' },
    createdAt: String(row.createdAt ?? ''),
    anchored: row.anchored === true,
    events: events.map((e) => ({ eventCode: String(e.eventCode ?? ''), at: String(e.at ?? ''), meta: publicMeta(String(e.eventCode ?? ''), e.meta) })),
  };
}
