import { parseMajorToMinor } from '../money';
// apps/web-gov/src/features/schemes/review.ts · PURE reviewer gates (PC-41 GW-1). Mirror the application
// state machine: submitted→under_verification→(clarification_needed|approved|rejected)→disbursed→closed;
// appealed re-enters review. The API re-checks every transition (reflect, never grant).
export const APP_STATUSES = ['draft', 'submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed'] as const;
export function isAppStatus(v: string | undefined | null): boolean { return !!v && (APP_STATUSES as readonly string[]).includes(v); }
export function canVerify(s: string | undefined | null): boolean { return s === 'submitted' || s === 'appealed'; }
export function canClarify(s: string | undefined | null): boolean { return s === 'under_verification'; }
export function canDecide(s: string | undefined | null): boolean { return s === 'under_verification'; }
export function canClose(s: string | undefined | null): boolean { return s === 'disbursed' || s === 'rejected'; }

// --- GW-2: DBT recording (per-application; the only DBT write the API has) ---
export function canRecordDbt(s: string | undefined | null): boolean { return s === 'approved' || s === 'disbursed'; }
export type DbtResult =
  | { ok: true; value: { amountMinor: string; creditedOn: string; instalmentNo?: number; pfmsRef?: string } }
  | { ok: false; error: 'amount' | 'date' | 'instalment' | 'pfms' };
export function buildDbt(raw: { amountMajor: string; creditedOn: string; instalmentNo: string; pfmsRef: string }): DbtResult {
  const amountMinor = parseMajorToMinor(raw.amountMajor);
  if (amountMinor === undefined || amountMinor === '0') return { ok: false, error: 'amount' };
  const creditedOn = raw.creditedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(creditedOn)) return { ok: false, error: 'date' };
  const out: { amountMinor: string; creditedOn: string; instalmentNo?: number; pfmsRef?: string } = { amountMinor, creditedOn };
  const inst = raw.instalmentNo.trim();
  if (inst) {
    const n = Number.parseInt(inst, 10);
    if (!Number.isInteger(n) || n < 1 || n > 60) return { ok: false, error: 'instalment' };
    out.instalmentNo = n;
  }
  const pfmsRef = raw.pfmsRef.trim();
  if (pfmsRef.length > 120) return { ok: false, error: 'pfms' };
  if (pfmsRef) out.pfmsRef = pfmsRef;
  return { ok: true, value: out };
}
