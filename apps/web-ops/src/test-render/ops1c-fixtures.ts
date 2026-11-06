// apps/web-ops/src/test-render/ops1c-fixtures.ts · PC-56 OPS-1c — shared pieces for the kiosk render tests: her own profile and earning rows as
// the API answers them (minor-unit digit strings; the platform's own stream codes), one hostile row carrying a CANON event code (printed as the
// raw code, never as a canon rate), the canon's false words as one visible-text regex, and the registry's languages. No canon person, place,
// phone, reference or figure.
import { LANGUAGES } from '@krishalaya/i18n';
import type { KioskEarningView, KioskProfileView } from '../components/ops1/KioskViews';

export const PROFILE_1C: KioskProfileView = { tierId: '0192aaaa-0000-7000-8000-0000000000f1', kioskEnabled: true, trainingCompletedAt: '2026-10-01T04:30:00.000Z', isActive: true };
export const PROFILE_UNTRAINED: KioskProfileView = { tierId: null, kioskEnabled: false, trainingCompletedAt: null, isActive: true };
/** Amounts chosen so that no sum of any two (or all) is printed by accident — a computed total would be a new figure. */
export const EARNINGS_1C: KioskEarningView[] = [
  { id: 'e1', eventCode: 'farmer_onboarded', amountMinor: '2500', payoutId: null, createdAt: '2026-11-05T05:30:00.000Z' },
  { id: 'e2', eventCode: 'listing_assist', amountMinor: '2700', payoutId: '0192bbbb-0000-7000-8000-000000000001', createdAt: '2026-11-04T05:30:00.000Z' },
  { id: 'e3', eventCode: 'some_future_stream', amountMinor: '1100', payoutId: null, createdAt: '2026-11-03T05:30:00.000Z' },
];
/** The sums a page would print if it added anything up (₹25 + ₹27 + ₹11 …) — none may appear. */
export const SUMS_1C = ['52.00', '36.00', '38.00', '63.00', '₹52', '₹36', '₹38', '₹63'];
export const LANGS_1C = LANGUAGES.map((l) => ({ code: l.code, nameNative: l.nameNative, nameEnglish: l.nameEnglish }));

/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_1C = /%|\bsessions?\b|per-session|access ended|\bOTP\b|voice[- ]note|penny[- ]drop|₹\s?1 stays|reversible right now|pass[- ]rate|\bFri\b|wage[- ]lane|out-of-cluster|battery|\bsynced\b|on this device|1800-|\*123#|plan settings|₹\s?60\b|member created|\bflips\b|onboarding\.verified|scheme\.application|first\.listing|zero-sum|reconcil|[=×]|Kiran|Jashoda|Vanthali|Anand|Kisan Mitra|Krishalaya Kiosk|GMISS|XXXX/i;
