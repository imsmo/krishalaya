// apps/web-tenant/src/features/group-lots/coordinator.ts · PURE helpers for the FPO group-lot coordinator console.
// No framework, no I/O → unit-tested. The SERVER stays authoritative: it owns the group-lot state machine
// (group-lot.state), accumulates pledges, and computes the proportional settlement (float-free, zero-loss; Law 2).
// These helpers only decide which coordinator actions to OFFER, pre-validate forms, and present a settlement
// preview that MIRRORS the server's settleShares math so the console can show shares before committing. Money is a
// bigint minor-unit STRING; quantities are decimal strings (numeric(14,3) → integer milli-units). Regexes are
// anchored fixed char-classes (ReDoS-safe).

export const GROUP_LOT_STATUSES = ['pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled'] as const;
export type GroupLotStatus = (typeof GROUP_LOT_STATUSES)[number];

const QTY = /^\d{1,11}(\.\d{1,3})?$/;   // numeric(14,3) — up to 11 integer digits, ≤3 decimals
const MINOR = /^\d{1,15}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;   // datetime-local / ISO prefix

/** Which coordinator (group_lot.coordinate) lifecycle actions to OFFER next, mirroring group-lot.state (Law 5).
 *  pledging → pledge + ready + cancel; ready → settle + cancel; listed → settle + cancel; sold → settle;
 *  settled/cancelled → none. (The server is the authority; this only shapes the UI.) */
export function coordinatorActions(status: string): Array<'pledge' | 'ready' | 'cancel' | 'settle'> {
  switch (status) {
    case 'pledging': return ['pledge', 'ready', 'cancel'];
    case 'ready': return ['settle', 'cancel'];
    case 'listed': return ['settle', 'cancel'];
    case 'sold': return ['settle'];
    default: return [];
  }
}

/** A lot is open for new pledges only while pledging AND before the deadline. */
export function canPledge(status: string, pledgeDeadline: string, now: Date = new Date()): boolean {
  if (status !== 'pledging') return false;
  const t = Date.parse(pledgeDeadline);
  return Number.isFinite(t) && t > now.getTime();
}

/** Validate the create-lot form. Returns a field code on the first problem, else null. */
export function validateCreate(input: { productId: string; targetQuantity: string; unitCode: string; pledgeDeadline: string; coordinationFeeBps?: string }): string | null {
  if (!input.productId || input.productId.trim().length === 0) return 'product';
  if (!QTY.test(input.targetQuantity) || parseQtyMilli(input.targetQuantity) <= 0n) return 'target';
  if (!input.unitCode || input.unitCode.trim().length === 0 || input.unitCode.length > 16) return 'unit';
  if (!ISO.test(input.pledgeDeadline) || !Number.isFinite(Date.parse(input.pledgeDeadline))) return 'deadline';
  if (input.coordinationFeeBps != null && input.coordinationFeeBps !== '') {
    const n = Number(input.coordinationFeeBps);
    if (!Number.isInteger(n) || n < 0 || n > 10000) return 'fee';
  }
  return null;
}

/** Validate the record-pledge form. */
export function validatePledge(input: { farmerUserId: string; quantity: string }): string | null {
  if (!input.farmerUserId || input.farmerUserId.trim().length === 0) return 'farmer';
  if (!QTY.test(input.quantity) || parseQtyMilli(input.quantity) <= 0n) return 'quantity';
  return null;
}

/** Validate the settle form (gross sale proceeds, bigint minor). */
export function validateSettle(grossProceedsMinor: string): string | null {
  if (!MINOR.test(grossProceedsMinor) || grossProceedsMinor === '0') return 'gross';
  return null;
}

// --- float-free quantity helpers (mirror apps/api .../domain/settle.ts) ---
const QTY_SCALE = 1000n;

/** "12.5" → 12500n milli-units. Throws on malformed input. */
export function parseQtyMilli(q: string): bigint {
  const m = QTY.exec(q);
  if (!m) throw new Error('bad quantity');
  const [intPart, fracPart = ''] = q.split('.');
  const frac = (fracPart + '000').slice(0, 3);
  return BigInt(intPart) * QTY_SCALE + BigInt(frac || '0');
}
/** 12500n → "12.500". */
export function formatQtyMilli(milli: bigint): string {
  const whole = milli / QTY_SCALE;
  const frac = (milli % QTY_SCALE).toString().padStart(3, '0');
  return `${whole}.${frac}`;
}

/** Pledged ÷ target as integer basis points (display only; clamped to 10000). Float-free. */
export function progressBps(pledgedQuantity: string, targetQuantity: string): number {
  const target = parseQtyMilli(targetQuantity);
  if (target <= 0n) return 0;
  const pct = (parseQtyMilli(pledgedQuantity) * 10000n) / target;
  return Number(pct > 10000n ? 10000n : pct);
}

const roundDiv = (num: bigint, den: bigint) => (num + den / 2n) / den;   // half-up

/** PREVIEW the proportional settlement — MIRRORS the server's settleShares (zero-loss; leftover paise to the
 *  largest-quantity pledge first). For display only; the server's result is authoritative. */
export function previewSettlement(input: {
  grossProceedsMinor: string;
  coordinationFeeBps: number;
  pledges: Array<{ id: string; quantity: string }>;
}): { grossMinor: string; coordinationFeeMinor: string; netMinor: string; shares: Array<{ id: string; shareMinor: string }> } {
  const gross = BigInt(input.grossProceedsMinor);
  const fee = roundDiv(gross * BigInt(input.coordinationFeeBps), 10000n);
  const net = gross - fee;
  const milli = input.pledges.map((p) => ({ id: p.id, q: parseQtyMilli(p.quantity) }));
  const totalQ = milli.reduce((a, p) => a + p.q, 0n);
  let shares: Array<{ id: string; shareMinor: bigint }>;
  if (totalQ <= 0n) {
    shares = milli.map((p) => ({ id: p.id, shareMinor: 0n }));
  } else {
    shares = milli.map((p) => ({ id: p.id, shareMinor: (net * p.q) / totalQ }));
    const allocated = shares.reduce((a, s) => a + s.shareMinor, 0n);
    let leftover = net - allocated;
    // distribute leftover paise, largest-quantity first (stable: index order breaks ties)
    const order = milli.map((p, i) => ({ i, q: p.q })).sort((a, b) => (b.q > a.q ? 1 : b.q < a.q ? -1 : a.i - b.i));
    let k = 0;
    while (leftover > 0n && order.length > 0) {
      shares[order[k % order.length].i].shareMinor += 1n;
      leftover -= 1n; k += 1;
    }
  }
  return {
    grossMinor: gross.toString(),
    coordinationFeeMinor: fee.toString(),
    netMinor: net.toString(),
    shares: shares.map((s) => ({ id: s.id, shareMinor: s.shareMinor.toString() })),
  };
}
