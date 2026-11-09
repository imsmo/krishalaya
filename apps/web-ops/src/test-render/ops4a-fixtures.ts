// apps/web-ops/src/test-render/ops4a-fixtures.ts · PC-56 OPS-4a — the hire desk's server answers as the API shapes them (the entities' `toJSON`):
// two machines of the signed-in person's (one with a registration number, one without), the equipment categories, a machine's rate lines and
// maintenance entries, and hires in five statuses. EVERY hire carries the renter's id — and one carries a renter NAME (as a hostile or future API
// might) — which the page must never print. Amounts are chosen so that no sum, product or difference of them appears by accident. No canon
// person, machine, place or figure (survey F-16).
import type { CategoryNode, EquipmentAsset, EquipmentRate, EquipmentRental } from '@krishalaya/sdk-js';
import type { MaintenanceEntry } from '../features/ops4/chc';

export const A1 = '0192d2c4-e0e0-7000-8000-0000000000a1';
export const A2 = '0192d2c4-e0e0-7000-8000-0000000000a2';
export const A_OTHER = '0192d2c4-e0e0-7000-8000-0000000000a9';
export const CAT1 = '0192d2c4-ca70-7000-8000-000000000001';
export const RENTER_ID = '0192d2c4-5e5e-7000-8000-00000000r001';
export const RENTER_NAME = 'Testrenter Namesake';
const asset = (id: string, over: Partial<EquipmentAsset> = {}): EquipmentAsset => ({
  id, ownerUserId: '0192d2c4-0000-7000-8000-00000000o001', categoryId: CAT1, productId: null, regNo: 'TEST-REG-1', yearOfMfg: 2019, engineHours: '1234.5',
  hpRating: 41, baseAddressId: null, serviceRadiusKm: 25, status: 'active', createdAt: '2026-10-01T04:00:00.000Z', ...over,
});
export const M1 = asset(A1);
export const M2 = asset(A2, { regNo: null, engineHours: null, status: 'maintenance', yearOfMfg: null, hpRating: null });
export const MACHINES: EquipmentAsset[] = [M1, M2];
export const CATEGORIES: CategoryNode[] = [{ id: CAT1, parentId: null, code: 'tractor', defaultName: 'Test tractor class', path: 'equipment.tractor', depth: 1, commerceKind: 'service',
  requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 }];
export const RATES: EquipmentRate[] = [
  { id: 'r1', assetId: A1, rateBasis: 'per_hour', rateMinor: '73100', includesOperator: true, includesFuel: false, effectiveFrom: '2026-10-01', effectiveTo: null },
  { id: 'r2', assetId: A1, rateBasis: 'per_acre', rateMinor: '190700', includesOperator: false, includesFuel: true, effectiveFrom: '2026-09-01', effectiveTo: '2026-09-30' },
];
export const MAINT: MaintenanceEntry[] = [
  { id: 'm1', logType: 'service', costMinor: '411100', notes: 'oil changed', engineHoursAt: '1200.0', performedOn: '2026-10-20' },
  { id: 'm2', logType: 'breakdown', costMinor: null, notes: null, engineHoursAt: null, performedOn: '2026-09-02' },
];
const hire = (id: string, over: Partial<EquipmentRental>): EquipmentRental => ({
  id, bookingNo: `EQ-TEST-${id.toUpperCase()}`, renterUserId: RENTER_ID, assetId: A1, ownerUserId: M1.ownerUserId, operatorUserId: null, taskDesc: 'private task words',
  rateBasis: 'per_hour', rateMinor: '73100', estQuantity: '6.00', actualQuantity: null, scheduledAt: '2027-03-10T19:00:00.000Z', status: 'requested',
  advanceMinor: '0', totalMinor: null, startedAt: null, completedAt: null, createdAt: '2026-11-01T04:00:00.000Z', usageConfirmedAt: null, ...over,
});
export const H_REQ = hire('h1', { ...({ renterName: RENTER_NAME } as object) });
export const H_QUOTED = hire('h2', { status: 'quoted', advanceMinor: '29900' });
export const H_DONE = hire('h3', { status: 'completed', advanceMinor: '29900', actualQuantity: '5.50', totalMinor: '402050', startedAt: '2027-03-10T19:10:00.000Z', completedAt: '2027-03-11T01:00:00.000Z' });
export const H_SETTLED = hire('h4', { status: 'settled', advanceMinor: '29900', actualQuantity: '2.00', totalMinor: '146200', usageConfirmedAt: '2027-03-11T03:15:00.000Z',
  startedAt: '2027-03-10T19:10:00.000Z', completedAt: '2027-03-10T21:30:00.000Z' });
export const H_AWAY = hire('h5', { assetId: A_OTHER, status: 'cancelled' });
export const HIRES: EquipmentRental[] = [H_REQ, H_QUOTED, H_DONE, H_SETTLED, H_AWAY];

/** The canon's false words and its figures as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_4A = /×|=|%|\bof \d|revenue|utili[sz]ation|\bMTD\b|subsid|disput|wait-?list|first[- ]come|odometer|\bGPS\b|technician|CHC manager|operator vs|on-call|audit[- ]trail|zero-sum|calendar|next service|\bMM\b/i;   // the F-16 brand literals are guarded in claims-guard (values + sources), never written here
const NEG = /\b(not|no|never|nothing|none|cannot|nobody)\b|n't\b/i;
/** Visible text (outside the refusal list) with every sentence that carries a negation removed — what the page AFFIRMS. */
export const affirmed = (visibleText: string) => visibleText.split(/(?<=[.!?])\s+/).filter((s) => !NEG.test(s)).join(' ');
/** Arithmetic and ratios are refused PLAIN: never in visible text, negated or not. */
export const MATH_4A = /[×=%]|\bof \d/;
