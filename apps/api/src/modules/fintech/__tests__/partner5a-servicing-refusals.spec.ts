// modules/fintech/__tests__/partner5a-servicing-refusals.spec.ts · PC-56 PARTNER-5a — THE FOUR NAMED REFUSALS (founder 5a-1 … 5a-4, survey F-1,
// F-2, F-3), unit level: each refusal is thrown with the founder's sentence BEFORE any idempotency record, lock, read or write; the two removed
// loan-status writes are proven absent from the SOURCE (not merely unreachable); `RESTRUCTURE_FLOW` is unchanged; and the milk-bill deduction
// (the member's agreed rail) is unchanged and pinned. The live proof is `src/__tests__/partner5a-servicing-lockdown.integration.spec.ts`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ServicingService, RESTRUCTURE_FLOW } from '../services/servicing.service';
import { LoanService } from '../services/loan.service';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SENT = {
  activation: 'A restructure cannot be activated on the platform yet: the agreed terms would not reach the loan and the loan could no longer be repaid. Nothing was changed.',
  acceptance: 'A borrower\'s acceptance cannot be recorded on the platform yet: the borrower has no screen to accept on, and no one may accept for her.',
  writeOff: 'A write-off cannot be recorded on the platform yet: it would keep no record of who decided it, when, or why, and would need a second person. Nothing was changed.',
  ownWallet: 'A repayment is made from the borrower\'s own wallet by the borrower. A desk cannot repay a member\'s loan from her wallet.',
};
const spyAll = () => {
  const uow = { run: jest.fn() }; const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, f: () => unknown) => f()) };
  const repo = { getRestructureForUpdate: jest.fn(), setRestructureStatus: jest.fn(), setLoanStatus: jest.fn(), lockLoan: jest.fn() };
  return { uow, idem, repo, svc: new ServicingService(uow as any, repo as any, idem as any) };
};
const MANAGER = { userId: 'u-desk', canManage: true };

describe('PC-56 PARTNER-5a · servicing refusals (unit)', () => {
  it('5a-1 · `activated` → 409 RESTRUCTURE_ACTIVATION_NOT_LIVE with the sentence, and nothing was touched — no idempotency record, no lock, no write', async () => {
    const { uow, idem, repo, svc } = spyAll();
    await expect(svc.transitionRestructure('t', MANAGER, 'r', 'activated', 'k')).rejects.toMatchObject({ code: 'RESTRUCTURE_ACTIVATION_NOT_LIVE', httpStatus: 409, message: SENT.activation });
    expect([idem.remember.mock.calls.length, uow.run.mock.calls.length, repo.getRestructureForUpdate.mock.calls.length, repo.setLoanStatus.mock.calls.length]).toEqual([0, 0, 0, 0]);
  });
  it('5a-2 · `accepted` → 409 RESTRUCTURE_ACCEPTANCE_NOT_LIVE from every session, and nothing was touched', async () => {
    const { uow, idem, svc } = spyAll();
    for (const actor of [MANAGER, { userId: 'u-other', canManage: true }]) {
      await expect(svc.transitionRestructure('t', actor, 'r', 'accepted', 'k')).rejects.toMatchObject({ code: 'RESTRUCTURE_ACCEPTANCE_NOT_LIVE', httpStatus: 409, message: SENT.acceptance });
    }
    expect([idem.remember.mock.calls.length, uow.run.mock.calls.length]).toEqual([0, 0]);
  });
  it('a non-manager is still refused as before (the permission check stays first)', async () => {
    const { svc } = spyAll();
    await expect(svc.transitionRestructure('t', { userId: 'u', canManage: false }, 'r', 'activated', 'k')).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('the other transitions still run: `mediation` reaches the lock and writes the restructure row only; the proposer cannot be the checker', async () => {
    const { uow, repo, svc } = spyAll();
    uow.run.mockImplementation(async (_t: string, f: (tx: unknown) => unknown) => f({}));
    repo.getRestructureForUpdate.mockResolvedValue({ id: 'r', loanId: 'l', status: 'draft', proposedBy: 'u-desk' });
    await expect(svc.transitionRestructure('t', MANAGER, 'r', 'mediation', 'k')).resolves.toEqual({ id: 'r', status: 'mediation' });
    expect(repo.setRestructureStatus).toHaveBeenCalledTimes(1);
    repo.getRestructureForUpdate.mockResolvedValue({ id: 'r', loanId: 'l', status: 'accepted', proposedBy: 'u-desk' });
    await expect(svc.transitionRestructure('t', MANAGER, 'r', 'checker_approved', 'k')).rejects.toMatchObject({ httpStatus: 403, message: 'maker-checker: the checker must differ from the proposer' });
    await expect(svc.transitionRestructure('t', { userId: 'u-checker', canManage: true }, 'r', 'checker_approved', 'k')).resolves.toEqual({ id: 'r', status: 'checker_approved' });
    expect(repo.setLoanStatus).not.toHaveBeenCalled();
  });
  it('5a-3 · every write-off → 409 WRITE_OFF_NOT_LIVE, first — whatever the reason, no lock, no read, no write', async () => {
    const { uow, idem, repo, svc } = spyAll();
    for (const reason of ['', 'ab', 'a perfectly long written reason']) {
      await expect(svc.writeOff('t', MANAGER, 'l', reason, 'k')).rejects.toMatchObject({ code: 'WRITE_OFF_NOT_LIVE', httpStatus: 409, message: SENT.writeOff });
    }
    expect([idem.remember.mock.calls.length, uow.run.mock.calls.length, repo.lockLoan.mock.calls.length, repo.setLoanStatus.mock.calls.length]).toEqual([0, 0, 0, 0]);
  });
  it('THE TWO REMOVED WRITES, BY SOURCE: no loan-status write remains in servicing.service.ts; `restructured` survives only in the KCC serviceable list; `written_off` nowhere', () => {
    const src = code('services/servicing.service.ts');
    expect(src.length).toBeGreaterThan(2000);
    expect(src).not.toMatch(/setLoanStatus/);
    expect(src).not.toMatch(/'written_off'/);
    // the ONE remaining `'restructured'` is a READ: the KCC entry's list of statuses it will post against (unchanged by this wave)
    expect((src.match(/'restructured'/g) ?? []).length).toBe(1);
    expect(src).toMatch(/\['active', 'overdue', 'restructured'\]\.includes\(loan\.status\)/);
    // and the two refusals sit before the idempotency record in the source order of the method
    const t = src.slice(src.indexOf('async transitionRestructure'));
    expect(t.indexOf('RestructureActivationNotLiveError')).toBeLessThan(t.indexOf('this.idem.remember'));
    expect(t.indexOf('RestructureAcceptanceNotLiveError')).toBeLessThan(t.indexOf('this.idem.remember'));
  });
  it('RESTRUCTURE_FLOW is unchanged — the machine\'s vocabulary stays; only two transitions are refused by name', () => {
    expect(RESTRUCTURE_FLOW).toEqual({
      draft: ['mediation', 'rejected'], mediation: ['accepted', 'rejected', 'expired'],
      accepted: ['checker_approved', 'rejected'], checker_approved: ['activated', 'rejected'],
      activated: [], rejected: [], expired: [],
    });
  });
});

describe('PC-56 PARTNER-5a · the repay route debits the caller\'s own wallet only (unit)', () => {
  const mk = (borrowerUserId: string) => {
    const loan = { borrowerUserId, repay: jest.fn(), outstandingMinor: 0n, pullEvents: () => [], toJSON: () => ({}) };
    const loans = { getForUpdate: jest.fn(async () => loan), update: jest.fn() };
    const wallet = { post: jest.fn() }; const repayments = { insert: jest.fn() }; const audit = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, f: (tx: unknown) => unknown) => f({})) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, f: () => unknown) => f()) };
    const metrics = { timing: jest.fn(), increment: jest.fn(), histogram: jest.fn(), observe: jest.fn(), counter: jest.fn() };
    const svc = new LoanService(uow as any, { write: jest.fn() } as any, idem as any, metrics as any, audit as any, wallet as any, loans as any, repayments as any);
    return { svc, wallet, loans, repayments, loan };
  };
  it('5a-4 · a `loan.manage` holder who also borrows, repaying ANOTHER member\'s loan → 403 LOAN_REPAY_OWN_WALLET_ONLY; no ledger call, no repayment row', async () => {
    const { svc, wallet, repayments, loan } = mk('u-member');
    await expect(svc.repay('t', { userId: 'u-banker', canBorrow: true, canManage: true }, 'l', 'k', { amountMinor: '100', channel: 'wallet' } as any, null))
      .rejects.toMatchObject({ code: 'LOAN_REPAY_OWN_WALLET_ONLY', httpStatus: 403, message: SENT.ownWallet });
    expect([wallet.post.mock.calls.length, repayments.insert.mock.calls.length, loan.repay.mock.calls.length]).toEqual([0, 0, 0]);
  });
  it('a desk WITHOUT loan.borrow is refused before the loan is even read', async () => {
    const { svc, loans } = mk('u-member');
    await expect(svc.repay('t', { userId: 'u-desk', canBorrow: false, canManage: true }, 'l', 'k', { amountMinor: '100' } as any, null)).rejects.toMatchObject({ httpStatus: 403 });
    expect(loans.getForUpdate).not.toHaveBeenCalled();
  });
  it('the borrower repaying her OWN loan still posts the two legs: her wallet → the cooperative\'s main (unchanged)', async () => {
    const { svc, wallet } = mk('u-member');
    await svc.repay('t', { userId: 'u-member', canBorrow: true, canManage: false }, 'l', 'k', { amountMinor: '100', channel: 'wallet' } as any, null);
    expect(wallet.post).toHaveBeenCalledTimes(1);
    const legs = (wallet.post.mock.calls[0] as any[])[1].legs;
    expect(legs.map((x: { amountMinor: bigint }) => x.amountMinor)).toEqual([-100n, 100n]);
    expect(legs[0].account).toMatchObject({ userId: 'u-member' });
  });
  it('THE MILK-BILL DEDUCTION IS UNCHANGED AND PINNED: no permission check, the loan must be the paid member\'s own (404 otherwise), keyed on the deduction line', () => {
    const src = code('services/loan.service.ts');
    const at = src.indexOf('async applyMilkBillDeduction');
    const m = src.slice(at, src.indexOf('\n  async ', at + 10) > 0 ? src.indexOf('\n  async ', at + 10) : at + 2600);
    expect(m).toMatch(/if \(loan\.borrowerUserId !== input\.borrowerUserId\) throw new LoanNotFoundError\(input\.loanId\);/);
    expect(m).toMatch(/idempotencyKey: `milkdeduct:\$\{input\.deductionId\}`/);
    expect(m).toMatch(/channel: 'milk_bill_deduction'/);
    expect(m).not.toMatch(/LoanRepayOwnWalletOnlyError|canManage|canBorrow/);
    // and the repay route carries no `canManage` escape any more
    const r = src.slice(src.indexOf('async repay('), src.indexOf('async applyMilkBillDeduction'));
    expect(r).not.toMatch(/canManage/);
    expect(r).toMatch(/if \(loan\.borrowerUserId !== actor\.userId\) throw new LoanRepayOwnWalletOnlyError\(\);/);
  });
});
