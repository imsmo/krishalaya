// apps/web-ops/src/test-render/ops2b-fixtures.ts · PC-56 OPS-2b — receipts and assays as the API answers them. The receipt fixtures CARRY the holder
// and the value the API body really carries (`holderUserId`, `valuationMinor` — pinned live in ops2b-receipts (4)): they are cast in, so a page that
// printed either would show them, and the render tests prove none does. No canon person, lab, place, receipt reference or figure.
import type { AssayReport, NwrReceipt } from '@krishalaya/sdk-js';

export const BOOKING_ID = '0192d2c4-b00c-7000-8000-0000000000b1';
export const HOLDER_ID = '0192d2c4-c0de-7000-8000-00000000d0d0';
export const VALUE_MINOR = '39062400';
export const ASSAYS_2B: AssayReport[] = [
  { id: '0192d2c4-a55a-7000-8000-000000000001', storageBookingId: BOOKING_ID, assayerName: 'Test assay lab', parameters: { moisture: '11.50', foreign_matter: 0.7, organic: true },
    gradeOptionId: null, reportMediaId: null, assayedAt: '2026-10-20T06:30:00.000Z', validUntil: '2026-12-31', createdAt: '2026-10-20T06:30:00.000Z' },
  { id: '0192d2c4-a55a-7000-8000-000000000002', storageBookingId: BOOKING_ID, assayerName: 'Second test lab', parameters: { grade: 'FAQ' },
    gradeOptionId: '0192d2c4-9999-7000-8000-000000000009', reportMediaId: null, assayedAt: '2026-10-21T06:30:00.000Z', validUntil: null, createdAt: '2026-10-21T06:30:00.000Z' },
];
const r = (over: Partial<NwrReceipt> & Record<string, unknown>): NwrReceipt => ({
  id: '0192d2c4-e000-7000-8000-000000000001', storageBookingId: BOOKING_ID, repository: 'NERL', enwrNo: 'TEST-RCPT-0001', quantity: '62.600', status: 'issued',
  issuedAt: '2026-10-22T06:30:00.000Z', expiresAt: null, createdAt: '2026-10-22T06:30:00.000Z', holderUserId: HOLDER_ID, valuationMinor: VALUE_MINOR, ...over,
} as unknown as NwrReceipt);
export const RECEIPTS_2B: NwrReceipt[] = [
  r({}),
  r({ id: '0192d2c4-e000-7000-8000-000000000002', enwrNo: 'TEST-RCPT-0002', repository: 'CCRL', quantity: '6260.125', status: 'cancelled', expiresAt: '2027-03-31' }),
  r({ id: '0192d2c4-e000-7000-8000-000000000003', enwrNo: 'TEST-RCPT-0003', status: 'released', quantity: 'abc' }),
];
/** The canon's false words in VISIBLE text (outside the refusal list). `pledged` etc. are caught only as claims, not as the verbatim legend codes. */
export const FALSE_2B = /certificate no|verified|\bQR\b|accredit|NABL|sets the price|birth certificate|\bOTP\b|receipt issued|eNWR issued|repository confirm|confirmed with (NERL|CCRL)|legally|negotiable|\bLTV\b|sanction|auction|fully withdrawn|of 341|Page 1 of|zero-sum|reconcil|on-call|₹|%|×|AgriQual|Ramesh|Patel|Anand|Gondal|NERL-26|AQ-26|SB-2026|krishalaya\.in/i;
