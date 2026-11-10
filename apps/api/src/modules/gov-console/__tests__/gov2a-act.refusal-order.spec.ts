// modules/gov-console/__tests__/gov2a-act.refusal-order.spec.ts · PC-56 GOV-2a · E2 — THE ACT'S REFUSAL ORDER, pinned with a spy: the key →
// the input → the permission → the facts (404, the legal step, the second person) — every refusal BEFORE `idem.remember`, the facts read and
// any write; and the happy path DOES go through `idem.remember` and writes the audit row and the outbox event inside the act's transaction.
import { GovApplicationsService } from '../services/gov-applications.service';
import { GovSession } from '../guards/gov-session.guard';

const AUTH = 'a0000000-0000-7000-8000-000000000001';
const A = 'b0000000-0000-7000-8000-000000000001';
const APP = 'e0000000-0000-7000-8000-000000000001';
const ORG = 'f0000000-0000-7000-8000-000000000001';
const OFFICER = ['authority.applications.read', 'authority.applications.verify'];
const HEAD = [...OFFICER, 'authority.applications.decide'];
const session = (perms: string[]): GovSession => ({ userId: A, authorityId: AUTH, sessionId: 's', roles: ['authority_head'], permissions: new Set(perms), expiresAt: null, ip: '127.0.0.1', requestId: 'r1' });
const SENTENCE = 'The land record does not match the name.';

function build(facts: Record<string, unknown> | null) {
  const writes: string[] = [];
  const repo = {
    actFacts: jest.fn(async () => (facts ? { shard: 0, facts } : null)),
    act: jest.fn(async (_s: number, _a: string, _u: string, _id: string, act: string, _c: unknown, _n: unknown, then: (tx: unknown, out: unknown) => Promise<void>) => {
      writes.push(`act:${act}`);
      const out = { tenantId: ORG, fromStatus: 'under_verification', toStatus: act === 'approve' ? 'approved' : 'rejected', schemeId: 's', decidedAt: '2026-11-11T00:00:00.000Z' };
      await then({ query: jest.fn() }, out);
      return out;
    }),
  };
  const audit = { write: jest.fn(async (_tx: unknown, e: { tenantId: string; action: string }) => { writes.push(`audit:${e.action}:${e.tenantId}`); }) };
  const outbox = { write: jest.fn(async (_tx: unknown, e: { tenantId: string; eventType: string }) => { writes.push(`outbox:${e.eventType}:${e.tenantId}`); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => Promise<unknown>) => fn()) };
  const svc = new GovApplicationsService(repo as any, audit as any, outbox as any, idem as any);
  return { svc, repo, idem, writes, audit, outbox };
}
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? String(e));
const ready = { status: 'under_verification', verified: true, actorIsVerifier: false, actorIsApplicant: false, actorIsAssister: false };

describe('PC-56 GOV-2a · the act\'s refusal order (E2): refusals before idem.remember, never a write', () => {
  it('no key → GOV_IDEMPOTENCY_KEY_REQUIRED before anything is read', async () => {
    const t = build(ready);
    expect(await codeOf(t.svc.act(session(HEAD), APP, { act: 'approve' }, undefined))).toBe('GOV_IDEMPOTENCY_KEY_REQUIRED');
    expect(t.repo.actFacts).not.toHaveBeenCalled(); expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
  });
  it('a rejection without a code / without a sentence → named, before the facts are read', async () => {
    const t = build(ready);
    expect(await codeOf(t.svc.act(session(HEAD), APP, { act: 'reject', note: SENTENCE }, 'k'))).toBe('GOV_REASON_CODE_REQUIRED');
    expect(await codeOf(t.svc.act(session(HEAD), APP, { act: 'reject', reasonCode: 'other' }, 'k'))).toBe('GOV_REASON_REQUIRED');
    expect(t.repo.actFacts).not.toHaveBeenCalled(); expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
  });
  it('an officer approving → GOV_PERMISSION_MISSING before the facts are read', async () => {
    const t = build(ready);
    expect(await codeOf(t.svc.act(session(OFFICER), APP, { act: 'approve' }, 'k'))).toBe('GOV_PERMISSION_MISSING');
    expect(t.repo.actFacts).not.toHaveBeenCalled(); expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
  });
  it('the facts: not found / the checker / the applicant / the assister / not yet checked / an illegal step — each named, never reserved', async () => {
    for (const [f, code] of [
      [null, 'GOV_APPLICATION_NOT_FOUND'], [{ ...ready, actorIsVerifier: true }, 'GOV_DECIDER_IS_VERIFIER'], [{ ...ready, actorIsApplicant: true }, 'GOV_DECIDER_IS_APPLICANT'],
      [{ ...ready, actorIsAssister: true }, 'GOV_DECIDER_IS_ASSISTER'], [{ ...ready, verified: false }, 'GOV_NOT_VERIFIED'], [{ ...ready, status: 'approved' }, 'GOV_ACT_NOT_NOW'],
    ] as const) {
      const t = build(f as Record<string, unknown> | null);
      expect([code, await codeOf(t.svc.act(session(HEAD), APP, { act: 'approve' }, 'k'))]).toEqual([code, code]);
      expect(t.repo.actFacts).toHaveBeenCalledTimes(1); expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
    }
  });
  it('a malformed id → the same 404, nothing read', async () => {
    const t = build(ready);
    expect(await codeOf(t.svc.act(session(HEAD), 'not-a-uuid', { act: 'approve' }, 'k'))).toBe('GOV_APPLICATION_NOT_FOUND');
    expect(t.repo.actFacts).not.toHaveBeenCalled(); expect(t.idem.remember).not.toHaveBeenCalled();
  });
  it('the second person approves → through idem.remember; the act, then the organisation\'s audit row and the outbox event, in the act\'s transaction', async () => {
    const t = build(ready);
    const r = await t.svc.act(session(HEAD), APP, { act: 'approve' }, 'k');
    expect(r).toEqual({ id: APP, act: 'approve', status: 'approved', from: 'under_verification', decidedAt: '2026-11-11T00:00:00.000Z', recorded: true });
    expect(t.idem.remember).toHaveBeenCalledTimes(1);
    expect(t.idem.remember.mock.calls[0].slice(0, 3)).toEqual(['k', A, 'gov.applications.act']);
    expect(t.writes).toEqual(['act:approve', `audit:gov.application.approve:${ORG}`, `outbox:schemes.application_approved:${ORG}`]);
    // approval carries no amount — none is written anywhere
    expect(JSON.stringify([t.audit.write.mock.calls, t.outbox.write.mock.calls])).not.toMatch(/amount|minor|₹/i);
  });
  it('a rejection carries its code to the audit row and the outbox, and its sentence as the audit reason', async () => {
    const t = build(ready);
    await t.svc.act(session(HEAD), APP, { act: 'reject', reasonCode: 'documents_missing', note: `  ${SENTENCE}  ` }, 'k');
    expect(t.repo.act.mock.calls[0].slice(4, 7)).toEqual(['reject', 'documents_missing', SENTENCE]);
    const a = (t.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1];
    expect([a.reason, a.newValue.reasonCode, a.newValue.realm, a.tenantId]).toEqual([SENTENCE, 'documents_missing', 'gov', ORG]);
  });
});
