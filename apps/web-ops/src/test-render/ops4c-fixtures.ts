// apps/web-ops/src/test-render/ops4c-fixtures.ts · PC-56 OPS-4c — the sensor pages' server answers as the API shapes them (`overview`, `subject`,
// `loggers`, `breaches`, the twin registry's counts): a cooler whose latest reading came FROM ITS LOGGER, a vaccine box whose latest reading was
// TYPED BY A PERSON, a shipment never read, and a chamber with no band; the registered loggers; a subject's trail carrying both sources; the
// silences the server flagged with a threshold that is NOT the platform's constant (so a hard-coded number is caught); and — on the subject —
// a battery level and a calibration date a hostile or future API might send, which the page must never print. Figures chosen so no sum of them
// appears by accident. No canon person, place, device or figure (survey F-16).
import type { ColdBreach, ColdLogger, ColdOverview, ColdSubjectDetail } from '@krishalaya/sdk-js';

export const READ_AT = Date.parse('2026-11-10T03:00:00.000Z');
export const S_COOLER = '0192d2c4-c001-7000-8000-000000000c01';
export const S_BOX = '0192d2c4-c001-7000-8000-000000000b01';
export const S_SHIP = '0192d2c4-c001-7000-8000-000000000501';
export const S_CHAMBER = '0192d2c4-c001-7000-8000-000000000d01';
export const L1 = '0192d2c4-1061-7000-8000-000000000001';
export const L2 = '0192d2c4-1061-7000-8000-000000000002';

export const OVERVIEW: ColdOverview = {
  breaches7d: 2,
  silenceMinutes: 15,
  refused: { autoCall: 'NO_VOICE_CHANNEL', signedExport: 'UNSIGNED' },
  items: [
    { subjectType: 'bmc_unit', subjectId: S_COOLER, label: 'TEST-COOLER-SN1', now: { tempC: '4.20', at: '2026-11-10T02:48:00.000Z', source: 'device' },
      target: { minC: '2.00', maxC: '6.00' }, device: { id: L1, serial: 'LOG-TEST-1', lastReadingAt: '2026-11-10T02:48:05.000Z' }, status: 'in_range' },
    { subjectType: 'vaccine_box', subjectId: S_BOX, label: 'VAC-0192C001', now: { tempC: '9.10', at: '2026-11-10T02:21:00.000Z', source: 'manual' },
      target: { minC: '2.00', maxC: '8.00' }, device: null, status: 'excursion' },
    { subjectType: 'shipment', subjectId: S_SHIP, label: 'AWB-TEST-77', now: null, target: { minC: '2.00', maxC: '8.00' },
      device: { id: L2, serial: 'LOG-TEST-2', lastReadingAt: '2026-11-09T21:10:00.000Z' }, status: 'silent' },
    { subjectType: 'warehouse_chamber', subjectId: S_CHAMBER, label: 'WAR-0192C001', now: { tempC: '11.30', at: '2026-11-10T01:00:00.000Z', source: 'manual' },
      target: null, device: null, status: 'no_threshold' },
  ],
};
export const LOGGERS: ColdLogger[] = [
  { deviceId: L1, serial: 'LOG-TEST-1', label: 'Labelled by Testperson Labelname', status: 'registered', registeredAt: '2026-10-01T04:00:00.000Z', lastReadingAt: '2026-11-10T02:48:05.000Z',
    key: { id: 'k1', hint: 'abcd', subjectType: 'bmc_unit', subjectId: S_COOLER, issuedAt: '2026-10-01T04:05:00.000Z', issuedBy: '0192d2c4-0000-7000-8000-00000000u001' } },
  { deviceId: L2, serial: 'LOG-TEST-2', label: null, status: 'registered', registeredAt: '2026-10-02T04:00:00.000Z', lastReadingAt: '2026-11-09T21:10:00.000Z',
    key: { id: 'k2', hint: 'efgh', subjectType: 'shipment', subjectId: S_SHIP, issuedAt: '2026-10-02T04:05:00.000Z', issuedBy: '0192d2c4-0000-7000-8000-00000000u001' } },
  { deviceId: '0192d2c4-1061-7000-8000-000000000003', serial: 'LOG-TEST-3', label: null, status: 'registered', registeredAt: '2026-11-01T04:00:00.000Z', lastReadingAt: null, key: null },
];
const breach = (over: Partial<ColdBreach>): ColdBreach => ({
  id: '0192d2c4-b4ea-7000-8000-000000000001', subjectType: 'bmc_unit', subjectId: S_COOLER, subjectRef: '0192D2C4', device: { id: L1, serial: 'LOG-TEST-1' },
  band: { minC: '2.00', maxC: '6.00' }, direction: 'above', peakC: '7.40', readingsOut: 3, firstOutAt: '2026-11-08T05:00:00.000Z', openedAt: '2026-11-08T05:10:00.000Z',
  closedAt: '2026-11-08T06:00:00.000Z', durationSeconds: 3600, alert: { state: 'alerted', recipients: 2, id: 'a1' }, acknowledgedAt: null, actionAt: null, actionNote: null,
  outcome: null, outcomeAt: null, outcomeReason: null, loss: null,
  buyer: { offerState: 'none', offeredAt: null, decision: null, decidedAt: null, reason: null, disputeId: null }, playbookRun: { kind: 'refused', code: 'NO_PLAYBOOK_OBJECT' } as never, acts: [], ...over,
});
export const LAST_BREACH = breach({});
export const REGISTRY = { soilPods: 6, weatherMasts: 0 };

/** One subject with a trail of BOTH sources — and a battery and a calibration date the page must never print. */
export const DETAIL: ColdSubjectDetail = {
  subjectType: 'bmc_unit', subjectId: S_COOLER, label: 'TEST-COOLER-SN1', status: 'in_range', windowHours: 48,
  band: { id: 't1', minC: '2.00', maxC: '6.00', setBy: null, reason: 'the label says so', effectiveFrom: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' }, bandHistory: [],
  device: { id: L1, serial: 'LOG-TEST-1', lastReadingAt: '2026-11-10T02:48:05.000Z' },
  trail: [
    { id: '91', subjectType: 'bmc_unit', subjectId: S_COOLER, tempC: 4.2, humidityPct: null, deviceRef: null, isBreach: false, excursion: false, band: { minC: 2, maxC: 6 }, source: 'device',
      deviceId: L1, recordedAt: '2026-11-10T02:48:00.000Z', serverRecordedAt: '2026-11-10T02:48:05.000Z', sequenceNo: '41' },
    { id: '90', subjectType: 'bmc_unit', subjectId: S_COOLER, tempC: 6.9, humidityPct: null, deviceRef: 'TYPED-REF-9', isBreach: true, excursion: true, band: { minC: 2, maxC: 6 }, source: 'manual',
      deviceId: null, recordedAt: '2026-11-10T01:30:00.000Z', serverRecordedAt: '2026-11-10T01:30:00.000Z', sequenceNo: null },
  ],
  nextCursor: null,
  breaches: [LAST_BREACH],
  playbook: { rule: 'two_consecutive_device_readings', manualNeverOpens: true, buyerOfferAfterMinutes: 15, silenceMinutes: 15, alerted: 'operators named on the cold-chain alert rules, and the shipment\'s driver' },
  refused: { bothTenants: 'NO_CROSS_TENANT_SHIPMENT', autoCall: 'NO_VOICE_CHANNEL', playbookRun: 'NO_PLAYBOOK_OBJECT', signedExport: 'UNSIGNED' },
  retentionMonths: 24,
  ...({ battery: { pct: 57, state: 'healthy' }, calibrationDue: '2027-01-15', cadenceMinutes: 30 } as object),
} as ColdSubjectDetail;

/** The server's flagged silences, and its own threshold — 37 here, NOT the platform's 15, so a hard-coded number is caught. */
export const SILENCE_MINUTES = 37;
export const SILENCES = [
  { id: 's1', deviceId: L2, subjectType: 'shipment', subjectId: S_SHIP, lastReadingAt: '2026-11-09T21:10:00.000Z', flaggedAt: '2026-11-09T21:48:00.000Z', alertState: 'alerted', resolvedAt: null },
  { id: 's2', deviceId: L1, subjectType: 'bmc_unit', subjectId: S_COOLER, lastReadingAt: '2026-11-08T03:00:00.000Z', flaggedAt: '2026-11-08T03:40:00.000Z', alertState: 'no_recipient', resolvedAt: '2026-11-08T05:00:00.000Z' },
];

/** The canon's sensor false words as they would appear in VISIBLE text (outside the refusal list), affirmed. */
export const FALSE_4C = /battery|calibrat|cadence|\bonline\b|\bsync(ed)?\b|right now|\bGPS\b|telecom|\bpaged\b|field visit|technician|centre manager|maker-checker|annotation|interpolat|likely cause|\bMM\b/i;
