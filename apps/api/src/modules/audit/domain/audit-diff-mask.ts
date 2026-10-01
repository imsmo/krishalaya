// modules/audit/domain/audit-diff-mask.ts · PC-56 TENANT-9c (F-9) · AUDIT DIFFS ARE MASKED BY DEFAULT (pure, no I/O).
//
// `audit.repository.ts` projected `old_value` / `new_value` raw to every holder of `audit.read`, so a phone number written
// into a diff by any of 246 writers was readable by the auditor — W200's *"✕ Member PII beyond masked identifiers"* was
// false. The masking happens HERE, in the read path the API owns, never in the component (TENANT-1b's rule: a page cannot
// leak what it was never sent).
//
// THE VOCABULARY. 1b's reveal control names the member fields a recorded reveal may unmask (`REVEALABLE_FIELDS`: phone,
// email, aadhaar_last4); the identifier maskers in `identity/domain/id-masking.ts` name the government ids (Aadhaar, PAN).
// A diff key is PII when one of its words (camelCase / snake_case split) is in `PII_KEY_WORDS`, or the whole key is in
// `PII_KEYS`. Over-masking is the safe direction: an auditor who needs a masked value asks a reveal holder, and the reveal
// is recorded; under-masking cannot be taken back. Bare `name` is NOT masked — products, crops, roles and centres all
// have one; a PERSON's name in a diff is `full_name` / `owner_name` / `display_name` / `holder_name`, which are.
//
// The mask is `••••` — never a partial value (a last-four in a diff is a last-four the masker did not choose). The paths
// masked are returned beside the value so the page can say WHICH fields it is not showing.

export const MASK = '••••';

/** Whole keys that are PII however they are spelled out. */
export const PII_KEYS = [
  'phone', 'mobile', 'msisdn', 'email', 'aadhaar', 'aadhaar_last4', 'pan', 'gstin', 'vpa', 'upi', 'upi_id', 'dob',
  'date_of_birth', 'address', 'full_name', 'owner_name', 'display_name', 'holder_name', 'account_number', 'account_no',
  'bank_account', 'ifsc_account', 'otp', 'password', 'token',
] as const;

/** Words that make a key PII wherever they appear in it (`ownerPhone`, `buyer_gstin`, `payeeVpa`, `line1Address`). */
export const PII_KEY_WORDS = ['phone', 'mobile', 'msisdn', 'email', 'aadhaar', 'pan', 'gstin', 'vpa', 'upi', 'dob', 'address', 'otp', 'password'] as const;

const keyWords = (key: string): string[] =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Is this diff key PII (by the vocabulary above)? */
export function isPiiKey(key: string): boolean {
  const norm = keyWords(key).join('_');
  if ((PII_KEYS as readonly string[]).includes(norm)) return true;
  const words = keyWords(key);
  if (words.includes('account') && (words.includes('number') || words.includes('no'))) return true;
  if (words.includes('name') && (words.includes('full') || words.includes('owner') || words.includes('display') || words.includes('holder') || words.includes('payee') || words.includes('nominee'))) return true;
  return words.some((w) => (PII_KEY_WORDS as readonly string[]).includes(w));
}

export interface MaskedValue { value: unknown; maskedPaths: string[] }

/** Walk a JSON value; replace every PII key's value (whatever its type) with `MASK`. Arrays keep their shape. Bounded depth. */
export function maskDiff(v: unknown, path = '', depth = 0): MaskedValue {
  if (v === null || v === undefined || typeof v !== 'object') return { value: v ?? null, maskedPaths: [] };
  if (depth > 12) return { value: MASK, maskedPaths: [path || '(root)'] };
  const masked: string[] = [];
  if (Array.isArray(v)) {
    const out = v.map((item, i) => {
      const r = maskDiff(item, `${path}[${i}]`, depth + 1);
      masked.push(...r.maskedPaths);
      return r.value;
    });
    return { value: out, maskedPaths: masked };
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (isPiiKey(k) && val !== null && val !== undefined && val !== '') { out[k] = MASK; masked.push(p); continue; }
    const r = maskDiff(val, p, depth + 1);
    out[k] = r.value;
    masked.push(...r.maskedPaths);
  }
  return { value: out, maskedPaths: masked };
}

/** Both halves of a diff, masked, and the union of what was hidden (sorted, deduplicated). */
export function maskEntry(oldValue: unknown, newValue: unknown): { oldValue: unknown; newValue: unknown; maskedFields: string[] } {
  const o = maskDiff(oldValue); const n = maskDiff(newValue);
  return { oldValue: o.value, newValue: n.value, maskedFields: [...new Set([...o.maskedPaths, ...n.maskedPaths])].sort() };
}
