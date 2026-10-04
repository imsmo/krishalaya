// apps/web-tenant/src/app/insights/reports/act/fields.ts · PC-56 TENANT-SW-f — what the confirm step SHOWED of the row an act changes, i.e.
// what verify-before-write re-reads and compares (W318 §3): a definition's identity, title, archive state; a schedule's state and shape.
export const DEF_FIELDS = ['id', 'title', 'datasetCode', 'archivedAt', 'updatedAt'] as const;
export const SCHED_FIELDS = ['id', 'active', 'nextRunAt', 'cadence', 'timeIst'] as const;
