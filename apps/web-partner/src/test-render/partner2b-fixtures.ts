// apps/web-partner/src/test-render/partner2b-fixtures.ts · PC-56 PARTNER-2b · WHERE THE MONEY IS NOT — the render tests' shared fixtures: the
// issuance queue as the API answers it (proposals on the insurer's own products; the type carries no holder, subject, payment, tenant, number or
// status field), the premiums counts (integers only) and the parametric counts. Neutral names only; no person anywhere.
import type { PartnerInsuranceQueueRow } from '@krishalaya/sdk-js';
import type { ParametricCounts, PremiumsCounts } from '../features/partner2/figures';

export const QUEUE: PartnerInsuranceQueueRow[] = [
  { id: '0192d2c4-3333-7000-8000-000000000003', productId: '0192d2c4-aaaa-7000-8000-00000000000a', productName: 'Fixture cattle cover', fpoName: 'Fixture Dairy Collective',
    subjectType: 'animal', sumInsuredMinor: '8000000', premiumMinor: '256000', proposedAt: '2026-10-17T05:00:00.123456Z', validFrom: '2026-10-20', validUntil: '2027-10-19' },
  { id: '0192d2c4-4444-7000-8000-000000000004', productId: '0192d2c4-aaaa-7000-8000-00000000000a', productName: null, fpoName: null,
    subjectType: 'crop_season', sumInsuredMinor: '9007199254740993', premiumMinor: '512000', proposedAt: '2026-10-16T05:00:00.000000Z', validFrom: null, validUntil: null },
];
export const PREMIUMS: PremiumsCounts = { active: 1234, proposed: 2, computedAt: '2026-10-18T06:30:00.000Z' };
export const PARAMETRIC: ParametricCounts = { products: 1, active: 3, computedAt: '2026-10-18T06:30:00.000Z' };

/** Words no 2b page may print (the canon's issuance, premium, report and parametric claims) — outside the founder's own statements. */
export const FALSE_2B = /T\+1|settles|settlement|receivable|kharif|\bcamps?\b|aadhaa?r|pre-?verified|\bchecker|voice summary|\bparked\b|\bAWS\b|\b72\s*h|rural sector|\bTAT\b|ombudsman|grievance|quarterly|watermark|\barmed\b|certified|rainfall|₹\s*77|\b412\b|1,286|earmarked|standing release|\bCFO\b|\bfamilies\b|Meera|Jayesh|BATCH-|PRP-|PMF-SETT-|sha256:|automatic|reserves?\b|16:00|1800|\+91/i;
/** Rupee money: the sign, or an Indian / Western digit-grouped amount with or without paise. */
export const MONEY = /₹|\b\d{1,3}(,\d{2,3})+(\.\d{2})?\b|\b\d+\.\d{2}\b/;
/** The markup without the refusal list (the refusals NAME the canon's claims to say no to them — every other line must not make them). */
export const withoutRefusals = (html: string) => html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, '');
