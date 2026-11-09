// apps/web-ops/src/test-render/ops3a-fixtures.ts · PC-56 OPS-3a — the counter's server answers as the API shapes them: the centre in custody
// (`GET /v1/dairy/mccs/mine`), its day sheet split by hold state (OPS3-B15), its roll (member codes; the fixture ALSO carries a name-like field the
// API never sends, which must never print), the record act's answer, and the cooler monitor's tiles (one at another centre, and a `fillPct` the
// page must never print). No canon person, member, centre or figure.
import type { DairyBmcTile, DairyDaySummaryRow, DairyMcc, DairyMembership } from '@krishalaya/sdk-js';
import type { RecordedPour } from '../features/ops3/counter';
import { COW_NOW } from './ops3c-fixtures';

export const C1 = '0192d2c4-c0c0-7000-8000-0000000000c1';
export const C2 = '0192d2c4-c0c0-7000-8000-0000000000c2';
export const CENTRE: DairyMcc = { id: C1, code: 'TC-01', defaultName: 'Test centre one', regionId: null, lat: null, lng: null, operatorUserId: 'u-me',
  capacityLitresShift: null, isActive: true, shiftWindows: { morning: { opens: '06:00', closes: '09:30' }, evening: null } };
export const CENTRE_2: DairyMcc = { ...CENTRE, id: C2, code: 'TC-02', defaultName: 'Test centre two', shiftWindows: { morning: null, evening: null } };
export const TODAY = '2026-11-09';

export const ROWS: DairyDaySummaryRow[] = [{ shift: 'morning', slips: 3, weightKg: '31.500', amountMinor: '120000', waterFlags: 1,
  payableMinor: '90000', heldMinor: '20000', rejectedMinor: '10000', heldPours: 1, rejectedPours: 1, flaggedPours: 2 }];
/** Every amount the shift / home pages may print for ROWS (en): the total and its three parts, the server's — nothing else. */
export const ROW_AMOUNTS = ['₹1,200.00', '₹900.00', '₹200.00', '₹100.00'];

const member = (id: string, code: string, mccId = C1): DairyMembership & { fullName: string; phone: string } =>
  ({ id, farmerUserId: `f-${code}`, mccId, memberCode: code, paymentCycle: 'fortnightly', defaultAnimalType: 'cow', isActive: true, fullName: `Name Of ${code}`, phone: '+910000000000' });
export const M1 = '0192d2c4-0e0e-7000-8000-000000000001';
export const M2 = '0192d2c4-0e0e-7000-8000-000000000002';
export const ROLL: DairyMembership[] = [member(M1, 'TC-001'), member(M2, 'TC-002')];

export const POUR = { membershipId: M1, shift: 'morning' as const, collectedOn: TODAY, weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', waterFlag: true, adulterationFlags: ['urea'] };
export const RECORDED: RecordedPour = { id: '0192d2c4-9090-7000-8000-000000000001', memberCode: 'TC-001', mccId: C1, shift: 'morning', collectedOn: TODAY,
  weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', amountMinor: '43050', rateCardId: COW_NOW.id, holdState: 'held', createdAt: '2026-11-09T01:12:40.000Z',
  waterFlag: true, adulterationFlags: ['urea'] };
export const CARD = COW_NOW;

const tile = (unitId: string, mccId: string, over: Partial<DairyBmcTile> = {}): DairyBmcTile => ({
  unitId, mccId, mccCode: 'TC-01', mccName: 'Test centre one', operatorUserId: 'u-me', tempC: '3.9', verdict: 'in_range',
  telemetry: { state: 'live', ageMinutes: 12, silenceMinutes: 30 }, band: { minC: '2.0', targetC: '4.0', maxC: '4.5' }, capacityLitres: '2000',
  volumeLitres: '1200', fillPct: 60, volumeAt: '2026-11-09T02:30:00.000Z', compressor: { state: 'healthy', at: null }, deviceRef: 'dev-1', model: 'M-1',
  serialNo: 'SN-SECRET-1', readings24h: 40, breaches24h: 0, ...over,
});
export const TILES: DairyBmcTile[] = [tile('0192d2c4-b0b0-7000-8000-000000000001', C1), tile('0192d2c4-b0b0-7000-8000-000000000002', C2, { volumeLitres: '777', tempC: '9.9' })];

/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_3A = /accept|joint|lactoscan|read automatically|device payload|slip no|slip number|\bQR\b|reprint|\bSMS\b|thermal|10-day|witness|supervisor|\bPIN\b|centre manager|synced|offline|on this device|variance|composite|\bavg\b|average|zero-sum|reconcil|on-call|audit trail|load.?cell|agitator|tanker|recount|×|=|÷|−|Vanthali|Anand|Jayaben|Meera|0781|537\.36|67\.17|\b214\b/i;
