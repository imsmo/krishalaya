// apps/web-admin/src/app/settings/page.tsx · W103 (PC-56 ADMIN-11).
//
// **THE REGISTRY NO SURFACE COULD REACH.** `setting_definitions` has carried a `scope` column with a 'platform' value
// since migration 0002, and nothing in the monorepo could read those rows: the only listing query filters
// `WHERE d.scope = 'tenant'`, the tenant write path refuses a non-tenant scope by design, and there was no admin module,
// no console route and no `settings.read` permission anywhere.
//
// TWO THINGS THIS PAGE SHOWS THAT THE SCHEMA COULD NOT EXPRESS BEFORE 0121:
//   • **the shipped default and the set value, apart.** One column meant "48 because we ship 48" and "48 because
//     somebody chose it in July" were the same fact, and only the second survived a change.
//   • **the risk class.** `scope` says who may override a key; it does not say whether changing it moves money.
//     `order.auto_confirm_hours` and `payments.payout_hold_hours` are both tenant-scoped and only one of them does.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { defineSettingAction } from './actions';
import {
  effectiveValue, overridesKey, provenanceClass, provenanceKey, riskClassName, riskKey, type SettingRow,
} from '../../features/settings/setting';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st11.title'), robots: { index: false, follow: false } };
}

interface Meta { nextCursor: string | null; dryRunNote: string; impactSimulationOwner: string }

const show = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

const GROUPS = ['order.', 'listing.', 'payments.', 'security.', 'notification.'] as const;

export default async function SettingsPage({ searchParams }: {
  searchParams: { prefix?: string; riskClass?: string; cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const prefix = (searchParams.prefix ?? '').trim() || undefined;
  const riskClass = ['ordinary', 'money_path', 'security'].includes(searchParams.riskClass ?? '')
    ? searchParams.riskClass : undefined;

  let rows: SettingRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (prefix) q.set('prefix', prefix);
    if (riskClass) q.set('riskClass', riskClass);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<SettingRow[]>(`settings?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'st11.restricted.settings' : 'st11.error.settings';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('st11.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('st11.title')}</h1>
        <p className="kv-page__sub">{t.t('st11.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`st11.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`st11.err.${searchParams.error}`)}</p> : null}

      {/* THE TWO RULES THAT GOVERN EVERY ROW BELOW. */}
      <p className="kv-note">{t.t('st11.insertNotMigration')}</p>
      <p className="kv-note is-warn">{t.t('st11.checkerRule')}</p>

      <nav className="kv-filters" aria-label={t.t('st11.filterGroup')}>
        <Link className={`kv-chip${!prefix && !riskClass ? ' is-active' : ''}`} href="/settings">{t.t('common.all')}</Link>
        {GROUPS.map((g) => (
          <Link key={g} className={`kv-chip${prefix === g ? ' is-active' : ''}`}
            href={`/settings?prefix=${encodeURIComponent(g)}`}>{g}*</Link>
        ))}
        <Link className={`kv-chip${riskClass === 'money_path' ? ' is-active' : ''}`} href="/settings?riskClass=money_path">
          {t.t('st11.risk.money_path')}
        </Link>
        <Link className={`kv-chip${riskClass === 'security' ? ' is-active' : ''}`} href="/settings?riskClass=security">
          {t.t('st11.risk.security')}
        </Link>
      </nav>

      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('st11.empty.title')}</h2>
          <p>{t.t('st11.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('st11.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('st11.col.key')}</th>
              <th scope="col">{t.t('st11.col.type')}</th>
              <th scope="col">{t.t('st11.col.serving')}</th>
              <th scope="col">{t.t('st11.col.shipped')}</th>
              <th scope="col">{t.t('st11.col.overrides')}</th>
              <th scope="col">{t.t('st11.col.risk')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <Link href={`/settings/${encodeURIComponent(r.key)}`} className="kv-mono">{r.key}</Link>
                  {r.lockNote ? <><br /><small>{r.lockNote}</small></> : null}
                </td>
                <td>{r.valueType}</td>
                <td>
                  {show(effectiveValue(r))}
                  {/* WHERE THIS VALUE CAME FROM. Three states, because a set value that equals the shipped default is
                      still a decision somebody made, and flattening it would erase that a person looked at this key. */}
                  <br /><span className={provenanceClass(r)}>{t.t(provenanceKey(r))}</span>
                </td>
                <td>{show(r.defaultValue)}</td>
                <td>{t.t(overridesKey(r), { n: String(r.overrideCount) })}</td>
                <td><span className={riskClassName(r.riskClass)}>{t.t(riskKey(r.riskClass))}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Link className="kv-btn" href={`/settings?${prefix ? `prefix=${encodeURIComponent(prefix)}&` : ''}cursor=${encodeURIComponent(meta.nextCursor)}`}>
            {t.t('common.next')}
          </Link>
        </nav>
      ) : null}

      {/* DEFINE A NEW SETTING — the INSERT that replaces a migration. */}
      <section className="kv-panel" aria-labelledby="st11-define">
        <h2 id="st11-define" className="kv-panel__title">{t.t('st11.define.title')}</h2>
        <p className="kv-note">{t.t('st11.define.note')}</p>
        <form action={defineSettingAction}>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-key">{t.t('st11.col.key')}</label>
            <input className="kv-input" id="st11-key" name="key" required maxLength={80}
              pattern="[a-z][a-z0-9_]*(\.[a-z0-9_]+)+" aria-describedby="st11-key-help" />
            <p className="kv-field__help" id="st11-key-help">{t.t('st11.define.keyHelp')}</p>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-type">{t.t('st11.col.type')}</label>
            <select className="kv-input" id="st11-type" name="valueType" defaultValue="int">
              {['string', 'int', 'decimal', 'bool', 'json'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-default">{t.t('st11.col.shipped')}</label>
            <input className="kv-input" id="st11-default" name="defaultValue" required />
            <p className="kv-field__help">{t.t('st11.define.defaultHelp')}</p>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-scope">{t.t('st11.define.scope')}</label>
            <select className="kv-input" id="st11-scope" name="scope" defaultValue="tenant">
              <option value="tenant">tenant — a tenant may override it</option>
              <option value="platform">platform — the value is the law</option>
            </select>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-risk">{t.t('st11.col.risk')}</label>
            <select className="kv-input" id="st11-risk" name="riskClass" defaultValue="ordinary">
              <option value="ordinary">ordinary</option>
              <option value="money_path">money_path — needs two administrators</option>
              <option value="security">security — needs two administrators</option>
            </select>
            <p className="kv-field__help">{t.t('st11.define.riskHelp')}</p>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-desc">{t.t('st11.define.description')}</label>
            <input className="kv-input" id="st11-desc" name="description" maxLength={2000} />
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="st11-reason">{t.t('st11.col.reason')}</label>
            <input className="kv-input" id="st11-reason" name="reason" required minLength={20} maxLength={2000} />
            <p className="kv-field__help">{t.t('st11.reasonHelp')}</p>
          </div>
          <button className="kv-btn" type="submit">{t.t('st11.define.submit')}</button>
        </form>
      </section>

      {meta ? <p className="kv-note"><small>{meta.dryRunNote} ({meta.impactSimulationOwner})</small></p> : null}
    </main>
  );
}
