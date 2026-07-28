// modules/insurance/__tests__/surveyor-dispatch.handler.spec.ts · DEV-25/KV-BL-057 integration-point test:
// claim survey_scheduled -> external surveyor-network dispatch, ONLY when a real surveyorUserId is present
// (the requestResurvey() event carries surveyorUserId:null and must be silently skipped) AND the
// `surveyor_dispatch` flag is ON.
import { SurveyorDispatchHandler } from '../events/handlers/surveyor-dispatch.handler';

function harness(flagOn: boolean) {
  const dispatcher = { dispatch: jest.fn(async () => ({ status: 'dispatched', providerDispatchRef: 'disp-1' })) };
  const flags = { isEnabled: jest.fn(async () => flagOn) };
  const audit = { write: jest.fn() };
  const claims = { getById: jest.fn(async () => ({ id: 'c1', policyId: 'p1' })) };
  const handler = new SurveyorDispatchHandler(dispatcher as any, flags as any, audit as any, claims as any);
  return { handler, dispatcher, flags, audit, claims };
}
const tx = {} as any;
const baseEvent = (payload: Record<string, unknown>) => ({ id: '1', tenantId: 't1', aggregateType: 'insurance_claim', aggregateId: 'c1', eventType: 'insurance.claim_survey_scheduled', payload });

describe('SurveyorDispatchHandler', () => {
  it('SILENT-SKIPS a requestResurvey() event (surveyorUserId null) — nothing to dispatch yet', async () => {
    const { handler, dispatcher } = harness(true);
    await handler.handle(baseEvent({ claimId: 'c1', surveyorUserId: null, resurvey: true }), tx);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
  it('SILENT-SKIPS when `surveyor_dispatch` flag is OFF (kill-switch, default OFF, §8)', async () => {
    const { handler, dispatcher, flags } = harness(false);
    await handler.handle(baseEvent({ claimId: 'c1', surveyorUserId: 's1', from: 'intimated' }), tx);
    expect(flags.isEnabled).toHaveBeenCalledWith('surveyor_dispatch', { tenantId: 't1' });
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
  it('flag ON + real surveyor: dispatches with isReassignment=false for an INITIAL assignment (from intimated/docs_pending)', async () => {
    const { handler, dispatcher, audit } = harness(true);
    await handler.handle(baseEvent({ claimId: 'c1', surveyorUserId: 's1', from: 'intimated' }), tx);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'c1', policyId: 'p1', surveyorUserId: 's1', isReassignment: false }));
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'insurance.claim.surveyor_dispatch_attempted', entityId: 'c1' }));
  });
  it('flag ON: dispatches with isReassignment=true when `from` is survey_scheduled (insurer re-assigning after a farmer disagreement)', async () => {
    const { handler, dispatcher } = harness(true);
    await handler.handle(baseEvent({ claimId: 'c1', surveyorUserId: 's2', from: 'survey_scheduled' }), tx);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({ isReassignment: true, surveyorUserId: 's2' }));
  });
  it('never throws on an unavailable dispatch result (a hung external network must never fail the claim event)', async () => {
    const { handler, dispatcher, audit } = harness(true);
    (dispatcher.dispatch as jest.Mock).mockResolvedValue({ status: 'unavailable', failureReason: 'surveyor_network_not_configured' });
    await expect(handler.handle(baseEvent({ claimId: 'c1', surveyorUserId: 's1', from: 'intimated' }), tx)).resolves.toBeUndefined();
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ newValue: expect.objectContaining({ status: 'unavailable' }) }));
  });
  it('returns quietly when the claim is gone/not ours', async () => {
    const { handler, dispatcher, claims } = harness(true);
    (claims.getById as jest.Mock).mockResolvedValue(null);
    await handler.handle(baseEvent({ claimId: 'c1', surveyorUserId: 's1', from: 'intimated' }), tx);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
