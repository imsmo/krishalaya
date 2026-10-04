// modules/memberships/domain/register-import.ts · PC-56 TENANT-SW-d · W2626–W2628 "Import register" — PURE rules.
//
// Founder decision (2026-10-04): UNDER A CHECKER + CONSENT EVIDENCE. This file reads the CSV a cooperative already keeps (phone, folio,
// shares, paid_up — ≤ 5,000 rows) and judges every line on its own: the phone normalised for the cooperative's COUNTRY (its dialling
// prefix, never a hard-coded +91), the numbers as numbers (paid_up as a decimal in the currency's own scale — never a float), and
// duplicates WITHIN the file. Matching to members, duplicates against the EXISTING register and folio collisions are the service's (they
// need the database); each produces a named code here. Every error is named with its LINE (the file's own line, header = 1).
// The phone is never kept: a line carries its masked form (••••1234) once judged.
import { normalizePhoneE164 } from '../../../shared/utils/phone';

export const IMPORT_COLUMNS = ['phone', 'folio', 'shares', 'paid_up'] as const;
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 1_048_576;
export const CONSENT_KINDS = ['board_resolution', 'attestation'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const ROW_ERRORS = [
  'ROW_SHAPE', 'PHONE_INVALID', 'FOLIO_INVALID', 'SHARES_INVALID', 'PAID_UP_INVALID',
  'MEMBER_NOT_FOUND', 'DUPLICATE_IN_FILE', 'FOLIO_DUPLICATE_IN_FILE', 'FOLIO_TAKEN',
] as const;
export type RowError = (typeof ROW_ERRORS)[number];
/** A member already on the register is SKIPPED, not an error — re-importing a file never doubles a holding. */
export const ALREADY_ON_REGISTER = 'ALREADY_ON_REGISTER';

export interface JudgedLine {
  lineNo: number; phoneE164: string | null; phoneMasked: string; folio: string | null; shares: number | null; paidUpMinor: string | null;
  error: RowError | null;
}

/** Which of the four columns the header lacks (case and surrounding spaces ignored). */
export function missingColumns(header: readonly string[]): string[] {
  const have = new Set(header.map((h) => h.trim().toLowerCase().replace(/^﻿/, '')));
  return IMPORT_COLUMNS.filter((c) => !have.has(c));
}

const digitsOnly = (s: string) => s.replace(/\D/g, '');
export function maskPhone(raw: string): string { const d = digitsOnly(raw); return d.length ? `••••${d.slice(-4)}` : ''; }

/** A decimal amount in the currency's own scale → minor units as a string; null when it is not a plain non-negative decimal. */
export function parseMinor(raw: string, minorUnits: number): string | null {
  const s = raw.trim().replace(/,/g, '');
  const re = minorUnits > 0 ? new RegExp(`^(\\d{1,13})(?:\\.(\\d{1,${minorUnits}}))?$`) : /^(\d{1,13})$/;
  const m = re.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(minorUnits, '0');
  const v = BigInt(m[1]) * 10n ** BigInt(minorUnits) + (minorUnits ? BigInt(frac || '0') : 0n);
  return v.toString();
}

/** Judge each data line on its own (shape, phone for the country, folio, numbers) and flag within-file duplicates. */
export function judgeLines(header: readonly string[], records: readonly string[][], opts: { phonePrefix: string; minorUnits: number }): JudgedLine[] {
  const idx = new Map(header.map((h, i) => [h.trim().toLowerCase().replace(/^﻿/, ''), i]));
  const col = (r: readonly string[], c: string) => String(r[idx.get(c) ?? -1] ?? '').trim();
  const out: JudgedLine[] = [];
  records.forEach((r, i) => {
    const lineNo = i + 2;
    if (r.length === 1 && r[0].trim() === '') return;          // a blank line is not a row
    const rawPhone = col(r, 'phone');
    const line: JudgedLine = { lineNo, phoneE164: null, phoneMasked: maskPhone(rawPhone), folio: null, shares: null, paidUpMinor: null, error: null };
    if (r.length < header.length) { line.error = 'ROW_SHAPE'; out.push(line); return; }
    const phone = normalizePhoneE164(rawPhone, opts.phonePrefix);
    const folio = col(r, 'folio');
    const sharesRaw = col(r, 'shares');
    const paid = parseMinor(col(r, 'paid_up'), opts.minorUnits);
    if (!phone) line.error = 'PHONE_INVALID';
    else if (!/^[A-Za-z0-9/._-]{1,40}$/.test(folio)) line.error = 'FOLIO_INVALID';
    else if (!/^\d{1,9}$/.test(sharesRaw) || Number(sharesRaw) <= 0) line.error = 'SHARES_INVALID';
    else if (paid === null) line.error = 'PAID_UP_INVALID';
    line.phoneE164 = phone; line.phoneMasked = phone ? maskPhone(phone) : line.phoneMasked;
    line.folio = /^[A-Za-z0-9/._-]{1,40}$/.test(folio) ? folio.toUpperCase() : null;
    line.shares = /^\d{1,9}$/.test(sharesRaw) && Number(sharesRaw) > 0 ? Number(sharesRaw) : null;
    line.paidUpMinor = paid;
    out.push(line);
  });
  // within-file duplicates: the FIRST occurrence stands; every later one is named
  const seenPhone = new Set<string>(); const seenFolio = new Set<string>();
  for (const l of out) {
    if (l.error) continue;
    if (l.phoneE164 && seenPhone.has(l.phoneE164)) { l.error = 'DUPLICATE_IN_FILE'; continue; }
    if (l.folio && seenFolio.has(l.folio)) { l.error = 'FOLIO_DUPLICATE_IN_FILE'; continue; }
    if (l.phoneE164) seenPhone.add(l.phoneE164);
    if (l.folio) seenFolio.add(l.folio);
  }
  return out;
}

/** The import's verdict counts, from the judged lines and the service's database checks. */
export function tally(statuses: ReadonlyArray<'valid' | 'error' | 'skipped_duplicate'>) {
  return {
    rowCount: statuses.length, validCount: statuses.filter((s) => s === 'valid').length,
    errorCount: statuses.filter((s) => s === 'error').length, duplicateCount: statuses.filter((s) => s === 'skipped_duplicate').length,
  };
}
