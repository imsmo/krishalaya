// modules/traceability/dto/create-trace-event.dto.ts · zod .strict() — append a journey event.
// PC-56 HOTFIX-7 · B15: `meta` is no longer `z.record(z.unknown())`. Each step accepts ONLY its allow-listed keys, each by its value rule
// (domain/trace-meta.ts — the same list the public scan and migration 0217's trace_scan_v2 apply): an unknown key, a phone-shaped value or a
// coordinate is refused 422 at the author's door, never published.
import { z } from 'zod';
import { TRACE_STEPS, TraceStep } from '../domain/traceability.events';
import { traceMetaSchema } from '../domain/trace-meta';

const perStep = (TRACE_STEPS as readonly TraceStep[]).map((step) =>
  z.object({ eventCode: z.literal(step), meta: traceMetaSchema(step).default({}) }).strict());

export const AppendEventSchema = z.discriminatedUnion('eventCode', perStep as unknown as [typeof perStep[number], typeof perStep[number], ...Array<typeof perStep[number]>]);
export type AppendEventDto = { eventCode: TraceStep; meta: Record<string, string | number | undefined> };
