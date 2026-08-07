// apps/web-admin/src/features/cells/map-approval.ts · W029–W036 view logic, PURE (PC-56 ADMIN-8).
//
// Every function maps a server field to a class name or an i18n KEY. No text here: web-admin is EN-only today and will
// not always be, and a string returned from a formatter is a string no translator will ever find.

/* ------------------------------------------------------------------------------------------------ */
/* THE PROPOSAL                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

export type ProposalStatus = 'open' | 'applied' | 'rejected' | 'stale';

export function proposalClass(s: string): string {
  switch (s) {
    // OPEN IS A WARNING, not a neutral note. On this screen an unsigned proposal is a routing change somebody is waiting
    // on — and one of them could be "drain the default cell", which stops a country's onboarding.
    case 'open': return 'kv-badge is-warn';
    case 'applied': return 'kv-badge is-ok';
    case 'rejected': return 'kv-badge';
    // STALE IS DANGER rather than neutral: it means somebody wrote a change against a world that has moved, and the
    // interesting question is what moved.
    case 'stale': return 'kv-badge is-danger';
    default: return 'kv-badge';
  }
}

export function proposalKey(s: string): string {
  const known = ['open', 'applied', 'rejected', 'stale'];
  return known.includes(s) ? `cm.status.${s}` : 'cm.status.unknown';
}

export type ApprovalKind = 'approvable' | 'needs_other_operator' | 'already' | 'stale';

/** MAKER-CHECKER BY ABSENCE. The Apply control is not drawn unless the state is `approvable`.
 *
 *  A disabled Apply teaches an operator that they nearly have the right to authorise their own topology change; an absent
 *  one beside a line naming the rule teaches them to find a colleague. Standing doctrine, and this is the twelfth site it
 *  applies to. */
export function showApply(kind: string): boolean { return kind === 'approvable'; }

/** Reject is shown in every state a rejection is legal from — so every kind except `already`. Notably it IS shown to the
 *  maker: refusing your own proposal is withdrawing it, and needing a colleague to help you stop a routing change would
 *  make the safe action the expensive one. */
export function showReject(kind: string): boolean { return kind !== 'already'; }

/** The Mark-stale control appears only when the server says the proposal IS stale — it is not a way of dismissing a
 *  proposal one disagrees with, which is what Reject is for, and conflating them would let somebody bury a colleague's
 *  change without writing a reason. */
export function showMarkStale(kind: string): boolean { return kind === 'stale'; }

export function approvalNoticeKey(kind: string): string {
  const known = ['approvable', 'needs_other_operator', 'already', 'stale'];
  return known.includes(kind) ? `cm.approval.${kind}` : 'cm.approval.unknown';
}

export function approvalNoticeClass(kind: string): string {
  switch (kind) {
    case 'stale': return 'kv-note is-danger';
    case 'needs_other_operator': return 'kv-note is-warn';
    default: return 'kv-note';
  }
}

/** Why a proposal is stale. `entity_missing` and `observed_changed` send an operator to different places: one means the
 *  cell or shard is gone, the other means somebody else changed the fields this proposal is about. */
export function stalenessKey(s: { stale: boolean; reason?: string } | null | undefined): string | null {
  if (!s || !s.stale) return null;
  if (s.reason === 'entity_missing') return 'cm.stale.missing';
  if (s.reason === 'observed_changed') return 'cm.stale.changed';
  return 'cm.stale.other';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DIFF A CHECKER READS                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/** W035 renders the change as `- "capacity_tenants": 1800 / + "capacity_tenants": 2000`.
 *
 *  Values are stringified through JSON so `null` renders as `null` rather than as an empty cell — on this map `null`
 *  capacity means UNCAPPED, which is the opposite of "no value", and a blank would read as the second. */
export function diffText(v: unknown): string {
  if (v === undefined) return '(not recorded)';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return '(unreadable)'; }
}

/** Which fields in a diff are the consequential ones, so the console can lead with them.
 *
 *  `status` and `isDefault` first, because those two decide whether a region accepts tenants at all — and a diff listing
 *  `notes` above `status` would bury the sentence that matters in the one that does not. */
const FIELD_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  status: 0, isDefault: 1, residencyLocked: 2, weight: 3, capacityTenants: 4,
});

export function orderDiff<T extends { field: string }>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => {
    const wa = FIELD_WEIGHT[a.field] ?? 50;
    const wb = FIELD_WEIGHT[b.field] ?? 50;
    return wa !== wb ? wa - wb : a.field.localeCompare(b.field);
  });
}

/** Is this a field whose change should be drawn as consequential? */
export function fieldIsCritical(field: string): boolean {
  return field === 'status' || field === 'isDefault' || field === 'residencyLocked';
}

/* ------------------------------------------------------------------------------------------------ */
/* W035 · THE CHANGE LOG                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export function actionKey(a: string): string {
  const known = ['created', 'updated', 'status_changed', 'placed', 'moved', 'removed'];
  return known.includes(a) ? `cm.action.${a}` : 'cm.action.other';
}

export function entityKey(e: string): string {
  const known = ['cell', 'shard', 'placement'];
  return known.includes(e) ? `cm.entity.${e}` : 'cm.entity.other';
}

/** `moved` is drawn as consequential: it is a tenant's live data relocating between physical stacks. `placed` and
 *  `removed` are ordinary traffic. */
export function actionClass(a: string): string {
  if (a === 'moved') return 'kv-badge is-warn';
  if (a === 'status_changed') return 'kv-badge is-info';
  return 'kv-badge';
}

/* ------------------------------------------------------------------------------------------------ */
/* W036 · CAPACITY                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export type Headroom = { known: true; percent: number; placed: number; capacity: number } | { known: false; reason: string };

/** The headroom bar's class. Thresholds mirror the server's plan trigger so one screen cannot call comfortable what
 *  another flags for a scale plan. */
export function headroomClass(h: Headroom, triggerPercentUsed: number): string {
  // UNCAPPED IS NOT "PLENTY". An uncapped cell has no headroom to report and no guard protecting it, which is a different
  // condition from a roomy one — drawing it green would say the opposite of what it means.
  if (!h.known) return 'kv-badge';
  const used = 100 - h.percent;
  if (used >= 90) return 'kv-badge is-danger';
  if (used >= triggerPercentUsed) return 'kv-badge is-warn';
  return 'kv-badge is-ok';
}

export function headroomText(h: Headroom): { text: string; unknownKey: string | null } {
  if (h.known) return { text: `${h.percent}%`, unknownKey: null };
  return { text: '—', unknownKey: h.reason === 'uncapped' ? 'cm.headroom.uncapped' : 'cm.headroom.noCapacity' };
}

export type Rate = { known: true; perWeek: number; windowWeeks: number; sample: number } | { known: false; reason: string };

/** The growth rate. NULL-shaped when there is no history — and "nobody joined" and "we have no history" are the same
 *  number and different findings, so the second must not render as `+0/week`. */
export function rateText(r: Rate): { text: string; unknownKey: string | null } {
  if (!r.known) return { text: '—', unknownKey: 'cm.rate.noHistory' };
  const sign = r.perWeek > 0 ? '+' : '';
  return { text: `${sign}${r.perWeek}/week`, unknownKey: null };
}

/** A SHRINKING cell is drawn as a note rather than as good news: tenants leaving is a churn signal, and a capacity screen
 *  that painted it green would be the wrong screen to learn it from. */
export function rateClass(r: Rate): string {
  if (!r.known) return 'kv-badge';
  if (r.perWeek < 0) return 'kv-badge is-warn';
  return 'kv-badge';
}

export type TimeToFull = { known: true; weeks: number } | { known: false; reason: string };

export function weeksToFullText(t: TimeToFull): { text: string; unknownKey: string | null } {
  if (t.known) return { text: String(t.weeks), unknownKey: null };
  switch (t.reason) {
    case 'uncapped': return { text: '—', unknownKey: 'cm.full.uncapped' };
    case 'already_full': return { text: '0', unknownKey: 'cm.full.already' };
    // NEVER renders as a large number of weeks. A figure meaning "never" invites somebody to plan against it.
    case 'not_filling': return { text: '—', unknownKey: 'cm.full.notFilling' };
    default: return { text: '—', unknownKey: 'cm.full.noRate' };
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE THREE INTEGRITY FINDINGS                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** A default cell that is not `active` means a country whose new registrations all fail at placement — existing tenants
 *  keep working, which is exactly what makes it hard to notice. Drawn as an incident. */
export function defaultNotActiveClass(count: number): string {
  return count > 0 ? 'kv-note is-danger' : 'kv-note';
}

/** A shard at weight 0 that is still `active`. Until 0116 those shards were RECEIVING tenants while their weight said
 *  drain, so the platform may hold shards whose count rose after somebody took them out of rotation. */
export function zeroWeightClass(count: number): string {
  return count > 0 ? 'kv-note is-warn' : 'kv-note';
}

export type CountCheck = { kind: 'match' | 'over' | 'under'; stored?: number; derived?: number; drift?: number; at: string; urgent: boolean } | null;

/** The reconciliation claim. NULL means NEVER CHECKED, which is the state of every node on the platform today — and it is
 *  drawn as a warning rather than as neutral, on the ADMIN-6 rule that an unverified figure says so rather than implying
 *  verification. */
export function countCheckClass(c: CountCheck): string {
  if (c === null) return 'kv-badge is-warn';
  if (c.kind === 'match') return 'kv-badge is-ok';
  return c.urgent ? 'kv-badge is-danger' : 'kv-badge is-warn';
}

export function countCheckKey(c: CountCheck): string {
  if (c === null) return 'cm.count.never';
  // `over` and `under` are separate keys because they cost different things: over refuses placements on a cell with room,
  // under admits them past the cap. One is visible (somebody complains); the other is invisible until a shard falls over.
  return `cm.count.${c.kind}`;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE ONE SECRET THAT MUST NOT LEAK                                                                 */
/* ------------------------------------------------------------------------------------------------ */

/** W031: "Raw DSNs never appear here. `dsn_secret_ref` points into Secrets Manager; even platform owners see only the
 *  reference."
 *
 *  The server already refuses to emit the ref at all (the shard entity exposes `hasDsn`, a boolean) — so this renders the
 *  BOOLEAN. Kept as a function rather than inlined because the temptation to show "the ref, it's only a ref" is exactly
 *  the change that would put a production connection string in a screenshot, and a named function is where a reviewer
 *  will look for the rule. */
export function dsnCellKey(hasDsn: boolean): string {
  return hasDsn ? 'cm.dsn.sealed' : 'cm.dsn.absent';
}

/** A shard with no DSN reference cannot serve traffic, so an `active` shard without one is a misconfiguration rather
 *  than a display detail. */
export function dsnMissingIsUrgent(hasDsn: boolean, status: string): boolean {
  return !hasDsn && status === 'active';
}

/* ------------------------------------------------------------------------------------------------ */
/* SHARDS                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** W031's weight column, and the state the canon describes and nothing enforced until 0116.
 *
 *  `draining_by_weight` is its own label rather than being folded into the status badge, because the two can disagree and
 *  the disagreement is the interesting case: somebody took the shard out of rotation without committing to the lifecycle
 *  change, which usually means a colleague mid-incident. */
export type ShardTraffic = 'accepting' | 'draining_by_weight' | 'draining_by_status' | 'frozen' | 'retired' | 'unknown';

export function shardTraffic(status: string, weight: number): ShardTraffic {
  if (status === 'retired') return 'retired';
  if (status === 'readonly') return 'frozen';
  if (status === 'draining') return 'draining_by_status';
  if (status !== 'active') return 'unknown';
  // `Number.isFinite` first: NaN loses every comparison, so a bare `weight > 0` would read an unreadable weight as
  // draining — which is the safe direction by luck rather than by design, and ADMIN-5f caught itself relying on exactly
  // that in `priorityOf`.
  if (!Number.isFinite(weight)) return 'unknown';
  return weight > 0 ? 'accepting' : 'draining_by_weight';
}

export function trafficKey(t: ShardTraffic): string { return `cm.traffic.${t}`; }

export function trafficClass(t: ShardTraffic): string {
  switch (t) {
    case 'accepting': return 'kv-badge is-ok';
    case 'draining_by_weight': return 'kv-badge is-warn';
    case 'draining_by_status': return 'kv-badge is-warn';
    case 'frozen': return 'kv-badge is-info';
    case 'retired': return 'kv-badge';
    // UNKNOWN IS DANGER on a routing table. A shard whose traffic state cannot be read is a shard nobody can say is safe
    // to place onto.
    default: return 'kv-badge is-danger';
  }
}
