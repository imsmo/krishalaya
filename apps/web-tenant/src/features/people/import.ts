// apps/web-tenant/src/features/people/import.ts · pure logic for W156's import screen (PC-56 TENANT-1b-4).
//
// No React, no I/O. The rules worth testing are all about not misleading an operator who is one click from adding several
// hundred people to a register.
import type { BulkImportJob, BulkValidationReport } from '@krishalaya/sdk-js';

export interface T { t(key: string, vars?: Record<string, string | number>): string }

/**
 * The five stages the screen distinguishes, collapsed from eight statuses.
 *
 * **`validating` AND `processing` COLLAPSE INTO "working", BUT `validated` STANDS ALONE.** The operator does not care which
 * kind of work is running — they care whether it is their turn to act. `validated` is the ONLY state where the decision is
 * theirs, so it must never be confused with a state where the system is busy.
 */
export function importStage(j: Pick<BulkImportJob, 'status'>): 'uploaded' | 'working' | 'validated' | 'done' | 'failed' {
  switch (j.status) {
    case 'pending': return 'uploaded';
    case 'validating':
    case 'processing': return 'working';
    case 'validated': return 'validated';
    case 'completed':
    case 'partially_completed': return 'done';
    default: return 'failed';   // failed | cancelled — nothing more happens without a new file
  }
}

/**
 * May the operator press "Import N valid rows"?
 *
 * **NO, WHEN THERE IS NOTHING TO CREATE.** A validated file of 220 rows that are all already members has `willCreate: 0`,
 * and offering a button that would add nobody teaches staff that the button lies. The screen says "nothing to create"
 * instead — which is the actual outcome, and a useful one: the register is already up to date.
 */
export function canConfirm(j: Pick<BulkImportJob, 'status' | 'validation'>): boolean {
  return j.status === 'validated' && (j.validation?.willCreate ?? 0) > 0;
}

/** "Showing 2 of 40 flagged rows" versus "2 flagged rows" — a truncation has to be visible, or the count is a lie. */
export function issueSummary(v: BulkValidationReport, t: T): string {
  const flagged = v.fixable + v.invalid;
  return v.issuesTruncated
    ? t.t('import.issuesTruncated', { shown: v.issues.length, flagged, total: v.totalRows })
    : t.t('import.issuesAll', { flagged, total: v.totalRows });
}

/** The first twelve hex characters. A 64-character hash on screen is noise nobody reads; twelve is enough for a human to
 *  compare two jobs and see they are the same file, which is the only thing they use it for. */
export function hashShort(sha256: string): string {
  return sha256.slice(0, 12);
}

/**
 * Does the triage add up?
 *
 * **THE SCREEN CHECKS THE SERVER'S ARITHMETIC RATHER THAN TRUSTING IT.** If the parts do not sum to the file then something
 * is wrong upstream, and the honest response is to say so rather than render four confident numbers that cannot all be true.
 */
export function triageBalances(v: BulkValidationReport): boolean {
  return v.willCreate + v.alreadyMembers + v.fixable + v.invalid === v.totalRows;
}
