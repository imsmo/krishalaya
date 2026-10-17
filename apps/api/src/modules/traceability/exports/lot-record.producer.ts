// modules/traceability/exports/lot-record.producer.ts · PC-56 STORE-5b · D2 (founder Q13) — "Download the record": ONE trace lot's journey as a
// CSV on the export plane, for the signed-in person who asked, with the plane's audit receipt (sha256, rows, generated-at, "You", a 15-minute
// link, every fetch logged — the plane's, unchanged).
//
// Dataset `traceability.lot_record` — a REQUESTER-ONLY dataset (`requesterOnly: true`, the plane's one rule: the job, receipt, link and
// download are readable by the person who asked and by nobody else, from whichever organisation their session is in; not behind
// `tenant_exports`). Enqueued ONLY by `TraceExportService.request` (`POST /v1/traceability/scan/:qrToken/export`); the plane's generic enqueue
// refuses it. The job's tenant is the requester's SESSION tenant (the 4a rule) — the lot may belong to another organisation, so `produce` never
// reads a tenant-scoped repository: it reads through `trace_scan_v3` (SECURITY DEFINER) and the same gate as the public page (the organisation
// live, its `traceability` flag ON) at the time the file is made.
//
// THE FILE: header `event_no, event_code, at, hash_version, event_hash, prev_hash, meta_json, recomputed`; one row per event — `at` is the
// instant the v2 hash covers (YYYY-MM-DDTHH:MM:SS.ffffffZ, UTC), `prev_hash` the previous event's stored hash (the FIRST event's is the lot's
// own id — the chain's genesis, so the file is recomputable end to end), `meta_json` the event's PUBLIC meta as canonical JSON, `recomputed`
// the server's verdict (ok | mismatch | unverifiable_v1); then ONE trailer row `seal` with the seal's value, `anchored_at`, and
// `{anchoredEventCount, anchoredHead, chain, brokenAt}`. CSV, NOT JSON (a DELTA named on W3155); NOT SIGNED (no signing key exists — the
// receipt's sha256 is the integrity; "signed record" is refused by name). No person, no money, no declared inputs.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { canonicalJson } from '../../../shared/hash/canonical-json';
import { TraceLotRepository } from '../repositories/trace-lot.repository';
import { publicMeta } from '../domain/trace-meta';
import { chainEventsOf, TRACEABILITY_FLAG } from '../services/public-scan.service';
import { verifyChain } from '../domain/trace-chain';

export const LOT_RECORD_DATASET = 'traceability.lot_record';
export const LOT_RECORD_DATASET_NAME_KEY = `exports.dataset.${LOT_RECORD_DATASET}`;
export const LOT_RECORD_HEADER = ['event_no', 'event_code', 'at', 'hash_version', 'event_hash', 'prev_hash', 'meta_json', 'recomputed'] as const;
/** A permission nobody is granted: a requester-only job is read by its requester (the plane's rule), never through a tenant verb. */
export const LOT_RECORD_SELF_PERMISSION = 'traceability.record_self';

export const LotRecordParamsSchema = z.object({ qrToken: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/) }).strict();
export type LotRecordParams = z.infer<typeof LotRecordParamsSchema>;

type Cell = string | number | null;

/** PURE: the v3 row (a LIVE lot) → the file's rows (events + the seal trailer). Unit-tested. */
export function lotRecordRows(row: Record<string, unknown>, lotId: string): Cell[][] {
  const events = chainEventsOf(row);
  const anchor = (row.anchor ?? {}) as Record<string, unknown>;
  const v = verifyChain(lotId, events, {
    value: typeof anchor.value === 'string' ? anchor.value : null,
    anchoredAt: typeof anchor.anchoredAt === 'string' ? anchor.anchoredAt : null,
    anchoredEventCount: anchor.anchoredEventCount == null ? null : Number(anchor.anchoredEventCount),
  });
  const rows: Cell[][] = events.map((e, i) => [
    e.no, e.eventCode, e.atUs, e.hashVersion, e.eventHash, i === 0 ? lotId : events[i - 1].eventHash,
    canonicalJson(publicMeta(e.eventCode, e.meta)), v.events[i].recomputed,
  ]);
  rows.push(['seal', '', v.anchor.anchoredAt, '', v.anchor.value, '',
    canonicalJson({ anchoredEventCount: v.anchor.anchoredEventCount, anchoredHead: v.anchor.matchesHead, chain: v.chain, brokenAt: v.brokenAt }),
    v.anchor.value === null ? 'unsealed' : v.anchor.matchesHead ? 'head' : 'stale']);
  return rows;
}

/** What the receipt ADMITS (the plane prints notes on the receipt). */
export function lotRecordNotes(eventCount: number, v1Count: number): string[] {
  const notes = [
    `one row per journey event (${eventCount}), then one "seal" row: the platform's daily seal of the chain head (a platform seal, not a public ledger)`,
    'version 2: event_hash = sha256(prev_hash|lot|event_code|canonical meta_json|at); the first event chains off the lot (its prev_hash)',
    'not signed — the receipt\'s sha256 is the integrity; CSV, not JSON',
    'no person, no money, no declared inputs: the organisation recorded this journey',
  ];
  if (v1Count > 0) notes.push(`${v1Count} event(s) written before version 2 — not recomputable from the stored record (unverifiable_v1)`);
  return notes;
}

@Injectable()
export class LotRecordDataset implements DatasetProducer<LotRecordParams> {
  readonly code = LOT_RECORD_DATASET;
  readonly permission = LOT_RECORD_SELF_PERMISSION;
  readonly requesterOnly = true;
  readonly params = LotRecordParamsSchema;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly flags: FlagsService,
    private readonly lots: TraceLotRepository,
    private readonly uiMessages: UiMessageRepository,
  ) {}

  datasetName(): Promise<LangMap> { return this.uiMessages.map(LOT_RECORD_DATASET_NAME_KEY); }

  async produce(ctx: ProduceContext, params: LotRecordParams): Promise<ProduceOutcome> {
    // the same gate as the public page, at the time the file is made (the organisation may have gone dark since the request)
    if (await this.flags.isKillSwitched(TRACEABILITY_FLAG)) return { kind: 'refused', code: 'dataset_disabled', detail: 'farm-to-fork traces are switched off' };
    const row = await this.uow.run(ctx.tenantId, (tx) => this.lots.scan(tx, params.qrToken), { userId: ctx.requestedBy });
    if (!row || row.live !== true || typeof row.lotId !== 'string' || typeof row.tenantId !== 'string') {
      return { kind: 'refused', code: 'dataset_disabled', detail: 'this trace is not published' };
    }
    if (!(await this.flags.isEnabled(TRACEABILITY_FLAG, { tenantId: row.tenantId }).catch(() => false))) {
      return { kind: 'refused', code: 'dataset_disabled', detail: 'this organisation has not published farm-to-fork traces' };
    }
    const rows = lotRecordRows(row, row.lotId);
    const events = rows.length - 1;
    const v1 = rows.filter((r) => r[7] === 'unverifiable_v1').length;
    return {
      kind: 'file',
      file: {
        header: LOT_RECORD_HEADER,
        rows: (async function* () { for (const r of rows) yield r; })(),
        notes: lotRecordNotes(events, v1),
        fileSuffix: 'record',
      },
    };
  }
}
