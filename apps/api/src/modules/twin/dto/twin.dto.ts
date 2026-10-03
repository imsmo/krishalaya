// modules/twin/dto/twin.dto.ts · PC-56 TENANT-12 · transport bounds only — the REVIEW (domain/twin-rules) judges values, citations,
// as-ofs, names and reasons, and answers every refusal by name. `.strict()` everywhere (anti-mass-assignment).
import { z } from 'zod';
import { SCENARIO_STATUSES } from '../domain/twin-scenario.state';

const s = (max: number) => z.string().max(max);
export const ScenarioInputSchema = z.object({
  name: s(400).optional(), templateCode: s(40).nullish(), productId: z.string().uuid().nullish(),
}).strict();
export type ScenarioInputDto = z.infer<typeof ScenarioInputSchema>;

export const AssumptionsSchema = z.object({
  assumptions: z.array(z.object({
    key: s(40), value: s(40).nullish(), unit: s(20).nullish(), citation: s(2000).nullish(), asOf: s(20).nullish(),
  }).strict()).max(20),
}).strict();
export type AssumptionsDto = z.infer<typeof AssumptionsSchema>;

export const ReasonSchema = z.object({ reason: s(1000).optional() }).strict();
export type ReasonDto = z.infer<typeof ReasonSchema>;
export const EmptySchema = z.object({}).strict();

export const QueryScenariosSchema = z.object({
  status: z.enum(SCENARIO_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: s(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryScenariosDto = z.infer<typeof QueryScenariosSchema>;

export const QueryResultsSchema = z.object({ a: z.string().uuid(), b: z.string().uuid().optional() }).strict();
export type QueryResultsDto = z.infer<typeof QueryResultsSchema>;

export const DeviceInputSchema = z.object({ kind: s(40), serial: s(200), label: s(400).nullish(), parcelId: z.string().uuid().nullish() }).strict();
export type DeviceInputDto = z.infer<typeof DeviceInputSchema>;
export const QueryDevicesSchema = z.object({ kind: s(40).optional(), cursor: s(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export type QueryDevicesDto = z.infer<typeof QueryDevicesSchema>;
