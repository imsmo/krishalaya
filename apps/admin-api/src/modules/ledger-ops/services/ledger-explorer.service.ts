// apps/admin-api/src/modules/ledger-ops/services/ledger-explorer.service.ts · W064 + W065 (PC-56 ADMIN-6).
//
// W064 calls the ledger "the single source of money truth". This is the first console surface that reads it — the
// recon repository's own header says it "NEVER touches ledger_entries/ledger_transactions", which was the right
// boundary for recon and is exactly what this module crosses, under its own permission.
//
// EVERY MONEY FIGURE LEAVES AS A STRING of minor units plus a preformatted display string. A bigint does not survive
// `JSON.stringify` and converting it to a number on the way out would undo Law 2 at the last possible moment.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { LedgerOpsRepository, type TxnRow, type EntryRow } from '../repositories/ledger-ops.repository';
import { formatMinor } from '../domain/accounts';
import {
  verifyChain, checkHead, txnBalance, balanceEquation, HASH_PREIMAGE, WRITER_SOURCES,
} from '../domain/hash-chain';
import { LedgerSubjectNotFoundError, LedgerWindowTooWideError, InvalidLedgerQueryError } from '../domain/ledger-ops.errors';
import type { QueryTxnsDto, VerifyChainDto } from '../dto/ledger-ops.dto';

/** W064: "Date filters default today (partition pruning)". Enforced, not suggested — `ledger_entries` and
 *  `ledger_transactions` are partitioned by `created_at`, and a query with no lower bound scans every partition ever
 *  created on the two tables that grow fastest and are never deleted from. */
export const MAX_LIVE_WINDOW_DAYS = 31;

/** Entries walked per chain verification. A hash chain has to be verified forward from an anchor, so a bounded walk
 *  reports `incomplete` rather than pretending — which is why the number can be modest without being dishonest. */
export const CHAIN_WALK_LIMIT = 5_000;

@Injectable()
export class LedgerExplorerService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: LedgerOpsRepository,
  ) {}

  /** The window, defaulted and bounded. Defaults to TODAY rather than to everything, which is the partition-pruning
   *  rule; defaulting the other way is how a console query becomes a full scan of the money tables. */
  private window(from?: string, to?: string): { from: Date; to: Date } {
    const toD = to ? new Date(to) : new Date();
    if (!Number.isFinite(toD.getTime())) throw new InvalidLedgerQueryError('the window end could not be read as a date');
    const fromD = from
      ? new Date(from)
      : new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth(), toD.getUTCDate()));
    if (!Number.isFinite(fromD.getTime())) throw new InvalidLedgerQueryError('the window start could not be read as a date');
    if (fromD.getTime() > toD.getTime()) throw new InvalidLedgerQueryError('the window starts after it ends');
    const days = (toD.getTime() - fromD.getTime()) / 86_400_000;
    if (days > MAX_LIVE_WINDOW_DAYS) {
      // W064's own error state: "Historic months need the signed-export path rather than live scan." The message says
      // what the operator should do instead, and says honestly that the signed export is not built.
      throw new LedgerWindowTooWideError(
        `that window is ${Math.ceil(days)} days and the live explorer allows ${MAX_LIVE_WINDOW_DAYS}. The ledger is `
        + 'partitioned by date and a wider live scan reads every partition on the two fastest-growing tables on the '
        + 'platform. A longer period needs the signed export — which does not exist yet, because signing needs a key '
        + 'nobody has issued (the same gap W018 and W039 name).');
    }
    return { from: fromD, to: toD };
  }

  private txnView(t: TxnRow) {
    return {
      id: t.id, txnType: t.txnTypeCode, tenantId: t.tenantId,
      referenceType: t.referenceType, referenceId: t.referenceId,
      description: t.description, idempotencyKey: t.idempotencyKey, initiatedBy: t.initiatedBy,
      createdAt: t.createdAt,
      legCount: t.legCount,
      // MAGNITUDE, not a sum: a healthy transaction's legs sum to zero, so a Σ column would read ₹0.00 on every row.
      magnitudeMinor: t.magnitudeMinor === null ? null : t.magnitudeMinor.toString(),
      magnitudeText: t.magnitudeMinor === null ? null : formatMinor(t.magnitudeMinor),
      // An unresolvable txn type is reported as such rather than blanked. `txn_type_id` is an FK to `lookup_values`
      // and a NULL code means the join failed, which is a data fault and not a transaction without a type.
      txnTypeResolved: t.txnTypeCode !== null,
    };
  }

  async list(q: Omit<QueryTxnsDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const w = this.window(q.from, q.to);
    const rows = await this.repo.listTxns({
      from: w.from, to: w.to, txnTypeCode: q.txnType, tenantId: q.tenantId,
      accountCode: q.accountCode, cursor: q.cursor, limit: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((t) => this.txnView(t)),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      window: { from: w.from.toISOString(), to: w.to.toISOString(), maxDays: MAX_LIVE_WINDOW_DAYS },
      // W064: "txn types are dynamic master data (lookup ledger_txn_type) — a new money product is an INSERT, never a
      // code change." So the filter's options are read, never hardcoded.
      txnTypes: await this.repo.txnTypes(),
    };
  }

  /** W065. Reading one transaction's legs is an audited act: it names every counterparty and every balance involved,
   *  across tenants, which is the most complete picture of who paid whom that this platform holds. */
  async txn(actor: AdminRequestContext, ref: { id?: string; idempotencyKey?: string }) {
    const t = ref.id
      ? await this.repo.getTxn(ref.id)
      : ref.idempotencyKey ? await this.repo.getTxnByIdempotencyKey(ref.idempotencyKey) : null;
    if (!t) {
      throw new LedgerSubjectNotFoundError(
        'no such transaction. Retried operations share one transaction, so an idempotency key finds the original.');
    }
    const legs = await this.repo.legsFor(t.id);
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'ledger.transaction_read', entityType: 'ledger_transaction', entityId: t.id,
      newValue: { legs: legs.length }, reason: 'ledger transaction opened',
      ip: actor.ip, requestId: actor.requestId || null,
    });

    const amounts = legs.map((l) => l.amountMinor);
    const bal = txnBalance(amounts);
    return {
      ...this.txnView({ ...t, legCount: legs.length, magnitudeMinor: amounts.reduce((a, x) => a + (x < 0n ? -x : x), 0n) / 2n }),
      legs: legs.map((l) => this.legView(l)),
      // RECOMPUTED on every read, never trusted from a status column — there is no `is_balanced` flag on the table and
      // there should not be, because a stored flag is a claim that can disagree with the rows this screen exists to show.
      balance: {
        balanced: bal.balanced, sumMinor: bal.sumMinor.toString(), sumText: formatMinor(bal.sumMinor),
        legCount: bal.legCount, tooFewLegs: 'tooFewLegs' in bal,
        equation: balanceEquation(amounts),
      },
      hashPreimage: HASH_PREIMAGE,
      writerSources: WRITER_SOURCES,
    };
  }

  private legView(l: EntryRow) {
    return {
      id: l.id, accountId: l.accountId, accountCode: l.accountCode, ownerKind: l.ownerKind,
      shardNo: l.shardNo, tenantId: l.tenantId, currencyCode: l.currencyCode,
      amountMinor: l.amountMinor.toString(), amountText: formatMinor(l.amountMinor, l.currencyCode),
      balanceAfterMinor: l.balanceAfterMinor.toString(), balanceAfterText: formatMinor(l.balanceAfterMinor, l.currencyCode),
      // BOTH hashes, in full. W065 shows a truncation and the console truncates for display — but the API returns the
      // whole thing, because a responder comparing hashes needs all 64 characters and the screen is where a
      // truncation belongs, not the wire.
      prevHash: l.prevHash, entryHash: l.entryHash,
      createdAt: l.createdAt,
    };
  }

  /**
   * W064's "Verify chain (period)" and W065's "Verify hashes" — THE FIRST CODE ON THIS PLATFORM THAT READS `prev_hash`.
   *
   * The result is RECORDED, not merely returned. W006 and W059 have printed "hash chain intact" with nothing behind
   * them, and a tamper-evidence claim is worth exactly as much as the last time somebody checked — so the console can
   * now say WHEN, and "never" until a row exists.
   */
  async verify(actor: AdminRequestContext, dto: VerifyChainDto) {
    const account = await this.repo.getAccount(dto.accountId);
    if (!account) throw new LedgerSubjectNotFoundError('no such wallet account');
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from ? new Date(dto.from) : null;
    if (!Number.isFinite(to.getTime()) || (from && !Number.isFinite(from.getTime()))) {
      throw new InvalidLedgerQueryError('the verification window could not be read as dates');
    }

    const entries = await this.repo.chainEntries(dto.accountId, from, to, CHAIN_WALK_LIMIT + 1);
    const walked = entries.slice(0, CHAIN_WALK_LIMIT);
    const truncated = entries.length > CHAIN_WALK_LIMIT;

    // Whether the first entry walked is the account's genesis. Asked of the database rather than inferred from "the
    // window had no lower bound", because an account whose earliest entry predates the window is a real and common
    // case and inferring would report `intact` over an unanchored walk.
    const fromGenesis = walked.length > 0 && await this.repo.isGenesisFirst(dto.accountId, walked[0].id);
    const result = verifyChain(walked, fromGenesis);
    const head = checkHead(result.headHash, account.lastEntryHash, !truncated);

    const id = await this.pool.withTx(async (c) => {
      const vid = await this.repo.recordVerification(c, {
        accountId: dto.accountId, fromCreatedAt: from, toCreatedAt: to,
        entriesChecked: result.entriesChecked, outcome: result.outcome,
        brokenAtEntryId: result.outcome === 'broken' ? result.brokenAtEntryId : null,
        expectedHash: result.outcome === 'broken' ? result.expectedHash : null,
        storedHash: result.outcome === 'broken' ? result.storedHash : null,
        headHash: result.headHash, verifiedBy: actor.userId,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: result.outcome === 'broken' ? 'ledger.chain_broken' : 'ledger.chain_verified',
        entityType: 'wallet_account', entityId: dto.accountId,
        newValue: {
          verificationId: vid, outcome: result.outcome, entriesChecked: result.entriesChecked,
          headCheck: head.kind, truncated,
          ...(result.outcome === 'broken' ? { brokenAtEntryId: result.brokenAtEntryId, kind: result.kind } : {}),
        },
        // A BROKEN chain is a P0 and the audit row says so in words, because whoever reads the ledger next needs to
        // know this row is not routine.
        reason: result.outcome === 'broken'
          ? 'HASH CHAIN BROKEN — P0. The stored ledger disagrees with its own hashes.'
          : 'ledger hash chain verified',
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return vid;
    });

    return {
      verificationId: id,
      accountId: dto.accountId,
      accountCode: account.accountCode,
      outcome: result.outcome,
      entriesChecked: result.entriesChecked,
      fromGenesis,
      truncated,
      walkLimit: CHAIN_WALK_LIMIT,
      headCheck: head,
      ...(result.outcome === 'broken'
        ? { brokenAtEntryId: result.brokenAtEntryId, expectedHash: result.expectedHash, storedHash: result.storedHash, kind: result.kind }
        : {}),
      ...(result.outcome === 'incomplete' ? { reason: result.reason } : {}),
      hashPreimage: HASH_PREIMAGE,
      // W065: "a mismatch here is a P0 incident, not a retry." Returned as a flag rather than left to the console to
      // remember, so every surface that renders this result says the same thing about it.
      p0: result.outcome === 'broken',
    };
  }
}
