// apps/admin-api/src/modules/ledger-ops/services/wallet-accounts.service.ts · W059 (PC-56 ADMIN-6).
//
// THE DEFECT THIS SERVICE FIXES: the console has been showing ONE STRIPE and calling it the balance. 0006's own comment
// says "true balance = SUM over stripes", and `GET /v1/recon/accounts/:id` returned one row by id — so a platform
// escrow balance read from the reconciliation console was roughly 1/16th of the money, with nothing on the screen
// saying so.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { LedgerOpsRepository } from '../repositories/ledger-ops.repository';
import {
  groupStripes, missingStripes, sumConfidence, chainClaim, formatMinor,
  PLATFORM_ACCOUNT_CODES, type StripeRow,
} from '../domain/accounts';
import { LedgerSubjectNotFoundError } from '../domain/ledger-ops.errors';
import type { QueryAccountsDto } from '../dto/ledger-ops.dto';

@Injectable()
export class WalletAccountsService {
  constructor(private readonly audit: AdminAuditWriter, private readonly repo: LedgerOpsRepository) {}

  /** W059's platform board: Σ per account_code, with the stripe count beside it.
   *
   *  `configuredStripeCount` is NOT read from the environment here, deliberately. `PLATFORM_STRIPE_COUNT` lives in the
   *  wallet-service's config and admin-api has no business reading another deployable's env — so the confidence check
   *  is fed `null` and reports on holes it can see rather than on a number it would be guessing. The stripe count is
   *  shown, which lets a human notice 15 where there should be 16. Named as ADMIN-6-Q5: the count belongs in the
   *  database as platform config, not in one service's env.
   */
  async platformBoard() {
    const stripes = await this.repo.platformStripes();
    const groups = groupStripes(stripes);
    const verifications = await Promise.all(
      groups.map(async (g) => {
        // The chain is per STRIPE ROW, not per account_code — each stripe has its own `last_entry_hash`, so an
        // account_code's "chain intact" is a claim about N chains. The newest verification across its stripes is the
        // most that can honestly be said, and the count of stripes ever verified says how much of it is covered.
        const ids = stripes.filter((s) => s.accountCode === g.accountCode && s.currencyCode === g.currencyCode).map((s) => s.id);
        const latest = await Promise.all(ids.map((id) => this.repo.latestVerification(id)));
        const present = latest.filter((v): v is NonNullable<typeof v> => !!v);
        const broken = present.find((v) => v.outcome === 'broken') ?? null;
        const newest = present.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
        return {
          accountCode: g.accountCode,
          claim: chainClaim(broken ?? newest),
          stripesVerified: present.length,
          stripeCount: g.stripeCount,
        };
      }));

    return {
      groups: groups.map((g) => ({
        accountCode: g.accountCode,
        currencyCode: g.currencyCode,
        stripeCount: g.stripeCount,
        totalMinor: g.totalMinor.toString(),
        totalText: formatMinor(g.totalMinor, g.currencyCode),
        frozenStripes: g.frozenStripes,
        shardNumbers: g.shardNumbers,
        missingStripes: missingStripes(g),
        confidence: sumConfidence(g, null),
        chain: verifications.find((v) => v.accountCode === g.accountCode) ?? null,
      })),
      totalStripeRows: stripes.length,
      // The codes W059 lists. An account_code the platform expects and has NO rows for is reported — a missing
      // account_code cannot be inferred from a Σ, and its absence means money has nowhere to land.
      expectedCodes: [...PLATFORM_ACCOUNT_CODES],
      missingCodes: PLATFORM_ACCOUNT_CODES.filter((c) => !groups.some((g) => g.accountCode === c)),
    };
  }

  async listOwned(q: QueryAccountsDto) {
    const rows = await this.repo.listOwnedAccounts({
      ownerKind: q.ownerKind, frozenOnly: q.frozenOnly === '1' || q.frozenOnly === 'true',
      cursor: q.cursor, limit: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((a) => this.view(a)),
      nextCursor: rows.length > q.limit && last ? last.id : null,
    };
  }

  private view(a: StripeRow) {
    return {
      id: a.id, ownerKind: a.ownerKind, accountCode: a.accountCode, currencyCode: a.currencyCode,
      shardNo: a.shardNo,
      cachedBalanceMinor: a.cachedBalanceMinor.toString(),
      cachedBalanceText: formatMinor(a.cachedBalanceMinor, a.currencyCode),
      balanceVersion: a.balanceVersion.toString(),
      hasChainHead: !!a.lastEntryHash,
      isFrozen: a.isFrozen, freezeReason: a.freezeReason,
    };
  }

  /** W059's "Verify balances vs ledger", for ONE account.
   *
   *  The same comparison the scheduled `internal_balance` job makes — the query that has existed twice since 0006 and
   *  had never run until this wave. On demand, because an operator looking at a suspicious balance should not have to
   *  wait for a sweep to reach it.
   *
   *  A DRIFT IS REPORTED WITH BOTH FIGURES AND THE DELTA, never as a boolean: the size and the direction are what tell
   *  somebody whether a farmer has been shown money they do not have, or denied money they do.
   */
  async verifyBalance(actor: AdminRequestContext, accountId: string) {
    const a = await this.repo.getAccount(accountId);
    if (!a) throw new LedgerSubjectNotFoundError('no such wallet account');
    const ledger = await this.repo.ledgerBalanceFor(accountId);
    const delta = a.cachedBalanceMinor - ledger;
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: delta === 0n ? 'ledger.balance_verified' : 'ledger.balance_drift_found',
      entityType: 'wallet_account', entityId: accountId,
      newValue: { cachedMinor: a.cachedBalanceMinor.toString(), ledgerMinor: ledger.toString(), deltaMinor: delta.toString() },
      reason: delta === 0n
        ? 'cached balance matches the ledger'
        : 'CACHED BALANCE DISAGREES WITH THE LEDGER — the figure shown to the account holder is wrong',
      ip: actor.ip, requestId: actor.requestId || null,
    });
    return {
      accountId, accountCode: a.accountCode, ownerKind: a.ownerKind, shardNo: a.shardNo,
      cachedMinor: a.cachedBalanceMinor.toString(), cachedText: formatMinor(a.cachedBalanceMinor, a.currencyCode),
      ledgerMinor: ledger.toString(), ledgerText: formatMinor(ledger, a.currencyCode),
      deltaMinor: delta.toString(), deltaText: formatMinor(delta, a.currencyCode),
      matches: delta === 0n,
      // The ledger is the truth and the cache is what gets read. Returned so no surface has to remember which is which.
      truthSource: 'ledger_entries',
    };
  }
}
