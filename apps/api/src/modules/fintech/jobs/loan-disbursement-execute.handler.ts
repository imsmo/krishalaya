// modules/fintech/jobs/loan-disbursement-execute.handler.ts · PC-55 A9 — the EXECUTE step, deliberately a STUB.
//
// WHY A STUB AND NOT AN IMPLEMENTATION: executing a disbursement means real money leaving a lender's account
// through RazorpayX. Without live credentials there is nothing to execute, and the one thing this code must
// never do is FLIP A LOAN TO 'disbursed' when no money moved — that would make a farmer owe a debt they never
// received. So this handler refuses to run and says why, in plain words, instead of simulating success.
//
// WHAT IT WILL DO when keys land (the contract is written now so the wiring is a config change, not a rewrite):
//   for each run item whose payout reached 'processed':
//     1. flip loan_applications.status → 'disbursed' (via the existing loan-application state machine, so the
//        outbox event and audit row happen exactly as they do for a wallet disbursal today);
//     2. create the `loans` servicing mirror row (principal = the payout amount, apr/tenor from the product,
//        disbursed_at = the payout's settlement date, outstanding = principal) — the row the W54-8 servicing
//        surface (DPD, collections, KCC ledger, restructures) reads;
//     3. stamp loan_disbursement_run_items.loan_id and complete the run.
// Each of those three is idempotent per item, so a re-run after a partial failure finishes the job rather than
// duplicating it.
import { Injectable, Logger } from '@nestjs/common';

export interface DisbursementExecuteResult { executed: boolean; reason: string; itemsProcessed: number }

@Injectable()
export class LoanDisbursementExecuteHandler {
  private readonly log = new Logger(LoanDisbursementExecuteHandler.name);

  /** True only when a real payout provider is configured. Fails CLOSED on anything unknown. */
  static payoutRailReady(env: Record<string, string | undefined>): boolean {
    return (env.PAYOUT_PROVIDER ?? 'noop').toLowerCase() === 'razorpayx'
      && !!env.RAZORPAYX_KEY_ID && !!env.RAZORPAYX_KEY_SECRET;
  }

  async execute(runId: string, env: Record<string, string | undefined> = process.env): Promise<DisbursementExecuteResult> {
    if (!LoanDisbursementExecuteHandler.payoutRailReady(env)) {
      const reason = 'Payout rail is not configured (PAYOUT_PROVIDER/RAZORPAYX credentials absent). No loan was '
        + 'marked disbursed and no servicing record was created — a borrower must never owe money they did not receive.';
      this.log.warn(`loan-disbursement execute refused for run ${runId}: rail not ready`);
      return { executed: false, reason, itemsProcessed: 0 };
    }
    // Live path lands with the credentials (see the header contract). Until then this branch is unreachable by
    // construction, and deliberately does NOT half-implement the state flips.
    this.log.log(`loan-disbursement execute would run for ${runId}`);
    return { executed: false, reason: 'Live disbursement execution ships with the payout-rail wiring batch (S2).', itemsProcessed: 0 };
  }
}
