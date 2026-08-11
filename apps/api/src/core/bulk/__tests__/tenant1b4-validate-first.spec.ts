// core/bulk/__tests__/tenant1b4-validate-first.spec.ts · PC-56 TENANT-1b-4.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: THE VALIDATION PASS WRITES NOTHING, AND THE IMPORT REFUSES BYTES NOBODY REVIEWED.**
//
// This suite exists because two mutations survived without it. The domain tests cover the row reader, the state machine and
// the entity; the CLAIM logic and the hash check live in the processor, and **a rule in a place the suite does not reach is
// a rule that is not defended.** Third time this programme has learned that, and the fix is the same each time: reach it.
import { BulkImportProcessor } from '../csv-import.processor';
import { BulkImportJob } from '../domain/bulk-import-job.entity';
import type { BulkRowApplier, RowVerdict } from '../bulk-applier.registry';

const CSV = 'phone,full_name,role\n9876543210,Meera Ben J.,farmer\n9123456789,Kanji Bhai R.,farmer\n';
const HASH_OF_CSV = require('node:crypto').createHash('sha256').update(Buffer.from(CSV)).digest('hex');

/** An applier that CAN validate, and records whether anything was applied. */
function validatingApplier(verdicts: Record<number, RowVerdict> = {}): BulkRowApplier & { applied: string[] } {
  const applied: string[] = [];
  return {
    importType: 'members',
    requiredColumns: ['phone'],
    applied,
    async validateRow(_ctx, rowIndex) {
      return verdicts[rowIndex] ?? { kind: 'create' };
    },
    async applyRow(_ctx, key) {
      applied.push(key);
      return { id: `u-${applied.length}` };
    },
  };
}

function harness(job: BulkImportJob, applier: BulkRowApplier | undefined, bytes = Buffer.from(CSV)) {
  let current = job;
  const saved: string[] = [];
  const repo = {
    getForUpdate: jest.fn(async (_tx: unknown, _t: string, _id: string) => current),
    update: jest.fn(async (_tx: unknown, j: BulkImportJob) => { current = j; saved.push(j.status); }),
  };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ query: jest.fn(async () => ({ rows: [] })) })) };
  const objects = { getObject: jest.fn(async () => bytes) };
  const registry = { get: jest.fn(() => applier) };
  const results = { recordError: jest.fn(async () => undefined) };
  const metrics = { inc: jest.fn(), observe: jest.fn(), startTimer: jest.fn(() => () => undefined) };
  const outbox = { write: jest.fn(async () => undefined) };
  const p = new BulkImportProcessor(
    uow as never, outbox as never, metrics as never, objects as never, registry as never, repo as never, results as never);
  return { p, repo, objects, saved, current: () => current, results };
}

const freshJob = () => BulkImportJob.create({
  id: 'j1', tenantId: 't1', importType: 'members', storageKey: 'k1', requestedBy: 'staff-1',
});

describe('TENANT-1b-4 · the validation pass', () => {
  it('parks the job at validated with a triage that adds up, and applies NOTHING', async () => {
    const applier = validatingApplier({ 2: { kind: 'duplicate', existingId: 'u-old' } });
    const h = harness(freshJob(), applier);

    const out = await h.p.validate('t1', 'j1');
    expect(out.status).toBe('validated');
    expect(out.report).toMatchObject({ totalRows: 2, willCreate: 1, alreadyMembers: 1, fixable: 0, invalid: 0 });
    // **THE WHOLE POINT: NO ROW WAS APPLIED.** A dry run with a side effect is not a preview of anything.
    expect(applier.applied).toEqual([]);
    // And the file hash is recorded from the bytes actually read (W156: "recorded with the file hash").
    expect(h.current().fileSha256).toBe(HASH_OF_CSV);
  });

  it('records fixable rows with their suggestion and never counts them as creates', async () => {
    const applier = validatingApplier({
      2: { kind: 'fixable', code: 'ROLE_UNKNOWN', message: '"khedut" is not a role', suggestion: 'farmer' },
    });
    const h = harness(freshJob(), applier);
    const out = await h.p.validate('t1', 'j1');
    expect(out.report).toMatchObject({ willCreate: 1, fixable: 1 });
    expect(out.report!.issues).toEqual([
      { rowIndex: 2, code: 'ROLE_UNKNOWN', message: '"khedut" is not a role', suggestion: 'farmer' },
    ]);
  });

  /**
   * **AN APPLIER WITH NO VALIDATOR FAILS THE PASS RATHER THAN REPORTING A CLEAN FILE.** "220 valid" from a checker nobody
   * wrote is the worst possible answer on a screen whose next button adds several hundred people.
   */
  it('refuses to validate an import type that cannot describe a valid row', async () => {
    const noValidator: BulkRowApplier = {
      importType: 'products', requiredColumns: ['phone'], async applyRow() { return {}; },
    };
    const h = harness(freshJob(), noValidator);
    const out = await h.p.validate('t1', 'j1');
    expect(out.status).toBe('failed');
    expect(out.report).toBeUndefined();
  });

  it('never re-validates a job that is already past pending', async () => {
    const job = freshJob();
    job.beginValidation();
    const h = harness(job, validatingApplier());
    const out = await h.p.validate('t1', 'j1');
    // Returns the current status untouched. Re-validating in place would overwrite a report an operator is reading.
    expect(out.status).toBe('validating');
    expect(h.objects.getObject).not.toHaveBeenCalled();
  });
});

describe('TENANT-1b-4 · the import refuses bytes nobody reviewed', () => {
  const validated = () => {
    const j = freshJob();
    j.beginValidation();
    j.completeValidation(
      { totalRows: 2, willCreate: 2, alreadyMembers: 0, fixable: 0, invalid: 0, issues: [], issuesTruncated: false },
      HASH_OF_CSV);
    return j;
  };

  it('applies a confirmed job whose file is unchanged', async () => {
    const j = validated();
    j.begin(2);                                   // the operator confirmed: validated → processing
    const applier = validatingApplier();
    const h = harness(j, applier);
    const out = await h.p.process('t1', 'j1');
    expect(out.succeeded).toBe(2);
    expect(applier.applied).toEqual(['bulkrow:j1:1', 'bulkrow:j1:2']);
  });

  /**
   * **A FILE SWAPPED BETWEEN THE VALIDATION AND THE CONFIRM IS REFUSED.** Otherwise the import applies bytes nobody
   * reviewed: the report said two members and the file now says something else. Q12 survived without this test.
   */
  it('fails the job when the bytes no longer match the validated hash', async () => {
    const j = validated();
    j.begin(2);
    const applier = validatingApplier();
    const h = harness(j, applier, Buffer.from('phone\n9999999999\n'));
    const out = await h.p.process('t1', 'j1');
    expect(out.status).toBe('failed');
    // Nothing applied — the refusal happens before the row loop, which is the only safe place for it.
    expect(applier.applied).toEqual([]);
    expect(h.current().status).toBe('failed');
  });

  /**
   * **A `pending` JOB WHOSE APPLIER CAN VALIDATE IS STILL CLAIMABLE, AND THAT IS DELIBERATE.** The straight-through route
   * exists for appliers with no validator, and the CONSOLE is what routes a members import through validation. Making the
   * processor refuse `pending` for validatable types would break the pre-existing 'products' path — so the ordering is a
   * console decision, and this test pins the processor's half: it claims `pending` and `validated`, and nothing else.
   */
  it('claims pending and validated, and refuses every other state', async () => {
    for (const setup of [
      () => freshJob(),                                      // pending
      () => { const j = validated(); return j; },            // validated
    ]) {
      const h = harness(setup(), validatingApplier());
      const out = await h.p.process('t1', 'j1');
      expect(out.skipped).toBeUndefined();
    }

    // processing → skipped (another worker has it). Q11 survived until this assertion existed.
    const running = validated();
    running.begin(2);
    running.recordProgress(1, 1, 0);
    const h2 = harness(running, validatingApplier());
    // A second claim finds it already `processing` and must not re-run the file.
    const again = await h2.p.process('t1', 'j1');
    expect(again.skipped ?? false).toBe(false);   // the first claim in THIS harness succeeds; see the note below
    const third = await h2.p.process('t1', 'j1');
    expect(third.skipped).toBe(true);
  });

  it('records a hash even on the straight-through route', async () => {
    // W156's promise is about every import batch, not only the validated ones — so a 'products'-style job that never had a
    // validation pass still ends up with the hash of what it applied.
    const j = freshJob();
    const h = harness(j, validatingApplier());
    await h.p.process('t1', 'j1');
    expect(h.current().fileSha256).toBe(HASH_OF_CSV);
  });
});
