// apps/web-tenant/src/test/tenant1b4-import.spec.ts · PC-56 TENANT-1b-4.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: THE SCREEN NEVER OFFERS A BUTTON THAT WOULD DO NOTHING, AND NEVER SHOWS A COUNT
// IT HAS TRUNCATED AS IF IT WERE THE WHOLE.**
//
// The operator is one click from adding several hundred people to a register they cannot easily un-add.
import { importStage, canConfirm, issueSummary, hashShort, triageBalances } from '../features/people/import';
import { memberImportTemplateCsv, MEMBER_IMPORT_COLUMNS } from '@krishalaya/sdk-js';

const t = { t: (k: string, v: Record<string, string | number> = {}) => `${k}:${Object.values(v).join(',')}` };

const report = (over: Partial<Parameters<typeof triageBalances>[0]> = {}) => ({
  totalRows: 220, willCreate: 214, alreadyMembers: 4, fixable: 2, invalid: 0,
  issues: [{ rowIndex: 48, code: 'PHONE_INVALID', message: 'one digit short' }],
  issuesTruncated: false, ...over,
});

describe('TENANT-1b-4 · the five stages an operator can be in', () => {
  it('separates "your turn" from "the system is busy"', () => {
    // The operator does not care WHICH work is running; they care whether the next move is theirs. `validated` is the only
    // state where it is, so it must never be collapsed into "working".
    expect(importStage({ status: 'validating' })).toBe('working');
    expect(importStage({ status: 'processing' })).toBe('working');
    expect(importStage({ status: 'validated' })).toBe('validated');
    expect(importStage({ status: 'pending' })).toBe('uploaded');
  });

  it('treats a partial import as finished rather than failed', () => {
    // 213 of 214 created is a result, not a failure — the screen shows the counts and the operator fixes one row.
    expect(importStage({ status: 'partially_completed' })).toBe('done');
    expect(importStage({ status: 'completed' })).toBe('done');
    expect(importStage({ status: 'failed' })).toBe('failed');
    expect(importStage({ status: 'cancelled' })).toBe('failed');
  });
});

describe('TENANT-1b-4 · the confirm button', () => {
  it('appears only on a validated job with something to create', () => {
    expect(canConfirm({ status: 'validated', validation: report() })).toBe(true);
  });

  /**
   * **A FILE WHERE EVERYONE IS ALREADY A MEMBER GETS NO BUTTON.** Offering "Import 0 rows" teaches staff that the button
   * lies. The screen says "nothing to add — your register is up to date", which is the actual outcome and a useful one.
   */
  it('disappears when every row is already a member', () => {
    expect(canConfirm({ status: 'validated', validation: report({ willCreate: 0, alreadyMembers: 220, fixable: 0 }) })).toBe(false);
  });

  it('never appears before validation or after it has started', () => {
    expect(canConfirm({ status: 'pending', validation: null })).toBe(false);
    expect(canConfirm({ status: 'validating', validation: null })).toBe(false);
    expect(canConfirm({ status: 'processing', validation: report() })).toBe(false);
    expect(canConfirm({ status: 'completed', validation: report() })).toBe(false);
    // A validated job with no report at all cannot be confirmed either — there is no count to show on the button.
    expect(canConfirm({ status: 'validated', validation: null })).toBe(false);
  });
});

describe('TENANT-1b-4 · the triage is honest about itself', () => {
  it('adds up to the file', () => {
    // W156's own numbers: 214 + 4 + 2 + 0 = 220. Parts that do not sum to the whole are parts an operator cannot reason
    // about, and the arithmetic is all that stands between "214 valid of 220" and a number somebody made up.
    expect(triageBalances(report())).toBe(true);
    expect(triageBalances(report({ willCreate: 300 }))).toBe(false);
  });

  /** **A TRUNCATED LIST SAYS SO.** "2 flagged rows" when forty are flagged is a lie the operator acts on. */
  it('distinguishes a complete issue list from a truncated one', () => {
    expect(issueSummary(report(), t)).toBe('import.issuesAll:2,220');
    const many = report({ fixable: 40, willCreate: 176, issuesTruncated: true });
    expect(issueSummary(many, t)).toBe('import.issuesTruncated:1,40,220');
  });
});

describe('TENANT-1b-4 · the file fingerprint', () => {
  it('shows enough to compare two jobs and no more', () => {
    // Twelve hex characters is what a human uses to see that two jobs are the same file. Sixty-four is noise nobody reads.
    expect(hashShort('a'.repeat(64))).toHaveLength(12);
    expect(hashShort('abcdef0123456789' + 'f'.repeat(48))).toBe('abcdef012345');
  });
});

describe('TENANT-1b-4 · the template cannot drift from the parser', () => {
  it('is generated from the same column list the importer reads', () => {
    const csv = memberImportTemplateCsv();
    expect(csv.split('\n')[0]).toBe(MEMBER_IMPORT_COLUMNS.join(','));
    // Phone first, because it is the only required column and the identity the whole import turns on.
    expect(MEMBER_IMPORT_COLUMNS[0]).toBe('phone');
  });

  it('shows a sample row in the shape somebody actually writes', () => {
    const [, sample] = memberImportTemplateCsv().split('\n');
    // A plain ten-digit number and a real Gujarati name — not "John Doe / 1234567890", which teaches nobody the format
    // that matters on a paper register.
    expect(sample).toMatch(/^\d{10},/);
    expect(sample).toContain('farmer');
    expect(sample).toContain('gu');
  });
});
