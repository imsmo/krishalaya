// modules/tenancy/dto/onboarding-governance.dto.ts · PC-56 TENANT-SW-d · the profile step (W114) + setup calls (W2619–W2625) — zod, strict.
// Transport bounds only: the SERVICE judges every field (country formats, the district, the advisory, the slot) and names each refusal.
import { z } from 'zod';
import { SETUP_CALL_LANGUAGES } from '../domain/setup-call';

const opt = (max: number) => z.string().max(max).nullable().optional();
export const ProfileStepSchema = z.object({
  legalName: opt(250), displayName: opt(150), regionId: opt(40), cinOrRegNo: opt(60), pan: opt(30), gstin: opt(30), fssaiLicense: opt(40),
  /** W114 "a gentle confirm, never a block": true = "continue" after the state-code advisory was shown. */
  confirmGstState: z.boolean().optional(),
  reason: z.string().max(280).optional(),
}).strict();
export type ProfileStepDto = z.infer<typeof ProfileStepSchema>;

/** A draft is anything the person typed so far — the service keeps only the step's keys, as text. */
export const DraftSchema = z.object({ payload: z.record(z.string(), z.union([z.string().max(250), z.null()])) }).strict();

export const SetupCallSchema = z.object({
  /** Civil IST date + times: "2026-10-12", "10:30", "11:30" — the Krishalaya team's clock. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
  languageCode: z.enum(SETUP_CALL_LANGUAGES),
  notes: z.string().max(500).optional(),
}).strict();
export type SetupCallDto = z.infer<typeof SetupCallSchema>;
export const CancelSetupCallSchema = z.object({ reason: z.string().max(300) }).strict();
export const SetupCallListSchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).strict();
