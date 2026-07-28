// modules/insurance/events/handlers/surveyor-dispatch.handler.ts
// Consumes insurance.claim_survey_scheduled (delivered by the outbox relay) — DEV-25/KV-BL-057, Wave 7
// external integration #2. `InsuranceClaim.scheduleSurvey()` and `InsuranceClaim.requestResurvey()` BOTH emit
// this same event type (insurance-claim.entity.ts) — this handler tells them apart by payload shape:
//   • scheduleSurvey()   -> { claimId, surveyorUserId, from }        (a real surveyor IS assigned -> dispatch)
//   • requestResurvey()  -> { claimId, surveyorUserId: null, resurvey: true }  (farmer disagreed; NO surveyor
//     assigned yet — the insurer must call scheduleSurvey() again before there is anything to dispatch)
// So: surveyorUserId === null -> SILENT skip (nothing to notify the external network about yet).
//
// Flag `surveyor_dispatch` (default OFF — no named surveyor-network partner is contracted, §8): OFF -> silent
// skip, mirrors PmfbyPolicySyncHandler/DisputeResolvedHandler's own kill-switch convention exactly.
//
// isReassignment is derived from the event's own `from` field (the claim's PRIOR status): `from ===
// 'survey_scheduled'` means the insurer is (re)assigning a surveyor while already in this status — either the
// self-loop reassignment path OR the second call after a farmer-triggered requestResurvey() cleared the prior
// surveyor. Any other `from` (intimated/docs_pending) is the initial dispatch.
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { InsuranceClaimRepository } from '../../repositories/insurance-claim.repository';
import { SURVEYOR_DISPATCH_GATEWAY, SurveyorDispatchGateway } from '../../gateway/surveyor-dispatch.port';

@Injectable()
export class SurveyorDispatchHandler implements OutboxHandler {
  readonly eventType = 'insurance.claim_survey_scheduled';
  constructor(
    @Inject(SURVEYOR_DISPATCH_GATEWAY) private readonly dispatcher: SurveyorDispatchGateway,
    private readonly flags: FlagsService,
    private readonly audit: AuditWriter,
    private readonly claims: InsuranceClaimRepository,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const claimId = (typeof p.claimId === 'string' && p.claimId) ? p.claimId : event.aggregateId;
    if (!tenantId || !claimId) return;
    const surveyorUserId = typeof p.surveyorUserId === 'string' ? p.surveyorUserId : null;
    if (!surveyorUserId) return;   // requestResurvey's own event (no surveyor assigned yet) — nothing to dispatch
    if (!(await this.flags.isEnabled('surveyor_dispatch', { tenantId }))) return;   // kill-switch (default OFF, §8)

    const claim = await this.claims.getById(tenantId, claimId);
    if (!claim) return;   // gone/not ours
    const from = typeof p.from === 'string' ? p.from : undefined;
    const isReassignment = from === 'survey_scheduled';

    const result = await this.dispatcher.dispatch({
      idempotencyKey: `${claimId}:${surveyorUserId}`, tenantId, claimId,
      policyId: claim.policyId, surveyorUserId, isReassignment,
    });

    // Audit-only record (no column to persist providerDispatchRef into — insurance_claims' DDL doesn't
    // anticipate one; same disclosed gap as PMFBY's govtApplicationRef, see dev25_report.md §8).
    await this.audit.write(tx, {
      tenantId, actorUserId: 'system', action: 'insurance.claim.surveyor_dispatch_attempted',
      entityType: 'insurance_claim', entityId: claimId,
      newValue: { status: result.status, providerDispatchRef: result.providerDispatchRef ?? null, failureReason: result.failureReason ?? null, isReassignment },
      ip: null,
    });
  }
}
