// apps/admin-api/src/modules/cells-ops/domain/map-approval.ts · the TWELFTH maker-checker site, PURE (PC-56 ADMIN-8).
//
// ---------------------------------------------------------------------------
// THE CANON NAMES A CHECKER FIVE TIMES AND THERE WAS NO CHECKER ANYWHERE
// ---------------------------------------------------------------------------
//   W029  "ALL changes are maker-checker + reasoned"
//   W030  "This action is recorded · requires checker (`cells.approve`) · blocked while is_default=true"
//   W031  "Weight/status changes need `cells.write` + checker; they shift the placement hash for new tenants"
//   W036  "Raising capacity_tenants needs `cells.write` + checker (infra cost approval)"
//   W038  "Set is_default for BD → open for placements (checker)"
//
// Every one of those writes is today ONE operator holding `cells.manage`, applied immediately. **`cells.approve` existed
// in no realm.** A reason IS mandatory and IS recorded — 0043 got that right — but a reason is a note, not a second pair
// of eyes, and this map decides which physical stack and which COUNTRY a tenant's data lives in.
//
// ---------------------------------------------------------------------------
// WHY ONE PROPOSAL TABLE HERE WHEN `two-person-rule.ts` ARGUED AGAINST A CENTRAL ONE
// ---------------------------------------------------------------------------
// That header's argument was that three genuinely different workflows (a money adjustment, a scheme version, a DSR
// countersign) forced into one table would need a polymorphic `entity_type` for no gain, and would put the approval
// further from the thing approved rather than closer. Both halves of that reasoning REVERSE here:
//   • The polymorphism already exists in the domain. `cell_map_changes` is keyed `(entity_type, entity_id)` for exactly
//     these three objects, and `node.state.ts` is explicit that a cell and a shard share one identical lifecycle.
//   • The approval sits NEXT to the thing approved, because the thing approved is a row in the change log's own
//     coordinate system. A proposal is a change that has not happened yet.
// So this is not a generic approvals table; it is the change log with one extra state at the front.
import { assertSecondPerson, isSecondPerson } from '../../../core/approval/two-person-rule';
import { InvalidCellsInputError } from './cells-ops.errors';

export const PROPOSAL_STATUSES = ['open', 'applied', 'rejected', 'stale'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MAP_ENTITIES = ['cell', 'shard', 'placement'] as const;
export type MapEntity = (typeof MAP_ENTITIES)[number];

/** WHICH WRITES NEED A SECOND PERSON, as data rather than as a set of conditionals scattered across a service.
 *
 *  THE OMISSIONS ARE THE DESIGN, and each is argued:
 *   • `placed` — a NEW tenant landing in the default cell is the platform working. Putting a checker in front of every
 *     signup would mean a farmer's co-operative waits for two Krishalaya employees before it can exist, which is a
 *     control that protects nobody and blocks the thing the platform is for. Same line ADMIN-6b drew at the payout gate.
 *   • `removed` — un-placing a tenant is how a drain FINISHES. Gating it would make the safe direction the expensive one.
 *   • `created` on a shard — adding capacity to a cell that already exists is additive and reversible (a new shard can be
 *     retired while empty), and W031's "Add shard" carries no checker in the canon.
 *  What IS gated is everything that moves EXISTING tenants' data or changes where new ones will land.
 */
export const NEEDS_CHECKER: Readonly<Record<MapEntity, readonly string[]>> = Object.freeze({
  // A cell's status decides whether a whole region accepts tenants; its capacity is an infra-cost commitment (W036); its
  // default flag decides where every new tenant in a country lands (W038).
  cell: Object.freeze(['status_changed', 'updated']),
  // W031: "Weight/status changes … shift the placement hash for new tenants."
  shard: Object.freeze(['status_changed', 'updated']),
  // Moving an existing tenant relocates live data across physical stacks. W034's whole wizard ends in "Submit for
  // checker approval".
  placement: Object.freeze(['moved']),
});

/** The six actions 0043's `cell_map_changes` CHECK permits. Held here so an UNRECOGNISED action can be told apart from a
 *  known-but-ungated one — which is the distinction the first version of this function got wrong. */
const KNOWN_ACTIONS: readonly string[] = Object.freeze([
  'created', 'updated', 'status_changed', 'placed', 'moved', 'removed',
]);

export function needsChecker(entity: string, action: string): boolean {
  const list = (NEEDS_CHECKER as Record<string, readonly string[] | undefined>)[entity];
  // AN ENTITY OR ACTION THIS MODULE DOES NOT RECOGNISE REQUIRES A CHECKER. The safe direction on a routing map is that an
  // unfamiliar change is the one most in need of a second reader — the opposite of the usual allow-list default, and
  // deliberate: a new action type added by a future migration should arrive gated, not ungated.
  //
  // **I WROTE THIS COMMENT AND THEN IMPLEMENTED HALF OF IT.** The first version returned `list.includes(action)`, which
  // gates an unknown ENTITY (no list, so `true`) and silently WAIVES an unknown ACTION on a known entity — `NEEDS_CHECKER
  // .cell.includes('teleported')` is false, so a future `cell/rekeyed` would have arrived ungated, which is precisely what
  // the comment says must not happen. A test asserting the comment caught the code. Recorded rather than quietly fixed,
  // because the failure mode is a paragraph of correct reasoning sitting above three words that do something else.
  if (!list) return true;
  if (!KNOWN_ACTIONS.includes(action)) return true;
  return list.includes(action);
}

export interface ProposalRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  patch: Record<string, unknown>;
  observed: Record<string, unknown>;
  reason: string;
  status: string;
  proposedByAdminId: string;
  proposedAt: string;
  decidedByAdminId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedChangeId: string | null;
  createdAt: string;
}

/** The reason floor. 20 characters, matching every other on this platform (0112's moderation reason, 0114's batch
 *  return, 0115's transition proposal) — and here the reader is a checker deciding whether to move a country's worth of
 *  tenant routing, so "rebalance" alone is not a case. */
export const REASON_MIN = 20;

export function assertReason(reason: string, what = 'a map change'): string {
  const r = reason.trim();
  if (r.length < REASON_MIN) {
    throw new InvalidCellsInputError(
      `${what} needs at least ${REASON_MIN} characters of reasoning; the checker reads it and nothing else explains why `
      + 'the routing map should change');
  }
  return r;
}

/* ------------------------------------------------------------------------------------------------ */
/* STALENESS — the half that makes an approval mean something                                        */
/* ------------------------------------------------------------------------------------------------ */

export type Staleness =
  | { stale: false }
  /** A field the maker observed has changed since. The checker would be approving a change to a world they never saw. */
  | { stale: true; reason: 'observed_changed'; fields: string[] }
  /** The object is gone. */
  | { stale: true; reason: 'entity_missing' };

/** Compare what the maker observed against the row as it is now.
 *
 *  **THIS IS WHY `observed` IS STORED AT ALL.** A proposal that said "set capacity to 2000" and was applied blind would
 *  overwrite a change somebody else made in between — and the checker's signature would be on a diff that never existed.
 *  0114's `preflightDrift` made the same argument for a payout batch; this is the routing map's version, and it is
 *  stricter, because there the drift was reported and here it REFUSES.
 *
 *  ONLY THE FIELDS THE MAKER RECORDED ARE COMPARED. A cell's `placed_count` moving while a capacity proposal is open is
 *  normal and must not invalidate it — tenants land continuously. So `observed` carries the fields the CHANGE is about,
 *  and staleness is measured over exactly those.
 */
export function stalenessOf(
  observed: Record<string, unknown>,
  current: Record<string, unknown> | null,
): Staleness {
  if (!current) return { stale: true, reason: 'entity_missing' };
  const fields: string[] = [];
  for (const k of Object.keys(observed)) {
    // Compared as JSON rather than by `===`, because a value can legitimately be a nested object (a placement's
    // `{cellId, shardId}` pair) and reference equality would report every proposal as stale.
    if (JSON.stringify(observed[k]) !== JSON.stringify(current[k])) fields.push(k);
  }
  return fields.length === 0 ? { stale: false } : { stale: true, reason: 'observed_changed', fields };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DECISION                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

export type ApprovalState =
  | { kind: 'approvable' }
  /** The viewer proposed it. The control is NOT DRAWN — maker-checker by absence. */
  | { kind: 'needs_other_operator' }
  | { kind: 'already'; status: ProposalStatus }
  | { kind: 'stale'; detail: Staleness };

export function approvalState(i: {
  status: string;
  proposedByAdminId: string | null;
  viewerAdminId: string | null;
  staleness: Staleness;
}): ApprovalState {
  if (i.status !== 'open') {
    return PROPOSAL_STATUSES.includes(i.status as ProposalStatus)
      ? { kind: 'already', status: i.status as ProposalStatus }
      // A status this code does not know is reported as decided rather than as approvable. `ck_cmp_status` constrains the
      // column, so this is reachable only if the vocabulary grows.
      : { kind: 'already', status: 'rejected' };
  }
  // STALENESS BEFORE THE TWO-PERSON RULE, so an operator learns the proposal is out of date before being told to find a
  // colleague — the sequence ADMIN-7 settled on, and for the same reason: being sent to fetch somebody and only then
  // discovering the change was never applicable is what gets a control resented.
  if (i.staleness.stale) return { kind: 'stale', detail: i.staleness };
  if (!isSecondPerson(i.proposedByAdminId, i.viewerAdminId)) return { kind: 'needs_other_operator' };
  return { kind: 'approvable' };
}

export function assertApplicable(i: {
  status: string;
  proposedByAdminId: string | null;
  approverAdminId: string;
  staleness: Staleness;
}): void {
  if (i.status !== 'open') {
    throw new InvalidCellsInputError(
      `this proposal is ${i.status}; only an open proposal can be applied. A corrected change is a NEW proposal, so the `
      + 'decided one stays on the record.');
  }
  if (i.staleness.stale) {
    throw new InvalidCellsInputError(
      i.staleness.reason === 'entity_missing'
        ? 'the object this proposal changes no longer exists, so there is nothing to apply it to'
        : `${i.staleness.fields.join(', ')} changed since this proposal was written, so applying it would overwrite `
          + 'somebody else\'s change and put your signature on a diff that never existed. Re-propose against the current '
          + 'state.');
  }
  assertSecondPerson('Applying a routing-map change', i.proposedByAdminId, i.approverAdminId,
    'The operator who proposed a map change cannot apply it.');
}

/** A rejection needs a reason the maker can act on. NOT subject to the two-person rule — refusing your own proposal is
 *  withdrawing it, and needing a colleague to help you stop a routing change would make the safe action the expensive
 *  one. Same asymmetry ADMIN-6b argued for returning a payout batch and ADMIN-7 for withdrawing a model transition. */
export function assertRejectable(i: { status: string; note: string; deciderAdminId: string }): void {
  if (i.status !== 'open') throw new InvalidCellsInputError(`this proposal is already ${i.status}`);
  if (!i.deciderAdminId) throw new InvalidCellsInputError('the deciding operator could not be identified');
  if (i.note.trim().length < REASON_MIN) {
    throw new InvalidCellsInputError(
      `a rejection needs at least ${REASON_MIN} characters explaining what the maker should change; they are its only `
      + 'reader');
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DIFF A CHECKER READS                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export interface DiffLine { field: string; from: unknown; to: unknown }

/** W035 shows the change as a diff — `- "capacity_tenants": 1800 / + "capacity_tenants": 2000`.
 *
 *  Built from `observed` and `patch` rather than from the applied change, so the CHECKER sees it BEFORE deciding. A diff
 *  rendered only after the fact is a receipt, not a review.
 *
 *  A field present in `patch` and absent from `observed` renders with `from: undefined` — which is honest: it means the
 *  maker did not record a prior value, and the alternative (omitting the line) would hide a field being set.
 */
export function diffOf(observed: Record<string, unknown>, patch: Record<string, unknown>): DiffLine[] {
  return Object.keys(patch)
    .filter((k) => JSON.stringify(observed[k]) !== JSON.stringify(patch[k]))
    .sort()
    .map((k) => ({ field: k, from: observed[k], to: patch[k] }));
}

/** Is this proposal a no-op? Refused at PROPOSAL time rather than at approval, so nobody is asked to sign a change that
 *  changes nothing — and a checker's time is the scarce resource this whole mechanism spends. */
export function isNoOp(observed: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  return diffOf(observed, patch).length === 0;
}
