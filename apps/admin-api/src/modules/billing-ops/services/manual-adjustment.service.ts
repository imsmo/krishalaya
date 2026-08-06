// apps/admin-api/src/modules/billing-ops/services/manual-adjustment.service.ts · MANUAL billing adjustments
// (goodwill credit / clawback debit), now under MAKER-CHECKER (PC-56 ADMIN-1b, closes ADMIN-1-Q5; migration 0093).
//
// WHAT CHANGED AND WHY. Until this wave one operator could move up to ₹10,00,000 of a tenant's money alone: the
// endpoint validated, called the wallet-service, and it was done. Every other consequential money path here is
// maker-checker (co-op payouts, loan restructures, COD reconciliation, KCC write-offs) and the canon screen W014
// shows this one as maker-checker too — the control simply did not exist in the schema, so no UI could have added it.
//
// THE THREE ACTS ARE NOW SEPARATE, AND SO ARE THE FACTS THEY RECORD:
//   request() → writes an `awaiting_approval` row with NO wallet txn. Nothing has moved. This is a request, and the
//               row says so.
//   decide()  → a DIFFERENT operator approves / returns / rejects. `ck_billing_adj_maker_ne_checker` in 0093 makes
//               self-approval unrepresentable, so the rule cannot be lost by a future caller written against the
//               table instead of this service.
//   apply()   → only from `approved`, and only here is the wallet-service called (Law 2/9 — this service still never
//               writes the ledger). The idempotency key is minted HERE, not at request time, because that is when a
//               post can be retried; a key fixed at request time would be reused across an approve→reject→resubmit
//               cycle and turn the corrected adjustment into a silent no-op at the wallet.
//
// A wallet failure leaves the row `approved` (never half-applied) with an audit 'failed' entry, so a retry is clean
// and the money is either moved and recorded or neither.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { WALLET_ADMIN, WalletAdminPort } from '../../../core/wallet/wallet-admin.port';
import { BillingRepository, AdjustmentListQuery } from '../repositories/billing.repository';
import { assertAdjustmentAmount, buildAdjustmentLegs } from '../domain/adjustment';
import {
  BillingTenantNotFoundError, WalletAdjustmentFailedError, AdjustmentNotFoundError,
  AdjustmentStateError, SelfApprovalError,
} from '../domain/billing-ops.errors';
import { RequestAdjustmentDto, DecideAdjustmentDto } from '../dto/billing-ops.dto';

@Injectable()
export class ManualAdjustmentService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
    @Inject(WALLET_ADMIN) private readonly wallet: WalletAdminPort,
  ) {}

  /** MAKER: record the request. No money moves; no wallet call; no idempotency key yet (see the header). */
  async request(actor: AdminRequestContext, dto: RequestAdjustmentDto) {
    const amount = assertAdjustmentAmount(BigInt(dto.amountMinor));      // 422 on zero/negative/over-cap
    if (!(await this.repo.tenantExists(dto.tenantId))) throw new BillingTenantNotFoundError(dto.tenantId);

    return this.pool.withTx(async (client) => {
      const row = await this.repo.insertAdjustmentRequest(client, {
        id: randomUUID(), tenantId: dto.tenantId, subscriptionId: dto.subscriptionId ?? null,
        invoiceId: dto.invoiceId ?? null, direction: dto.direction, amountMinor: amount,
        currency: dto.currency, reason: dto.reason, requestedBy: actor.userId,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.adjustment_requested', entityType: 'billing_adjustment', entityId: String(row.id),
        newValue: { tenantId: dto.tenantId, direction: dto.direction, amountMinor: amount.toString(), status: 'awaiting_approval' },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return row;
    });
  }

  /** CHECKER: approve, return for correction, or reject. A second pair of eyes — enforced by the DB, mirrored here so
   *  the caller gets a 403 that explains itself rather than a constraint violation. */
  async decide(actor: AdminRequestContext, id: string, dto: DecideAdjustmentDto) {
    return this.pool.withTx(async (client) => {
      const row = await this.repo.getAdjustmentForUpdate(client, id);
      if (!row) throw new AdjustmentNotFoundError(id);
      if (row.status !== 'awaiting_approval') {
        throw new AdjustmentStateError(`adjustment is '${row.status}'; only an awaiting_approval request can be decided`);
      }
      if (row.requestedBy && row.requestedBy === actor.userId) throw new SelfApprovalError();

      const status = dto.decision === 'approve' ? 'approved' : dto.decision === 'return' ? 'returned' : 'rejected';
      const note = dto.note?.trim() || null;
      await this.repo.decideAdjustment(client, id, status, actor.userId, note);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: `billing.adjustment_${status}`, entityType: 'billing_adjustment', entityId: id,
        oldValue: { status: row.status },
        newValue: { status, requestedBy: row.requestedBy, amountMinor: row.amountMinor, direction: row.direction },
        reason: note ?? `adjustment ${status}`, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ...row, status, decidedBy: actor.userId, decisionNote: note };
    });
  }

  /** APPLY: the only place money moves. Approved-only, and the row is locked so two operators cannot both apply it.
   *  The wallet post happens OUTSIDE the tx that stamps it, so a wallet timeout cannot leave a committed row claiming
   *  money that never left — the row stays `approved` and the retry is clean. */
  async apply(actor: AdminRequestContext, id: string) {
    // read + validate under a lock, then release before the network call
    const row = await this.pool.withTx(async (client) => {
      const r = await this.repo.getAdjustmentForUpdate(client, id);
      if (!r) throw new AdjustmentNotFoundError(id);
      if (r.status === 'applied') return r;                              // idempotent: already done, say so
      if (r.status !== 'approved') {
        throw new AdjustmentStateError(`adjustment is '${r.status}'; only an approved adjustment can be applied`);
      }
      return r;
    });
    if (row.status === 'applied') return row;

    const tenantId = String(row.tenantId);
    const amount = assertAdjustmentAmount(BigInt(String(row.amountMinor)));
    const direction = String(row.direction) as 'credit' | 'debit';
    const legs = buildAdjustmentLegs(tenantId, direction, amount);
    // Minted at APPLY time and derived from the ROW id, so it is stable across retries of this apply and unique to
    // this adjustment — a resubmitted, corrected adjustment is a different row and therefore a different key.
    const walletKey = `billing_adjustment:${tenantId}:${id}`;

    let res: { txnId: string; alreadyApplied: boolean };
    try {
      res = await this.wallet.post({
        tenantId, txnType: 'billing_adjustment', idempotencyKey: walletKey, legs, currencyCode: String(row.currency),
        referenceType: 'billing_adjustment', referenceId: id, initiatedBy: actor.userId, description: String(row.reason),
      });
    } catch (e: any) {
      await this.audit.log({
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.adjustment_failed', entityType: 'billing_adjustment', entityId: id,
        newValue: { tenantId, direction, amountMinor: amount.toString(), status: 'approved' },
        reason: String(row.reason), ip: actor.ip, requestId: actor.requestId || null,
      });
      throw new WalletAdjustmentFailedError(e?.message ?? 'wallet-service error');
    }

    return this.pool.withTx(async (client) => {
      await this.repo.markAdjustmentApplied(client, id, res.txnId, walletKey, actor.userId);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.adjustment_applied', entityType: 'billing_adjustment', entityId: id,
        oldValue: { status: 'approved' },
        newValue: { tenantId, direction, amountMinor: amount.toString(), walletTxnId: res.txnId, alreadyApplied: res.alreadyApplied },
        reason: String(row.reason), ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ...row, status: 'applied', walletTxnId: res.txnId };
    });
  }

  async list(q: AdjustmentListQuery) {
    const items = await this.repo.listAdjustments(q);
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
}
