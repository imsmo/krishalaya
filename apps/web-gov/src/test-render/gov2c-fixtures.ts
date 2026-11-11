// apps/web-gov/src/test-render/gov2c-fixtures.ts · PC-56 GOV-2c — applications AS GOV-2a's read GIVES THEM (`gov.applications.list / get`):
// no applicant, no organisation name, the declared fields of the version with personal ones already masked by the API. SENTINELS ride in the
// objects the way a careless mapping could leak them: an undeclared form key with the farmer's name (`formData`), a money figure, an
// organisation's name, and an unsent application in the list. The read never returns any of them; the pages must never print them. No canon
// person, place, body or figure: plainly test names.
import type { GovApplication, GovApplicationOpened, GovMe } from '@krishalaya/sdk-js';
import { ME_HEAD, ME_OFFICER } from './gov1a-fixtures';

export const APP_1 = '0192d2c4-f000-7000-8000-00000000c001';
export const APP_2 = '0192d2c4-f000-7000-8000-00000000c002';
export const APP_3 = '0192d2c4-f000-7000-8000-00000000c003';
export const APP_UNSENT = '0192d2c4-f000-7000-8000-00000000c0d0';
export const SCHEME_ID = '0192d2c4-c000-7000-8000-00000000000a';
export const ORG_ID = '0192d2c4-b000-7000-8000-0000000000aa';
export const UNDECLARED_SENTINEL = 'UNDECLARED-FARMER-NAME-SENTINEL';
export const ORG_SENTINEL = 'ORGANISATION-NAME-SENTINEL';
export const MONEY_SENTINEL_2C = 2880000;

const SCHEME = { id: SCHEME_ID, code: 'test_scheme_a', name: 'Test Scheme A' };
const base = (id: string, status: string, over: Partial<GovApplication> = {}): GovApplication => ({
  id, organisationId: ORG_ID, scheme: SCHEME, schemeVersion: 3, status, submittedAt: '2026-10-05T06:00:00.000Z', decidedAt: null, createdAt: '1791180000000000', ...over,
  ...({ organisationName: ORG_SENTINEL } as object),
});
export const LIST: GovApplication[] = [
  base(APP_1, 'under_verification'),
  base(APP_2, 'approved', { decidedAt: '2026-10-09T07:30:00.000Z' }),
  base(APP_3, 'submitted', { schemeVersion: 2 }),
];
/** An unsent application a careless caller could hand the view — the list view must never be given it, and the page never asks for it. */
export const UNSENT: GovApplication = base(APP_UNSENT, 'draft', { submittedAt: null });

export const OPENED: GovApplicationOpened = {
  ...base(APP_1, 'under_verification'),
  form: [
    { key: 'crop_planned', label: 'Crop planned', kind: 'text', personal: false, value: 'groundnut' },
    { key: 'land_acres', label: 'Land (acres)', kind: 'number', personal: false, value: 2.5 },
    { key: 'farmer_name', label: 'Name', kind: 'text', personal: true, value: '••••••ame' },
  ],
  formDeclared: true, recorded: true,
  // the sentinels: raw form data and a money figure a careless mapping could print (the read never returns them)
  ...({ formData: { farmer_name: UNDECLARED_SENTINEL, village: UNDECLARED_SENTINEL }, amountMinor: MONEY_SENTINEL_2C } as object),
};
export const OPENED_UNDECLARED: GovApplicationOpened = { ...OPENED, id: APP_3, schemeVersion: 2, status: 'submitted', form: [], formDeclared: false };
export const OPENED_DECIDED: GovApplicationOpened = { ...OPENED, id: APP_2, status: 'approved', decidedAt: '2026-10-09T07:30:00.000Z' };

const withPerms = (me: GovMe, extra: string[]): GovMe => ({ ...me, person: { ...me.person, permissions: [...me.person.permissions, ...extra] } });
/** A head (verify + decide) and an officer (verify) as GOV-2a's roles give them. */
export const HEAD_2C = withPerms(ME_HEAD, ['authority.applications.verify', 'authority.applications.decide']);
export const OFFICER_2C = withPerms(ME_OFFICER, ['authority.applications.verify']);
export const READER_2C = ME_OFFICER;

/** W330 / W331's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_2C = /₹|%|\bINR\b|rupee|\bAI\b|pre-?check|confidence|district|taluka|\bSLA\b|target|due by|fast lane|auto-?rout|EXIF|7\/12|land record|ambassador|govt ref|caste|village|export|audit trail|zero-sum|on-call|reconcil|Directorate|Gujarat|GMISS|GM26-|\bDK\b/i;
