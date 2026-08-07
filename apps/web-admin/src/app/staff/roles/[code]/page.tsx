// apps/web-admin/src/app/staff/roles/[code]/page.tsx · W105's drill-in (PC-56 ADMIN-9).
//
// THE REVERSE READ, and the question an auditor actually arrives with. "What can this role do" takes a column-scan of
// 57 rows; "who can approve a payout" is one glance — and it is the form the question takes after an incident.
//
// AN UNKNOWN CODE IS NOT AN EMPTY HOLDER LIST. "No role holds this" is a gap in a least-privilege catalogue; "this is
// not a permission" is a typo. Rendering both as an empty table would let somebody conclude a permission is safely
// ungranted when they have in fact misspelled it — the same failure this wave refuses at the restriction form.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st.holders.title'), robots: { index: false, follow: false } };
}

interface Holders { permission: string; known: boolean; direct: string[]; godMode: string[] }

export default async function PermissionHoldersPage({ params }: { params: { code: string } }) {
  requireAdmin();
  const t = getTranslator();

  let h: Holders | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Holders>(`staff/roles/permissions/${encodeURIComponent(params.code)}`);
    h = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'st.restricted.matrix' : 'st.error.matrix';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/staff">{t.t('st.roster.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/staff/roles">{t.t('st.matrix.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{params.code}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{params.code}</h1>
        <p className="kv-page__sub">{t.t('st.holders.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {h ? (
        !h.known ? (
          // A typo, said as a typo.
          <p className="kv-note is-danger" role="alert">{t.t('st.holders.unknown')}</p>
        ) : (
          <>
            <section className="kv-panel" aria-labelledby="st-direct">
              <h2 id="st-direct" className="kv-panel__title">{t.t('st.holders.direct')}</h2>
              {h.direct.length === 0 ? (
                // A gap, said as a gap: only a god-mode account can use this, so every use of it is a use of the most
                // powerful credential on the platform.
                <p className="kv-note is-warn">{t.t('st.holders.noneDirect')}</p>
              ) : (
                <ul className="kv-list">{h.direct.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
            </section>
            <section className="kv-panel" aria-labelledby="st-god">
              <h2 id="st-god" className="kv-panel__title">{t.t('st.holders.godMode')}</h2>
              <ul className="kv-list">{h.godMode.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="kv-note">{t.t('st.holders.godModeNote')}</p>
            </section>
          </>
        )
      ) : null}
    </main>
  );
}
