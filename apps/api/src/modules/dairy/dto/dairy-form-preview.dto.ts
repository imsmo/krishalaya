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

// The four helpers below (`WriterIssue`, `looksLikeId`, `writerIssuesOf`, `submittedValues`) are `shared/form-review.ts`
// since PC-56 TENANT-7a — the course form needed them and modules do not import each other's DTOs. Re-exported.
import { WriterIssue, looksLikeId, writerIssuesOf, submittedValues } from '../../../shared/form-review';
export type { WriterIssue };
export { looksLikeId, writerIssuesOf, submittedValues };
