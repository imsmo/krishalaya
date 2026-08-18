// PC-56 TENANT-4d-3 · W2424-W2427 — the GST-details chain's rules, and the page's own promises pinned against
// its source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  STEPS, checksumKey, diffRowKey, errorKey, errorsByField, fieldValue, idempotencyKeyFor, isAdvisory,
  reasonPromptKey, refusalKey, retryTarget, stepOf, submitState,
} from '../features/settings/tax-identity';

describe('TENANT-4d-3 · the four states of one act', () => {
  it('are W2424-W2427, and an unknown step falls back to the form', () => {
    expect([...STEPS]).toEqual(['edit', 'review', 'done', 'failed']);
    expect(stepOf('review')).toBe('review');
    expect(stepOf('nonsense')).toBe('edit');
    expect(stepOf(undefined)).toBe('edit');
  });
});

describe('TENANT-4d-3 · W2424: every invalid field, and nothing lost', () => {
  it('each reason has its own sentence', () => {
    expect(errorKey({ field: 'gstin', reason: 'malformed' })).toBe('tax.err.malformed');
    expect(errorKey({ field: 'gstin', reason: 'too_long' })).toBe('tax.err.tooLong');
    expect(errorKey({ field: 'gstin', reason: 'not_plain_text' })).toBe('tax.err.notPlain');
    expect(errorKey({ field: 'gstin', reason: 'required' })).toBe('tax.err.required');
    expect(errorKey({ field: 'a', reason: 'malformed' })).not.toBe(errorKey({ field: 'a', reason: 'required' }));
  });

  it('errors are indexed per field so an input renders its own message beside itself', () => {
    const by = errorsByField([{ field: 'gstin', reason: 'malformed' }, { field: 'pan', reason: 'required' }]);
    expect(by.gstin.reason).toBe('malformed');
    expect(by.pan.reason).toBe('required');
    expect(by.fssai_license).toBeUndefined();
  });

  it('the FIRST reason per field wins, so the API\'s ordering is respected rather than the last write', () => {
    const by = errorsByField([{ field: 'gstin', reason: 'malformed' }, { field: 'gstin', reason: 'too_long' }]);
    expect(by.gstin.reason).toBe('malformed');
  });

  it('WHAT THE TENANT TYPED IS PRESERVED, and an untouched field falls back to the stored value', () => {
    const submitted = { gstin: '27BAD', pan: '' };
    const current = { gstin: '27AAPFU0939F1ZV', pan: 'AABCU9603R', legalName: 'Anand FPO' };
    expect(fieldValue(submitted, current, 'gstin')).toBe('27BAD');       // kept, not reverted
    expect(fieldValue(submitted, current, 'pan')).toBe('');              // a deliberate clear is kept as empty
    expect(fieldValue(submitted, current, 'legalName')).toBe('Anand FPO');
    expect(fieldValue({}, { gstin: null }, 'gstin')).toBe('');           // nothing stored, nothing typed
  });
});

describe('TENANT-4d-3 · the check digit reads as four different things', () => {
  it('and "not verifiable" never reads like "verified"', () => {
    expect(checksumKey('verified')).toBe('tax.checksum.verified');
    expect(checksumKey('failed')).toBe('tax.checksum.failed');
    expect(checksumKey('not_applicable')).toBe('tax.checksum.notApplicable');
    expect(checksumKey('not_verifiable')).toBe('tax.checksum.notVerifiable');
    expect(checksumKey('not_verifiable')).not.toBe(checksumKey('verified'));
    expect(checksumKey('not_applicable')).not.toBe(checksumKey('not_verifiable'));
  });
  it('only a FAILED digit is an advisory — the others are not warnings', () => {
    expect(isAdvisory('failed')).toBe(true);
    expect(isAdvisory('verified')).toBe(false);
    expect(isAdvisory('not_applicable')).toBe(false);
    expect(isAdvisory('not_verifiable')).toBe(false);
  });
});

describe('TENANT-4d-3 · W2425: the review step', () => {
  it('set, replaced and cleared are three different sentences', () => {
    expect(diffRowKey({ field: 'gstin', from: null, to: 'X' })).toBe('tax.diff.set');
    expect(diffRowKey({ field: 'gstin', from: 'OLD', to: 'X' })).toBe('tax.diff.replaced');
    expect(diffRowKey({ field: 'gstin', from: 'OLD', to: null })).toBe('tax.diff.cleared');
    expect(diffRowKey({ field: 'a', from: null, to: 'X' })).not.toBe(diffRowKey({ field: 'a', from: 'O', to: null }));
  });

  it('Submit is offered only when it can succeed, and the most fundamental refusal wins', () => {
    const base = { writable: true, errors: [], noOp: false, reasonRequired: false, reasonProblem: null } as const;
    expect(submitState(base)).toEqual({ kind: 'ready' });
    // A suspended tenant is not told to write a reason.
    expect(submitState({ ...base, writable: false, reasonProblem: 'required' })).toEqual({ kind: 'blocked', key: 'tax.blocked.notWritable' });
    expect(submitState({ ...base, errors: [{ field: 'gstin', reason: 'malformed' }] })).toEqual({ kind: 'blocked', key: 'tax.blocked.errors' });
    // "Nothing would change" is said, rather than offering a button the API will refuse for exactly that reason.
    expect(submitState({ ...base, noOp: true })).toEqual({ kind: 'blocked', key: 'tax.blocked.noChange' });
    expect(submitState({ ...base, reasonProblem: 'required' })).toEqual({ kind: 'blocked', key: 'tax.blocked.reasonRequired' });
    expect(submitState({ ...base, reasonProblem: 'too_long' })).toEqual({ kind: 'blocked', key: 'tax.err.tooLong' });
  });

  it('the reason prompt changes when one is required', () => {
    expect(reasonPromptKey(true)).toBe('tax.reason.required');
    expect(reasonPromptKey(false)).toBe('tax.reason.optional');
    expect(reasonPromptKey(true)).not.toBe(reasonPromptKey(false));
  });
});

describe('TENANT-4d-3 · W2427: failure, and a retry that goes somewhere useful', () => {
  it('refusals are translated BY NAME', () => {
    expect(refusalKey('TENANT_PROFILE_INVALID')).toBe('tax.fail.invalid');
    expect(refusalKey('TENANT_NOT_WRITABLE')).toBe('tax.fail.notWritable');
    expect(refusalKey('TENANT_FORBIDDEN')).toBe('tax.fail.forbidden');
    expect(refusalKey('WHAT')).toBe('tax.fail.generic');
  });

  it('a validation refusal retries by EDITING; an infrastructure one by re-submitting; a permission one not at all', () => {
    expect(retryTarget('TENANT_PROFILE_INVALID')).toBe('edit');
    expect(retryTarget('')).toBe('confirm');
    expect(retryTarget('DB_UNAVAILABLE')).toBe('confirm');
    // Offering "retry" on a permission error is a dead end that generates a support ticket.
    expect(retryTarget('TENANT_FORBIDDEN')).toBe('none');
    expect(retryTarget('TENANT_NOT_WRITABLE')).toBe('none');
    expect(retryTarget('TENANT_NOT_FOUND')).toBe('none');
  });

  it('THE IDEMPOTENCY KEY IS DERIVED FROM THE CHANGE, so Retry cannot apply the edit twice', () => {
    const diff = [{ field: 'gstin', from: 'OLD', to: 'NEW' }];
    const k1 = idempotencyKeyFor(diff, 'typo');
    expect(idempotencyKeyFor(diff, 'typo')).toBe(k1);                       // retrying the SAME change reuses it
    expect(idempotencyKeyFor([...diff].reverse(), 'typo')).toBe(k1);        // order-insensitive
    expect(idempotencyKeyFor(diff, 'different reason')).not.toBe(k1);       // a different act gets its own key
    expect(idempotencyKeyFor([{ field: 'pan', from: 'OLD', to: 'NEW' }], 'typo')).not.toBe(k1);
    expect(idempotencyKeyFor([], null)).not.toBe(k1);
    expect(k1.startsWith('tenant-profile:')).toBe(true);
  });
});

describe('TENANT-4d-3 · the page states its own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the fields come from the tenant\'s COUNTRY, and an empty list is stated', () => {
    const s = read('app', 'settings', 'gst', 'page.tsx');
    expect(s).toContain('tenancy.profile.taxIdentity()');
    expect(s).toContain('form.fields.map');
    expect(s).toContain('tax.noFormats');
    // No fallback to another country's rules anywhere on this page.
    expect(s).not.toContain('GSTIN_RE');
  });

  it('it is permission-gated and renders all four states', () => {
    const s = read('app', 'settings', 'gst', 'page.tsx');
    expect(s).toContain("tenantHasPerm('tenant.settings')");
    expect(s).toContain('tax.restricted');
    for (const k of ['tax.reviewTitle', 'tax.doneTitle', 'tax.failTitle', 'tax.errorSummary']) expect(s).toContain(k);
  });

  it('the REVIEW step re-asks the API rather than trusting the query string', () => {
    const s = read('app', 'settings', 'gst', 'page.tsx');
    expect(s).toContain('tenancy.profile.preview(');
    expect(s).toContain('submitState(');
    expect(s).toContain('diffRowKey(');
  });

  it('the checksum advisory sits ABOVE Submit, and does not block it', () => {
    const s = read('app', 'settings', 'gst', 'page.tsx');
    expect(s).toContain('tax.checksum.advisory');
    expect(s).toContain('isAdvisory(');
    // submitState decides the button and has no checksum input at all — the advisory cannot become a refusal
    // here by accident.
    expect(read('features', 'settings', 'tax-identity.ts')).not.toMatch(/submitState[\s\S]{0,400}checksum/);
  });

  it('the action derives the key from the SERVER\'s diff and states that nothing changed on failure', () => {
    const a = read('app', 'settings', 'gst', 'actions.ts');
    expect(a).toContain('idempotencyKeyFor(pv.diff');
    expect(a).toContain('tenancy.profile.update(');
    expect(a).toContain("step: 'failed'");
    // A uuid per click would let Retry apply the edit twice.
    expect(a).not.toContain('randomUUID');
  });

  it('only the fields the tenant TOUCHED travel on, so a one-field edit is not an eight-field diff', () => {
    expect(read('app', 'settings', 'gst', 'actions.ts')).toContain('if (v !== null) out[f] = String(v)');
  });

  it('every new key is translated in all three launch languages, with no blanks', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('tax.'));
    expect(mine.length).toBeGreaterThan(60);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
    for (const f of ['en.ts', 'hi.ts', 'gu.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'i18n', f), 'utf8');
      for (const m of src.matchAll(/^\s{2}'(tax\.[^']+)':\s*'([^']*)'/gm)) expect(m[2].length).toBeGreaterThan(0);
    }
  });
});
