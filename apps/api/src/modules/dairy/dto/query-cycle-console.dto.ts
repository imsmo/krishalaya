// modules/dairy/dto/query-cycle-console.dto.ts · PC-56 TENANT-6c-6 · W169's register query, zod `.strict()`.
//
// `cycleId` is optional, and that is the whole ergonomics of the screen: an operator opening *"Payout cycles"* means
// the fortnight that is running, and should not have to know a uuid to see it. Passing one is how last fortnight
// becomes a BOOKMARK — the same ruling W167 and W168 made about the day and the cycle riding in the URL.
import { z } from 'zod';

export const CycleConsoleSchema = z.object({
  cycleId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  /** 25 by default: W169's register is a page of a fortnight, and 312 rows in one response is a 2G timeout. */
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** The canon draws Gross sorted DESCENDING (`aria-sort="descending"`) — who is owed the most, first. Ascending is
   *  offered because the smallest bills are where a missing pour hides, and nothing else is: a sort on a column the
   *  canon does not sort on would be an invented feature with an invented index. */
  direction: z.enum(['desc', 'asc']).default('desc'),
}).strict();
export type CycleConsoleDto = z.infer<typeof CycleConsoleSchema>;

/**
 * `base64("<gross>|<uuid>")` → the keyset. A cursor that does not decode is treated as NO cursor rather than as an
 * error: a truncated URL should show an operator the first page, not a 400 they cannot act on.
 */
export function decodeGrossCursor(raw?: string): { gross: string; id: string } | null {
  if (!raw) return null;
  try {
    const [gross, id] = Buffer.from(raw, 'base64').toString('utf8').split('|');
    if (!gross || !id || !/^-?\d+$/.test(gross) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { gross, id };
  } catch {
    return null;
  }
}
