// apps/web-ops/src/test-render/ops2c-fixtures.ts · PC-56 OPS-2c — the warehouses as `GET /v1/warehousing/warehouses?box=mine` answers them (rate a
// minor-unit STRING or null; the operator's id present in the body — it must never print). No canon person, warehouse, registration or figure.
import type { Warehouse } from '@krishalaya/sdk-js';

export const OPERATOR_ID = '0192d2c4-c0de-7000-8000-00000000a0a0';
/** Three warehouses: two rates chosen so that NO sum, product or difference of them is printed by accident, and one with no rate on file. */
export const WAREHOUSES_2C: Warehouse[] = [
  { id: '0192d2c4-c0de-7000-8000-000000000001', defaultName: 'Test store north', operatorUserId: OPERATOR_ID, wdraRegNo: 'TEST-WDRA-17', capacityMt: '120.00', ratePerQtlMonthMinor: '900', isActive: true },
  { id: '0192d2c4-c0de-7000-8000-000000000002', defaultName: 'Test store south', operatorUserId: OPERATOR_ID, wdraRegNo: null, capacityMt: null, ratePerQtlMonthMinor: '1275', isActive: true },
  { id: '0192d2c4-c0de-7000-8000-000000000003', defaultName: 'Test store east', operatorUserId: OPERATOR_ID, wdraRegNo: null, capacityMt: null, ratePerQtlMonthMinor: null, isActive: true },
];
/** The rates as the money formatter prints them (en) — the ONLY amounts the page may show. */
export const RATES_PRINTED_2C = ['₹9.00', '₹12.75'];
/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_2C = /%|×|=|−|zero-sum|reconcil|billed monthly|in arrears|versioned|promo|free storage|first 14 days|revenue|occupan|pledge rate|turnaround|audit-stamped|charged twice|on-call|plan settings|month-to-date revenue|Gondal|Anand|Ramesh|Patel|Paresh|AgriQual|GJ-0412|SB-2026|\b563\b|\b341\b/i;
