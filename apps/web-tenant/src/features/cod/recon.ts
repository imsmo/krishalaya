// apps/web-tenant/src/features/cod/recon.ts · PURE COD-reconciliation rules (PC-55 B8, on W54-2 + PC-55 A2).
// Framework-free mirror of the A2 remittance rules, and the one place in this console where cash a rider is holding
// becomes a number the tenant will bank.
//
// THE LAW A2 ESTABLISHED, AND WHY EVERY LINE HERE SERVES IT:
//   1. THE TOTAL IS SERVER-COMPUTED. The console may send `expectedAmountMinor` — the figure the operator was LOOKING
//      AT — and the API refuses (409) if the real total has moved since. That is the opposite of trusting a client
//      total: it is a stale-read guard, so a rider is never credited with a number nobody re-checked.
//   2. MAKER ≠ CHECKER ON RECONCILE. Whoever recorded the deposit cannot be the person who confirms the bank saw it.
//      The console withholds the button rather than letting one person do both and read a 403.
//   3. A DELIVERED COD SHIPMENT IS COUNTED ONCE, EVER (a DB unique index). So the worksheet never invites an
//      operator to "re-add" a shipment: if it is missing from the outstanding list, it is already on a remittance.
export const REMITTANCE_STATUSES = ['pending', 'deposited', 'reconciled', 'cancelled'] as const;
export type RemittanceStatus = (typeof REMITTANCE_STATUSES)[number];
export const DEPOSIT_METHODS = ['bank_branch', 'cash_office', 'upi', 'other'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

export function isRemittanceStatus(v: string | undefined | null): v is RemittanceStatus {
  return !!v && (REMITTANCE_STATUSES as readonly string[]).includes(v);
}
export function isDepositMethod(v: string | undefined | null): v is DepositMethod {
  return !!v && (DEPOSIT_METHODS as readonly string[]).includes(v);
}

export interface OutstandingRow { riderUserId?: string | null; shipments?: number | null; codMinor?: string | null; oldestDeliveredAt?: string | null }

/** Oldest cash first: the risk in COD is time-in-hand, so the rider holding money longest is the one to chase.
 *  A row with no date sorts LAST rather than first — an unknown age must not outrank a known three-week-old bag. */
export function sortOutstanding<T extends OutstandingRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const av = (a.oldestDeliveredAt ?? '').trim();
    const bv = (b.oldestDeliveredAt ?? '').trim();
    if (av && !bv) return -1;
    if (!av && bv) return 1;
    if (!av && !bv) return 0;
    return av.localeCompare(bv);
  });
}

/** How long the oldest cash in this row has been out, in whole days. */
export function daysHeld(oldestDeliveredAt: string | null | undefined, nowMs: number): number | null {
  const s = (oldestDeliveredAt ?? '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Cash held longer than this is worth flagging. Not a policy the platform enforces — a tenant's own credit terms
 *  differ — so it only sorts and highlights, and the page says the threshold is a display choice. */
export const AGEING_WARN_DAYS = 3;
export function isAgeing(oldestDeliveredAt: string | null | undefined, nowMs: number, warnDays = AGEING_WARN_DAYS): boolean {
  const d = daysHeld(oldestDeliveredAt, nowMs);
  return d !== null && d >= warnDays;
}

/** Total cash outstanding across riders, summed as bigint minor units (Law 2 — never a float). */
export function totalOutstandingMinor(rows: readonly OutstandingRow[]): bigint {
  let total = 0n;
  for (const r of rows) {
    const s = String(r.codMinor ?? '').trim();
    if (/^\d{1,20}$/.test(s)) total += BigInt(s);
  }
  return total;
}

export type RemittanceInput = { riderUserId: string; expectedAmountMinor?: string; depositRef?: string; depositMethod?: DepositMethod };
export type RemittanceError = 'rider' | 'expected' | 'depositRef' | 'depositMethod';
export type RemittanceResult = { ok: true; value: RemittanceInput } | { ok: false; error: RemittanceError };

/** Open a remittance for a rider. `expectedAmountMinor` is deliberately the figure the operator was READING — it is
 *  sent so the API can REFUSE if the real total has changed since the page loaded. It is never used as the amount:
 *  the server computes that from the shipments themselves. */
export function buildRemittance(raw: { riderUserId: string; expectedAmountMinor: string; depositRef: string; depositMethod: string }): RemittanceResult {
  const riderUserId = raw.riderUserId.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(riderUserId)) return { ok: false, error: 'rider' };
  const value: RemittanceInput = { riderUserId };

  const expected = raw.expectedAmountMinor.trim();
  if (expected) {
    if (!/^\d{1,20}$/.test(expected)) return { ok: false, error: 'expected' };
    value.expectedAmountMinor = expected;
  }
  const ref = raw.depositRef.trim();
  if (ref) {
    if (ref.length > 80) return { ok: false, error: 'depositRef' };
    value.depositRef = ref;
  }
  const method = raw.depositMethod.trim();
  if (method) {
    if (!isDepositMethod(method)) return { ok: false, error: 'depositMethod' };
    value.depositMethod = method;
  }
  return { ok: true, value };
}

export type DepositResult = { ok: true; value: { depositRef: string; depositMethod: DepositMethod } } | { ok: false; error: 'depositRef' | 'depositMethod' };

/** Recording a deposit REQUIRES a reference and a method: "the money went in somehow" is not a reconciliation, and
 *  the reference is what a finance officer matches against the bank statement. */
export function buildDeposit(raw: { depositRef: string; depositMethod: string }): DepositResult {
  const depositRef = raw.depositRef.trim();
  if (depositRef.length < 3 || depositRef.length > 80) return { ok: false, error: 'depositRef' };
  const method = raw.depositMethod.trim();
  if (!isDepositMethod(method)) return { ok: false, error: 'depositMethod' };
  return { ok: true, value: { depositRef, depositMethod: method } };
}

/** Which acts to offer on a remittance, mirroring the server's state gates.
 *  RECONCILE is withheld from the person who recorded the deposit (maker≠checker, server-enforced) and from anyone
 *  without the permission — so the button's absence is the control, not a 403. */
export function remittanceActions(
  r: { status?: string | null; depositedBy?: string | null },
  viewerUserId: string | null | undefined,
  canReconcile: boolean,
): Array<'deposit' | 'reconcile' | 'cancel'> {
  const out: Array<'deposit' | 'reconcile' | 'cancel'> = [];
  if (r.status === 'pending') { out.push('deposit'); out.push('cancel'); }
  if (r.status === 'deposited') {
    const isMaker = !!viewerUserId && viewerUserId === r.depositedBy;
    if (canReconcile && !isMaker) out.push('reconcile');
    out.push('cancel');
  }
  return out;
}

/** Why reconcile is unavailable, so the worksheet can say it in words. */
export function reconcileBlockedReason(
  r: { status?: string | null; depositedBy?: string | null },
  viewerUserId: string | null | undefined,
  canReconcile: boolean,
): 'none' | 'not_deposited' | 'you_recorded_it' | 'no_permission' {
  if (r.status !== 'deposited') return 'not_deposited';
  if (!canReconcile) return 'no_permission';
  if (viewerUserId && viewerUserId === r.depositedBy) return 'you_recorded_it';
  return 'none';
}

/** A cancellation always carries a reason — cancelling a remittance puts cash back into "outstanding", and somebody
 *  will ask why next week. */
export function buildCancel(raw: { reason: string }): { ok: true; value: { reason: string } } | { ok: false; error: 'reason' } {
  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false, error: 'reason' };
  return { ok: true, value: { reason } };
}
