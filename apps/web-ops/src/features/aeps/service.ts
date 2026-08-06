// apps/web-ops/src/features/aeps/service.ts · PURE rules for the OW-5 assisted-money screens (PC-55 B3).
// Framework-free so every rule below is unit-provable, and deliberately a MIRROR of the server's own
// (modules/ambassadors/services/aeps.service.ts + the W391/W392 laws in Ledger Appendix 3). The API stays
// authoritative — refusing here only means the operator learns immediately, at a kiosk, instead of after a round
// trip on a bad connection.
//
// THE FIVE LAWS THIS FILE EXISTS TO KEEP (Appendix 3, from canon W390–W392):
//   1. LOG ONLY. AePS cash moves in the BANK's systems over NPCI. Nothing here is a money primitive: there is no
//      wallet, no ledger, no commission. The amount recorded is what the bank did, reported after the fact.
//   2. MASKED IDENTIFIERS ONLY. Four digits of an account, four of an Aadhaar — never more. The form cannot accept
//      more, so a full Aadhaar cannot be typed into this platform even by mistake.
//   3. THREE ATTEMPTS, AND NO OTP FALLBACK. A fingerprint may be tried at most three times. There is no
//      "send an OTP instead" path in this taxonomy, and inventing one would be inventing a security model.
//   4. AN UNCERTIFIED DEVICE BLOCKS. A non-RD-certified reader may record exactly one thing: a blocked event with
//      `device_not_rd_certified`. It may never record a success — biometrics on an uncertified device is precisely
//      the fraud the certification exists to stop. The operator is told to switch to a certified backup.
//   5. THE THIRD FINGER-FAIL MUST ESCALATE. Money is untouched, but the person in front of the operator still
//      needs their cash: the third failure carries a written escalation (nearest bank mitra/branch).
// And one thing this file deliberately does NOT do: hardcode the ₹10,000 per-transaction cap. That cap is
// BANK-SET (W391). Baking a number in would make the platform lie the day a bank changes it.

export const SERVICE_KINDS = ['cash_withdrawal', 'balance_enquiry', 'mini_statement'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const EVENT_STATUSES = ['success', 'failed', 'declined', 'blocked'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EXCEPTION_CODES = ['device_not_rd_certified', 'finger_fail', 'bank_server_down', 'cap_exceeded', 'bank_declined'] as const;
export type ExceptionCode = (typeof EXCEPTION_CODES)[number];

export const MAX_ATTEMPTS = 3;

export function isServiceKind(v: string | undefined | null): v is ServiceKind {
  return !!v && (SERVICE_KINDS as readonly string[]).includes(v);
}
export function isEventStatus(v: string | undefined | null): v is EventStatus {
  return !!v && (EVENT_STATUSES as readonly string[]).includes(v);
}
export function isExceptionCode(v: string | undefined | null): v is ExceptionCode {
  return !!v && (EXCEPTION_CODES as readonly string[]).includes(v);
}

/** Law 4: an uncertified reader may record ONE shape of event and nothing else. */
export function uncertifiedAllowed(status: string, exceptionCode: string | undefined): boolean {
  return status === 'blocked' && exceptionCode === 'device_not_rd_certified';
}
/** Law 5: the third finger-fail must carry the escalation note. */
export function escalationRequired(exceptionCode: string | undefined, attemptNo: number): boolean {
  return exceptionCode === 'finger_fail' && attemptNo === MAX_ATTEMPTS;
}
/** Only a withdrawal carries an amount — a balance enquiry that "records ₹2000" is a fiction. */
export function amountExpected(serviceKind: string): boolean { return serviceKind === 'cash_withdrawal'; }

export interface AepsEventInput {
  serviceKind: ServiceKind; status: EventStatus; attemptNo: number; deviceCertified: boolean;
  customerUserId?: string; bankName?: string; accountLast4?: string; aadhaarLast4?: string;
  amountMinor?: string; balanceAfterMinor?: string; exceptionCode?: ExceptionCode;
  npciRrn?: string; escalationNote?: string;
}

export type AepsFormError =
  | 'serviceKind' | 'status' | 'attempt' | 'exception' | 'amountMissing' | 'amountNotAllowed' | 'amount'
  | 'balance' | 'last4Account' | 'last4Aadhaar' | 'uncertified' | 'escalation' | 'successException' | 'rrn' | 'customer';
export type AepsFormResult = { ok: true; value: AepsEventInput } | { ok: false; error: AepsFormError };

const LAST4 = /^\d{4}$/;
const MINOR = /^\d{1,15}$/;

/** Build the event write from the kiosk form. Every branch mirrors a server check, in the SAME order, so the
 *  operator's error message and the API's refusal can never disagree about which rule was broken. */
export function buildAepsEvent(raw: {
  serviceKind: string; status: string; attemptNo: string; deviceCertified: boolean;
  customerUserId: string; bankName: string; accountLast4: string; aadhaarLast4: string;
  amountMajor: string; balanceAfterMajor: string; exceptionCode: string; npciRrn: string; escalationNote: string;
}, toMinor: (major: string) => string | undefined): AepsFormResult {
  if (!isServiceKind(raw.serviceKind)) return { ok: false, error: 'serviceKind' };
  if (!isEventStatus(raw.status)) return { ok: false, error: 'status' };

  // Law 3: attempts are 1..3, whole numbers only. '2.5' is refused rather than truncated to 2 — an attempt count
  // is evidence about how many times a person's finger was rejected.
  const attemptRaw = raw.attemptNo.trim();
  if (!/^[1-3]$/.test(attemptRaw)) return { ok: false, error: 'attempt' };
  const attemptNo = Number.parseInt(attemptRaw, 10);

  const exceptionRaw = raw.exceptionCode.trim();
  if (exceptionRaw && !isExceptionCode(exceptionRaw)) return { ok: false, error: 'exception' };
  const exceptionCode = exceptionRaw ? (exceptionRaw as ExceptionCode) : undefined;

  if (raw.status === 'success' && exceptionCode) return { ok: false, error: 'successException' };
  if (!raw.deviceCertified && !uncertifiedAllowed(raw.status, exceptionCode)) return { ok: false, error: 'uncertified' };

  const escalationNote = raw.escalationNote.trim();
  if (escalationRequired(exceptionCode, attemptNo) && !escalationNote) return { ok: false, error: 'escalation' };

  const value: AepsEventInput = {
    serviceKind: raw.serviceKind, status: raw.status, attemptNo, deviceCertified: raw.deviceCertified,
  };
  if (exceptionCode) value.exceptionCode = exceptionCode;
  if (escalationNote) value.escalationNote = escalationNote.slice(0, 200);

  // Law 1 + the server's cross-field rule: an amount belongs to a withdrawal and to nothing else. A FAILED or
  // BLOCKED withdrawal still records what was attempted — that is the number a customer will ask about.
  const amountRaw = raw.amountMajor.trim();
  if (amountExpected(raw.serviceKind)) {
    if (!amountRaw) return { ok: false, error: 'amountMissing' };
    const amountMinor = toMinor(amountRaw);
    if (!amountMinor || amountMinor === '0') return { ok: false, error: 'amount' };
    value.amountMinor = amountMinor;
  } else if (amountRaw) {
    return { ok: false, error: 'amountNotAllowed' };
  }

  // Bank-reported balance: informational only, and optional for every service kind.
  const balanceRaw = raw.balanceAfterMajor.trim();
  if (balanceRaw) {
    const balanceAfterMinor = toMinor(balanceRaw);
    if (!balanceAfterMinor || !MINOR.test(balanceAfterMinor)) return { ok: false, error: 'balance' };
    value.balanceAfterMinor = balanceAfterMinor;
  }

  // Law 2: exactly four digits, or nothing at all.
  const accountLast4 = raw.accountLast4.trim();
  if (accountLast4) {
    if (!LAST4.test(accountLast4)) return { ok: false, error: 'last4Account' };
    value.accountLast4 = accountLast4;
  }
  const aadhaarLast4 = raw.aadhaarLast4.trim();
  if (aadhaarLast4) {
    if (!LAST4.test(aadhaarLast4)) return { ok: false, error: 'last4Aadhaar' };
    value.aadhaarLast4 = aadhaarLast4;
  }

  const customerUserId = raw.customerUserId.trim();
  if (customerUserId) {
    if (!/^[0-9a-fA-F-]{36}$/.test(customerUserId)) return { ok: false, error: 'customer' };
    value.customerUserId = customerUserId;
  }
  const bankName = raw.bankName.trim();
  if (bankName) value.bankName = bankName.slice(0, 120);
  const npciRrn = raw.npciRrn.trim();
  if (npciRrn) {
    if (npciRrn.length > 40) return { ok: false, error: 'rrn' };
    value.npciRrn = npciRrn;
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// How an event READS back to an operator or a supervisor
// ---------------------------------------------------------------------------
export interface AepsEventRow {
  status?: string | null; exceptionCode?: string | null; attemptNo?: number | null;
  serviceKind?: string | null; amountMinor?: string | null; balanceAfterMinor?: string | null;
  escalationNote?: string | null; deviceCertified?: boolean | null;
}

/** What the operator should DO next, drawn only from what the record actually says.
 *  'switch_device'  — the reader is not RD-certified: use the certified backup (nothing else will work).
 *  'escalate'       — three finger failures: money untouched, send the customer to a bank mitra/branch.
 *  'retry_allowed'  — a transient failure with attempts left (bank server down, or fails 1–2).
 *  'none'           — a settled event; there is nothing to chase. */
export function nextStep(e: AepsEventRow): 'switch_device' | 'escalate' | 'retry_allowed' | 'none' {
  if (e.exceptionCode === 'device_not_rd_certified' || e.deviceCertified === false) return 'switch_device';
  if (e.exceptionCode === 'finger_fail') return (e.attemptNo ?? 1) >= MAX_ATTEMPTS ? 'escalate' : 'retry_allowed';
  if (e.exceptionCode === 'bank_server_down') return 'retry_allowed';
  return 'none';
}

/** Whether the money is untouched — the sentence a frightened customer needs first. TRUE for every non-success,
 *  because AePS cash moves bank-side only on success; a declined or blocked attempt moved nothing. */
export function moneyUntouched(e: AepsEventRow): boolean {
  return e.status !== 'success';
}

/** Attempts left in this session under Law 3. NO OTP fallback exists, so 0 left means escalate — never "try
 *  another way". */
export function attemptsLeft(attemptNo: number | null | undefined): number {
  const n = typeof attemptNo === 'number' && Number.isFinite(attemptNo) ? Math.floor(attemptNo) : 0;
  return Math.max(0, MAX_ATTEMPTS - Math.max(0, n));
}

/** A defensive display mask. The API only ever returns four digits, but if a longer string ever arrived (a provider
 *  change, a bad backfill) this console must not be the thing that prints it. */
export function maskLast4(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  if (!s) return '';
  const last4 = s.slice(-4);
  return `•••• ${last4}`;
}
