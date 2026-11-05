// apps/web-ops/src/test-render/ops1b-fixtures.ts · PC-56 OPS-1b — shared pieces for the AePS / biometric render tests: the events as the API
// answers them AFTER Q7-A (plus one hostile row that still carries the two refused keys, to prove a view never prints them), the canon's false
// words as one visible-text regex, and an exact control counter. No canon person, bank, phone, Aadhaar mask, reference or figure.
import type { AepsEventView } from '../components/ops1/AepsViews';

export const EVENTS_1B: AepsEventView[] = [
  { id: '9001', ambassadorId: '0192aaaa-0000-7000-8000-000000000001', serviceKind: 'cash_withdrawal', status: 'success', attemptNo: 1, amountMinor: '250000', deviceCertified: true, occurredAt: '2026-11-05T05:30:00.000Z' },
  { id: '9002', ambassadorId: '0192aaaa-0000-7000-8000-000000000001', serviceKind: 'cash_withdrawal', status: 'failed', exceptionCode: 'finger_fail', attemptNo: 3, amountMinor: '120000', escalationNote: 'Sent to the branch on the main road', deviceCertified: true, occurredAt: '2026-11-05T06:30:00.000Z' },
  { id: '9003', ambassadorId: '0192bbbb-0000-7000-8000-000000000002', serviceKind: 'balance_enquiry', status: 'blocked', exceptionCode: 'device_not_rd_certified', attemptNo: 1, amountMinor: null, deviceCertified: false, occurredAt: '2026-11-05T07:30:00.000Z' },
  // hostile: a legacy-shaped row that still carries the refused keys — never printed
  { id: '9004', ambassadorId: '0192bbbb-0000-7000-8000-000000000002', serviceKind: 'cash_withdrawal', status: 'declined', exceptionCode: 'bank_declined', attemptNo: 1, amountMinor: '330000',
    occurredAt: '2026-11-05T08:30:00.000Z', ...({ aadhaarLast4: '5150', customerUserId: '0190a000-0000-7000-8000-00000000c0de', accountLast4: '4321', bankName: 'Test Bank' } as object) },
];

/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_1B = /%|NPCI|UIDAI|\b10,000\b|cap set by|stealing|free to you|bank['’]s own ledger|micro-ATM|face template|on this device|delete it any time|1800-|\*123#|never the face|access trail|plan settings|zero-sum|reconcil|=|−|→|←|Kiran|Jashoda|Raju|Bank of Baroda|XXXX|commission|RD-certified/i;
/** Exact counts of each control in a markup string. */
export const controls = (html: string) => ({
  input: (html.match(/<input\b/g) ?? []).length, select: (html.match(/<select\b/g) ?? []).length, textarea: (html.match(/<textarea\b/g) ?? []).length,
  form: (html.match(/<form\b/g) ?? []).length, button: (html.match(/<button\b/g) ?? []).length,
});
export const NONE = { input: 0, select: 0, textarea: 0, form: 0, button: 0 };
