// apps/web-tenant/src/test/tenant13b-settings-desks.spec.ts · PC-56 TENANT-13b — W186 / W185 and their chains: the pure helpers, every
// refusal the API can name has a sentence in three languages, the canon routes exist, the sidebar reaches them, and /settings no longer
// writes the dead language settings.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  REFUSAL_CODES, editHref, failureCodesFrom, inputKind, pageState, parseValue, proposalHref, refusalKey, riskKey, routeKey, showValue, splitRows,
} from '../features/org-settings/org-settings';
import { DESK_REFUSAL_CODES, deskActHref, deskRefusalKey, labelLine, parseIdList, parsePermList } from '../features/desks/desks';

const APP = join(__dirname, '..', 'app');
const all = (k: string) => { for (const c of [en, hi, gu]) expect({ k, has: typeof c[k] === 'string' && c[k].length > 0 }).toEqual({ k, has: true }); };

describe('TENANT-13b · organisation settings helpers', () => {
  it('states: 404 on the registry is the flag, 403 is tenant.settings', () => {
    expect(pageState(undefined, 404)).toBe('flaggedOff');
    expect(pageState('TENANT_FORBIDDEN', 403)).toBe('restricted');
    expect(pageState(undefined, 404, true)).toBe('notFound');
    expect(pageState(undefined, 500)).toBe('error');
  });
  it('a value is parsed by its type; blanks and junk are refused before the API is asked', () => {
    expect(parseValue('int', '48')).toEqual({ ok: true, value: 48 });
    expect(parseValue('int', '4.5')).toEqual({ ok: false });
    expect(parseValue('bool', 'true')).toEqual({ ok: true, value: true });
    expect(parseValue('bool', 'yes')).toEqual({ ok: false });
    expect(parseValue('json', '[1440,60]')).toEqual({ ok: true, value: [1440, 60] });
    expect(parseValue('json', '5')).toEqual({ ok: false });
    expect(showValue('')).toBe('""'); expect(showValue({ a: 1 })).toBe('{"a":1}');
    expect(inputKind('decimal')).toBe('number');
  });
  it('rows split into the table (a consumer reads them) and the unwired list', () => {
    const r = (key: string, wired: boolean) => ({ key, wired } as never);
    const s = splitRows([r('a', true), r('b', false)]);
    expect(s.table.map((x: { key: string }) => x.key)).toEqual(['a']); expect(s.unwired.map((x: { key: string }) => x.key)).toEqual(['b']);
    expect(riskKey({ riskClass: 'ordinary', memberNotice: true })).toBe('os.risk.trust');
    expect(routeKey('none', true)).toBe('os.route.locked');
  });
  it('every refusal code has a sentence in en / hi / gu; an unknown code reads as "something went wrong"', () => {
    for (const c of REFUSAL_CODES) all(refusalKey(c));
    expect(refusalKey('SOMETHING_NEW')).toBe('os.refusal.unknown');
    expect(failureCodesFrom('X', 422, { refusals: [{ code: 'SETTING_OUTSIDE_FLOOR' }, { code: '<script>' }] })).toEqual(['SETTING_OUTSIDE_FLOOR', 'unknown']);
    expect(failureCodesFrom(undefined, 403)).toEqual(['TENANT_FORBIDDEN']);
  });
  it('the chain hrefs', () => {
    expect(editHref('governance.quorum_bp')).toBe('/settings/org/edit?key=governance.quorum_bp&step=edit');
    expect(proposalHref('p1', 'refuse')).toBe('/settings/org/proposals/p1?act=refuse&step=confirm');
  });
});

describe('TENANT-13b · desks helpers', () => {
  it('every desk refusal has a sentence in three languages', () => { for (const c of DESK_REFUSAL_CODES) all(deskRefusalKey(c)); });
  it('a template label prints the code it rides, or why it is refused — never a code the platform lacks', () => {
    expect(labelLine({ label: 'kyc.verify', kind: 'mapped', code: 'kyc.review', grant: 'grantable', noteKey: null })).toEqual({ key: 'dk.label.mapped', vars: { label: 'kyc.verify', code: 'kyc.review' } });
    expect(labelLine({ label: 'statement.read', kind: 'refused', reasonKey: 'rides_other', ridesOn: 'settlement.close' }).key).toBe('dk.label.rides');
    expect(labelLine({ label: 'ledger.read', kind: 'mapped', code: 'ledger.read', grant: 'not_held', noteKey: null }).key).toBe('dk.label.notHeld');
    for (const k of ['dk.label.mapped', 'dk.label.rides', 'dk.label.noRoute', 'dk.label.notHeld', 'dk.label.ungrantable', 'dk.label.same']) all(k);
  });
  it('lists from the URL are sanitised and bounded', () => {
    expect(parsePermList('support.handle,BAD CODE,report.view,support.handle')).toEqual(['support.handle', 'report.view']);
    expect(parseIdList(['nope', '0192aaaa-0000-7000-8000-000000000001'])).toEqual(['0192aaaa-0000-7000-8000-000000000001']);
    expect(deskActHref('disable', 'd1')).toBe('/settings/team/desks/act?kind=disable&deskId=d1&step=confirm');
  });
});

describe('TENANT-13b · the canon routes exist and are reachable', () => {
  it('W186 + W2754–W2760 and W185 + W2574–W2580 have pages', () => {
    for (const p of ['settings/org/page.tsx', 'settings/org/edit/page.tsx', 'settings/org/proposals/[id]/page.tsx', 'settings/org/history/page.tsx', 'settings/org/loading.tsx',
                     'settings/team/desks/page.tsx', 'settings/team/desks/new/page.tsx', 'settings/team/desks/act/page.tsx', 'settings/team/desks/proposals/[id]/page.tsx', 'settings/team/desks/loading.tsx']) {
      expect({ p, exists: existsSync(join(APP, p)) }).toEqual({ p, exists: true });
    }
    const side = readFileSync(join(__dirname, '..', 'components', 'Sidebar.tsx'), 'utf8');
    expect(side).toContain("href: '/settings/org'"); expect(side).toContain("href: '/settings/team/desks'");
  });
  it('/settings no longer renders the dead languages form; its action writes tenant_languages', () => {
    const page = readFileSync(join(APP, 'settings', 'page.tsx'), 'utf8');
    expect(page).not.toContain('saveLanguagesAction');
    expect(page).toContain('/settings/org#languages');
    const act = readFileSync(join(APP, 'settings', 'actions.ts'), 'utf8');
    expect(act).toMatch(/orgSettings\.putLanguages/);
  });
});
