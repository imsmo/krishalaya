// apps/admin-api/src/core/approval/two-person-rule.ts · the two-person rule, extracted at the THIRD instance.
//
// WHY NOW AND NOT EARLIER. Two implementations is a coincidence; three is a pattern.
//   • 0093 / `ManualAdjustmentService` — request → decide → apply, with `ck_billing_adj_maker_ne_checker`.
//   • 0105 / `SchemeVersionService` — draft → publish → discard, with `ck_scheme_version_maker_ne_checker`.
//   • 0107 / this wave — a DSR erasure needs a DPO countersign, with `ck_dsr_countersign_ne_actor`.
// Each was hand-rolled independently. What they share is not a state machine — they have three genuinely different
// shapes, and forcing them into one would be worse than the duplication. What they share is the ASSERTION, its failure
// mode, and the reason the database constraint exists alongside it. That is what is extracted here.
//
// WHAT IS DELIBERATELY *NOT* EXTRACTED:
//   • The state machines. A three-step apply (money must move separately from approval) and a two-step publish (the
//     projection happens in the publish transaction) are not the same workflow wearing different names.
//   • A generic `approvals` table. Every one of the three has its own object with its own columns and its own
//     constraints; a central table would mean a join and a polymorphic entity_type for no gain, and it would put the
//     approval further from the thing being approved rather than closer.
//   • Retrofitting the two existing call sites. That is a refactor with its own verification — changing a money
//     control to prove a tidiness point is exactly the wrong order — and it is named as debt rather than smuggled into
//     a compliance wave.
//
// THE THREE RULES THIS FILE ENCODES, each learned from one of the three sites:
//   1. THROW, NEVER RETURN A BOOLEAN. A boolean a caller may ignore is a control that will eventually be ignored
//      (the same reasoning as `assertReviewerScope` in the translations plane).
//   2. THE ERROR NAMES THE RULE, NOT THE PERMISSION. The operator HAS the permission — what they lack is a second
//      person. A bare 403 sends them to ask for access they already hold, and the commonest outcome of that is a
//      permission being widened to solve a problem it was not.
//   3. A DATABASE CONSTRAINT ALWAYS ACCOMPANIES IT. This function protects the current caller; the CHECK protects
//      every future one. Neither is redundant, and shipping only the service-side check is how the rule quietly
//      becomes advisory.
import { HttpException, HttpStatus } from '@nestjs/common';

/** A refusal to let one person do both halves of a two-person action.
 *
 *  409 and not 403 on purpose: 403 means "you may not do this", and the truth is "this cannot be done by you ALONE",
 *  which is a state conflict rather than an authorisation failure. The distinction shows up in the operator's next
 *  move — a 409 sends them to find a colleague, a 403 sends them to raise an access request.
 */
export class SecondPersonRequiredError extends HttpException {
  constructor(action: string, detail?: string) {
    super(
      {
        code: 'SECOND_PERSON_REQUIRED',
        message: `${action} must be performed by a different operator from the one who initiated it (two-person rule).`
          + (detail ? ` ${detail}` : ''),
        action,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Refuse when the approving actor is the initiating actor.
 *
 * `initiator` MAY BE NULL, and the null case is the one worth reading carefully. A null initiator means the record does
 * not name who started it — a backfilled row, a system-initiated request, a legacy row from before the column existed.
 * Those are ALLOWED to proceed, because the alternative is a permanent dead end: nobody can ever approve a record whose
 * initiator is unknown, and there is no second field to appeal to. The risk of allowing it is that one person approves
 * something they may have initiated invisibly; the risk of refusing it is that lawful work becomes impossible for ever.
 * The first is recoverable through the audit trail, the second is not, so this errs toward letting the work happen and
 * letting the ledger record who did it.
 *
 * Two nulls must NOT compare equal — a mutation test on the scheme-version plane caught exactly that bug, where
 * `initiator === approver` with both null hid a control from everybody.
 */
export function assertSecondPerson(
  action: string,
  initiator: string | null | undefined,
  approver: string,
  detail?: string,
): void {
  if (!approver) throw new SecondPersonRequiredError(action, 'the approving operator could not be identified.');
  if (!initiator) return;                       // unknown initiator — see the note above
  if (initiator === approver) throw new SecondPersonRequiredError(action, detail);
}

/**
 * The read-side counterpart: is this action offerable to this viewer?
 *
 * Used to decide whether a console RENDERS a control — the standing "maker-checker by absence" doctrine, where a
 * control the viewer cannot use is NOT DRAWN rather than drawn-and-disabled. A disabled button teaches an operator that
 * they nearly have the right to approve their own work; an absent one beside a line naming the rule teaches them to
 * find a colleague.
 *
 * Returns TRUE when the viewer is unknown, matching `assertSecondPerson`: the safe direction for a DISPLAY decision is
 * to show the control and let the server refuse, because a redundant refusal is recoverable and a wrongly hidden
 * control blocks legitimate work with no explanation on screen.
 */
export function isSecondPerson(initiator: string | null | undefined, viewer: string | null | undefined): boolean {
  if (!viewer) return true;
  if (!initiator) return true;
  return initiator !== viewer;
}

/**
 * The constraint idiom, as a string, so a migration author writes the same shape the last one did.
 *
 * Not executed — this is documentation that lives next to the code it describes rather than in a wiki nobody opens.
 * All three existing constraints follow it:
 *   CHECK (<approver> IS NULL OR <initiator> IS NULL OR <approver> <> <initiator>)
 * The two NULL escapes are load-bearing and are the part most likely to be dropped by somebody tightening it: without
 * them the constraint refuses every row where either party is unrecorded, which includes every backfilled row, and the
 * migration fails on data that is perfectly lawful.
 */
export function makerNeCheckerConstraint(table: string, initiatorCol: string, approverCol: string): string {
  return `ALTER TABLE ${table} ADD CONSTRAINT ck_${table}_maker_ne_checker CHECK (`
    + `${approverCol} IS NULL OR ${initiatorCol} IS NULL OR ${approverCol} <> ${initiatorCol});`;
}
