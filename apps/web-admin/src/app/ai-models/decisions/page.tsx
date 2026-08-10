// apps/web-admin/src/app/ai-models/decisions/page.tsx · W084 (PC-56 ADMIN-7).
//
// "ai_inferences — partitioned audit of every consequential decision. input_ref holds pointers, never raw PII."
//
// THE LOG HAS BEEN WRITTEN SINCE 0013 AND HAD NO GOD-MODE READER. apps/api exposes a tenant-scoped view; the platform
// realm — the one that needs to answer "did this model treat everybody the same" — had no route to it at all.
//
// **`input_ref` IS NEVER SELECTED, and that is a decision rather than an omission.** 0013's own comment on the column is
// "pointers, never raw PII" and W084 repeats it in its subtitle — but a pointer set is still a map of which farmer's
// photograph went to which model, and this screen's job is to show what was DECIDED. `output` IS shown, because the
// decision is the point: it is what the model concluded, not what it was given.
//
// THE WINDOW IS A REFUSAL, NOT A SUGGESTION. The table is partitioned monthly, so an unbounded range is a scan of every
// partition — and W084's own "Couldn't query partition · older months need the signed-export path, not a live scan" state
// was describing a defect rather than a limit. Same rule ADMIN-6 applied to the ledger explorer.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  MAX_WINDOW_DAYS, formatRate, outputSummary, overriddenClass, windowTooWide,
} from '../../../features/ai-governance/ai-governance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ai.decisions.title'), robots: { index: false, follow: false } };
}

interface InferenceRow {
  id: string; createdAt: string; modelId: string; code: string; version: string;
  subjectType: string; subjectId: string; output: unknown; confidence: number | null;
  wasOverridden: boolean; overrideReason: string | null; tenantId: string | null;
}
interface Meta {
  nextCursor: string | null;
  window: { from: string; to: string; maxDays: number };
  inputsWithheld: boolean;
}

export default async function DecisionsPage({ searchParams }: {
  searchParams: { from?: string; to?: string; modelId?: string; tenantId?: string; overriddenOnly?: string; cursor?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  const f = {
    from: searchParams.from?.trim() || undefined,
    to: searchParams.to?.trim() || undefined,
    modelId: searchParams.modelId?.trim() || undefined,
    tenantId: searchParams.tenantId?.trim() || undefined,
    overriddenOnly: searchParams.overriddenOnly === 'true' ? 'true' : undefined,
  };
  // Checked BEFORE the request so the query is not sent. The point of the rule is to avoid the partition scan, not to
  // survive one.
  const tooWide = windowTooWide(f.from, f.to, MAX_WINDOW_DAYS);

  let rows: InferenceRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  if (!tooWide) {
    try {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
      if (searchParams.cursor) q.set('cursor', searchParams.cursor);
      const res = await adminGet<InferenceRow[]>(`ai/inferences?${q.toString()}`);
      rows = res.data ?? []; meta = res.meta as unknown as Meta;
    } catch (e) {
      notice = e instanceof AdminApiError && e.status === 403 ? 'ai.restricted.decisions' : 'ai.error.decisions';
    }
  }

  const withFilters = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/ai-models/decisions?${s}` : '/ai-models/decisions';
  };

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/ai-models">{t.t('nav.aiModels')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('ai.decisions.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('ai.decisions.title')}</h1>
        <p className="kv-page__sub">{t.t('ai.decisions.sub')}</p>
      </header>

      {tooWide ? (
        <p className="kv-note is-danger" role="alert">
          {t.t('ai.decisions.tooWide', { max: String(MAX_WINDOW_DAYS) })}
        </p>
      ) : null}
      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      <form className="kv-filters" method="get" action="/ai-models/decisions">
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="ai-from">{t.t('ai.filter.from')}</label>
          <input className="kv-input" id="ai-from" name="from" type="datetime-local" defaultValue={f.from?.slice(0, 16) ?? ''} />
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="ai-to">{t.t('ai.filter.to')}</label>
          <input className="kv-input" id="ai-to" name="to" type="datetime-local" defaultValue={f.to?.slice(0, 16) ?? ''} />
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="ai-model">{t.t('ai.filter.model')}</label>
          <input className="kv-input" id="ai-model" name="modelId" defaultValue={f.modelId ?? ''} />
        </div>
        <div className="kv-chips" role="group" aria-label={t.t('ai.filter.overridden')}>
          <Link className={`kv-chip${!f.overriddenOnly ? ' is-active' : ''}`} href={withFilters({ overriddenOnly: undefined, cursor: undefined })}>
            {t.t('common.all')}
          </Link>
          {/* W084's "Overridden only" saved view, applied SERVER-SIDE. Filtering a keyset page after fetching it returns
              short pages and eventually an empty one that reads as "no matches" — the ADMIN-5e finding. */}
          <Link className={`kv-chip${f.overriddenOnly ? ' is-active' : ''}`} href={withFilters({ overriddenOnly: 'true', cursor: undefined })}>
            {t.t('ai.filter.overriddenOnly')}
          </Link>
        </div>
        <button className="kv-btn" type="submit">{t.t('common.apply')}</button>
      </form>

      {meta?.window ? (
        <p className="kv-note">
          {t.t('ai.decisions.window', {
            from: meta.window.from.slice(0, 16).replace('T', ' '),
            to: meta.window.to.slice(0, 16).replace('T', ' '),
            max: String(meta.window.maxDays),
          })}
        </p>
      ) : null}

      {/* The withheld inputs, stated on the screen rather than only in a comment — so nobody adds the column later
          believing its absence was an oversight. */}
      {meta?.inputsWithheld ? <p className="kv-note">{t.t('ai.decisions.inputsWithheld')}</p> : null}

      {rows.length === 0 && !notice && !tooWide ? (
        <div className="kv-empty">
          <h2>{t.t('ai.decisions.empty.title')}</h2>
          <p>{t.t('ai.decisions.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('ai.decisions.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('ai.col.when')}</th>
              <th scope="col">{t.t('ai.col.model')}</th>
              <th scope="col">{t.t('ai.col.subject')}</th>
              <th scope="col">{t.t('ai.col.output')}</th>
              <th scope="col">{t.t('ai.col.confidence')}</th>
              <th scope="col">{t.t('ai.col.overridden')}</th>
              <th scope="col">{t.t('ai.col.tenant')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.slice(11, 19)}<br /><small>{r.createdAt.slice(0, 10)}</small></td>
                <td>{r.code} {r.version}</td>
                <td>{r.subjectType}/{r.subjectId.slice(0, 8)}</td>
                {/* Never "[object Object]": a cell that says that in a governance log teaches an operator to stop reading
                    the column. */}
                <td>{outputSummary(r.output)}</td>
                <td>{formatRate(r.confidence)}</td>
                <td>
                  {/* An override is a NOTE, not an error — it is the system working as designed, and W085's argument is
                      that overrides are the training signal. Drawing it red would make a healthy human-in-the-loop look
                      like a fault. */}
                  <span className={overriddenClass(r.wasOverridden)}>
                    {r.wasOverridden ? t.t('ai.overridden.yes') : t.t('common.dash')}
                  </span>
                  {r.overrideReason ? <><br /><small>{r.overrideReason}</small></> : null}
                </td>
                <td>{r.tenantId ? r.tenantId.slice(0, 8) : t.t('ai.tenant.platform')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* NO SIGNED EXPORT BUTTON. W084 offers "Export (signed)"; there is still no signing key on this platform, the same
          gap W018, W039 and W064 name — and a button producing an unsigned file labelled "signed" would be worse than its
          absence. ADMIN-5c's digest is not a signature and the console has said so since. */}
      <p className="kv-note">{t.t('ai.decisions.noSignedExport')}</p>

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Link className="kv-btn" href={withFilters({ cursor: meta.nextCursor })}>{t.t('common.next')}</Link>
        </nav>
      ) : null}
    </main>
  );
}
