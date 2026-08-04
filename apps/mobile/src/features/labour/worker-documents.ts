// apps/mobile/src/features/labour/worker-documents.ts · PURE logic for the worker My-Documents screen (139). No
// React / no SDK I/O (SDK types `import type` → erased) → unit-tested. It builds the identity-document checklist
// from the REAL doc-type catalogue (kycDocTypes) joined to the worker's submitted KYC docs, resolves the banking
// rows, and computes the "N of M documents" completion. The design's PAN "> ₹50K" note, photo "matched with
// Aadhaar", and Skill-India cert are fixed program copy (static i18n) — no fabricated verification is invented (§13).
import type { KycDocument, KycDocType, KycStatus, BankAccount } from '@krishalaya/sdk-js';

export interface DocRow {
  typeId: string;
  code: string;
  name: string;             // from the catalogue (real), e.g. "Aadhaar Card"
  docNoMasked: string | null; // masked only — never a raw id (§4)
  status: KycStatus | null;   // null when not yet submitted
  present: boolean;
}

/** One checklist row per catalogue doc-type, joined to the worker's submitted doc (if any). Real names + masked
 * values only. Pure. */
export function checklistRows(docTypes: readonly KycDocType[], kyc: readonly KycDocument[]): DocRow[] {
  return (docTypes ?? []).map((dt) => {
    const doc = (kyc ?? []).find((k) => k.docTypeId === dt.id) ?? null;
    return { typeId: dt.id, code: dt.code, name: dt.name, docNoMasked: doc?.docNoMasked ?? null, status: (doc?.status as KycStatus) ?? null, present: !!doc };
  });
}

/** The linked bank account (first primary, else first) — or null. Pure. */
export function bankAccount(banks: readonly BankAccount[]): BankAccount | null {
  const rows = (banks ?? []).filter((b) => b.accountKind === 'bank');
  return rows.find((b) => b.isPrimary) ?? rows[0] ?? null;
}

/** The linked UPI id account — or null. Pure. */
export function upiAccount(banks: readonly BankAccount[]): BankAccount | null {
  return (banks ?? []).find((b) => b.accountKind === 'upi') ?? null;
}

/** Completion = submitted identity docs + (bank?1) + (upi?1) over (catalogue types + 2 banking slots). Data, not a
 * literal — it reflects whatever the worker has actually added (§13). Pure. */
export function documentsProgress(docTypes: readonly KycDocType[], kyc: readonly KycDocument[], banks: readonly BankAccount[]): { done: number; total: number } {
  const idDone = checklistRows(docTypes, kyc).filter((r) => r.present).length;
  const done = idDone + (bankAccount(banks) ? 1 : 0) + (upiAccount(banks) ? 1 : 0);
  const total = (docTypes?.length ?? 0) + 2;
  return { done, total };
}
