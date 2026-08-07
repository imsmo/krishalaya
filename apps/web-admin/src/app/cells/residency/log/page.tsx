// apps/web-admin/src/app/cells/residency/log/page.tsx · W033's evidence half (PC-56 ADMIN-8b).
//
// A NEW ROUTE beside the existing /cells/residency posture report, which is correct and stays. What it could not show is
// the thing W033's own empty state promises:
//
//   "No residency violations logged. No attempt to move or access data outside its declared region has been recorded.
//    **This log fills automatically if the fail-closed boundary is ever tested.**"
//
// THERE WAS NO LOG. `TenantCellAssignmentService.move` refuses a cross-border move and fails closed — that part is
// correct and ADMIN-8 verified it — and it throws `ResidencyViolationError` and the attempt vanishes. **A fail-closed
// boundary that leaves no trace when tested is a boundary nobody can prove held**, and that sentence would have read
// identically after a hundred blocked attempts.
//
// IT MATTERS BECAUSE THE OTHER CONTROL IS AN ATTESTATION. Under DPDP the claim is "no personal data left the country" —
// a NEGATIVE, evidenced by a complete record of attempts and never by the absence of a record. Today's export would
// attest from nothing, which is why `no_evidence` is the loudest state on this page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import {
  emptyLogClass, emptyLogKey, gateClass, outcomeClass, postureClass, postureKey,
  refusalIsBoundary, refusalKey, regulationClass, regulationKey,
} from '../../../../features/cells/residency-migration';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rz.log.title'), robots: { index: false, follow: false } };
}

interface Violation {
  id: string; attemptKind: string; subjectType: string; subjectId: string;
  fromCountry: string | null; toCountry: string | null;
  refusedBy: string; outcome: string; actorAdminId: string | null;
  detail: Record<string, unknown>; createdAt: string;
}
interface Country {
  code: string; name: string; regulationProfile: string | null; regulationStatus: string;
  cells: number; activeCells: number; placedTenants: number; allLocked: boolean;
  crossBorder: string; canProvision: { ok: boolean; reason?: string };
}
interface Meta {
  nextCursor: string | null;
  countries: Country[];
  window: { from: string; to: string; days: number };
  loggingSince: string | null;
}

export default async function ResidencyLogPage({ searchParams }: {
  searchParams: { days?: string; country?: string; cursor?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const days = searchParams.days && /^\d{1,3}$/.test(searchParams.days) ? searchParams.days : undefined;
  const country = searchParams.country && /^[A-Za-z]{2}$/.test(searchParams.country)
    ? searchParams.country.toUpperCase() : undefined;

  let rows: Violation[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (days) q.set('days', days);
    if (country) q.set('country', country);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<Violation[]>(`cells/residency-log?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rz.restricted.log' : 'rz.error.log';
  }

  const withFilters = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (days) q.set('days', days);
    if (country) q.set('country', country);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/cells/residency/log?${s}` : '/cells/residency/log';
  };

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/cells/residency">{t.t('cells.residencyTitle')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rz.log.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rz.log.title')}</h1>
        <p className="kv-page__sub">{t.t('rz.log.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {/* ---------------- SINCE WHEN THE LOG CAN SPEAK ---------------- */}
      {meta ? (
        <p className={emptyLogClass(meta.loggingSince)} role={meta.loggingSince === null ? 'alert' : 'status'}>
          {meta.loggingSince === null
            ? t.t('rz.log.neverRecorded')
            : t.t('rz.log.since', { at: meta.loggingSince.slice(0, 10) })}
        </p>
      ) : null}

      {/* ---------------- COUNTRY PROFILES ---------------- */}
      {meta?.countries?.length ? (
        <section className="kv-panel" aria-labelledby="rz-countries">
          <h2 id="rz-countries" className="kv-panel__title">{t.t('rz.countries.title')}</h2>
          <table className="kv-table">
            <thead>
              <tr>
                <th scope="col">{t.t('rz.col.country')}</th>
                <th scope="col">{t.t('rz.col.profile')}</th>
                <th scope="col">{t.t('rz.col.cells')}</th>
                <th scope="col">{t.t('rz.col.tenants')}</th>
                <th scope="col">{t.t('rz.col.crossBorder')}</th>
              </tr>
            </thead>
            <tbody>
              {meta.countries.map((c) => (
                <tr key={c.code}>
                  <td>{c.code} · {c.name}</td>
                  <td>
                    <span className={regulationClass(c.regulationStatus)}>{t.t(regulationKey(c.regulationStatus))}</span>
                    {c.regulationProfile ? <><br /><small>{c.regulationProfile}</small></> : null}
                    {/* W038's market-entry gate, surfaced here too: the reason a country has no cell is a residency fact
                        before it is an infrastructure one. */}
                    {!c.canProvision.ok ? (
                      <div className={gateClass(false)}><small>{c.canProvision.reason}</small></div>
                    ) : null}
                  </td>
                  <td>{c.activeCells} / {c.cells}</td>
                  <td>{c.placedTenants.toLocaleString('en-IN')}</td>
                  <td>
                    {/* "The boundary holds" and "there is nothing here to protect" are different statements, and W033
                        renders both as "blocked". Only the second is true for a country with no cells. */}
                    <span className={postureClass(c.crossBorder)}>{t.t(postureKey(c.crossBorder))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ---------------- FILTERS ---------------- */}
      <form className="kv-filters" method="get" action="/cells/residency/log">
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="rz-days">{t.t('rz.filter.days')}</label>
          <input className="kv-input" id="rz-days" name="days" type="number" min={1} max={400}
            defaultValue={days ?? String(meta?.window.days ?? 90)} />
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="rz-country">{t.t('rz.filter.country')}</label>
          <input className="kv-input" id="rz-country" name="country" maxLength={2} defaultValue={country ?? ''} />
        </div>
        <button className="kv-btn" type="submit">{t.t('common.apply')}</button>
      </form>

      <p className="kv-note">
        <Link href={`/cells/residency/attestation${days ? `?days=${days}` : ''}`}>{t.t('rz.log.openAttestation')}</Link>
      </p>

      {/* ---------------- THE LOG ---------------- */}
      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('rz.log.empty.title')}</h2>
          {/* THE TWO EMPTY CASES ARE OPPOSITE FINDINGS and only `loggingSince` tells them apart. Inferring "nothing
              happened" from "nothing is recorded" is exactly the mistake this wave exists to stop. */}
          <p>{t.t(emptyLogKey(meta?.loggingSince ?? null))}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('rz.log.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('rz.col.when')}</th>
              <th scope="col">{t.t('rz.col.attempt')}</th>
              <th scope="col">{t.t('rz.col.subject')}</th>
              <th scope="col">{t.t('rz.col.route')}</th>
              <th scope="col">{t.t('rz.col.refusedBy')}</th>
              <th scope="col">{t.t('rz.col.outcome')}</th>
              <th scope="col">{t.t('rz.col.actor')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.slice(0, 16).replace('T', ' ')}</td>
                <td>{r.attemptKind}</td>
                <td>{r.subjectType}/{r.subjectId.slice(0, 8)}</td>
                <td>{r.fromCountry ?? '—'} → {r.toCountry ?? '—'}</td>
                <td>
                  {t.t(refusalKey(r.refusedBy))}
                  {/* Only two of the four refusals ARE the boundary. An attestation counting "the cell did not exist" as
                      protection would be claiming credit for a typo, so the distinction is on the row. */}
                  {!refusalIsBoundary(r.refusedBy) ? <><br /><small>{t.t('rz.refused.notBoundary')}</small></> : null}
                </td>
                <td><span className={outcomeClass(r.outcome)}>{t.t(`rz.outcome.${r.outcome}`)}</span></td>
                <td>{r.actorAdminId ? r.actorAdminId.slice(0, 8) : t.t('rz.actor.system')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Link className="kv-btn" href={withFilters({ cursor: meta.nextCursor })}>{t.t('common.next')}</Link>
        </nav>
      ) : null}
    </main>
  );
}
