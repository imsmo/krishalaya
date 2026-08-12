// modules/ai-governance/__tests__/appeal-submit.service.spec.ts · PC-56 ADMIN-SWEEP-b1, the farmer's half of W097.
//
// Pins the four facts submit lives by: OWNERSHIP is the authorization (a 404 that confirms nothing, never a 403
// that confirms existence); the 48h SLA CLOCK is set in the INSERT itself, on submit; a duplicate is a SILENT
// DEDUPE with the shape of success; and the event log calls an appeal an appeal (aggregate 'appeal', not a report).
import { AppealService, APPEAL_SUBMITTED_EVENT } from '../services/appeal.service';
import { AppealRepository } from '../repositories/appeal.repository';
import { AiGovernancePublisher } from '../events/ai-governance.publisher';
import {
  APPEAL_SLA_HOURS, APPEALABLE_ACTIONS, ACTION_SUBJECT_KIND, assertAppealableAction, buildSubjectRef, subjectIdFor,
  InvalidAppealError, AppealNotYoursError,
} from '../domain/appeal-submit';

const LISTING = '11111111-1111-7111-8111-111111111111';

function harness(opts: { owns?: boolean; inserted?: { id: string; slaDueAt: string } | null } = {}) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const repo = {
    ownsListing: jest.fn(async () => opts.owns ?? true),
    ownsReview: jest.fn(async () => opts.owns ?? true),
    insertDeduped: jest.fn(async () => (opts.inserted === undefined ? { id: 'ap1', slaDueAt: '2026-08-13T12:00:00Z' } : opts.inserted)),
    listMine: jest.fn(async () => []),
  };
  const svc = new AppealService(uow as any, metrics as any, audit as any, new AiGovernancePublisher(outbox as any), repo as any);
  return { svc, tx, outbox, audit, repo, metrics };
}
const farmer = { userId: 'farmer-1' };

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · appeal-submit domain', () => {
  it('exactly the three canon actions are appealable — the set 0132 CHECKs and the overturn dispatches on', () => {
    expect([...APPEALABLE_ACTIONS].sort()).toEqual(['account_restricted', 'listing_removed', 'review_hidden']);
    expect(() => assertAppealableAction('listing_held')).toThrow(InvalidAppealError);
    expect(() => assertAppealableAction(undefined)).toThrow(InvalidAppealError);
  });
  it('subject_ref is built server-side and always agrees with the action', () => {
    for (const a of APPEALABLE_ACTIONS) {
      expect(buildSubjectRef(a, 'x').startsWith(`${ACTION_SUBJECT_KIND[a]}:`)).toBe(true);
    }
  });
  it('account_restricted appeals the CALLER; the other two must name their subject', () => {
    expect(subjectIdFor('account_restricted', undefined, 'me')).toBe('me');
    expect(subjectIdFor('account_restricted', 'someone-else', 'me')).toBe('me');   // cannot appeal another account
    expect(() => subjectIdFor('listing_removed', undefined, 'me')).toThrow(InvalidAppealError);
    expect(subjectIdFor('review_hidden', 'r1', 'me')).toBe('r1');
  });
  it('the clock constant is the canon 48', () => {
    expect(APPEAL_SLA_HOURS).toBe(48);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · appeal-submit service', () => {
  it("someone else's listing refuses as 404 — an appeal path must not become an existence oracle", async () => {
    const { svc, repo, audit, outbox } = harness({ owns: false });
    await expect(svc.submit('t1', farmer, { subjectAction: 'listing_removed', subjectId: LISTING } as any, null))
      .rejects.toBeInstanceOf(AppealNotYoursError);
    expect(repo.insertDeduped).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
    expect(outbox.write).not.toHaveBeenCalled();
  });

  it('submit inserts, audits and emits — with the appeal AS an appeal in the event log', async () => {
    const { svc, repo, audit, outbox } = harness();
    const out = await svc.submit('t1', farmer, { subjectAction: 'listing_removed', subjectId: LISTING, note: 'the photos were mine' } as any, '1.2.3.4');
    expect(out).toMatchObject({ id: 'ap1', deduped: false, slaHours: 48 });
    expect(repo.insertDeduped).toHaveBeenCalledWith(expect.anything(), {
      subjectRef: `listing:${LISTING}`, subjectAction: 'listing_removed', appellant: 'farmer-1',
    });
    expect(audit.write).toHaveBeenCalledTimes(1);
    // the farmer's note survives in the audit reason — 0067's filed shape has no note column, and the shape stays filed
    expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'appeal.submitted', reason: 'the photos were mine' });
    expect(outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateType: 'appeal', eventType: APPEAL_SUBMITTED_EVENT,
    }));
  });

  it('a duplicate is a silent no-op with the SHAPE of success — nothing audited, nothing emitted twice', async () => {
    const { svc, audit, outbox, metrics } = harness({ inserted: null });
    const out = await svc.submit('t1', farmer, { subjectAction: 'account_restricted' } as any, null);
    expect(out).toMatchObject({ id: null, deduped: true });
    expect(audit.write).not.toHaveBeenCalled();
    expect(outbox.write).not.toHaveBeenCalled();
    expect(metrics.inc).toHaveBeenCalledWith('ai.appeal.duplicate');
  });

  it('account_restricted needs no ownership read — the subject IS the caller, by construction', async () => {
    const { svc, repo } = harness();
    await svc.submit('t1', farmer, { subjectAction: 'account_restricted' } as any, null);
    expect(repo.ownsListing).not.toHaveBeenCalled();
    expect(repo.ownsReview).not.toHaveBeenCalled();
    expect(repo.insertDeduped).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectRef: 'account:farmer-1',
    }));
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · the INSERT itself sets the clock and leans on the dedupe index', () => {
  it('sla_due_at = now() + 48h in the SQL, ON CONFLICT over the 0132 partial index', async () => {
    const tx = { query: jest.fn(async (...args: unknown[]) => { void args; return { rows: [{ id: 'ap1', slaDueAt: 'x' }] }; }) };
    const repo = new AppealRepository({ forTenant: () => ({ query: jest.fn() }) } as any);
    await repo.insertDeduped(tx as any, { subjectRef: 'listing:x', subjectAction: 'listing_removed', appellant: 'u1' });
    const [sql, params] = tx.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("now() + ($5 || ' hours')::interval");
    expect(sql).toContain("ON CONFLICT (subject_ref, appellant) WHERE status = 'pending' AND deleted_at IS NULL DO NOTHING");
    expect(params).toContain(String(APPEAL_SLA_HOURS));
    // appellant is also created_by — no row without a person who owns it
    expect(sql).toContain('created_by');
  });

  it('listMine binds the APPELLANT in every read — the repository is where the scoping law lives (no RLS on appeals)', async () => {
    const tx = { query: jest.fn(async (...args: unknown[]) => { void args; return { rows: [] }; }) };
    const repo = new AppealRepository({ forTenant: () => ({ query: jest.fn() }) } as any);
    await repo.listMine(tx as any, { appellant: 'u1', limit: 10 });
    const [sql, params] = tx.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('appellant = $1');
    expect(params[0]).toBe('u1');
  });
});
