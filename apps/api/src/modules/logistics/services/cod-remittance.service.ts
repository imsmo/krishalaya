// modules/logistics/services/cod-remittance.service.ts · PC-55 A2. The rider-cash → bank ledger.
// LAWS, all server-side:
//  • THE TOTAL IS NEVER TYPED. It is SUM(cod_minor) over the rider's locked, unremitted delivered shipments.
//    A caller MAY send expectedAmountMinor (from the worksheet they were looking at); a mismatch is a 409, not
//    a silent overwrite — that's how a stale screen is caught instead of banking a wrong figure.
//  • ONCE ONLY. The 0082 UNIQUE(shipment_id) means a shipment's cash can belong to one live batch, ever;
//    a mid-flight race surfaces as a typed conflict.
//  • MAKER ≠ CHECKER. Reconcile is refused when the reconciler is the person who banked it.
//  • CANCEL RELEASES. A mis-keyed batch can be cancelled with a reason; its shipments return to the worksheet.
//  • IDEMPOTENT create (Law 3): a retried tap returns the same batch, never a second one.
//  • PC-56 TENANT-SW-a (C1 / C2): with `cod_ledger` ON, RECONCILE posts cod-remit:<remittance> (the rider's cash_in_hand +, cash_clearing −)
//    in the same transaction — the rider's liability returns to zero against the bank fact (CodLedgerService has the leg table). The batch
//    total is the cash actually COLLECTED (cod_collections) where the ledger recorded a collection, the shipment's COD figure otherwise.
//    Every act is audited WITH its reason (creation used to write `reason: null`).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { CodRemittanceRepository } from '../repositories/cod-remittance.repository';
import { batchTotalMinor, expectedMatches, canReconcile, canTransition, type RemittanceStatus } from '../domain/cod-remittance.rules';
import { CodLedgerService } from './cod-ledger.service';

export interface RemitActor { userId: string; canManage: boolean }

@Injectable()
export class CodRemittanceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: CodRemittanceRepository,
    private readonly audit: AuditWriter,
    private readonly ledger: CodLedgerService,
  ) {}
  private assert(a: RemitActor) { if (!a.canManage) throw new ForbiddenError('requires logistics.manage'); }

  /** Create the batch. Optionally bank it in the same breath (depositRef present ⇒ status 'deposited'). */
  async create(tenantId: string, a: RemitActor, key: string, dto: { riderUserId: string; shipmentIds?: string[]; expectedAmountMinor?: string; depositRef?: string; depositMethod?: string; currencyCode?: string; reason?: string }, ip: string | null) {
    this.assert(a);
    const why = (dto.reason ?? '').trim();
    if (why.length < 3) throw new BadRequestError('a reason is required to open a cash batch (it is recorded in the audit trail)');
    const id = uuidv7();
    return this.uow.run(tenantId, async (tx) => {
      const ships = await this.repo.lockRemittable(tx, tenantId, dto.riderUserId, dto.shipmentIds);
      if (ships.length === 0) throw new ConflictError('this rider has no unremitted delivered COD shipments');
      if (dto.shipmentIds?.length && ships.length !== dto.shipmentIds.length) {
        throw new ConflictError('some listed shipments are not remittable (not delivered, no COD, or already remitted)');
      }
      const total = batchTotalMinor(ships);                                       // THE server-computed figure
      if (!expectedMatches(dto.expectedAmountMinor, total)) {
        throw new ConflictError(`the worksheet has moved: server total is ${total.toString()} minor units, not ${dto.expectedAmountMinor}`);
      }
      const status = dto.depositRef ? 'deposited' : 'collected';
      const ins = await this.repo.insert(tx, {
        id, tenantId, riderUserId: dto.riderUserId, amountMinor: total, shipmentCount: ships.length,
        currencyCode: dto.currencyCode ?? 'INR', status, depositRef: dto.depositRef, depositMethod: dto.depositMethod,
        depositedBy: a.userId, idempotencyKey: key,
      });
      if (!ins.ok) throw new ConflictError('this remittance was already recorded (idempotency-key replay)');
      const linked = await this.repo.link(tx, tenantId, id, ships);
      if (!linked.ok) throw new ConflictError('another batch claimed one of these shipments — refresh the worksheet');
      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: 'logistics.cod_remittance_created', entityType: 'cod_remittance', entityId: id,
        oldValue: null, newValue: { riderUserId: dto.riderUserId, amountMinor: total.toString(), shipmentCount: ships.length, status, depositRef: dto.depositRef ?? null }, reason: why, ip,
      });
      return { id, status, amountMinor: total.toString(), shipmentCount: ships.length };
    }, { userId: a.userId });
  }

  /** collected → deposited (attach the bank reference). */
  async deposit(tenantId: string, a: RemitActor, id: string, dto: { depositRef: string; depositMethod: string }, ip: string | null) {
    this.assert(a);
    if (!dto.depositRef?.trim()) throw new BadRequestError('depositRef is required to bank a remittance');
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.lock(tx, tenantId, id);
      if (!r) throw new NotFoundError('remittance not found');
      if (!canTransition(r.status as RemittanceStatus, 'deposited')) throw new ConflictError(`a ${r.status} remittance cannot be deposited`);
      await this.repo.markDeposited(tx, tenantId, id, a.userId, dto.depositRef.trim(), dto.depositMethod);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cod_remittance_deposited', entityType: 'cod_remittance', entityId: id,
        oldValue: { status: 'collected' }, newValue: { status: 'deposited', depositRef: dto.depositRef.trim(), depositMethod: dto.depositMethod }, reason: `banked, reference ${dto.depositRef.trim()}`, ip });
      return { id, status: 'deposited' as const };
    }, { userId: a.userId });
  }

  /** deposited → reconciled. MAKER ≠ CHECKER: the banker cannot verify their own deposit. */
  async reconcile(tenantId: string, a: RemitActor, id: string, note: string | undefined, ip: string | null) {
    this.assert(a);
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.lock(tx, tenantId, id);
      if (!r) throw new NotFoundError('remittance not found');
      if (!canTransition(r.status as RemittanceStatus, 'reconciled')) throw new ConflictError(`a ${r.status} remittance cannot be reconciled`);
      if (!canReconcile(r.status as RemittanceStatus, r.deposited_by, a.userId)) throw new ForbiddenError('maker-checker: the person who banked this cash cannot reconcile it');
      await this.repo.markReconciled(tx, tenantId, id, a.userId, note);
      // C1 · the money: the rider's cash-in-hand clears against the bank deposit (cod_ledger ON; nothing collected on the ledger → no legs)
      let remit: { txnId: string | null; amountMinor: bigint } = { txnId: null, amountMinor: 0n };
      if (await this.ledger.enabled(tenantId)) {
        const shipmentIds = await this.repo.shipmentIdsTx(tx, tenantId, id);
        remit = await this.ledger.remitOnReconcileInTx(tx, { tenantId, remittanceId: id, riderUserId: r.rider_user_id, shipmentIds, actorUserId: a.userId });
      }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cod_remittance_reconciled', entityType: 'cod_remittance', entityId: id,
        oldValue: { status: 'deposited' }, newValue: { status: 'reconciled', amountMinor: r.amount_minor, ledgerRemittedMinor: remit.amountMinor.toString(), remitTxnId: remit.txnId },
        reason: note?.trim() || 'deposit verified against the bank by a second person', ip });
      return { id, status: 'reconciled' as const, remitTxnId: remit.txnId, ledgerRemittedMinor: remit.amountMinor.toString() };
    }, { userId: a.userId });
  }

  /** Cancel a mis-keyed batch (pre-reconcile only) — RELEASES its shipments back to the worksheet. */
  async cancel(tenantId: string, a: RemitActor, id: string, reason: string, ip: string | null) {
    this.assert(a);
    if (!reason || reason.trim().length < 3) throw new BadRequestError('a written reason is required to cancel a cash batch');
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.lock(tx, tenantId, id);
      if (!r) throw new NotFoundError('remittance not found');
      if (!canTransition(r.status as RemittanceStatus, 'cancelled')) throw new ConflictError(`a ${r.status} remittance cannot be cancelled`);
      await this.repo.cancel(tx, tenantId, id, reason.trim());
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cod_remittance_cancelled', entityType: 'cod_remittance', entityId: id,
        oldValue: { status: r.status }, newValue: { status: 'cancelled', releasedShipments: true }, reason: reason.trim(), ip });
      return { id, status: 'cancelled' as const };
    }, { userId: a.userId });
  }

  /** Oldest-first page, MICROSECOND keyset (F-14). */
  async list(tenantId: string, a: RemitActor, q: { riderUserId?: string; status?: string; limit: number; cursor?: string }) {
    this.assert(a);
    const rows = await this.repo.list(tenantId, { ...q, cursor: decodeKeyset(q.cursor, UUID_RE) });
    return rows;
  }
  async get(tenantId: string, a: RemitActor, id: string) {
    this.assert(a);
    const r = await this.repo.get(tenantId, id);
    if (!r) throw new NotFoundError('remittance not found');
    return r;
  }
}
