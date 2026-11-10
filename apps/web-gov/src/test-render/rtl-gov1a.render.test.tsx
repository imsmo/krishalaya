// apps/web-gov/src/test-render/rtl-gov1a.render.test.tsx · PC-56 GOV-1a — every login step, every login chain state, the access page and every
// access chain state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved, and the SAME
// `data-kv-*` skeleton in every language; no GOV-1a source carries physical CSS or an arrow (E10).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginView, type LoginActions } from '../components/gov1/LoginViews';
import { AccessDoneNote, AccessFailureNote, AccessView, ApproveConfirm, RemoveForm, RequestForm } from '../components/gov1/AccessViews';
import { Gov1Chain } from '../components/gov1/Gov1Chain';
import { GovFooter, GovShell, GovSidebar } from '../components/gov1/GovShell';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ROWS, ROWS_LONE, text, tr } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const act = async () => undefined;
const KEY = '0192d2c4-4e70-7000-8000-000000000001';
const A: LoginActions = { requestOtp: act, verifyOtp: act, choose: act, twoFactor: act, enrol: act, confirmEnrol: act, startOver: act };
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['phone', 'verify', 'choose', '2fa', 'enrol', 'off'] as const).map((s) => rtl(<LoginView t={t} step={s} actions={A} phoneMasked="••••••318" choices={[{ id: 'a1', name: 'Test Authority One' }]} />)),
    rtl(<LoginView t={t} step="enrol-confirm" actions={A} enrolKey={{ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }} />),
    rtl(<LoginView t={t} step="enrolled" actions={A} recoveryCodes={['abcd-efgh-01']} />),
    rtl(<LoginView t={t} step="verify" act="form-error" error="OTP_WRONG" left={2} actions={A} />),
    rtl(<LoginView t={t} step="phone" act="review" actions={A} />),
    rtl(<LoginView t={t} step="phone" act="success" signedInTo="Test Authority One" actions={A} />),
    rtl(<LoginView t={t} step="phone" act="failure" error="OTP_LOCKED" wait={3} actions={A} />),
    rtl(<AccessView t={t} state="ok" me={ME_HEAD} rows={ROWS} />),
    rtl(<AccessView t={t} state="ok" me={ME_HEAD} rows={ROWS_LONE} />),
    ...(['forbidden', 'error', 'off'] as const).map((s) => rtl(<AccessView t={t} state={s} me={ME_HEAD} rows={[]} />)),
    rtl(<Gov1Chain t={t} chain="access_act" state="confirm"><RequestForm t={t} idemKey={KEY} action={act} /></Gov1Chain>),
    rtl(<Gov1Chain t={t} chain="access_act" state="confirm"><ApproveConfirm t={t} row={ROWS[4]} rows={ROWS} me={ME_HEAD} idemKey={KEY} action={act} /></Gov1Chain>),
    rtl(<Gov1Chain t={t} chain="access_act" state="confirm"><RemoveForm t={t} row={ROWS[2]} rows={ROWS} me={ME_HEAD} idemKey={KEY} action={act} /></Gov1Chain>),
    rtl(<Gov1Chain t={t} chain="access_act" state="success"><AccessDoneNote t={t} done="approved" expiresAt="2027-11-10T06:30:00.000Z" /></Gov1Chain>),
    rtl(<Gov1Chain t={t} chain="access_act" state="failure"><AccessFailureNote t={t} error="GOV_APPROVER_IS_REQUESTER" /></Gov1Chain>),
    ...(['confirm', 'success', 'failure'] as const).map((s) => rtl(<Gov1Chain t={t} chain="access_reread" state={s} />)),
    rtl(<GovShell me={ME_HEAD} sidebar={<GovSidebar t={t} me={ME_HEAD} />} footer={<GovFooter t={t} />} skipLabel={t.t('common.skipToContent')}><p>{t.t('gov1.dash.title')}</p></GovShell>),
  ];
};
const SRC_1A = ['components/gov1/LoginViews.tsx', 'components/gov1/AccessViews.tsx', 'components/gov1/Gov1Chain.tsx', 'components/gov1/GovShell.tsx', 'components/Sidebar.tsx',
  'features/gov1/login.ts', 'features/gov1/access.ts', 'features/gov1/persona.ts', 'app/login/page.tsx', 'app/login/actions.ts', 'app/access/page.tsx', 'app/access/actions.ts',
  'app/dashboard/page.tsx', 'app/layout.tsx'];

describe('PC-56 GOV-1a · the sign-in and access pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov1\.|login\.|nav\.|common\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no GOV-1a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_1A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
