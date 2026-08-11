// core/bulk/bulk-applier.registry.ts · the extension point. core/bulk is generic plumbing (no business logic);
// each domain module registers a BulkRowApplier for the entity it owns (e.g. catalogue registers 'products').
// The processor resolves the applier by importType and applies each CSV row through it. Mirrors the outbox
// handler-registry pattern — modules register in onModuleInit, so core never imports a module.
export interface BulkApplyContext { tenantId: string; actorUserId: string; }

/**
 * What a validation pass concluded about ONE row (PC-56 TENANT-1b-4).
 *
 * **FOUR VERDICTS AND NOT TWO, BECAUSE W156's TRIAGE HAS FOUR COLUMNS.** "220 rows · 214 valid · 4 already members ·
 * 2 fixable" is not valid-versus-invalid: a row matching an existing member by phone is a SUCCESS that creates nothing
 * ("matched by phone — skipped, never duplicated"), while a row with a nine-digit phone is a row somebody must fix. Folding
 * those together would tell an operator that four of their members failed to import.
 */
export type RowVerdict =
  /** Would create. */
  | { kind: 'create' }
  /** Already exists — skipped, never duplicated. Carries the id so the console can link to the member. */
  | { kind: 'duplicate'; existingId: string | null }
  /** A human can correct this in the file. `suggestion` is a proposal, NEVER applied automatically. */
  | { kind: 'fixable'; code: string; message: string; suggestion?: string }
  /** Structurally unusable — a missing required column value, not something a suggestion fixes. */
  | { kind: 'invalid'; code: string; message: string };

export interface BulkRowApplier {
  /** The import_type this applier handles (e.g. 'products'). */
  readonly importType: string;
  /** Columns that MUST be present in the CSV header (validated before any row runs — fail closed). */
  readonly requiredColumns: string[];
  /**
   * Apply ONE row. MUST be idempotent w.r.t. rowIdemKey (the processor passes a deterministic per-row key so a
   * resumed/retried import never double-creates). Throw a typed error to mark the row failed; return the new id
   * on success. Money/tenant rules are enforced by the underlying module service the applier delegates to.
   */
  applyRow(ctx: BulkApplyContext, rowIdemKey: string, row: Record<string, string>): Promise<{ id?: string }>;

  /**
   * Judge ONE row WITHOUT writing anything (PC-56 TENANT-1b-4, W156's "validates every row first").
   *
   * **OPTIONAL, AND THAT IS A DELIBERATE COMPATIBILITY DECISION RATHER THAN LAZINESS.** An applier that cannot describe a
   * valid row cannot promise a validate-first pass, so the processor requires the confirm step only for appliers that
   * implement this. The pre-existing 'products' applier keeps its straight-through behaviour; 'members' — where the cost of
   * getting it wrong is 220 half-created people in a register — gets the triage its screen shows.
   *
   * MUST NOT WRITE. The processor calls it against the read replica's view of the world, and a validation pass with a side
   * effect would make the dry run the thing it was supposed to preview.
   */
  validateRow?(ctx: BulkApplyContext, rowIndex: number, row: Record<string, string>): Promise<RowVerdict>;
}

export class BulkApplierRegistry {
  private readonly byType = new Map<string, BulkRowApplier>();
  register(applier: BulkRowApplier): void {
    if (this.byType.has(applier.importType)) throw new Error(`duplicate bulk applier for "${applier.importType}"`);
    this.byType.set(applier.importType, applier);
  }
  get(importType: string): BulkRowApplier | undefined { return this.byType.get(importType); }
  has(importType: string): boolean { return this.byType.has(importType); }
  types(): string[] { return [...this.byType.keys()]; }
}
export const BULK_APPLIER_REGISTRY = Symbol('BULK_APPLIER_REGISTRY');
