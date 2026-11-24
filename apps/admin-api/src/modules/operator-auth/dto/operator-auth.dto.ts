// apps/admin-api/src/modules/operator-auth/dto/operator-auth.dto.ts · PC-56 ADMIN-AUTH-1. Every body `.strict()` at the top level.
//
// A WebAuthn response is checked for SHAPE here (sizes, the fields the library reads) and for MEANING in webauthn.ceremony.ts.
// Its inner `response` object is kept as a string→string record rather than a strict schema, because the browser adds fields
// (transports, publicKeyAlgorithm, …) across versions and a strict schema would turn a browser upgrade into a lockout.
import { z } from 'zod';

const B64Url = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);
/** A login ticket: 32 random bytes, base64url (43 chars). */
export const Ticket = B64Url(64);
const Reason = z.string().trim().min(10).max(500);
const Label = z.string().trim().min(1).max(60);

const CredentialResponse = z.object({
  id: B64Url(1400),
  rawId: B64Url(1400),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.union([z.string().max(20_000), z.array(z.string().max(20)).max(8), z.number(), z.null()])),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
  authenticatorAttachment: z.string().max(40).optional(),
}).strict();

export const KeyOptionsSchema = z.object({ ticket: Ticket }).strict();
export type KeyOptionsDto = z.infer<typeof KeyOptionsSchema>;

export const EnrollSchema = z.object({
  ticket: Ticket,
  code: z.string().trim().min(8).max(80),
  label: Label,
  response: CredentialResponse,
}).strict();
export type EnrollDto = z.infer<typeof EnrollSchema>;

export const LoginSchema = z.object({ ticket: Ticket, response: CredentialResponse }).strict();
export type LoginDto = z.infer<typeof LoginSchema>;

export const StepUpSchema = z.object({ response: CredentialResponse }).strict();
export type StepUpDto = z.infer<typeof StepUpSchema>;

export const AddKeySchema = z.object({ label: Label, response: CredentialResponse }).strict();
export type AddKeyDto = z.infer<typeof AddKeySchema>;

export const RevokeKeySchema = z.object({ reason: Reason }).strict();
export type RevokeKeyDto = z.infer<typeof RevokeKeySchema>;

export const IssueCodeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320), reason: Reason }).strict();
export type IssueCodeDto = z.infer<typeof IssueCodeSchema>;
