// apps/web-ops/src/test-render/ops3b-fixtures.ts · PC-56 OPS-3b — the cooler's server answers as the API shapes them: the monitor's tiles (one at the
// custody centre, one at ANOTHER centre that must never show; each carries a `fillPct`, a sensor serial and an operator id the page must never print),
// a stale tile, a never-read tile, the series as the server's points, and the reading act's answer. No canon person, centre or figure.
import type { DairyBmcMonitor, DairyBmcTile } from '@krishalaya/sdk-js';
import type { RecordedReading } from '../features/ops3/bmc';
import { C1, C2, CENTRE, CENTRE_2 } from './ops3a-fixtures';

export { C1, C2, CENTRE, CENTRE_2 };
export const U1 = '0192d2c4-b0b0-7000-8000-0000000000a1';
export const U2 = '0192d2c4-b0b0-7000-8000-0000000000a2';
export const U3 = '0192d2c4-b0b0-7000-8000-0000000000a3';
const tile = (unitId: string, mccId: string, over: Partial<DairyBmcTile> = {}): DairyBmcTile => ({
  unitId, mccId, mccCode: 'TC-01', mccName: 'Test centre one', operatorUserId: 'u-op-secret', tempC: '3.9', verdict: 'in_range',
  telemetry: { state: 'live', ageMinutes: 12, silenceMinutes: 30 }, band: { minC: '2.0', targetC: '4.0', maxC: '4.5' }, capacityLitres: '2000.00',
  volumeLitres: '1200.00', fillPct: 60, volumeAt: '2026-11-09T02:30:00.000Z', compressor: { state: 'healthy', at: '2026-11-09T01:05:00.000Z' }, deviceRef: 'dev-1',
  model: 'M-1', serialNo: 'SN-SECRET-1', readings24h: 41, breaches24h: 3, ...over,
});
export const T1 = tile(U1, C1);
/** ANOTHER centre's cooler: its figures (777 L, 9.9 °C, 17 readings) must never print on a custody page. */
export const T_AWAY = tile(U2, C2, { mccCode: 'TC-02', mccName: 'Test centre two', volumeLitres: '777.00', tempC: '9.9', verdict: 'above_band', readings24h: 17 });
export const T_STALE = tile(U3, C1, { mccCode: 'TC-01', telemetry: { state: 'stale', ageMinutes: 95, silenceMinutes: 30 }, compressor: { state: 'unknown', at: null }, volumeLitres: null, volumeAt: null });
export const T_NEVER = tile(U3, C1, { tempC: null, verdict: null, telemetry: { state: 'never', ageMinutes: null, silenceMinutes: 30 }, readings24h: 0, breaches24h: 0 });
export const TILES: DairyBmcTile[] = [T1, T_AWAY];
export const POINTS: NonNullable<DairyBmcMonitor['focus']>['points'] = [
  { atMinutesAgo: 120, at: '2026-11-09T01:00:00.000Z', tempC: '3.6', isBreach: false },
  { atMinutesAgo: 60, at: '2026-11-09T02:00:00.000Z', tempC: '5.1', isBreach: true },
  { atMinutesAgo: 12, at: '2026-11-09T02:48:00.000Z', tempC: '3.9', isBreach: false },
];
export const RECORDED: RecordedReading = { unitId: U1, tempC: '5.2', verdict: 'above_band', recordedAt: '2026-11-09T03:10:44.000Z', band: { minC: '2.0', maxC: '4.5' } };

/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_3B = /tanker|dispatch|manifest|\bseal|weighbridge|reconcil|agitator|\bCIP\b|composite|travels with|centre manager|operator vs|photo|interpolat|\d+ ?%|zero-sum|on-call|audit trail|maker[- ]checker|sensor silent|Vanthali|Anand|\bMM\b|1,788|\b214\b|11:00/i;
