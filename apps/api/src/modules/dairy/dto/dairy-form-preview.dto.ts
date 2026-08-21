// modules/dairy/dto/dairy-form-preview.dto.ts · PC-56 TENANT-6d-4 · the review step's own body, deliberately LENIENT.
//
// THE REVIEW'S JOB IS TO EXPLAIN, NOT TO REJECT.
//
// The first build of this wave pointed the two `preview` routes at the CREATE schemas, and that quietly made the
// review useless for most of what it exists to say. `RegisterBmcSchema` demands a uuid, so a mistyped centre id came
// back as a 400 from a validator instead of *"no centre of this cooperative has that id"*. Its tolerance regex forbids
// a minus sign, so `TOLERANCE_NEGATIVE` could never be reached. `CreateMccSchema` refuses a reason without an
// operator, so `REASON_WITHOUT_OPERATOR` could never be reached either. An operator would have seen a bare error code
// on a review screen whose entire purpose is to name, in their own language, what is wrong and with which field.
//
// So the review accepts STRINGS — capped in length, because a body still has to be bounded, and `.strict()`, because
// an unknown key is the caller's bug and not the operator's — and every judgement is made by `reviewBmc` /
// `reviewCentre`, which are the functions the act itself consults.
//
// The other half of the contract, and the reason this file is safe: the reviewers ALSO run the create schema, and
// report anything it would reject as a refusal against the field to blame (`writerIssues`). Lenient at the edge,
// strictly no more permissive than the writer in its verdict — so *"ready"* still means the write will be accepted.
import { z } from 'zod';

/** Long enough for any field on either form (the longest cap in the create schemas is 300), short enough to bound a
 *  body. A value over this cap is refused here rather than reviewed, because it cannot be a real entry. */
const loose = z.string().max(400);

export const PreviewBmcSchema = z.object({
  mccId: loose.optional(),
  capacityLitres: loose.optional(),
  targetTempC: loose.optional(),
  minTempC: loose.optional(),
  toleranceC: loose.optional(),
  iotDeviceRef: loose.optional(),
  model: loose.optional(),
  serialNo: loose.optional(),
}).strict();
export type PreviewBmcDto = z.infer<typeof PreviewBmcSchema>;

export const PreviewMccSchema = z.object({
  code: loose.optional(),
  defaultName: loose.optional(),
  regionId: loose.optional(),
  lat: loose.optional(),
  lng: loose.optional(),
  operatorUserId: loose.optional(),
  operatorReason: loose.optional(),
  capacityLitresShift: loose.optional(),
  analyzerModel: loose.optional(),
  analyzerSerial: loose.optional(),
  morningOpensAt: loose.optional(),
  morningClosesAt: loose.optional(),
  eveningOpensAt: loose.optional(),
  eveningClosesAt: loose.optional(),
}).strict();
export type PreviewMccDto = z.infer<typeof PreviewMccSchema>;

/**
 * What the WRITER would refuse about this body, as facts a review can print.
 *
 * Runs the create schema over the same values the create route would receive, and reports each complaint against the
 * field it names. This is what makes *"ready"* honest: a value the validator rejects is a refusal on the review, not a
 * 400 after somebody has pressed confirm.
 *
 * `too_big` is separated because *"too long"* is actionable in a way that *"rejected"* is not — the operator can see a
 * limit and shorten the entry.
 */
export interface WriterIssue { path: string | null; tooLong: boolean }

/**
 * Could this string be an id at all?
 *
 * A review looks values up in the database, and `mcc_centres.id` is a `uuid`: handing Postgres `MCC-AND-03` raises
 * `22P02` and the review — the one screen whose job is to explain what is wrong with an entry — answers with a 500. So
 * a value that cannot be an id is not asked about, and the reviewer's own refusal (*"no centre of this cooperative has
 * that id"*) is what the operator reads.
 */
export function looksLikeId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function writerIssuesOf(schema: z.ZodTypeAny, body: Record<string, unknown>): WriterIssue[] {
  const parsed = schema.safeParse(body);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({
    path: typeof i.path[0] === 'string' ? (i.path[0] as string) : null,
    tooLong: i.code === 'too_big',
  }));
}

/**
 * Trim, and drop what was left blank.
 *
 * The chain's submit does exactly this before calling `create`, so the review has to do it before asking the create
 * schema anything — otherwise a field the operator left EMPTY would be reported as rejected (`min(1)`) while the
 * review's own row correctly shows it as storing nothing, and the screen would contradict itself.
 */
export function submittedValues(dto: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dto)) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length > 0) out[k] = s;
  }
  return out;
}
