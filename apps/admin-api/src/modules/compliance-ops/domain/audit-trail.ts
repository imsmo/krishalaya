// apps/admin-api/src/modules/compliance-ops/domain/audit-trail.ts · W039 + W040, PURE (PC-56 ADMIN-5e).
//
// W039: "audit_log — append-only, monthly partitions, 7-year immutable retention. Every privileged action lands
// here. Nothing here can be edited or deleted — by anyone."
//
// ---------------------------------------------------------------------------------------------------------------
// THE TENSION AN EARLIER WAVE LOGGED AS UNRESOLVED, AND THE CANON'S ANSWER TO IT
// ---------------------------------------------------------------------------------------------------------------
// The explorer built in an earlier wave deliberately never selects `old_value`/`new_value`: a change diff can carry
// anything the changed row carried — a phone number, an address, a bank reference — and PII minimisation on a
// compliance read path is the right default. W040 then asks for a before/after diff, which is precisely those two
// columns. The ADMIN-5 verdict recorded the two requirements as "in genuine tension" and deferred the decision.
//
// **The canon had already made it, in the restricted state of both screens.** W039: "Needs `audit.read`; old/new
// values additionally need `audit.values.read` (PII in diffs)." W040: "Diffs masked — old/new values need
// `audit.values.read` — timeline stays visible, diffs show ▪▪▪."
//
// So the resolution is a SECOND PERMISSION and a graceful degrade, not a choice between minimisation and utility.
// The history of WHAT HAPPENED stays widely readable; the contents of WHAT CHANGED are their own grant. Reading a
// lifecycle is an auditor's routine job; reading every value inside every change is an investigation.
//
// AND THE MASKED FORM STILL SHOWS THE FIELD NAMES. `{"status": ▪▪▪}` tells a reader that the status changed without
// telling them to what, which is most of the value of a diff at none of the risk. The keys in these blobs are column
// names written by our own audit writers, not user content — so a key is safe to show and a value is not.

/* ===================== entity references (W040's `listing/LST-2026-084497`) ===================== */

export interface EntityRef { entityType: string; entityId: string }

/** Parse `type/id`. Refuses anything else rather than guessing.
 *
 *  The id half is NOT validated as a uuid even though `audit_log.entity_id` is one: a caller who pastes a display
 *  reference should get "no history for this entity" from the query, which is W040's own empty state, rather than a
 *  validation error that reads like the console is broken.
 */
export function parseEntityRef(v: unknown): EntityRef | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const i = s.indexOf('/');
  // The `<= 0` and `length - 1` bounds are REDUNDANT with the emptiness check three lines down, and a mutation test
  // proved it — removing them changed no behaviour. Kept anyway, and the redundancy is noted rather than tidied: the
  // bound states the shape at the point the index is taken, where a future reader is deciding what `i` means, and
  // deleting it would move the only statement of that rule into a check about something else.
  if (i <= 0 || i === s.length - 1) return null;
  const entityType = s.slice(0, i).trim();
  const entityId = s.slice(i + 1).trim();
  // A second slash means this is a path, not a reference — and silently taking the first segment would drill into
  // the wrong entity.
  if (!entityType || !entityId || entityId.includes('/')) return null;
  if (!/^[a-z][a-z0-9_]{1,59}$/.test(entityType)) return null;
  return { entityType, entityId };
}
export function formatEntityRef(r: EntityRef): string { return `${r.entityType}/${r.entityId}`; }

/* ===================== the diff ===================== */

export type DiffKind = 'added' | 'removed' | 'changed';
export interface DiffLine { kind: DiffKind; key: string; before: string | null; after: string | null }

export type DiffPanel =
  /** Neither value column was written. The overwhelmingly common case, and it is NOT "nothing changed". */
  | { kind: 'not_recorded' }
  /** The viewer lacks `audit.values.read`. Field names shown, values withheld. */
  | { kind: 'masked'; keys: string[] }
  /** Only a new value was recorded — there is no before-state to diff against. */
  | { kind: 'created'; lines: DiffLine[] }
  | { kind: 'diff'; lines: DiffLine[] }
  /** A value column held something that is not a JSON object (a bare string or array). Shown whole rather than
   *  pretended to be a field-level diff. */
  | { kind: 'opaque'; before: string | null; after: string | null };

export const MASK = '▪▪▪' as const;

/** Render one jsonb value for a diff cell. Objects and arrays are canonicalised so the same content always renders
 *  identically — a diff that shows a "change" caused by key ordering is a diff nobody will trust twice. */
function render(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
  }
  return String(v);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Build W040's change diff — or refuse to.
 *
 *  THE FIRST BRANCH IS THE IMPORTANT ONE AND IT IS THE STATE OF NEARLY EVERY ROW. Most audit writers on this
 *  platform pass `newValue` only; a minority pass both. A diff panel that rendered "no changes" for a row with no
 *  recorded values would tell an auditor that a privileged action changed nothing, when the truth is that nobody
 *  wrote down what it changed. Those are opposite statements about the same row, and only one of them is a fact
 *  about the platform.
 */
export function diffOf(oldValue: unknown, newValue: unknown, canReadValues: boolean): DiffPanel {
  const hasOld = oldValue !== null && oldValue !== undefined;
  const hasNew = newValue !== null && newValue !== undefined;
  if (!hasOld && !hasNew) return { kind: 'not_recorded' };

  if (!canReadValues) {
    // Keys only. Sorted and de-duplicated so the masked panel is stable and comparable between rows.
    const keys = new Set<string>();
    if (isPlainObject(oldValue)) Object.keys(oldValue).forEach((k) => keys.add(k));
    if (isPlainObject(newValue)) Object.keys(newValue).forEach((k) => keys.add(k));
    return { kind: 'masked', keys: [...keys].sort() };
  }

  // A value column that is not an object cannot be diffed field by field. Shown whole rather than coerced into a
  // shape it does not have — a fabricated `{"value": …}` wrapper would be a field name we invented.
  if ((hasOld && !isPlainObject(oldValue)) || (hasNew && !isPlainObject(newValue))) {
    return { kind: 'opaque', before: hasOld ? render(oldValue) : null, after: hasNew ? render(newValue) : null };
  }

  const o = isPlainObject(oldValue) ? oldValue : {};
  const n = isPlainObject(newValue) ? newValue : {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].sort();
  const lines: DiffLine[] = [];
  for (const key of keys) {
    const inOld = key in o;
    const inNew = key in n;
    const before = inOld ? render(o[key]) : null;
    const after = inNew ? render(n[key]) : null;
    if (inOld && inNew) {
      // Unchanged keys are omitted. W040 shows only what moved, and a diff padded with every untouched field is a
      // diff nobody reads to the bottom of.
      if (before !== after) lines.push({ kind: 'changed', key, before, after });
    } else if (inNew) {
      lines.push({ kind: 'added', key, before: null, after });
    } else {
      // A key present in the BEFORE and absent from the AFTER is a removal, and it is the direction most likely to
      // be dropped by a naive diff that iterates the new object. A field that stopped existing is a change.
      lines.push({ kind: 'removed', key, before, after: null });
    }
  }
  return hasOld ? { kind: 'diff', lines } : { kind: 'created', lines };
}

/** Whether the diff panel found anything to show. A recorded-but-identical pair is a real and reportable state —
 *  a privileged action that wrote an audit row and changed nothing — and it is distinct from `not_recorded`. */
export function diffIsEmpty(p: DiffPanel): boolean {
  if (p.kind === 'diff' || p.kind === 'created') return p.lines.length === 0;
  if (p.kind === 'masked') return p.keys.length === 0;
  return p.kind === 'not_recorded';
}

/* ===================== W039's saved views ===================== */

/** W039 offers "Writes only" and "Money mutations" as one-tap filters, plus a starred filter.
 *
 *  MATCHED ON THE ACTION PREFIX, and the list is data rather than a regex, because a regex over action names is a
 *  filter that silently stops matching when somebody adds a module. Each entry is a NAMESPACE the platform actually
 *  writes, verified against the action strings in the audit writers.
 */
export const MONEY_ACTION_PREFIXES = Object.freeze([
  'billing.', 'wallet.', 'payout.', 'recon.', 'ledger.', 'plans.',
] as const);

/** Actions that only READ. Everything else is treated as a write, and the asymmetry is deliberate: a new action
 *  nobody has classified shows up under "writes only", where somebody will see it. The opposite default would hide
 *  a new privileged write from the view designed to catch privileged writes. */
export const READ_ACTION_SUFFIXES = Object.freeze(['_read', '_viewed', '_exported', '.read', '.viewed'] as const);

export type SavedView = 'all' | 'writes' | 'money';

export function isWriteAction(action: string): boolean {
  if (typeof action !== 'string' || !action) return false;
  return !READ_ACTION_SUFFIXES.some((s) => action.endsWith(s));
}
export function isMoneyAction(action: string): boolean {
  if (typeof action !== 'string') return false;
  return MONEY_ACTION_PREFIXES.some((p) => action.startsWith(p));
}
export function matchesView(action: string, view: SavedView): boolean {
  if (view === 'all') return true;
  if (view === 'writes') return isWriteAction(action);
  return isMoneyAction(action) && isWriteAction(action);
}

/* ===================== the date window ===================== */

/** W039: "Date filters default to today (partition pruning); wide scans require an export job instead of a live
 *  query", and the error state adds "use a signed export for ranges beyond 90 days".
 *
 *  Enforced rather than suggested. `audit_log` is partitioned by `created_at`, and a query with no lower bound
 *  scans every partition ever created — on the table that grows fastest and is never deleted from. The refusal
 *  names the export because the export is the answer, and W018's signed export is itself GAP-BACKEND, which is why
 *  the message says what it can honestly say.
 */
export const MAX_LIVE_WINDOW_DAYS = 90;

export type WindowCheck =
  | { ok: true; from: Date; to: Date }
  | { ok: false; reason: 'too_wide'; days: number }
  | { ok: false; reason: 'inverted' };

export function checkWindow(from: Date | null, to: Date | null, now: Date): WindowCheck {
  // Defaulting to TODAY rather than to everything is the partition-pruning rule, and defaulting the other way is how
  // a console query becomes a full-table scan on the busiest table on the platform.
  const end = to ?? now;
  const start = from ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return { ok: false, reason: 'inverted' };
  if (start.getTime() > end.getTime()) return { ok: false, reason: 'inverted' };
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days > MAX_LIVE_WINDOW_DAYS) return { ok: false, reason: 'too_wide', days: Math.ceil(days) };
  return { ok: true, from: start, to: end };
}

/* ===================== the retention claim ===================== */

/** W039 prints "7-year immutable retention". Half of that is true and half is not, and the console says which.
 *
 *  IMMUTABLE: yes, and by database grant rather than by policy — 0014 revokes UPDATE and DELETE on `audit_log` from
 *  `kv_app`, and no admin path writes anything but INSERT.
 *  SEVEN YEARS: there is no enforcement. 0107 seeded a retention POLICY row for the table, and the retention worker
 *  implements `action='delete'` only — the one verb that must never run against an append-only ledger. So the
 *  platform has a policy it cannot execute and, on this table, must not.
 */
export const RETENTION_CLAIM = Object.freeze({
  immutable: true,
  immutableBasis: 'UPDATE and DELETE are revoked from every application role (0014); only INSERT is granted',
  yearsEnforced: false,
  yearsBasis: 'a retention policy row exists (0107) and the retention worker implements deletion only — the one '
    + 'action that must never run against an append-only trail, so nothing enforces the seven years and nothing '
    + 'should enforce it this way',
});
