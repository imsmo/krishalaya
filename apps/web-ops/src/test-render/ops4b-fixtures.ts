// apps/web-ops/src/test-render/ops4b-fixtures.ts · PC-56 OPS-4b — the upkeep page's server answers as the API shapes them: the signed-in person's
// two machines (4a's fixtures), the entries of one of them — one carrying a typed NOTE with a person's name, which the page must never print —, the
// server's alerts for her machines AND one for another person's machine (which the page must not print), and the server's answer to a recorded
// entry. Amounts chosen so that no sum, product or difference of them appears by accident. No canon person, machine, place or figure (survey F-16).
import type { MaintenanceEntry } from '../features/ops4/chc';
import type { RecordedEntry } from '../features/ops4/upkeep';
import { A1, A2, A_OTHER } from './ops4a-fixtures';

export const PERSON_IN_NOTE = 'Testperson Notename';
export const ENTRIES_A1: MaintenanceEntry[] = [
  { id: 'e1', logType: 'repair', costMinor: '411150', notes: `fixed by ${PERSON_IN_NOTE}`, engineHoursAt: '1200.5', performedOn: '2026-10-20' },
  { id: 'e2', logType: 'breakdown', costMinor: null, notes: null, engineHoursAt: null, performedOn: '2026-09-02' },
];
export const ENTRIES: Record<string, MaintenanceEntry[] | null> = { [A1]: ENTRIES_A1, [A2]: [] };
export const ALERTS = [{ assetId: A1, alert: 'needs_attention' as const }, { assetId: A2, alert: 'service_due' as const }, { assetId: A_OTHER, alert: 'needs_attention' as const }];
export const RECORDED: RecordedEntry = { id: '0192d2c4-e0e0-7000-8000-0000000000e9', assetId: A1, logType: 'service', costMinor: '73150', engineHoursAt: '1210.0', performedOn: '2026-11-09' };
export const DRAFT = { asset: A1, logType: 'service', performedOn: '2026-11-09', cost: '731.5', hours: '1210.0' };

/** The canon's upkeep and animal false words as they would appear in VISIBLE text (outside the refusal list), affirmed. */
export const FALSE_4B = /\bscan(ned)?\b|paravet|photo|INAPH|merge desk|handshake|insurance follows|days down|real rent|odometer|technician|completion|%|synced|ambassador:/i;
