// modules/support/__tests__/support-ticket.service.spec.ts · service unit tests with fakes.
// Pins: open files a requester ticket; agent actions require support.handle (throw otherwise) + audit; a
// non-owner non-agent read 404s (no IDOR); autoOpen is idempotent on ticket_no; transition records first response.
import { SupportTicketService } from '../services/support-ticket.service';
import { SupportTicket } from '../domain/support-ticket.entity';
import { TicketNotFoundError, SupportForbiddenError } from '../domain/support.errors';

const ticket = (over: Partial<any> = {}) => SupportTicket.rehydrate({ id: 't1', tenantId: 't1', ticketNo: 'KV-T-1', requesterUserId: 'req', channel: 'app', categoryId: null, severity: 'P2', subject: 'x', status: 'open', assigneeUserId: null, conversationId: null, slaFirstResponseDue: null, slaResolutionDue: null, firstRespondedAt: null, resolvedAt: null, csatScore: null, ...over });

function harness(opts: { ticket?: SupportTicket | null; exists?: boolean; csatAppends?: Array<{ id: string } | null>; latestScore?: number | null } = {}) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const repo = { insert: jest.fn(), getForUpdate: jest.fn(async () => opts.ticket ?? null), getById: jest.fn(async () => opts.ticket ?? null), update: jest.fn(), existsByTicketNo: jest.fn(async () => opts.exists ?? false), listFor: jest.fn() };
  // PC-56 ADMIN-2c: the CSAT ledger (0099). `append` returns null when the insert was deduped by the rating-occasion
  // index, which is how the service tells "recorded" from "already recorded".
  const appends = opts.csatAppends ? [...opts.csatAppends] : [{ id: 'csat-1' }];
  const csat = {
    append: jest.fn(async (_tx: any, _p: any) => (appends.length > 1 ? appends.shift() : appends[0])),
    latestScoreFor: jest.fn(async (_tx: any, _t: string, _id: string) => (opts.latestScore === undefined ? 5 : opts.latestScore)),
    historyFor: jest.fn(async (_t: string, _id: string) => [] as any[]),
  };
  const svc = new SupportTicketService(uow as any, outbox as any, idem as any, metrics as any, audit as any, repo as any, csat as any);
  return { svc, repo, audit, csat };
}
const requester = { userId: 'req', isAgent: false };
const agent = { userId: 'agt', isAgent: true };

describe('open', () => {
  it('files a requester ticket with SLA due dates', async () => {
    const h = harness();
    const out = await h.svc.open('t1', requester, 'idem-1', { channel: 'app', severity: 'P1', subject: 'help' } as any);
    expect(h.repo.insert).toHaveBeenCalledTimes(1); expect(out.severity).toBe('P1'); expect(out.slaResolutionDue).toBeTruthy();
  });
});

describe('agent actions', () => {
  it('transition requires support.handle (throws for a requester)', async () => {
    const h = harness({ ticket: ticket() });
    await expect(h.svc.transition('t1', requester, 't1', { to: 'resolved' } as any, null)).rejects.toBeInstanceOf(SupportForbiddenError);
  });
  it('agent transition records first response + writes audit', async () => {
    const h = harness({ ticket: ticket() });
    await h.svc.transition('t1', agent, 't1', { to: 'resolved' } as any, '1.1.1.1');
    expect(h.repo.update).toHaveBeenCalledTimes(1); expect(h.audit.write).toHaveBeenCalledTimes(1);
  });
});

describe('reads + autoOpen', () => {
  it('a stranger gets 404 (no IDOR)', async () => {
    const h = harness({ ticket: ticket() });
    await expect(h.svc.getById('t1', { userId: 'stranger', isAgent: false }, 't1')).rejects.toBeInstanceOf(TicketNotFoundError);
  });
  it('autoOpen is idempotent — skips when the ticket_no already exists', async () => {
    const h = harness({ exists: true });
    await h.svc.autoOpen({ query: jest.fn() } as any, { tenantId: 't1', ticketNo: 'DSP-X', requesterUserId: null, channel: 'app', severity: 'P1', subject: 's', categoryId: null });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PC-56 ADMIN-2c · the CSAT ledger. These tests exist because of a data-loss bug:
// `support_tickets.csat_score` is cleared on reopen (entity line ~58), so before migration 0099 a farmer's rating was
// DELETED when the desk reopened their ticket — and the ratings most likely to be followed by a reopen are the bad ones.
// ---------------------------------------------------------------------------
describe('submitCsat — the rating ledger', () => {
  const rated = () => ticket({ status: 'resolved', assigneeUserId: 'agt' });

  it('appends a ledger row and derives the column from the ledger, not from the input', async () => {
    const h = harness({ ticket: rated(), latestScore: 4 });
    const out = await h.svc.submitCsat('t1', requester, 't1', { score: 4 });
    expect(h.csat.append).toHaveBeenCalledTimes(1);
    expect(h.csat.append.mock.calls[0][1]).toMatchObject({
      tenantId: 't1', ticketId: 't1', respondentUserId: 'req', score: 4,
      comment: null, commentLanguage: null,
      ticketStatus: 'resolved',       // copied so a re-rating after a reopen is a different occasion
      ratedAgentUserId: 'agt',        // copied so a later reassignment cannot re-attribute the rating
    });
    expect(out.csatScore).toBe(4);
    expect(out.csatRecorded).toBe(true);
    expect(out.csatResponseId).toBe('csat-1');
  });

  it('writes the ledger row and the ticket in the SAME transaction (Law 4)', async () => {
    // both must land together: a ledger row with no derived column, or a column with no row, is two representations of
    // one fact disagreeing
    const h = harness({ ticket: rated() });
    await h.svc.submitCsat('t1', requester, 't1', { score: 5 });
    const txUsedForAppend = h.csat.append.mock.calls[0][0];
    expect(txUsedForAppend).toBe((h.repo.update as jest.Mock).mock.calls[0][0]);
  });

  it('carries the farmer\'s own words and the language they wrote them in', async () => {
    const h = harness({ ticket: rated(), latestScore: 2 });
    await h.svc.submitCsat('t1', requester, 't1', { score: 2, comment: '  पैसा नहीं आया  ', commentLanguage: 'hi' });
    expect(h.csat.append.mock.calls[0][1]).toMatchObject({ comment: 'पैसा नहीं आया', commentLanguage: 'hi' });
  });

  it('drops a language given with no comment — 0099 CHECKs the pair, and a language against no text is noise', async () => {
    const h = harness({ ticket: rated() });
    await h.svc.submitCsat('t1', requester, 't1', { score: 5, comment: '   ', commentLanguage: 'gu' });
    expect(h.csat.append.mock.calls[0][1]).toMatchObject({ comment: null, commentLanguage: null });
  });

  it('reports NOT recorded when the ledger deduped a double-tap, and keeps the existing latest score', async () => {
    // a flaky rural connection retrying must not thank somebody twice for one rating
    const h = harness({ ticket: rated(), csatAppends: [null], latestScore: 3 });
    const out = await h.svc.submitCsat('t1', requester, 't1', { score: 5 });
    expect(out.csatRecorded).toBe(false);
    // the column follows the LEDGER (3), not the rejected input (5)
    expect(out.csatScore).toBe(3);
  });

  it('sets the column to null when the ledger somehow holds nothing, rather than to the input', async () => {
    // unknown ≠ the number we were just handed: the column's meaning is "the latest rating in the ledger"
    const h = harness({ ticket: rated(), csatAppends: [null], latestScore: null });
    const out = await h.svc.submitCsat('t1', requester, 't1', { score: 5 });
    expect(out.csatScore).toBeNull();
  });

  it('still refuses anybody but the requester, and still 404s a stranger', async () => {
    const h = harness({ ticket: rated() });
    await expect(h.svc.submitCsat('t1', agent, 't1', { score: 5 })).rejects.toThrow(SupportForbiddenError);
    expect(h.csat.append).not.toHaveBeenCalled();
    const h2 = harness({ ticket: null });
    await expect(h2.svc.submitCsat('t1', requester, 't1', { score: 5 })).rejects.toThrow(TicketNotFoundError);
  });

  it('still refuses a rating on a ticket that is not closable — the entity owns that rule', async () => {
    const h = harness({ ticket: ticket({ status: 'open' }) });
    await expect(h.svc.submitCsat('t1', requester, 't1', { score: 5 })).rejects.toThrow();
    // nothing was appended: a refused rating must not leave a ledger row behind
    expect(h.csat.append).not.toHaveBeenCalled();
  });

  it('exposes the full rating history, which a reopen used to destroy', async () => {
    const h = harness({ ticket: rated() });
    await h.svc.csatHistory('t1', requester, 't1');
    expect(h.csat.historyFor).toHaveBeenCalledWith('t1', 't1');
    const stranger = harness({ ticket: null });
    await expect(stranger.svc.csatHistory('t1', requester, 't1')).rejects.toThrow(TicketNotFoundError);
  });
});
