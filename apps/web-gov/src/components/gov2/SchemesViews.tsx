// apps/web-gov/src/components/gov2/SchemesViews.tsx · PC-56 GOV-2b — W326 (`/schemes`) and W327–W329 (`/schemes/[id]?tab=identity|rules|
// versions`), presentational (rendered by the pages and by the render tests). GOV-2 Q1-A and Q5-A (lead-applied 2026-11-10; the founder may
// reopen).
//
// Every value printed is one GOV-2a's B3 read returned (`gov.schemes.{list,get,versions,diff}` — the PUBLISHED version only). This file holds
// no money helper and prints no money figure (Q1-A: the benefit TYPE and the instalment COUNT only); it never prints a draft's content (only
// the fact that a newer draft exists); it converts nothing (land stays in acres, as stored). Every authoring act the canon offers is a LINK
// to its DECOR chain with the refusal beside it — no form, no input, no write. Q5-A's sentence is printed verbatim on the list and every tab.
// All copy via i18n; no inline styles; no physical direction.
import type { ReactNode } from 'react';
import type { GovMe, GovScheme, GovSchemeVersion, GovSchemeVersionDiff } from '@krishalaya/sdk-js';
import { Gov2Refusals } from './Gov2Chain';
import { atUtc } from '../../features/gov1/access';
import { chain2Href, SCHEME_TABS, type SchemeTab, type Tr } from '../../features/gov2/refusals';
import { rulesInWords } from '../../features/gov2/rules-format';
import { activeKey, asStored, diffFieldKey, secondPersonKey, versionStatusKey, type SchemeState, type SchemesState } from '../../features/gov2/schemes';

const shown = (t: Tr, v: string | null) => v ?? t.t('common.dash');

function States({ t, state, retry }: { t: Tr; state: string; retry: string }) {
  return (
    <>
      {state === 'off' ? <p className="kv-notice" data-kv-notice="off">{t.t('gov2.off')}</p> : null}
      {state === 'forbidden' ? <p className="kv-notice" data-kv-notice="forbidden">{t.t('gov2.forbidden')}</p> : null}
      {state === 'error' ? (
        <div className="kv-notice" data-kv-notice="error">
          <p>{t.t('gov2.error')}</p>
          <p className="kv-pager"><a className="kv-btn" href={retry} data-kv-retry="">{t.t('common.retry')}</a></p>
        </div>
      ) : null}
    </>
  );
}

/** An authoring act the canon offers, as a link to its DECOR chain, the refusal sentence beside it. */
function Refused({ t, href, label, id }: { t: Tr; href: string; label: string; id: string }) {
  return <li data-kv-decor={id}><a className="kv-link" href={href}>{t.t(label)}</a>{' '}{t.t('gov2.actRefused')}</li>;
}

/** W326 — the authority's schemes. */
export function SchemesListView({ t, state, me, schemes }: { t: Tr; state: SchemesState; me: GovMe | null; schemes: GovScheme[] }) {
  const rows = state === 'ok' ? schemes : [];
  return (
    <section data-kv-page="schemes" data-kv-state={state}>
      <h1>{t.t('gov2.list.title')}</h1>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.dash.signedIn', { authority: me.authority?.name ?? t.t('common.dash') })}</p> : null}
      <p className="kv-statement" data-kv-statement="gov2.q5">{t.t('gov2.q5')}</p>
      <p className="kv-muted" data-kv-fact="version-rule">{t.t('gov2.versionRule')}</p>
      <p className="kv-muted" data-kv-fact="no-money">{t.t('gov2.noMoney')}</p>
      <States t={t} state={state} retry={chain2Href('scheme_reread', 'confirm', null)} />
      {state === 'empty' ? <p className="kv-muted" data-kv-empty="no-scheme">{t.t('gov2.list.empty')}</p> : null}
      {rows.length > 0 ? (
        <>
          <p className="kv-muted">{t.t('gov2.list.lead')}</p>
          <table className="kv-table" data-kv-schemes={rows.length}>
            <thead><tr>
              <th scope="col">{t.t('gov2.list.col.scheme')}</th><th scope="col">{t.t('gov2.list.col.code')}</th><th scope="col">{t.t('gov2.list.col.category')}</th>
              <th scope="col">{t.t('gov2.list.col.benefit')}</th><th scope="col">{t.t('gov2.list.col.instalments')}</th>
              <th scope="col">{t.t('gov2.list.col.version')}</th><th scope="col">{t.t('gov2.list.col.status')}</th>
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} data-kv-scheme={s.code} data-kv-active={s.isActive ? 'yes' : 'no'}>
                  <th scope="row"><a className="kv-link" href={`/schemes/${s.id}`} data-kv-open={s.code}>{s.name}</a></th>
                  <td>{s.code}</td>
                  <td>{shown(t, s.category?.name ?? null)}</td>
                  <td>{shown(t, s.published?.benefitType ?? null)}</td>
                  <td>{s.published?.instalments === null || s.published?.instalments === undefined ? t.t('common.dash') : String(s.published.instalments)}</td>
                  <td>
                    {s.version === null ? t.t('gov2.noPublished') : t.t('gov2.versionN', { n: String(s.version) })}
                    {s.newerDraftExists ? <span className="kv-fine" data-kv-newer-draft=""> {t.t('gov2.newerDraft')}</span> : null}
                  </td>
                  <td data-kv-status={s.isActive ? 'active' : 'inactive'}>{t.t(activeKey(s))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <ul className="kv-actions" data-kv-acts="schemes">
        <Refused t={t} href={chain2Href('scheme_form', 'review', null)} label="gov2.act.define" id="define" />
      </ul>
      <Gov2Refusals t={t} surface="schemes" />
    </section>
  );
}

function Tabs({ t, id, tab }: { t: Tr; id: string; tab: SchemeTab }) {
  return (
    <nav className="kv-tabs" aria-label={t.t('gov2.tabs.label')} data-kv-tabs="">
      {SCHEME_TABS.map((x) => (
        <a key={x} href={`/schemes/${id}?tab=${x}`} className={x === tab ? 'kv-tab kv-tab--active' : 'kv-tab'} data-kv-tab={x} aria-current={x === tab ? 'page' : undefined}>{t.t(`gov2.tab.${x}`)}</a>
      ))}
    </nav>
  );
}

function Fact({ t, k, children, id }: { t: Tr; k: string; children: ReactNode; id: string }) {
  return <div className="kv-facts__row" data-kv-field={id}><dt>{t.t(k)}</dt><dd>{children}</dd></div>;
}

/** The rules in words (E6) — used by the rules tab and by the diff. */
export function RulesInWords({ t, rules }: { t: Tr; rules: Record<string, unknown> | null | undefined }) {
  const w = rulesInWords(rules);
  if (w.lines.length === 0 && w.notApplied.length === 0) return <p data-kv-rules="none">{t.t('gov2.rules.none')}</p>;
  return (
    <ul className="kv-rules" data-kv-rules={w.lines.length}>
      {w.lines.map((l) => <li key={l.field} data-kv-rule={l.field}>{t.t(l.key, l.vars)}</li>)}
      {w.notApplied.length ? <li data-kv-rule="not-applied">{t.t('gov2.rule.notApplied', { keys: w.notApplied.join(', ') })}</li> : null}
    </ul>
  );
}

function Identity({ t, s }: { t: Tr; s: GovScheme }) {
  const p = s.published;
  return (
    <div data-kv-tab-body="identity">
      <dl className="kv-facts">
        <Fact t={t} k="gov2.id.name" id="name">{s.name}</Fact>
        <Fact t={t} k="gov2.id.code" id="code">{s.code}</Fact>
        <Fact t={t} k="gov2.id.category" id="category">{shown(t, s.category?.name ?? null)}</Fact>
        <Fact t={t} k="gov2.id.status" id="status">{t.t(activeKey(s))}</Fact>
        <Fact t={t} k="gov2.id.version" id="version">{s.version === null ? t.t('gov2.noPublished') : t.t('gov2.versionN', { n: String(s.version) })}</Fact>
        <Fact t={t} k="gov2.id.publishedAt" id="published-at">{shown(t, atUtc(s.publishedAt))}</Fact>
        {p ? (
          <>
            <Fact t={t} k="gov2.id.benefitType" id="benefit-type">{shown(t, p.benefitType)}</Fact>
            <Fact t={t} k="gov2.id.instalments" id="instalments">{p.instalments === null ? t.t('common.dash') : String(p.instalments)}</Fact>
            <Fact t={t} k="gov2.id.window" id="window">{shown(t, asStored(p.applicationWindow))} <span className="kv-fine">{t.t('gov2.id.windowNote')}</span></Fact>
            <Fact t={t} k="gov2.id.regions" id="regions">{asStored(p.regions) ?? t.t('gov2.id.regionsNone')} <span className="kv-fine">{t.t('gov2.id.regionsNote')}</span></Fact>
            <Fact t={t} k="gov2.id.docs" id="documents">{asStored(p.requiredDocuments) ?? t.t('gov2.id.docsNone')}</Fact>
          </>
        ) : null}
      </dl>
      {p ? (
        <>
          <h2 className="kv-card__title">{t.t('gov2.id.fields')}</h2>
          {p.formFields.length === 0 ? <p data-kv-fields="none">{t.t('gov2.id.fieldsNone')}</p> : (
            <ul data-kv-fields={p.formFields.length}>
              {p.formFields.map((f) => <li key={f.key} data-kv-form-field={f.key}>{f.label} ({f.key}) — {t.t(f.personal ? 'gov2.id.fieldPersonal' : 'gov2.id.fieldOpen')}</li>)}
            </ul>
          )}
        </>
      ) : <p data-kv-empty="no-version">{t.t('gov2.id.noVersion')}</p>}
      <ul className="kv-actions" data-kv-acts="identity">
        <Refused t={t} href={chain2Href('scheme_form', 'review', s.id, 'identity')} label="gov2.act.edit" id="edit" />
        <Refused t={t} href={chain2Href('scheme_form', 'review', s.id, 'identity')} label="gov2.act.addTier" id="add-tier" />
        <Refused t={t} href={chain2Href('scheme_form', 'review', s.id, 'identity')} label="gov2.act.addDocument" id="add-document" />
        <Refused t={t} href={chain2Href('scheme_form', 'review', s.id, 'identity')} label="gov2.act.saveDraft" id="save-draft" />
        <Refused t={t} href={chain2Href('scheme_send', 'confirm', s.id, 'identity')} label="gov2.act.copy" id="copy" />
      </ul>
    </div>
  );
}

function Rules({ t, s }: { t: Tr; s: GovScheme }) {
  return (
    <div data-kv-tab-body="rules">
      <p>{t.t('gov2.rules.lead')}</p>
      {s.published ? <RulesInWords t={t} rules={s.published.rules} /> : <p data-kv-empty="no-version">{t.t('gov2.id.noVersion')}</p>}
      <p className="kv-muted" data-kv-fact="five-fields">{t.t('gov2.rules.only')}</p>
      <p className="kv-muted" data-kv-fact="not-at-apply">{t.t('gov2.rules.notAtApply')}</p>
      <p className="kv-muted" data-kv-fact="unknown-skipped">{t.t('gov2.rules.unknownSkipped')}</p>
      <ul className="kv-actions" data-kv-acts="rules">
        <Refused t={t} href={chain2Href('rule_form', 'review', s.id)} label="gov2.act.addRulePlus" id="add-rule-plus" />
        <Refused t={t} href={chain2Href('rule_form', 'review', s.id)} label="gov2.act.addRule" id="add-rule" />
        <Refused t={t} href={chain2Href('rule_form', 'review', s.id)} label="gov2.act.saveDraft" id="save-draft" />
        <Refused t={t} href={chain2Href('rule_remove', 'confirm', s.id)} label="gov2.act.remove" id="remove" />
      </ul>
    </div>
  );
}

function DiffValue({ t, field, v }: { t: Tr; field: string; v: unknown }) {
  if (field === 'rules') return v === null || v === undefined ? <>{t.t('common.dash')}</> : <RulesInWords t={t} rules={v as Record<string, unknown>} />;
  return <>{shown(t, asStored(v))}</>;
}

export type DiffState = 'ok' | 'error' | 'none';
function Versions({ t, s, versions, diff, diffState }: { t: Tr; s: GovScheme; versions: GovSchemeVersion[]; diff: GovSchemeVersionDiff | null; diffState: DiffState }) {
  return (
    <div data-kv-tab-body="versions">
      <p className="kv-muted" data-kv-fact="version-rule">{t.t('gov2.versionRule')}</p>
      {s.newerDraftExists ? <p data-kv-newer-draft="">{t.t('gov2.newerDraft')}</p> : <p data-kv-no-newer="">{t.t('gov2.ver.noNewer')}</p>}
      {s.unrecordedBelow !== null ? <p className="kv-muted" data-kv-unrecorded-below={s.unrecordedBelow}>{t.t('gov2.ver.unrecordedBelow', { n: String(s.unrecordedBelow) })}</p> : null}
      {versions.length === 0 ? <p data-kv-empty="no-version">{t.t('gov2.ver.none')}</p> : (
        <table className="kv-table" data-kv-versions={versions.length}>
          <thead><tr>
            <th scope="col">{t.t('gov2.ver.col.version')}</th><th scope="col">{t.t('gov2.ver.col.status')}</th>
            <th scope="col">{t.t('gov2.ver.col.publishedAt')}</th><th scope="col">{t.t('gov2.ver.col.second')}</th><th scope="col">{t.t('gov2.ver.col.changes')}</th>
          </tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version} data-kv-version={v.version}>
                <th scope="row">{t.t('gov2.versionN', { n: String(v.version) })}</th>
                <td data-kv-version-status={v.status}>{t.t(versionStatusKey(v.status))}</td>
                <td>{shown(t, atUtc(v.publishedAt))}</td>
                <td data-kv-second={v.publishedBySecondPerson ? 'yes' : v.isBackfilled ? 'backfilled' : 'no'}>{t.t(secondPersonKey(v))}</td>
                <td><a className="kv-link" href={`/schemes/${s.id}?tab=versions&v=${v.version}`}>{t.t('gov2.ver.show')}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {diffState === 'error' ? <p className="kv-notice" data-kv-diff="error">{t.t('gov2.ver.diffError')}</p> : null}
      {diffState === 'ok' && diff ? (
        <section data-kv-diff={diff.version}>
          <h2 className="kv-card__title">{t.t('gov2.ver.diffTitle', { n: String(diff.version) })}</h2>
          <p className="kv-muted">{diff.comparedWith === null ? t.t('gov2.ver.diffFirst') : t.t('gov2.ver.diffAgainst', { m: String(diff.comparedWith) })}</p>
          {diff.changes.length === 0 ? <p data-kv-diff-none="">{t.t('gov2.ver.diffNone', { m: String(diff.comparedWith ?? '') })}</p> : (
            <table className="kv-table" data-kv-changes={diff.changes.length}>
              <thead><tr><th scope="col">{t.t('gov2.ver.col.field')}</th><th scope="col">{t.t('gov2.ver.was')}</th><th scope="col">{t.t('gov2.ver.now')}</th></tr></thead>
              <tbody>
                {diff.changes.map((c) => (
                  <tr key={c.field} data-kv-change={c.field}>
                    <th scope="row">{t.t(diffFieldKey(c.field))}</th>
                    <td data-kv-from=""><DiffValue t={t} field={c.field} v={c.from} /></td>
                    <td data-kv-to=""><DiffValue t={t} field={c.field} v={c.to} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
      <p className="kv-pager"><a className="kv-link" href={`/schemes/${s.id}?tab=rules`} data-kv-nav="back-to-rules">{t.t('gov2.ver.backToRules')}</a></p>
      <ul className="kv-actions" data-kv-acts="versions">
        <Refused t={t} href={chain2Href('scheme_send', 'confirm', s.id, 'versions')} label="gov2.act.send" id="send" />
        <Refused t={t} href={chain2Href('scheme_form', 'review', s.id, 'versions')} label="gov2.act.startDraft" id="start-draft" />
      </ul>
    </div>
  );
}

const TAB_SURFACE = { identity: 'scheme_identity', rules: 'scheme_rules', versions: 'scheme_versions' } as const;

/** W327 / W328 / W329 — one scheme, three tabs. */
export function SchemeDetailView({ t, state, id, tab, scheme, versions = [], diff = null, diffState = 'none' }: {
  t: Tr; state: SchemeState; id: string; tab: SchemeTab; scheme: GovScheme | null; versions?: GovSchemeVersion[]; diff?: GovSchemeVersionDiff | null; diffState?: DiffState;
}) {
  const s = state === 'ok' ? scheme : null;
  return (
    <section data-kv-page="scheme" data-kv-state={state} data-kv-tab={tab}>
      <p className="kv-pager"><a className="kv-link" href="/schemes" data-kv-nav="list">{t.t('gov2.backToList')}</a></p>
      <h1>{s ? s.name : t.t('gov2.detail.title')}</h1>
      {s && !s.isActive ? <p className="kv-notice" data-kv-inactive="">{t.t('gov2.inactive')}</p> : null}
      <p className="kv-statement" data-kv-statement="gov2.q5">{t.t('gov2.q5')}</p>
      <p className="kv-muted" data-kv-fact="no-money">{t.t('gov2.noMoney')}</p>
      <States t={t} state={state} retry={`/schemes/${encodeURIComponent(id)}?tab=${tab}&do=reread&act=confirm`} />
      {state === 'not_found' ? <p className="kv-notice" data-kv-notice="not-found">{t.t('gov2.notFound')}</p> : null}
      {s ? (
        <>
          <Tabs t={t} id={s.id} tab={tab} />
          {tab === 'identity' ? <Identity t={t} s={s} /> : null}
          {tab === 'rules' ? <Rules t={t} s={s} /> : null}
          {tab === 'versions' ? <Versions t={t} s={s} versions={versions} diff={diff} diffState={diffState} /> : null}
        </>
      ) : null}
      <Gov2Refusals t={t} surface={TAB_SURFACE[tab]} />
    </section>
  );
}
