// apps/web-gov/src/test-render/gov1a-fixtures.ts · PC-56 GOV-1a — the render harness's shared pieces (E13): the i18n test catalogue loader (`tr`:
// a catalogue → a translator with en fallback, the web-ops / web-partner shape), a visible-text extractor, and the authority's people AS
// GOV-0's `GET /v1/gov/members` gives them (names or the phone by its last 3; user ids for who asked and who approved). No canon person,
// place, body or figure: the names are plainly test names.
import type { GovMe, GovMembership } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';

/** A catalogue → the translator shape the views take (missing keys fall back to en, then to the key). */
export const tr = (cat: Record<string, string>) => ({ t: (key: string, vars: Record<string, string | number> = {}) => (cat[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`)) });
/** Text of the markup with tags removed and the entities React escapes restored. */
export const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** Visible text OUTSIDE the refusal list (the list names what it refuses). */
export const visible = (html: string) => text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/g, ''));
/** The markup of ONE table row of the people list. */
export const rowOf = (html: string, membershipId: string) => (html.match(new RegExp(`<tr data-kv-member="${membershipId}"[\\s\\S]*?</tr>`)) ?? [''])[0];

export const AUTH = '0192d2c4-a000-7000-8000-000000000001';
export const H1 = '0192d2c4-a001-7000-8000-000000000001';   // a head — the viewer in the head fixtures
export const H2 = '0192d2c4-a001-7000-8000-000000000002';   // a second head
export const O1 = '0192d2c4-a001-7000-8000-000000000003';   // an officer — the viewer in the officer fixtures
export const P1 = '0192d2c4-a001-7000-8000-000000000004';
export const P2 = '0192d2c4-a001-7000-8000-000000000005';
export const X1 = '0192d2c4-a001-7000-8000-000000000006';
export const Y1 = '0192d2c4-a001-7000-8000-000000000007';

const HEAD_PERMS = ['authority.applications.read', 'authority.members.approve', 'authority.members.read', 'authority.members.remove', 'authority.members.request'];
const OFFICER_PERMS = ['authority.applications.read', 'authority.members.read', 'authority.members.request'];
const me = (userId: string, roles: string[], permissions: string[]): GovMe => ({
  authority: { id: AUTH, name: 'Test Authority One', level: 'state' },
  person: { userId, roles, permissions, phoneMasked: '••••••101', accessEndsAt: '2027-11-10T06:30:00.000Z' },
  realm: 'gov',
});
export const ME_HEAD = me(H1, ['authority_head'], HEAD_PERMS);
export const ME_HEAD2 = me(H2, ['authority_head'], HEAD_PERMS);
export const ME_OFFICER = me(O1, ['authority_officer'], OFFICER_PERMS);

const m = (over: Partial<GovMembership> & Pick<GovMembership, 'membershipId' | 'userId'>): GovMembership => ({
  name: null, phoneMasked: '••••••999', roleCode: 'authority_officer', status: 'active', live: true, termMonths: 12,
  requestedBy: null, requestedByPlatform: false, requestReason: 'a reason of ten characters', requestedAt: '2026-11-01T05:00:00.000Z',
  approvedBy: null, approvedAt: null, expiresAt: null, removedBy: null, removedAt: null, removedReason: null, ...over,
});
/** The authority's people: the platform's first head (the viewer), a second head, an officer, two pending requests (one asked for by the
 *  viewer, one by the officer), a request FOR the viewer, an ended role and a removed one. */
export const ROWS: GovMembership[] = [
  m({ membershipId: 'm1', userId: H1, name: 'Test Head One', phoneMasked: '••••••101', roleCode: 'authority_head', requestedByPlatform: true, approvedAt: '2026-11-01T05:00:00.000Z', expiresAt: '2027-11-01T05:00:00.000Z' }),
  m({ membershipId: 'm2', userId: H2, name: 'Test Head Two', phoneMasked: '••••••102', roleCode: 'authority_head', requestedBy: O1, approvedBy: H1, approvedAt: '2026-11-02T05:00:00.000Z', expiresAt: '2027-05-02T05:00:00.000Z', termMonths: 6 }),
  m({ membershipId: 'm3', userId: O1, name: 'Test Officer One', phoneMasked: '••••••103', requestedBy: H1, approvedBy: H2, approvedAt: '2026-11-03T05:00:00.000Z', expiresAt: '2027-02-03T05:00:00.000Z', termMonths: 3 }),
  m({ membershipId: 'm4', userId: P1, name: null, phoneMasked: '••••••104', status: 'requested', live: false, requestedBy: H1, termMonths: 4 }),
  m({ membershipId: 'm5', userId: P2, name: 'Test Person Five', phoneMasked: '••••••105', status: 'requested', live: false, requestedBy: O1, termMonths: 5 }),
  m({ membershipId: 'm6', userId: H1, name: 'Test Head One', phoneMasked: '••••••101', status: 'requested', live: false, requestedBy: O1, termMonths: 2 }),
  m({ membershipId: 'm7', userId: X1, name: 'Test Person Seven', phoneMasked: '••••••107', status: 'active', live: false, requestedBy: H1, approvedBy: H2, approvedAt: '2025-10-01T05:00:00.000Z', expiresAt: '2026-10-01T05:00:00.000Z' }),
  m({ membershipId: 'm8', userId: Y1, name: 'Test Person Eight', phoneMasked: '••••••108', status: 'removed', live: false, requestedBy: H1, approvedBy: H2, approvedAt: '2026-06-01T05:00:00.000Z', expiresAt: '2027-06-01T05:00:00.000Z', removedBy: H1, removedAt: '2026-11-05T05:00:00.000Z', removedReason: 'a removal reason here' }),
];
/** A lone head: the platform's appointment and one request the head made. */
export const ROWS_LONE: GovMembership[] = [ROWS[0], ROWS[3]];
/** No live head: the officer and an ended head. */
export const ROWS_NO_HEAD: GovMembership[] = [ROWS[2], { ...ROWS[1], live: false, expiresAt: '2026-10-02T05:00:00.000Z' }];

/** The canon's false words as they would appear in VISIBLE text (persons, bodies, places and the refused claims). */
export const FALSE_1A = /SSO|single sign-on|e-?Pramaan|departmental|hardware|security key|step-up|Official ID|release|FTO|PFMS|regulator|auditor|extracts|renewed late|maker-checker|two-person|review date is|on-call|zero-sum|audit trail|gov-support@|Directorate|Gujarat|Dahod|GMISS|Trivedi|Christian|Chauhan|Damor|Kapadia|Rathva|\bDK\b|device/i;
