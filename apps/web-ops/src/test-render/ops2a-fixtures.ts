// apps/web-ops/src/test-render/ops2a-fixtures.ts · PC-56 OPS-2a — the intake reads as the API answers them, through a FAKE client that answers the
// way the API does (survey E1, mutant 8): `bookings` WITHOUT `box: 'warehouse'` answers the API's default `depositor` — the CALLER's own deposit
// (OWN_DEPOSIT) — and WITH it answers that warehouse's bookings. So a dashboard that dropped the `box` would print the operator's own deposit, and
// `wh-dashboard.render` proves it does not. Every booking body CARRIES `depositorUserId` (the API body does — pinned live in ops2a (2)), cast in,
// so a page that printed it would show it. No canon person, place, reference or figure.
import type { Page, StorageBooking, Warehouse } from '@krishalaya/sdk-js';
import type { DashboardIo } from '../features/ops2/intake';

export const WH_1 = '0192d2c4-a000-7000-8000-0000000000a1';
export const WH_2 = '0192d2c4-a000-7000-8000-0000000000a2';
export const DEPOSITOR_ID = '0192d2c4-dddd-7000-8000-00000000d0d1';
export const OPERATOR_ID = '0192d2c4-0000-7000-8000-0000000000f1';
export const PRODUCT_1 = '0192d2c4-9000-7000-8000-000000000001';
export const PRODUCT_GONE = '0192d2c4-9000-7000-8000-0000000000ee';   // a product the read cannot find → "not available", never its id
const b = (over: Partial<StorageBooking> & Record<string, unknown>): StorageBooking => ({
  id: '0192d2c4-b000-7000-8000-000000000001', warehouseId: WH_1, productId: PRODUCT_1, quantity: '62.600', unitCode: 'quintal', status: 'stored',
  storedAt: '2026-10-21T06:30:00.000Z', releasedAt: null, createdAt: '2026-10-20T06:30:00.000Z', depositorUserId: DEPOSITOR_ID, ...over,
} as unknown as StorageBooking);
export const WAREHOUSE_ROWS: Record<string, StorageBooking[]> = {
  [WH_1]: [b({}), b({ id: '0192d2c4-b000-7000-8000-000000000002', status: 'requested', storedAt: null, quantity: '10.000', productId: PRODUCT_GONE })],
  [WH_2]: [],
};
/** The operator's OWN deposit — returned ONLY when `box` is not 'warehouse' (the API default `depositor`). */
export const OWN_DEPOSIT = b({ id: '0192d2c4-b000-7000-8000-0000000000ff', warehouseId: WH_1, status: 'requested', quantity: '5.000', depositorUserId: OPERATOR_ID });
export const MINE: Warehouse[] = [
  { id: WH_1, defaultName: 'Test warehouse one', wdraRegNo: 'TEST-WDRA-9', operatorUserId: OPERATOR_ID, ratePerQtlMonthMinor: '900' },
  { id: WH_2, defaultName: 'Test warehouse two', wdraRegNo: null, operatorUserId: OPERATOR_ID, ratePerQtlMonthMinor: null },
];
export function fakeIo(opts: { warehousesFail?: number; nextCursor?: string } = {}): DashboardIo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async warehouses(p) {
      calls.push(`warehouses:${JSON.stringify(p)}`);
      if (opts.warehousesFail) throw Object.assign(new Error('x'), { status: opts.warehousesFail });
      return { items: MINE, nextCursor: null } as Page<Warehouse>;
    },
    async bookings(p) {
      calls.push(`bookings:${JSON.stringify(p)}`);
      const q = p as { box?: string; warehouseId?: string; status?: string };
      if (q.box !== 'warehouse') return { items: [OWN_DEPOSIT], nextCursor: null };                       // the API default: the caller's own deposits
      const rows = (WAREHOUSE_ROWS[q.warehouseId ?? ''] ?? []).filter((r) => !q.status || r.status === q.status);
      return { items: rows, nextCursor: q.warehouseId === WH_1 ? opts.nextCursor ?? null : null };
    },
    async product(id) {
      calls.push(`product:${id}`);
      if (id === PRODUCT_1) return { defaultName: 'Test commodity' };
      throw Object.assign(new Error('not found'), { status: 404 });
    },
  };
}
/** The canon's false words in VISIBLE text (outside the refusal list). */
export const FALSE_2A = /\(weighed\)|weighbridge slip|\bgross\b|\btare\b|calibrat|legal metrology|\bbays?\b|\bstack \d|\bpest|quarantin|centre manager|gate staff|\bas of \d|\bof \d|Page \d|weighed in|zero-sum|reconcil|on-call|maker-checker|₹|%|×|Gondal|Anand|Ramesh|Patel|Paresh|SB-2026|WB-0713|GG-20|62\.60 qtl/i;
