// modules/dairy/domain/deduction-plan.ts · PC-56 TENANT-6c-5 · what the cycle may take, and in what order.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."*
//
// This file is the whole of the assembly DECISION and none of its I/O: given a gross, a cap and the member's live
// arrangements, it returns the lines. Pure, so the arithmetic that decides how much of a family's fortnight is
// withheld can be read in one screen and tested at its boundaries — which is where every mistake in it lives.
//
// EVERYTHING IS BIGINT. A percentage cap invites a float; `gross * pct / 100` in integers, truncating, is the same
// discipline `core/database/pg-numeric.ts` exists for, and truncation is the right rounding direction here because
// the remainder stays with the member.

/** One thing that could be recovered: an outstanding debt, plus whatever the member's arrangement allows per cycle. */
export interface DeductionCandidate {
  /** The `milk_deduction` vocabulary row. */
  typeId: string;
  typeCode: string;
  /** What `source_id` will point at — `dairy_member_credit` or `loan`. */
  sourceType: string;
  sourceId: string;
  /** What is still owed on this source. */
  outstandingMinor: bigint;
  /** The member's instalment for this arrangement, or null for "as much as the bill can carry". */
  maxPerCycleMinor: bigint | null;
  /**
   * The tie-break, and the ONLY ordering this platform applies: the date the debt arose. Oldest first, across every
   * type. Recovering a bank's loan before the cooperative's own feed shop — or the reverse — is a policy W169 does
   * not state, and choosing one silently would decide whose debt a family pays first. A per-type priority is named
   * in 0161's header and deliberately not built.
   */
  since: string;
  /** Stable tie-break when two debts arose on the same day. */
  id: string;
}

export interface PlannedDeduction {
  typeId: string;
  typeCode: string;
  sourceType: string;
  sourceId: string;
  amountMinor: bigint;
}

export interface DeductionPlan {
  lines: PlannedDeduction[];
  totalMinor: bigint;
  /** The cap this plan was built against — recorded so a log or a test can say WHY it stopped. */
  capMinor: bigint;
  /** Candidates left wholly or partly unrecovered because the cap bound. Nothing is hidden by being skipped. */
  deferred: Array<{ sourceType: string; sourceId: string; wantedMinor: bigint; takenMinor: bigint }>;
}

/**
 * THE CAP: the most the automatic path may take from this bill.
 *
 * `min(assembly cap, consent threshold)` — see 0161. The assembler must never build a bill that needs the member's
 * fresh consent, because that is the difference between the two halves of W169's sentence: standing instructions
 * govern below the line, and above it a human asks. Integer arithmetic, truncated, so the member keeps the remainder.
 *
 * Note the asymmetry with `deductionConsentRequired`, which triggers STRICTLY ABOVE the threshold: a plan may
 * therefore fill the cap exactly and still need no consent. Off by one in the safe direction, on purpose.
 */
export function assemblyCapMinor(grossMinor: bigint, assemblyPct: number, consentPct: number): bigint {
  const pct = Math.min(assemblyPct, consentPct);
  if (pct <= 0 || grossMinor <= 0n) return 0n;
  return (grossMinor * BigInt(pct)) / 100n;
}

/**
 * Build the plan: oldest debt first, each capped by the member's own instalment, all of it capped by the tenant's
 * share of the gross.
 *
 * A candidate that the cap can only partly cover is TAKEN PARTLY rather than skipped — a family with one big debt
 * would otherwise have nothing recovered for ever, and the cooperative's books would never move. What must not
 * happen is a partial take being invisible, so it is reported in `deferred` alongside what was wanted.
 */
export function planDeductions(grossMinor: bigint, capMinor: bigint, candidates: DeductionCandidate[]): DeductionPlan {
  const ordered = [...candidates].sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines: PlannedDeduction[] = [];
  const deferred: DeductionPlan['deferred'] = [];
  let remaining = capMinor > 0n ? capMinor : 0n;
  let total = 0n;

  for (const c of ordered) {
    const wanted = c.maxPerCycleMinor !== null && c.maxPerCycleMinor < c.outstandingMinor ? c.maxPerCycleMinor : c.outstandingMinor;
    if (wanted <= 0n) continue;
    const take = wanted <= remaining ? wanted : remaining;
    if (take > 0n) {
      lines.push({ typeId: c.typeId, typeCode: c.typeCode, sourceType: c.sourceType, sourceId: c.sourceId, amountMinor: take });
      remaining -= take;
      total += take;
    }
    if (take < wanted) deferred.push({ sourceType: c.sourceType, sourceId: c.sourceId, wantedMinor: wanted, takenMinor: take });
  }

  // The invariant the whole file exists for, asserted rather than assumed: the plan cannot exceed its cap, and the
  // cap cannot exceed the gross. A bill whose deductions exceed its gross is refused by the aggregate anyway
  // (`MilkBill.generate`), but by then 312 of them have been built.
  if (total > capMinor || total > grossMinor) {
    throw new Error(`deduction plan overran its cap (total ${total}, cap ${capMinor}, gross ${grossMinor})`);
  }
  return { lines, totalMinor: total, capMinor, deferred };
}
