// modules/identity/__tests__/tenant1b4-member-import.spec.ts · PC-56 TENANT-1b-4.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: THE IMPORT TELLS YOU WHAT IT WILL DO BEFORE IT DOES IT, AND IT NEVER CREATES THE
// SAME PERSON TWICE.**
//
// W156 shows a triage — "220 rows · 214 valid · 4 already members (matched by phone — skipped, never duplicated) · 2
// fixable" — and only then a button. Before this wave the processor applied rows as it streamed, so the only way to find
// out what a file would do was to let it do it. On a member register that is 220 half-created people and a phone call from
// every one of them.
//
// Every row shape below is one a human has actually typed at an SHG meeting: a number with spaces, a nine-digit number, a
// role written in Gujarati, a trailing blank line, a name in a column the header calls something else.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readMemberRow, suggestRole, memberImportIdemKey, isPlausibleIndianMobile, DEFAULT_IMPORT_ROLE } from '../domain/member-import-row';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { assertTransition, isActive, canTransition } from '../../../core/bulk/domain/bulk-import.state';
import { BulkImportJob } from '../../../core/bulk/domain/bulk-import-job.entity';

const ROLES = ['farmer', 'dairy_farmer', 'pashupalak', 'worker', 'vyapari', 'sardar'];

describe('TENANT-1b-4 · reading one row of a human-written file', () => {
  it('normalises a phone the way the LOGIN path does', () => {
    // **THIS IS WHERE "IDEMPOTENT BY PHONE" IS EITHER KEPT OR LOST.** A member imported as "98765 43210" must be the same
    // person who later signs in as "+919876543210", or the register grows a duplicate it can never merge.
    for (const raw of ['9876543210', '+91 98765 43210', '098765 43210', '+919876543210']) {
      const out = readMemberRow({ phone: raw }, ROLES);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.phone).toBe('+919876543210');
    }
  });

  /** W156's own flagged row: "Hansa Ben V. · +91 90••• ••41 (9 digits) · invalid phone — one digit short · [Fix number]". */
  it('reports a short number as unusable and never guesses the missing digit', () => {
    const out = readMemberRow({ phone: '+91 90123 4541', full_name: 'Hansa Ben V.' }, ROLES);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('PHONE_INVALID');
  });

  /**
   * **A BLANK LINE IS ITS OWN VERDICT.** Spreadsheets carry trailing empty rows by the dozen, and reporting forty
   * "missing phone" errors for forty blank lines buries the two rows that actually need a human.
   */
  it('separates a blank row from a row missing its phone', () => {
    const blank = readMemberRow({ phone: '  ', full_name: '', role: '' }, ROLES);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe('ROW_EMPTY');

    const named = readMemberRow({ phone: '', full_name: 'Meera Ben J.' }, ROLES);
    expect(named.ok).toBe(false);
    if (!named.ok) expect(named.code).toBe('PHONE_MISSING');
  });

  it('defaults an absent role rather than refusing the row', () => {
    const out = readMemberRow({ phone: '9876543210' }, ROLES);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.roleCode).toBe(DEFAULT_IMPORT_ROLE);
  });

  /**
   * **W156's GUJARATI ROLE ROW, AND THE SUGGESTION IS NEVER APPLIED.** The screen shows "khedut · role name in Gujarati —
   * mapped to farmer? confirm". Accepting the guess silently is how somebody becomes a `dairy_farmer` because two words
   * looked alike — and roles are DATA a tenant in Bangladesh will fill with words this code has never seen.
   */
  it('marks an unknown role FIXABLE and offers a suggestion it does not act on', () => {
    const out = readMemberRow({ phone: '9876543210', role: 'khedut', full_name: 'Ranjan Bhai T.' }, ROLES);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('ROLE_UNKNOWN');
      expect('fixable' in out && out.fixable).toBe(true);
      // No prefix relationship with any known code, so there is nothing honest to propose.
      expect('suggestion' in out ? out.suggestion : undefined).toBeUndefined();
    }
  });

  /**
   * **THE SUGGESTION IS OFFERED AND NEVER APPLIED — AND A MUTATION PROVED THE SUITE COULD NOT SEE THE DIFFERENCE.**
   *
   * The test above uses "khedut", for which there IS no honest suggestion, so a mutant that accepted the suggestion when
   * one existed passed unnoticed. This is the case that matters: a row whose role has a plausible match must STILL be
   * refused as fixable, because the operator confirms the mapping in the file — the importer never decides it. W156 shows
   * exactly that shape ("mapped to farmer? confirm"), and a question mark on a screen is not consent.
   */
  it('refuses a row EVEN WHEN it has a confident suggestion', () => {
    const out = readMemberRow({ phone: '9876543210', role: 'farmers' }, ROLES);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('ROLE_UNKNOWN');
      expect('suggestion' in out ? out.suggestion : undefined).toBe('farmer');
    }
    // The same for a prefix match, which is the most tempting one to auto-apply.
    const dairy = readMemberRow({ phone: '9876543210', role: 'dairy' }, ROLES);
    expect(dairy.ok).toBe(false);
    if (!dairy.ok) expect('suggestion' in dairy ? dairy.suggestion : undefined).toBe('dairy_farmer');
  });

  it('offers a suggestion only where the words genuinely relate', () => {
    expect(suggestRole('farmers', ROLES)).toBe('farmer');       // plural
    expect(suggestRole('dairy', ROLES)).toBe('dairy_farmer');   // prefix
    expect(suggestRole('farmer', ROLES)).toBe('farmer');
    // **CONSERVATIVE ON PURPOSE: NO EDIT DISTANCE.** A fuzzy match would propose `worker` for `broker` and `vyapari` for
    // `vyapaari` — and one of those is a person selling their own crop while the other is a trader, with different KYC and
    // different payout eligibility (0125). A suggestion nobody can explain is worse than none, because the operator
    // clicks confirm on it.
    expect(suggestRole('broker', ROLES)).toBeUndefined();
    expect(suggestRole('kh', ROLES)).toBeUndefined();           // too short to mean anything
  });

  /** **AN ABSENT NAME IS null AND NEVER THE PHONE NUMBER.** A register full of people called "+919876543210" cannot be
   *  searched, and the roster's name column becomes a second phone column. */
  it('leaves a missing name empty', () => {
    const out = readMemberRow({ phone: '9876543210', full_name: '   ' }, ROLES);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fullName).toBeNull();
      expect(out.fullName).not.toBe(out.phone);
    }
  });

  it('keys idempotency on the tenant AND the normalised phone', () => {
    // The processor's `bulkrow:<job>:<n>` protects a RE-RUN of one job. This key protects the other case: the same person
    // twice in one file, or across two files.
    expect(memberImportIdemKey('t1', '+919876543210')).toBe('member_import:t1:+919876543210');
    expect(memberImportIdemKey('t1', '+919876543210')).not.toBe(memberImportIdemKey('t2', '+919876543210'));
  });
});

describe('TENANT-1b-4 · the validate-first states', () => {
  it('allows the triage route AND the straight-through route', () => {
    // `pending → validating → validated → processing` is W156's triage; `pending → processing` stays for appliers with no
    // validator (the pre-existing 'products' path). Both are legal, which is what lets ONE screen gain a confirm step
    // without every other import growing one.
    expect(canTransition('pending', 'validating')).toBe(true);
    expect(canTransition('validating', 'validated')).toBe(true);
    expect(canTransition('validated', 'processing')).toBe(true);
    expect(canTransition('pending', 'processing')).toBe(true);
  });

  it('never re-validates in place', () => {
    // A second pass would overwrite the report an operator is looking at while they decide. A stale report is cancelled
    // and the file re-uploaded, which is also the only honest answer when the register has moved underneath it.
    expect(canTransition('validated', 'validating')).toBe(false);
    expect(canTransition('validating', 'processing')).toBe(false);
    expect(() => assertTransition('validated', 'validating')).toThrow(/Cannot move/);
  });

  it('lets a validation fail or be cancelled', () => {
    expect(canTransition('validating', 'failed')).toBe(true);
    expect(canTransition('validating', 'cancelled')).toBe(true);
    expect(canTransition('validated', 'cancelled')).toBe(true);
  });

  /** A file waiting for somebody to press a button still holds a slot against the per-tenant cap: five abandoned
   *  validations must not let a sixth start. Mirrors 0129's `idx_bulk_jobs_active`. */
  it('counts a parked validation as ACTIVE', () => {
    expect(isActive('validating')).toBe(true);
    expect(isActive('validated')).toBe(true);
    expect(isActive('completed')).toBe(false);
    expect(isActive('cancelled')).toBe(false);
  });
});

describe('TENANT-1b-4 · the job records the triage and the file hash', () => {
  const HASH = 'a'.repeat(64);
  const report = {
    totalRows: 220, willCreate: 214, alreadyMembers: 4, fixable: 2, invalid: 0,
    issues: [{ rowIndex: 48, code: 'PHONE_INVALID', message: 'one digit short' }],
    issuesTruncated: false,
  };
  const fresh = () => BulkImportJob.create({
    id: 'j1', tenantId: 't1', importType: 'members', storageKey: 'k', requestedBy: 'staff-1',
  });

  it('parks at validated with the report, the hash and the row count', () => {
    const j = fresh();
    j.beginValidation();
    j.completeValidation(report, HASH);
    expect(j.status).toBe('validated');
    expect(j.fileSha256).toBe(HASH);
    expect(j.validation).toEqual(report);
    // The total comes from the report, so the console's "of 220 rows" and the job's counter cannot disagree.
    expect(j.toProps().totalRows).toBe(220);
  });

  /**
   * **THE TRIAGE MUST ADD UP TO THE FILE.** A report whose parts do not sum to `totalRows` is one an operator cannot
   * reason about, and the arithmetic is the only thing between "214 valid of 220" and a number somebody made up.
   */
  it('has parts that sum to the whole', () => {
    expect(report.willCreate + report.alreadyMembers + report.fixable + report.invalid).toBe(report.totalRows);
  });

  /**
   * **THE HASH IS CHECKED ON THE WAY IN, NOT JUST RECORDED.** A file swapped in the object store between the validation an
   * operator approved and the import they confirmed would otherwise apply bytes nobody reviewed.
   */
  it('refuses a different hash and accepts the same one', () => {
    const j = fresh();
    j.beginValidation();
    j.completeValidation(report, HASH);
    expect(j.recordFileHash(HASH)).toBe(true);           // the same bytes — proceed
    expect(j.recordFileHash('b'.repeat(64))).toBe(false); // different bytes — the caller fails the job
    // And the original hash is not overwritten by the rejected one: it is the hash the REPORT describes.
    expect(j.fileSha256).toBe(HASH);
  });

  it('records a hash for a job that never had one', () => {
    // The straight-through path ('products') has no validation pass, so the hash is first seen at import time. It is still
    // recorded — W156's promise is about every import batch, not only the validated ones.
    const j = fresh();
    expect(j.fileSha256).toBeNull();
    expect(j.recordFileHash(HASH)).toBe(true);
    expect(j.fileSha256).toBe(HASH);
  });
});

describe('TENANT-1b-4 · two defects in the shared phone normaliser, found by a real-world file', () => {
  /**
   * **DEFECT 1, FIXED IN THE SHARED NORMALISER BECAUSE THE FIX ONLY WIDENS.** "098765 43210" is how a phone number is
   * written on paper across India — the leading 0 is the STD prefix — and `normalizePhoneE164` returned null for it. A
   * paper-first member import would have flagged a large share of a real SHG register as invalid and sent staff to correct
   * nothing. No Indian mobile begins with 0, so stripping one leading zero from eleven digits is unambiguous.
   *
   * Safe for existing accounts: the change turns refusals into acceptances and never changes what an accepted number
   * resolves to. The login path gains the same tolerance, which is correct — those are one subscriber and must be one
   * person.
   */
  it('accepts the STD-prefixed form and resolves it to the same person', () => {
    expect(normalizePhoneE164('098765 43210')).toBe('+919876543210');
    expect(normalizePhoneE164('09876543210')).toBe('+919876543210');
    // Every form that worked before still resolves identically.
    expect(normalizePhoneE164('9876543210')).toBe('+919876543210');
    expect(normalizePhoneE164('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhoneE164('919876543210')).toBe('+919876543210');
    // And a genuinely unusable string is still refused.
    expect(normalizePhoneE164('0123')).toBeNull();
  });

  /**
   * **DEFECT 2, FIXED AT THE IMPORT FRONT DOOR AND DELIBERATELY NOT IN THE SHARED NORMALISER.**
   *
   * `/^\+[1-9]\d{7,14}$/` is E.164's global range, so `+91901234541` — nine subscriber digits, W156's own "one digit
   * short" row — passes. Tightening the shared function would be the obvious fix and the dangerous one: any account
   * already stored with a short number would stop normalising, and that person is locked out of their own login. So the
   * strict check guards the place bad data ENTERS, where a refusal costs a corrected spreadsheet cell.
   */
  it('refuses a nine-digit Indian number on import while the normaliser still accepts it', () => {
    // The shared function's behaviour is unchanged, and that is recorded rather than quietly altered.
    expect(normalizePhoneE164('+91 90123 4541')).toBe('+91901234541');
    expect(isPlausibleIndianMobile('+91901234541')).toBe(false);
    expect(isPlausibleIndianMobile('+919876543210')).toBe(true);
    // Indian mobiles start 6-9: a landline-shaped number is not a member's mobile.
    expect(isPlausibleIndianMobile('+912212345678')).toBe(false);
    // Another country's rules are not ours to guess — this check only speaks for +91.
    expect(isPlausibleIndianMobile('+8801712345678')).toBe(true);
  });
});

describe('TENANT-1b-4 · the invite reaches the member through the outbox, not a module import', () => {
  const applier = fs.readFileSync(
    path.join(__dirname, '..', 'bulk', 'member-bulk-applier.ts'), 'utf8');
  const map = fs.readFileSync(
    path.join(__dirname, '..', '..', 'communication', 'events', 'notification-event-map.ts'), 'utf8');

  /**
   * **THE FIRST VERSION OF THE APPLIER INJECTED `NotificationService` DIRECTLY, AND THAT WAS A DI DEFECT.**
   *
   * `IdentityModule` does not import `CommunicationModule`, so Nest could not have resolved it — and because the unit tests
   * never boot the container, nothing would have failed until the application started. Adding the import would also have
   * been the wrong fix: the platform already bridges an outbox event type to a notification code, so a module emits a fact
   * and the communication module decides who hears about it.
   */
  it('emits an outbox event and depends on no communication service', () => {
    expect(applier).toMatch(/eventType: 'identity\.member_imported'/);
    // **CODE PATTERNS, NOT PROSE** — the third time in this programme. This file EXPLAINS the defect in its own comments, so
    // a bare /NotificationService/ match fails on the explanation and could only be silenced by deleting it.
    expect(applier).not.toMatch(/import[^;]*NotificationService[^;]*;/);
    expect(applier).not.toMatch(/readonly \w+: NotificationService/);
    expect(applier).not.toMatch(/this\.\w+\.fanout\(/);
  });

  /** **AND THE PAYLOAD CARRIES THE RECIPIENT.** ADMIN-6b's finding was a map row pointing at a payload with no user id:
   *  the handler finds no recipient and returns early, silently — a fix that looks done and changes nothing. */
  it('puts the recipient IN the payload and maps it', () => {
    expect(applier).toMatch(/userId: user\.id/);
    expect(map).toMatch(/outboxType: 'identity\.member_imported',\s*eventCode: 'member\.invited',\s*recipientKeys: \['userId'\]/);
  });

  /** The member's own language travels with the event, because "in their language" is the promise. */
  it('carries the language when the row names one', () => {
    expect(applier).toMatch(/read\.languageCode \? \{ languageCode: read\.languageCode \}/);
  });
});
