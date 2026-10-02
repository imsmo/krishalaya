// modules/requirements/services/buyer-consent.ts · PC-56 TENANT-11d · A4 (F-10 / F-20) — WHO MAY DECIDE ON A BUYER'S QUOTE.
//
// The buyer decides on their own quotes. Nobody else does — EXCEPT the buyer desk (`requirement.desk`), and then only with
// the buyer's recorded consent for THAT act (shortlist / accept / reject), written append-only in the same transaction as the
// decision. A moderator (listing.moderate / dispute.resolve) no longer reaches these acts at all: before this wave support staff
// could accept a quote on a buyer's behalf, which creates the buyer's order (survey F-10).
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BuyerConsentRequiredError, RequirementForbiddenError } from '../domain/requirements.errors';
import { ConsentDto } from '../dto/requirement-desk.dto';
import { ResponseGroupRepository } from '../repositories/response-group.repository';
import { RequirementActor } from '../policies/requirements.policies';

export type DecisionAct = 'shortlist' | 'accept' | 'reject';

/** Authorise a decision on the buyer's behalf. Returns null for the buyer themself, or the recorded consent's id. */
export async function authorizeBuyerDecision(
  tx: TxContext, groups: ResponseGroupRepository,
  input: { tenantId: string; requirementId: string; buyerUserId: string; actor: RequirementActor; act: DecisionAct; consent?: ConsentDto; responseId?: string | null; groupId?: string | null },
): Promise<{ onBehalf: boolean; consentId: string | null }> {
  if (input.actor.userId === input.buyerUserId) return { onBehalf: false, consentId: null };
  if (!input.actor.canDesk) throw new RequirementForbiddenError(`only the buyer may ${input.act} a quote (or the buyer desk with the buyer's recorded consent)`);
  const c = input.consent;
  if (!c) throw new BuyerConsentRequiredError(input.act);
  if (c.channel === 'app') throw new BuyerConsentRequiredError(input.act, 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');      // `app` is only the buyer themself
  if (c.channel !== 'otp' && !c.mediaId) throw new BuyerConsentRequiredError(input.act, 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');
  const id = uuidv7();
  await groups.insertConsent(tx, { id, tenantId: input.tenantId, requirementId: input.requirementId, act: input.act, memberUserId: input.buyerUserId,
    responseId: input.responseId ?? null, groupId: input.groupId ?? null, channel: c.channel, mediaId: c.mediaId ?? null, note: c.note?.trim() || null, recordedBy: input.actor.userId });
  return { onBehalf: true, consentId: id };
}
