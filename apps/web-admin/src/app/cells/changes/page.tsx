// apps/web-admin/src/app/cells/changes/page.tsx · W035 (PC-56 ADMIN-8).
//
// "cell_map_changes — append-only history of the routing map. Every row has a mandatory reason and actor."
//
// THE LOG HAS BEEN WRITTEN SINCE 0043 AND HAD NO MAP-WIDE READER. `CellsRepository.listChanges` takes `entityType` AND
// `entityId` as required parameters — right for one cell's history, and structurally unable to answer W035's question,
// which is "every change to the map in the last 7 days". `idx_cell_map_changes` (0043) leads with those two columns for
// the same reason, so the new read needed its own index (0116 §5).
//
// AND THE PROPOSAL QUEUE IS ON THIS PAGE, because W029 says "ALL changes are maker-checker + reasoned" and the change log
// is where an operator looks to see what the map has done. What it could not show, until this wave, is what the map is
// ABOUT to do — and the proposals awaiting a checker are exactly that.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  Button, Callout, Chip, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  actionTone, actionKey, diffText, entityKey, orderDiff,
} from '../../../features/cells/map-approval';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cm.changes.title'), robots: { index: false, follow: false } };
}

interface ChangeRow {
  id: string; entityType: string; entityId: string; action: string;
  oldValue: unknown; newValue: unknown; reason: string; actorUserId: string; createdAt: string;
  diff: { field: string; from: unknown; to: unknown }[];
}
interface Meta {
  nextCursor: string | null;
  window: { from: string; to: string; days: number; maxDays: number };
}
interface ProposalSummary {
  id: string; entityType: string; entityId: string; action: string;
  proposedByAdminId: string; proposedAt: string; reason: string; status: string;
}

const ENTITIES = ['cell', 'shard', 'placement'] as const;
const ACTIONS = ['created', 'updated', 'status_changed', 'placed', 'moved', 'removed'] as const;

export default async function CellChangesPage({ searchParams }: {
  searchParams: { days?: string; entityType?: string; action?: string; cursor?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const entityType = (ENTITIES as readonly string[]).includes(searchParams.entityType ?? '') ? searchParams.entityType : undefined;
  const action = (ACTIONS as readonly string[]).includes(searchParams.action ?? '') ? searchParams.action : undefined;
  const days = searchParams.days && /^\d{1,2}$/.test(searchParams.days) ? searchParams.days : undefined;

  let rows: ChangeRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  let proposals: ProposalSummary[] = [];
  try {
    const q = new URLSearchParams();
    if (days) q.set('days', days);
    if (entityType) q.set('entityType', entityType);
    if (action) q.set('action', action);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<ChangeRow[]>(`cells/map-history?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'cm.restricted.changes' : 'cm.error.changes';
  }
  try {
    const res = await adminGet<ProposalSummary[]>('cells/proposals?status=open&limit=10');
    proposals = res.data ?? [];
  } catch {
    // The proposal queue failing must not take the history down with it — the history is append-only and durable, which
    // is W035's own error-state copy, and it is still worth reading when the newer surface is unavailable.
    proposals = [];
  }

  const withFilters = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (days) q.set('days', days);
    if (entityType) q.set('entityType', entityType);
    if (action) q.set('action', action);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/cells/changes?${s}` : '/cells/changes';
  };

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('cm.changes.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('cm.changes.title')}</h1>
        <p className="kv-page__sub">{t.t('cm.changes.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}

      {/* ---------------- WHAT THE MAP IS ABOUT TO DO ---------------- */}
      {proposals.length > 0 ? (
        <section className="kv-panel is-warn" aria-labelledby="cm-awaiting">
          <h2 id="cm-awaiting" className="kv-panel__title">
            {t.t('cm.awaiting.title', { n: String(proposals.length) })}
          </h2>
          <ul>
            {proposals.map((p) => (
              <li key={p.id}>
                <Link href={`/cells/proposals/${encodeURIComponent(p.id)}`}>
                  {t.t(entityKey(p.entityType))} {p.entityId.slice(0, 8)}
                </Link>
                {' · '}<StatusPill tone={actionTone(p.action)} label={t.t(actionKey(p.action))} />
                {/* The maker by id, not by name. admin-api has no `users` row to join to — realm-identity for the seventh
                    time — and inventing a display name would be inventing an identity. */}
                {' · '}{t.t('cm.maker')} {p.proposedByAdminId.slice(0, 8)}
                <br /><small>{p.reason}</small>
              </li>
            ))}
          </ul>
          <Callout>{t.t('cm.awaiting.note')}</Callout>
        </section>
      ) : null}

      {/* ---------------- FILTERS ---------------- */}
      <form className="kv-filters" method="get" action="/cells/changes">
        <div className="kv-chips" role="group" aria-label={t.t('cm.filter.entity')}>
          <Chip as={Link} href={withFilters({ entityType: undefined, cursor: undefined })} active={!entityType}>
            {t.t('common.all')}
          </Chip>
          {ENTITIES.map((e) => (
            <Chip as={Link} key={e} href={(() => { const q = new URLSearchParams(); q.set('entityType', e); if (days) q.set('days', days); if (action) q.set('action', action); return `/cells/changes?${q.toString()}`; })()} active={entityType === e}>
              {t.t(entityKey(e))}
            </Chip>
          ))}
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="cm-days">{t.t('cm.filter.days')}</label>
          <input className="kv-input" id="cm-days" name="days" type="number" min={1} max={meta?.window.maxDays ?? 90}
            defaultValue={days ?? String(meta?.window.days ?? 7)} />
        </div>
        <Button type="submit">{t.t('common.apply')}</Button>
      </form>

      {meta?.window ? (
        <Callout>
          {t.t('cm.changes.window', {
            days: String(meta.window.days), max: String(meta.window.maxDays),
          })}
        </Callout>
      ) : null}

      {rows.length === 0 && !notice ? (
        // W035's own copy, and it is the honest reading: "A quiet map is a healthy map."
        <EmptyState title={t.t('cm.changes.empty.title')} body={t.t('cm.changes.empty.body')} />
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('cm.changes.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('cm.col.when')}</th>
              <th scope="col">{t.t('cm.col.entity')}</th>
              <th scope="col">{t.t('cm.col.action')}</th>
              <th scope="col">{t.t('cm.col.change')}</th>
              <th scope="col">{t.t('cm.col.reason')}</th>
              <th scope="col">{t.t('cm.col.actor')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.slice(11, 16)}<br /><small>{r.createdAt.slice(0, 10)}</small></td>
                <td>
                  {t.t(entityKey(r.entityType))}
                  <br /><small>{r.entityId.slice(0, 12)}</small>
                </td>
                <td><StatusPill tone={actionTone(r.action)} label={t.t(actionKey(r.action))} /></td>
                <td>
                  {/* W035 renders the change as a diff. Ordered so `status` and `isDefault` lead — a diff listing `notes`
                      above `status` would bury the field that decides whether a region accepts tenants. */}
                  {r.diff.length === 0 ? '—' : orderDiff(r.diff).map((d) => (
                    <div key={d.field}>
                      <StatusPill tone="neutral" icon={false} label={d.field} />{' '}
                      <code>{diffText(d.from)}</code> → <code>{diffText(d.to)}</code>
                    </div>
                  ))}
                </td>
                {/* THE REASON IS MANDATORY IN THE SCHEMA and this is the column that makes that worth having. 0043 got it
                    right; what it lacked was a checker, which is what this wave adds. */}
                <td>{r.reason}</td>
                <td>{r.actorUserId === 'system' ? t.t('cm.actor.system') : r.actorUserId.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Button as={Link} href={withFilters({ cursor: meta.nextCursor })}>{t.t('common.next')}</Button>
        </nav>
      ) : null}
    </main>
  );
}
