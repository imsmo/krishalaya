// core/exports-plane/dataset.registry.ts · the extension point (PC-56 TENANT-6e-2). The plane is generic plumbing — queue,
// worker, receipt, signed link, fetch log — and knows NOTHING about what is in a file. Each module registers a
// `DatasetProducer` for a dataset it owns (dairy registers `dairy.insights`); the worker resolves the producer by code
// and streams its rows into the CSV sink. Mirrors `BulkApplierRegistry` and the outbox-handler registry: modules
// register in `onModuleInit`, so core never imports a module.
import type { ZodTypeAny } from 'zod';
import type { LangMap } from '../i18n/lang-map';

export interface ProduceContext {
  tenantId: string;
  /** Who asked. A producer that needs an actor for its own read model gets the requester, never a system user. */
  requestedBy: string;
  /** The tenant's calendar day when the worker ran — for file names and "as of" notes; resolved by the worker, once. */
  today: string;
}

/** What the producer hands the worker: a header, an async stream of rows, and its notes. */
export interface DatasetFile {
  header: readonly string[];
  rows: AsyncIterable<ReadonlyArray<string | number | bigint | boolean | null | undefined>>;
  /** What the file ADMITS — refused figures, declared bounds, formatting facts. Printed on the receipt. A producer that
   *  refuses a figure MUST say so here: a spreadsheet missing a column invites somebody to compute it from the wrong ones. */
  notes: readonly string[];
  /** The stamp after the dataset code in the file name (`90d` → `dairy-insights-90d-<day>.csv`). */
  fileSuffix: string;
}

/** A producer that CANNOT honestly make the file says which of the plane's failure codes describes why. */
export type ProduceOutcome =
  | { kind: 'file'; file: DatasetFile }
  | { kind: 'refused'; code: 'dataset_disabled' | 'money_shape_missing'; detail: string };

export interface DatasetProducer<P = Record<string, unknown>> {
  /** The dataset code jobs carry (`dairy.insights`). Stable — it is in the queue table and the `ui_messages` key. */
  readonly code: string;
  /** The permission that reads the job, its receipt and its file — the same one that gates the SCREEN the export is of.
   *  `*` (god mode) passes as it does everywhere. */
  readonly permission: string;
  /** Strict zod schema for `params`; the enqueue validates and STORES the parsed value, so a job's params are canonical. */
  readonly params: ZodTypeAny & { _output: P };
  /** The dataset's name in every language the notice can be sent in (seed 0017 → `ui_messages`). Read at ready time. */
  datasetName(): Promise<LangMap>;
  /** Make the file. MUST NOT write anything; it is a read that happens to be long. */
  produce(ctx: ProduceContext, params: P): Promise<ProduceOutcome>;
}

export class DatasetRegistry {
  private readonly byCode = new Map<string, DatasetProducer<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any -- heterogeneous param types; each entry is typed at registration
  register<P>(p: DatasetProducer<P>): void {
    if (this.byCode.has(p.code)) throw new Error(`DatasetRegistry: duplicate dataset "${p.code}"`);
    this.byCode.set(p.code, p);
  }
  get(code: string): DatasetProducer<Record<string, unknown>> | undefined { return this.byCode.get(code); }
  has(code: string): boolean { return this.byCode.has(code); }
  codes(): string[] { return [...this.byCode.keys()]; }
}
export const DATASET_REGISTRY = Symbol('DATASET_REGISTRY');
