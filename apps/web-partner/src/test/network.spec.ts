// apps/web-partner/src/test/network.spec.ts · unit tests for the PURE delivery-network helper (zones, routes,
// cold-chain). Float-free temperature parsing, UUID/pincode validation, nullable runWeekday, subject scoping.
import {
  tokenize, parseActiveOnly, parseOptionalUuid, validZoneName, parsePincodes, parseRegionIds,
  buildCreateZone, buildUpdateZone, validRouteName, parseRunWeekday, buildCreateRoute, buildUpdateRoute,
  weekdayKey, COLD_CHAIN_SUBJECTS, isColdSubject, coldSubjectKey, parseTempC, parseHumidity, parseDeviceRef,
  toIsoTimestamp, buildRecordReading, buildColdChainQuery, buildSetActive, NetworkError,
} from '../features/logistics/network';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

function throws(fn: () => unknown, key: string, label: string) {
  try { fn(); throw new Error(`${label}: expected throw`); }
  catch (e) { if (!(e instanceof NetworkError) || e.fieldKey !== key) throw new Error(`${label}: expected NetworkError(${key}), got ${e}`); }
}

const tests: Array<[string, () => void]> = [
  // tokenize
  ['tokenize splits on comma/space/newline + dedupes', () => { const t = tokenize('a, b\nc  a'); if (JSON.stringify(t) !== JSON.stringify(['a', 'b', 'c'])) throw new Error(JSON.stringify(t)); }],
  ['tokenize blank → []', () => { if (tokenize('   ').length !== 0) throw new Error('expected empty'); }],
  // activeOnly
  ['parseActiveOnly default true', () => { if (parseActiveOnly(undefined) !== true) throw new Error('x'); }],
  ['parseActiveOnly false', () => { if (parseActiveOnly('false') !== false) throw new Error('x'); }],
  // optional uuid
  ['parseOptionalUuid blank → null', () => { if (parseOptionalUuid('', 'k') !== null) throw new Error('x'); }],
  ['parseOptionalUuid valid', () => { if (parseOptionalUuid(UUID, 'k') !== UUID) throw new Error('x'); }],
  ['parseOptionalUuid bad → throws', () => throws(() => parseOptionalUuid('nope', 'chargeDefinitionId'), 'chargeDefinitionId', 'optUuid')],
  // zone name + pincodes
  ['validZoneName trims', () => { if (validZoneName('  Z  ') !== 'Z') throw new Error('x'); }],
  ['validZoneName empty → throws', () => throws(() => validZoneName('   '), 'zoneName', 'zoneName')],
  ['validZoneName >120 → throws', () => throws(() => validZoneName('x'.repeat(121)), 'zoneName', 'zoneNameLong')],
  ['parsePincodes valid 6-digit', () => { const p = parsePincodes('560001, 110011'); if (p.length !== 2) throw new Error(JSON.stringify(p)); }],
  ['parsePincodes leading-zero → throws', () => throws(() => parsePincodes('012345'), 'pincodes', 'pin0')],
  ['parsePincodes 5-digit → throws', () => throws(() => parsePincodes('56001'), 'pincodes', 'pin5')],
  ['parseRegionIds bad uuid → throws', () => throws(() => parseRegionIds('not-a-uuid'), 'regionIds', 'region')],
  // buildCreateZone
  ['buildCreateZone full body', () => {
    const b = buildCreateZone({ defaultName: 'North', pincodes: '560001 560002', regionIds: UUID, chargeDefinitionId: UUID2 });
    if (b.defaultName !== 'North' || b.pincodes.length !== 2 || b.regionIds[0] !== UUID || b.chargeDefinitionId !== UUID2) throw new Error(JSON.stringify(b));
  }],
  ['buildCreateZone defaults empty arrays + null charge', () => {
    const b = buildCreateZone({ defaultName: 'Z' });
    if (b.pincodes.length !== 0 || b.regionIds.length !== 0 || b.chargeDefinitionId !== null) throw new Error(JSON.stringify(b));
  }],
  ['buildUpdateZone no fields → throws noChange', () => throws(() => buildUpdateZone({}), 'noChange', 'zoneNoChange')],
  ['buildUpdateZone partial', () => { const b = buildUpdateZone({ pincodes: '560001' }); if (b.pincodes?.length !== 1 || 'defaultName' in b) throw new Error(JSON.stringify(b)); }],
  // routes
  ['validRouteName >150 → throws', () => throws(() => validRouteName('x'.repeat(151)), 'routeName', 'routeNameLong')],
  ['parseRunWeekday blank → null', () => { if (parseRunWeekday('') !== null) throw new Error('x'); }],
  ['parseRunWeekday 3', () => { if (parseRunWeekday('3') !== 3) throw new Error('x'); }],
  ['parseRunWeekday 7 → throws', () => throws(() => parseRunWeekday('7'), 'runWeekday', 'wd7')],
  ['weekdayKey null → any', () => { if (weekdayKey(null) !== 'net.wd.any') throw new Error('x'); }],
  ['weekdayKey 2', () => { if (weekdayKey(2) !== 'net.wd.2') throw new Error('x'); }],
  ['buildCreateRoute full', () => {
    const b = buildCreateRoute({ defaultName: 'Run A', runWeekday: '1', villageRegionIds: UUID, vehicleId: UUID2, consolidationUserId: '' });
    if (b.runWeekday !== 1 || b.villageRegionIds[0] !== UUID || b.vehicleId !== UUID2 || b.consolidationUserId !== null) throw new Error(JSON.stringify(b));
  }],
  ['buildCreateRoute null weekday', () => { const b = buildCreateRoute({ defaultName: 'R' }); if (b.runWeekday !== null) throw new Error(JSON.stringify(b)); }],
  ['buildUpdateRoute empty → noChange', () => throws(() => buildUpdateRoute({}), 'noChange', 'routeNoChange')],
  // setActive
  ['buildSetActive', () => { if (buildSetActive(true).isActive !== true || buildSetActive(false).isActive !== false) throw new Error('x'); }],
  // cold-chain subjects
  ['COLD_CHAIN_SUBJECTS has 4', () => { if (COLD_CHAIN_SUBJECTS.length !== 4) throw new Error('x'); }],
  ['isColdSubject true', () => { if (!isColdSubject('shipment')) throw new Error('x'); }],
  ['isColdSubject false', () => { if (isColdSubject('truck')) throw new Error('x'); }],
  ['coldSubjectKey known', () => { if (coldSubjectKey('vaccine_box') !== 'net.subject.vaccine_box') throw new Error('x'); }],
  ['coldSubjectKey unknown', () => { if (coldSubjectKey('x') !== 'net.subject.unknown') throw new Error('x'); }],
  // temperature parsing (float-free)
  ['parseTempC negative decimal', () => { if (parseTempC('-18.5', 'tempC') !== -18.5) throw new Error('x'); }],
  ['parseTempC integer', () => { if (parseTempC('4', 'tempC') !== 4) throw new Error('x'); }],
  ['parseTempC out of envelope → throws', () => throws(() => parseTempC('200', 'tempC'), 'tempC', 'tempHi')],
  ['parseTempC non-numeric → throws', () => throws(() => parseTempC('cold', 'tempC'), 'tempC', 'tempNaN')],
  ['parseHumidity blank → null', () => { if (parseHumidity('') !== null) throw new Error('x'); }],
  ['parseHumidity 50.5', () => { if (parseHumidity('50.5') !== 50.5) throw new Error('x'); }],
  ['parseHumidity 120 → throws', () => throws(() => parseHumidity('120'), 'humidity', 'humHi')],
  ['parseDeviceRef blank → null', () => { if (parseDeviceRef('  ') !== null) throw new Error('x'); }],
  ['parseDeviceRef >100 → throws', () => throws(() => parseDeviceRef('d'.repeat(101)), 'deviceRef', 'devLong')],
  // recordedAt → ISO
  ['toIsoTimestamp produces Z ISO', () => { const s = toIsoTimestamp('2026-06-24T14:30'); if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(s)) throw new Error(s); }],
  ['toIsoTimestamp bad → throws', () => throws(() => toIsoTimestamp('24/06/2026'), 'recordedAt', 'dt')],
  // record reading
  ['buildRecordReading full', () => {
    const b = buildRecordReading({ subjectType: 'shipment', subjectId: UUID, tempC: '-18', humidityPct: '40', deviceRef: 'probe-1', recordedAt: '2026-06-24T10:00', allowedMinC: '-20', allowedMaxC: '-15' });
    if (b.subjectType !== 'shipment' || b.tempC !== -18 || b.humidityPct !== 40 || b.deviceRef !== 'probe-1' || b.allowedMinC !== -20 || b.allowedMaxC !== -15 || !b.recordedAt.endsWith('Z')) throw new Error(JSON.stringify(b));
  }],
  ['buildRecordReading bad subject → throws', () => throws(() => buildRecordReading({ subjectType: 'truck', subjectId: UUID, tempC: '4', recordedAt: '2026-06-24T10:00', allowedMinC: '2', allowedMaxC: '8' }), 'subjectType', 'recSubj')],
  ['buildRecordReading bad subjectId → throws', () => throws(() => buildRecordReading({ subjectType: 'shipment', subjectId: 'x', tempC: '4', recordedAt: '2026-06-24T10:00', allowedMinC: '2', allowedMaxC: '8' }), 'subjectId', 'recSid')],
  ['buildRecordReading band inverted → throws', () => throws(() => buildRecordReading({ subjectType: 'shipment', subjectId: UUID, tempC: '4', recordedAt: '2026-06-24T10:00', allowedMinC: '8', allowedMaxC: '2' }), 'bandOrder', 'recBand')],
  // cold-chain query
  ['buildColdChainQuery nothing → null', () => { if (buildColdChainQuery({}) !== null) throw new Error('x'); }],
  ['buildColdChainQuery valid', () => { const q = buildColdChainQuery({ subjectType: 'bmc_unit', subjectId: UUID, breachOnly: 'true' }); if (!q || q.subjectType !== 'bmc_unit' || q.breachOnly !== true) throw new Error(JSON.stringify(q)); }],
  ['buildColdChainQuery bad subject → throws', () => throws(() => buildColdChainQuery({ subjectType: 'x', subjectId: UUID }), 'subjectType', 'qSubj')],
];

// PC-2A fix: this file was a SELF-EXECUTING script (assertions ran at import; ZERO jest tests registered —
// jest reported "must contain at least one test" and the suite counted as failed-to-run on every CI run).
// Same assertions, now registered as real jest tests.
describe('logistics network (ported table)', () => {
  for (const [name, fn] of tests) it(name, fn);
});
export {};
