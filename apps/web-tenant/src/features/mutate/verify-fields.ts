// apps/web-tenant/src/features/mutate/verify-fields.ts · PC-56 TENANT-SW-f · W318 §3 — WHAT EACH SWEEP-WAVE ACT'S CONFIRM STEP SHOWED of the
// row it changes: the fields verify-before-write carries (`kv_seen`) and re-reads before the server action writes. One list per act, used
// by BOTH the confirm page (seenToken) and the action (verifyBeforeWrite), so the two can never compare different things. A field that
// moves on every read (a counter of minutes, a computed "now") is never listed — it would make every confirm stale.
export const VERIFY_FIELDS = {
  // SW-a
  commissionProposal: ['id', 'status', 'confirmedBy', 'refusedBy', 'expiresAt'],
  commissionPolicy: ['platformShareBps', 'earliestEffectiveFrom', 'noticeDays'],
  zoneProposal: ['id', 'status', 'confirmedBy', 'refusedBy', 'chargeDefinitionId'],
  deliveryZone: ['id', 'isActive', 'chargeDefinitionId'],
  podReview: ['id', 'status', 'rejectProposedBy', 'reviewerUserId', 'varianceMinor', 'disputeId'],
  codShortfall: ['id', 'status', 'amountMinor', 'collectedAt'],
  cashDay: ['id', 'status', 'closedAt'],
  // SW-b
  ambassador: ['id', 'isActive', 'owedMinor', 'tierId'],
  ambassadorRun: ['id', 'status', 'preparedBy', 'confirmedBy', 'totalMinor', 'lineCount'],
  attendanceTiles: ['clean', 'needsReview', 'paperBackfill'],
  advanceCap: ['assignmentId', 'capMinor', 'expectedWageMinor'],
  wageAdvance: ['id', 'status', 'amountMinor'],
  schemeSweep: ['scheme.code', 'scheme.version', 'scheme.isActive', 'sweeps.0.id'],
  // SW-c
  kycDoc: ['document.id', 'document.status', 'document.docTypeCode'],
  invite: ['id', 'status', 'roleCode', 'expiresAt', 'revokedAt'],
  staff: ['userId', 'suspended', 'sessionCutoffAt', 'assignments', 'overrides', 'proposals', 'conflicts.length'],
  // SW-d
  registerImport: ['id', 'status', 'proposedBy', 'confirmedBy', 'rejectedBy', 'validCount', 'errorCount'],
  agmPack: ['id', 'status', 'issuedBy', 'confirmedBy', 'documentId', 'contentSha256', 'supersededBy'],
  // SW-e
  carrier: ['id', 'isActive', 'statusReason', 'scope'],
  breach: ['id', 'acknowledgedAt', 'actionAt', 'outcome', 'closedAt'],
  routeRun: ['id', 'status'],
  dropPoint: ['id', 'active'],
  slotProposal: ['id', 'status', 'expiresAt'],
} as const satisfies Record<string, readonly string[]>;
export type VerifyAct = keyof typeof VERIFY_FIELDS;
