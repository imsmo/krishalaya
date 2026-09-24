// modules/education/dto/create-instructor.dto.ts · PC-56 TENANT-7d · the instructor FORMS as the writer receives them —
// one shape for the review and the write (7a's rule) — the act's body, the desk's list query, and the studio form.
// The review body is LENIENT (strings, capped) so a typo is explained by name rather than refused by a validator; the
// writer schema is the same fields with the column widths, and `writerIssuesOf` reports what the writer would refuse.
import { z } from 'zod';
import { CREDENTIAL_FORM_FIELDS, PROFILE_FORM_FIELDS } from '../domain/instructor-review';
import { TEMPLATE_FORM_FIELDS } from '../domain/course-template';

const loose = z.string().max(4000);
const shape = <T extends readonly string[]>(names: T, v: z.ZodTypeAny) => Object.fromEntries(names.map((n) => [n, v.optional()])) as Record<T[number], z.ZodOptional<z.ZodTypeAny>>;

/** PC-26's bio-only body, kept for `PUT /instructors/me` callers that send only a bio. */
export const CreateInstructorSchema = z.object({ bio: z.string().max(2000).nullish() }).strict();
export type CreateInstructorDto = z.infer<typeof CreateInstructorSchema>;

export const ProfileFormSchema = z.object({ ...shape(PROFILE_FORM_FIELDS, loose) }).strict();
export type ProfileFormDto = z.infer<typeof ProfileFormSchema>;
export const ProfileWriterSchema = z.object({
  displayName: z.string().max(120).optional(),
  bio: z.string().min(1).max(2000),
  languages: z.string().max(80).optional(),
  visibility: z.string().max(10).optional(),
}).strict();

export const CredentialFormSchema = z.object({ ...shape(CREDENTIAL_FORM_FIELDS, loose) }).strict();
export type CredentialFormDto = z.infer<typeof CredentialFormSchema>;
export const CredentialWriterSchema = z.object({
  title: z.string().min(1).max(200),
  issuer: z.string().max(200).optional(),
  yearAwarded: z.string().max(4).optional(),
  documentMediaId: z.string().max(40),
}).strict();

/** The preview asks which form, and — for a re-upload — which credential. */
export const PreviewInstructorSchema = z.object({
  form: z.enum(['profile', 'credential']),
  credentialId: z.string().max(80).optional(),
  ...shape(PROFILE_FORM_FIELDS, loose), ...shape(CREDENTIAL_FORM_FIELDS, loose),
}).strict();
export type PreviewInstructorDto = z.infer<typeof PreviewInstructorSchema>;

/** The act's body: the reason (3–300, the audit row's own words) and, for a credential act, the credential. */
export const InstructorActSchema = z.object({ reason: z.string().min(1).max(400), credentialId: z.string().max(80).optional() }).strict();
export type InstructorActDto = z.infer<typeof InstructorActSchema>;

export const QueryInstructorsSchema = z.object({
  verified: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryInstructorsDto = z.infer<typeof QueryInstructorsSchema>;

export const TemplateFormSchema = z.object({ ...shape(TEMPLATE_FORM_FIELDS, loose) }).strict();
export type TemplateFormDto = z.infer<typeof TemplateFormSchema>;
export const TemplateWriterSchema = z.object({ templateCode: z.string().min(1).max(60), title: z.string().max(250).optional() }).strict();
