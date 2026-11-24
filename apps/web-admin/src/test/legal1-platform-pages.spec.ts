// apps/web-admin/src/test/legal1-platform-pages.spec.ts · PC-56 LEGAL-1 console spec.
//
// The platform policy pages (/terms, /privacy, /refunds, /shipping) are a Razorpay-activation and DPDP launch blocker,
// and the console's job is narrow: never show a publish control to the person who wrote the words, send every write
// with an Idempotency-Key and a bounded reason, explain every refusal in words, and never render the body as HTML.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ERROR_KINDS, OK_KINDS, PLATFORM_FACT_TOKENS, PLATFORM_PAGE_SLUGS, buildArchive, buildCreateDraft, buildPublish,
  buildSaveDraft, decodeProblems, encodeProblems, errorKey, errorKindFor, isPlatformPageSlug, liveVersion, openDraft,
  problemsFrom, publishWithheldKey, slugKey, statusKey, translationLanguages, whoLabel, type VersionDetail,
} from '../features/legal-pages/legal-pages';
import { ADMIN_NAV, liveNav } from '../features/nav/nav-model';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;
const ROOT = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const NEW_FILES = [
  ['app', 'legal-pages', 'page.tsx'],
  ['app', 'legal-pages', '[slug]', 'page.tsx'],
  ['app', 'legal-pages', 'actions.ts'],
  ['features', 'legal-pages', 'legal-pages.ts'],
];

/** A FormData-like stand-in (the builders only need get/getAll). */
function fields(o: Record<string, string | string[]>) {
  return {
    get: (k: string) => { const v = o[k]; return Array.isArray(v) ? v[0] : v ?? null; },
    getAll: (k: string) => { const v = o[k]; return v === undefined ? [] : Array.isArray(v) ? v : [v]; },
  };
}
const REASON = 'Lawyer review completed on the v2 text';

describe('LEGAL-1 · nav entry', () => {
  it('is registered, live, and labelled through the catalogue', () => {
    const item = ADMIN_NAV.find((i) => i.href === '/legal-pages');
    expect(item).toBeDefined();
    expect(liveNav().map((i) => i.href)).toContain('/legal-pages');
    expect(dict[item!.labelKey]).toBeTruthy();
  });

  // The nav in this console is not permission-filtered (admin-api is the gate, per nav-model's charter); the
  // permission gate is the read itself: a 403 on GET renders the restricted notice naming platform.pages.read.
  it('is permission-gated by the read: a 403 renders the restricted notice', () => {
    for (const f of [NEW_FILES[0], NEW_FILES[1]]) {
      const src = strip(read(...f));
      expect(src).toMatch(/e\.status === 403 \? 'lp\.restricted'/);
    }
    expect(dict['lp.restricted']).toMatch(/platform\.pages\.read/);
  });
});

describe('LEGAL-1 · every write sends an Idempotency-Key and a reason', () => {
  const actions = strip(read('app', 'legal-pages', 'actions.ts'));

  it('passes a fresh crypto.randomUUID() as the idempotency key on every admin-api write', () => {
    const writes = actions.match(/await admin(Post|Patch|Put|Delete)\(/g) ?? [];
    expect(writes.length).toBe(4);
    const keyed = actions.match(/idempotencyKey: randomUUID\(\)/g) ?? [];
    expect(keyed.length).toBe(writes.length);
    expect(actions).toMatch(/import \{ randomUUID \} from 'node:crypto'/);
  });

  it('hits the contract routes', () => {
    expect(actions).toMatch(/adminPost\(`platform-pages\/\$\{enc\(slug\)\}\/drafts`/);
    expect(actions).toMatch(/adminPatch\(`platform-pages\/versions\/\$\{enc\(versionId\)\}`/);
    expect(actions).toMatch(/adminPost\(`platform-pages\/versions\/\$\{enc\(versionId\)\}\/publish`/);
    expect(actions).toMatch(/adminPost\(`platform-pages\/versions\/\$\{enc\(versionId\)\}\/archive`/);
  });

  it('every body builder requires a 20..2000-char reason and puts it in the body', () => {
    const base = { title: 'Terms of service', body: '# Terms\n\nHello', reason: REASON };
    const create = buildCreateDraft(fields(base));
    const save = buildSaveDraft(fields({ ...base, expectUpdatedAt: '2026-11-01T00:00:00.000Z' }));
    const pub = buildPublish(fields({ reason: REASON }));
    const arch = buildArchive(fields({ reason: REASON, archiveReason: 'withdrawn' }));
    for (const b of [create, save, pub, arch]) {
      expect(b.ok).toBe(true);
      if (b.ok) expect(b.value.reason).toBe(REASON);
    }
    if (save.ok) expect(save.value.expectUpdatedAt).toBe('2026-11-01T00:00:00.000Z');

    const short = 'too short';
    expect(buildCreateDraft(fields({ ...base, reason: short }))).toEqual({ ok: false, error: 'reason' });
    expect(buildPublish(fields({ reason: short }))).toEqual({ ok: false, error: 'reason' });
    expect(buildArchive(fields({ reason: short, archiveReason: 'withdrawn' }))).toEqual({ ok: false, error: 'reason' });
    expect(buildPublish(fields({ reason: 'x'.repeat(2001) }))).toEqual({ ok: false, error: 'reason' });
    expect(buildArchive(fields({ reason: REASON, archiveReason: '' }))).toEqual({ ok: false, error: 'archiveReason' });
  });

  it('refuses an empty title or body before the round trip', () => {
    expect(buildCreateDraft(fields({ title: '', body: 'x', reason: REASON }))).toEqual({ ok: false, error: 'title' });
    expect(buildCreateDraft(fields({ title: 'T', body: '   ', reason: REASON }))).toEqual({ ok: false, error: 'body' });
  });

  it('sends translations as a full set, drops empty ones, and refuses a title without a body', () => {
    const b = buildCreateDraft(fields({
      title: 'T', body: 'B', reason: REASON, trLang: ['hi', 'gu'],
      tr_hi_title: 'शर्तें', tr_hi_body: 'हिंदी पाठ', tr_gu_title: '', tr_gu_body: '',
    }));
    expect(b.ok && b.value.translations).toEqual([{ languageCode: 'hi', title: 'शर्तें', body: 'हिंदी पाठ' }]);
    expect(buildCreateDraft(fields({ title: 'T', body: 'B', reason: REASON, trLang: ['gu'], tr_gu_title: 'only', tr_gu_body: '' })))
      .toEqual({ ok: false, error: 'translation' });
  });

  it('keeps a stored translation in a language the defaults do not list', () => {
    expect(translationLanguages([{ languageCode: 'mr', title: null, body: 'x' }])).toEqual(['hi', 'gu', 'mr']);
  });
});

describe('LEGAL-1 · publish by absence', () => {
  const draft = { id: 'v2', status: 'draft' } as unknown as VersionDetail;

  it('draws the publish form only when admin-api says the viewer may publish', () => {
    expect(publishWithheldKey({ adminId: 'b', canPublishDraft: true, draftHasNamedMaker: true }, draft)).toBeNull();
    expect(publishWithheldKey({ adminId: 'a', canPublishDraft: false, draftHasNamedMaker: true }, draft)).toBe('lp.publish.checkerRequired');
    expect(publishWithheldKey({ adminId: 'a', canPublishDraft: false, draftHasNamedMaker: false }, draft)).toBe('lp.publish.makerUnnamed');
    expect(publishWithheldKey({ adminId: 'a', canPublishDraft: true, draftHasNamedMaker: true }, null)).toBe('lp.publish.noDraft');
    expect(dict['lp.publish.checkerRequired']).toMatch(/maker and checker must be different/);
    expect(dict['lp.publish.makerUnnamed']).toMatch(/must save it first/);
  });

  it('the detail page renders publishAction only behind withheld === null, and the rule line otherwise', () => {
    const page = strip(read('app', 'legal-pages', '[slug]', 'page.tsx'));
    expect(page).toMatch(/withheld === null \? \(\s*<form action=\{publishAction\}/);
    expect(page).toMatch(/<Callout tone="info">\{t\.t\(withheld\)\}<\/Callout>/);
    expect((page.match(/action=\{publishAction\}/g) ?? []).length).toBe(1);
  });

  it('picks the live version and the open draft from the history', () => {
    const vs = [{ status: 'draft', id: 'd' }, { status: 'published', id: 'p' }, { status: 'archived', id: 'a' }] as unknown as VersionDetail[];
    expect(liveVersion({ versions: vs })?.id).toBe('p');
    expect(openDraft({ versions: vs })?.id).toBe('d');
    expect(liveVersion({ versions: [] })).toBeNull();
  });

  it('labels operators honestly', () => {
    expect(whoLabel(null, 'me')).toEqual({ key: 'lp.who.nobody', who: '' });
    expect(whoLabel('me-123456789', 'me-123456789').key).toBe('lp.who.you');
    expect(whoLabel('other-123456789', 'me').key).toBe('lp.who.other');
  });
});

describe('LEGAL-1 · typed refusals become localized messages', () => {
  it('maps every contract code to its own kind', () => {
    expect(errorKindFor('IDEMPOTENCY_KEY_REQUIRED', 400)).toBe('idempotency');
    expect(errorKindFor('PLATFORM_PAGE_UNKNOWN_SLUG', 404)).toBe('unknownSlug');
    expect(errorKindFor('PLATFORM_PAGE_DRAFT_EXISTS', 409)).toBe('draftExists');
    expect(errorKindFor('PLATFORM_PAGE_NOT_DRAFT', 409)).toBe('notDraft');
    expect(errorKindFor('PLATFORM_PAGE_CHANGED', 409)).toBe('changed');
    expect(errorKindFor('PLATFORM_PAGE_CHECKER_REQUIRED', 409)).toBe('checkerRequired');
    expect(errorKindFor('SECOND_PERSON_REQUIRED', 409)).toBe('checkerRequired');
    expect(errorKindFor('PLATFORM_PAGE_MAKER_UNNAMED', 409)).toBe('makerUnnamed');
    expect(errorKindFor('PLATFORM_PAGE_REFUSED', 422)).toBe('refused');
  });

  it('splits a 403 into "missing permission" and "re-authenticate"', () => {
    expect(errorKindFor('ADMIN_API_ERROR', 403, 'missing owner permission: platform.pages.publish')).toBe('permission');
    expect(errorKindFor(undefined, 403, 'step-up required')).toBe('elevation');
    expect(errorKindFor(undefined, 500)).toBe('generic');
    expect(errorKindFor(undefined, 409)).toBe('conflict');
  });

  it('has a non-empty catalogue message for every kind and every success', () => {
    for (const k of ERROR_KINDS) expect(dict[errorKey(k)]).toBeTruthy();
    for (const k of OK_KINDS) expect(dict[`lp.ok.${k}`]).toBeTruthy();
  });

  it('carries every body problem to the page, bounded, and round-trips it', () => {
    const ps = problemsFrom({ problems: [
      { code: 'RAW_HTML', detail: '<script> at line 3' },
      { code: 'UNKNOWN_TOKEN', detail: '{{platform.nope}}' },
    ] });
    expect(ps).toHaveLength(2);
    expect(decodeProblems(encodeProblems(ps))).toEqual(ps);
    expect(decodeProblems('not-base64-json')).toEqual([]);
    expect(problemsFrom({ problems: Array.from({ length: 50 }, () => ({ code: 'X', detail: 'y' })) })).toHaveLength(12);
    expect(problemsFrom(null)).toEqual([]);
    expect(dict['lp.problem']).toMatch(/\{code\}.*\{detail\}/);
  });
});

describe('LEGAL-1 · the body is text, never HTML', () => {
  it('no new file renders HTML from a string', () => {
    for (const f of NEW_FILES) {
      const src = read(...f);
      expect(src).not.toMatch(/dangerouslySetInnerHTML/);
      expect(src).not.toMatch(/innerHTML/);
    }
  });

  it('the live body is printed inside <pre>', () => {
    const page = strip(read('app', 'legal-pages', '[slug]', 'page.tsx'));
    expect(page).toMatch(/<pre className="kv-pre">\{live\.body\}<\/pre>/);
  });
});

describe('LEGAL-1 · copy is in the catalogue', () => {
  it('every literal t.t key in the new files exists in en.ts', () => {
    const missing: string[] = [];
    for (const f of NEW_FILES) {
      const src = read(...f);
      for (const m of src.matchAll(/t\.t\(\s*'([^']+)'/g)) if (!dict[m[1]]) missing.push(`${f.join('/')}: ${m[1]}`);
      for (const m of src.matchAll(/'(lp\.[A-Za-z0-9_.]+)'/g)) if (!dict[m[1]] && !m[1].endsWith('.')) missing.push(`${f.join('/')}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('labels every slug and status, and lists the eleven platform fact tokens', () => {
    for (const s of PLATFORM_PAGE_SLUGS) { expect(isPlatformPageSlug(s)).toBe(true); expect(dict[slugKey(s)]).toBeTruthy(); }
    expect(isPlatformPageSlug('cookies')).toBe(false);
    for (const s of ['draft', 'published', 'archived', 'weird']) expect(dict[statusKey(s)]).toBeTruthy();
    for (const k of ['lp.who.you', 'lp.who.other', 'lp.who.nobody']) expect(dict[k]).toBeTruthy();
    expect(PLATFORM_FACT_TOKENS).toHaveLength(11);
    expect(PLATFORM_FACT_TOKENS).toContain('platform.grievance.email');
  });

  it('the not-published state says what the storefront shows', () => {
    expect(dict['lp.notPublished']).toMatch(/not published yet/);
  });
});
