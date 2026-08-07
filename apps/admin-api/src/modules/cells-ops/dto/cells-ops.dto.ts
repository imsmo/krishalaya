// apps/admin-api/src/modules/cells-ops/dto/cells-ops.dto.ts · zod .strict() request schemas (reject unknown keys
// → no mass-assignment). Every mutation carries a mandatory reason. Shapes are bounded here AND re-validated in
// the domain (defence in depth). dsn_secret_ref accepts ONLY a vault reference shape — never a raw connection
// string (and is never returned). No money in this plane.
import { z } from 'zod';
import { NODE_STATUSES } from '../domain/node.state';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).default(50);
const Uuid = z.string().uuid();
const CellCode = z.string().min(2).max(40).regex(/^[a-z][a-z0-9-]{1,39}$/);
const Name = z.string().min(1).max(150);
const Country = z.string().regex(/^[A-Za-z]{2}$/);
const Notes = z.string().max(2000).nullable().optional();
const Capacity = z.coerce.number().int().min(0).max(100_000_000).nullable().optional();
const ShardIndex = z.coerce.number().int().min(0).max(100_000);
const Weight = z.coerce.number().int().min(0).max(10_000);
const DsnRef = z.string().regex(/^[A-Za-z0-9:_\-/.]{1,200}$/).nullable().optional();
const Status = z.enum(NODE_STATUSES);

/* ---------------- cells ---------------- */
export const CreateCellSchema = z.object({
  code: CellCode,
  displayName: Name,
  countryCode: Country,
  isDefault: z.boolean().default(false),
  residencyLocked: z.boolean().default(true),
  capacityTenants: Capacity,
  notes: Notes,
  reason: Reason,
}).strict();
export type CreateCellDto = z.infer<typeof CreateCellSchema>;

export const UpdateCellSchema = z.object({
  displayName: Name.optional(),
  capacityTenants: Capacity,
  residencyLocked: z.boolean().optional(),
  notes: Notes,
  reason: Reason,
}).strict().refine((d) => ['displayName', 'capacityTenants', 'residencyLocked', 'notes'].some((k) => (d as Record<string, unknown>)[k] !== undefined), { message: 'at least one mutable field is required' });
export type UpdateCellDto = z.infer<typeof UpdateCellSchema>;

export const SetStatusSchema = z.object({ status: Status, reason: Reason }).strict();
export type SetStatusDto = z.infer<typeof SetStatusSchema>;

export const SetDefaultSchema = z.object({ isDefault: z.boolean(), reason: Reason }).strict();
export type SetDefaultDto = z.infer<typeof SetDefaultSchema>;

export const SetResidencyLockSchema = z.object({ residencyLocked: z.boolean(), reason: Reason }).strict();
export type SetResidencyLockDto = z.infer<typeof SetResidencyLockSchema>;

/* ---------------- shards ---------------- */
export const CreateShardSchema = z.object({
  cellId: Uuid,
  shardIndex: ShardIndex,
  weight: Weight.default(100),
  dsnSecretRef: DsnRef,
  notes: Notes,
  reason: Reason,
}).strict();
export type CreateShardDto = z.infer<typeof CreateShardSchema>;

export const UpdateShardSchema = z.object({
  weight: Weight.optional(),
  dsnSecretRef: DsnRef,
  notes: Notes,
  reason: Reason,
}).strict().refine((d) => ['weight', 'dsnSecretRef', 'notes'].some((k) => (d as Record<string, unknown>)[k] !== undefined), { message: 'at least one mutable field is required' });
export type UpdateShardDto = z.infer<typeof UpdateShardSchema>;

/* ---------------- placements ---------------- */
export const PlaceTenantSchema = z.object({
  tenantId: Uuid,
  cellId: Uuid,
  shardId: Uuid,
  pinned: z.boolean().default(false),
  reason: Reason,
}).strict();
export type PlaceTenantDto = z.infer<typeof PlaceTenantSchema>;

export const MoveTenantSchema = z.object({
  cellId: Uuid,
  shardId: Uuid,
  pinned: z.boolean().optional(),
  reason: Reason,
}).strict();
export type MoveTenantDto = z.infer<typeof MoveTenantSchema>;

export const RemovePlacementSchema = z.object({ reason: Reason }).strict();
export type RemovePlacementDto = z.infer<typeof RemovePlacementSchema>;

/* ---------------- queries ---------------- */
export const QueryCellsSchema = z.object({
  countryCode: Country.optional(),
  status: Status.optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryCellsDto = z.infer<typeof QueryCellsSchema>;

export const QueryShardsSchema = z.object({
  cellId: Uuid.optional(),
  status: Status.optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryShardsDto = z.infer<typeof QueryShardsSchema>;

export const QueryPlacementsSchema = z.object({
  cellId: Uuid.optional(),
  shardId: Uuid.optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryPlacementsDto = z.infer<typeof QueryPlacementsSchema>;

export const QueryChangesSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryChangesDto = z.infer<typeof QueryChangesSchema>;

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-8 · the TWELFTH maker-checker site                                                    */
/* ------------------------------------------------------------------------------------------------ */
//
// NO `observed` FIELD IS ACCEPTED FROM A CLIENT. The maker's observed state is read server-side from the row, because it
// is what the staleness check compares against — and a client that could supply it could supply a snapshot matching
// whatever it wanted applied, which defeats the whole point of storing one. Same rule as ADMIN-6b's preflight and
// ADMIN-7's fairness verdict: whatever a control depends on is computed, never supplied.

const mapReason = z.string().trim().min(20).max(2_000);

export const ProposeCellChangeSchema = z.object({
  action: z.enum(['status_changed', 'updated']),
  status: z.enum(['active', 'draining', 'readonly', 'retired']).optional(),
  // `null` is meaningful — it is "uncapped" — so `.nullable()` rather than `.optional()` alone.
  capacityTenants: z.number().int().min(0).max(100_000_000).nullable().optional(),
  isDefault: z.boolean().optional(),
  residencyLocked: z.boolean().optional(),
  reason: mapReason,
}).strict();
export type ProposeCellChangeDto = z.infer<typeof ProposeCellChangeSchema>;

export const ProposeShardChangeSchema = z.object({
  action: z.enum(['status_changed', 'updated']),
  status: z.enum(['active', 'draining', 'readonly', 'retired']).optional(),
  // 0 is the interesting value: W031's "weight 0 = drain (no new placements)", which until 0116 nothing enforced.
  weight: z.number().int().min(0).max(10_000).optional(),
  reason: mapReason,
}).strict();
export type ProposeShardChangeDto = z.infer<typeof ProposeShardChangeSchema>;

/** Applying takes NO BODY. The proposal is in the path, the approver is in the token, the staleness is re-checked
 *  server-side inside the transaction. There is nothing for a client to say and a great deal it could usefully lie about. */
export const ApplyProposalSchema = z.object({}).strict();
export type ApplyProposalDto = z.infer<typeof ApplyProposalSchema>;

export const RejectProposalSchema = z.object({ note: mapReason }).strict();
export type RejectProposalDto = z.infer<typeof RejectProposalSchema>;

export const QueryProposalsSchema = z.object({
  // Enum rather than a free string, so a typo returns 400 rather than an empty list — an operator filtering for "opn" and
  // seeing "no proposals" would conclude nothing was awaiting them.
  status: z.enum(['open', 'applied', 'rejected', 'stale']).optional(),
  entityType: z.enum(['cell', 'shard', 'placement']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type QueryProposalsDto = z.infer<typeof QueryProposalsSchema>;

export const QueryMapHistorySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  entityType: z.enum(['cell', 'shard', 'placement']).optional(),
  action: z.enum(['created', 'updated', 'status_changed', 'placed', 'moved', 'removed']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type QueryMapHistoryDto = z.infer<typeof QueryMapHistorySchema>;

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-8b · residency evidence, the migration pipeline, the plan, provisioning               */
/* ------------------------------------------------------------------------------------------------ */

export const QueryResidencySchema = z.object({
  days: z.coerce.number().int().min(1).max(400).optional(),
  country: z.string().length(2).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type QueryResidencyDto = z.infer<typeof QueryResidencySchema>;

export const AttestSchema = z.object({ days: z.coerce.number().int().min(1).max(400).optional() });
export type AttestDto = z.infer<typeof AttestSchema>;

export const SetCountryProfileSchema = z.object({
  profile: z.string().trim().min(3).max(40),
  status: z.enum(['none', 'draft', 'ratified']),
  note: z.string().trim().max(2_000).optional(),
}).strict();
export type SetCountryProfileDto = z.infer<typeof SetCountryProfileSchema>;

export const DraftMigrationSchema = z.object({
  tenantId: z.string().uuid(),
  // The SOURCE is read from the current placement, never supplied: a move built from what a form said rather than from
  // where the tenant actually is would be a move whose "from" could be wrong.
  toCellId: z.string().uuid(),
  toShardId: z.string().uuid(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  reason: z.string().trim().min(20).max(2_000),
}).strict();
export type DraftMigrationDto = z.infer<typeof DraftMigrationSchema>;

export const MigrationPreflightSchema = z.object({
  // NULLABLE ON PURPOSE. These come from cross-plane reads that can fail, and `null` means "the check did not run" —
  // which the domain reports as UNKNOWN and never as a pass. A schema that coerced a failed read to 0 would turn every
  // outage into a clean preflight.
  openPayouts: z.number().int().min(0).nullable(),
  liveAuctions: z.number().int().min(0).nullable(),
  outboxPending: z.number().int().min(0).nullable(),
  estimatedBytes: z.number().int().min(0).nullable(),
  windowBudgetBytes: z.number().int().min(0).nullable(),
}).strict();
export type MigrationPreflightDto = z.infer<typeof MigrationPreflightSchema>;

export const AdvanceMigrationSchema = z.object({
  to: z.enum(['copying', 'verifying', 'cutover', 'done', 'rolled_back', 'failed']),
  sourceRows: z.number().int().min(0).optional(),
  targetRows: z.number().int().min(0).optional(),
  // Money as STRINGS of minor units (Law 2). A ledger sum crossing as a number would be a verify that could pass on a
  // one-paisa difference in a very large figure.
  sourceLedgerMinor: z.string().regex(/^-?[0-9]{1,19}$/).optional(),
  targetLedgerMinor: z.string().regex(/^-?[0-9]{1,19}$/).optional(),
  rollbackReason: z.string().trim().max(2_000).optional(),
  failureDetail: z.string().trim().max(2_000).optional(),
  waived: z.array(z.object({
    check: z.string().max(40),
    // Per check, so "I waived the preflight" is never something anybody can do — the granularity IS the control.
    reason: z.string().trim().min(20).max(1_000),
  })).max(4).optional(),
}).strict();
export type AdvanceMigrationDto = z.infer<typeof AdvanceMigrationSchema>;

export const AddPlanStepSchema = z.object({
  cellId: z.string().uuid().optional(),
  targetCode: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).optional(),
  action: z.enum(['add_shards', 'provision_cell', 'raise_capacity', 'retire_cell']),
  addsCapacity: z.number().int().min(0).max(100_000_000).optional(),
  // A CONDITION, not a date. `{"kind":"utilisation","percent":70}` survives a slow quarter; a calendar entry goes stale.
  triggerSpec: z.record(z.unknown()).refine((v) => 'kind' in v, 'a trigger needs a kind'),
  status: z.enum(['draft', 'planned', 'gated']),
  gateReason: z.string().trim().max(2_000).optional(),
  notes: z.string().trim().max(2_000).optional(),
}).strict();
export type AddPlanStepDto = z.infer<typeof AddPlanStepSchema>;

export const StartProvisioningSchema = z.object({
  targetCode: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  countryCode: z.string().length(2),
}).strict();
export type StartProvisioningDto = z.infer<typeof StartProvisioningSchema>;

export const RecordSmokeSchema = z.object({
  outcome: z.enum(['passed', 'failed']),
  detail: z.record(z.unknown()).default({}),
}).strict();
export type RecordSmokeDto = z.infer<typeof RecordSmokeSchema>;
