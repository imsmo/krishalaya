// apps/web-admin/src/app/support/escalation/page.tsx · the SLA MATRIX (PC-56 ADMIN-2, canon W054).
//
// THE CANON SHOWS AN EDITABLE MATRIX WITH AN ESCALATION CHAIN. Half of that exists and half does not, and this page is
// careful about which is which:
//   • THE SLA TARGETS ARE REAL. They live in code (`domain/sla.ts`, mirroring apps/api's support-ticket entity) and are
//     applied to every ticket the moment it is opened. The page shows THOSE numbers — the ones the platform actually
//     enforces — rather than an empty form implying they are configurable here.
//   • THE ESCALATION CHAIN DOES NOT EXIST. Who is paged at breach, at +30 minutes, at +2 hours: nothing stores it. So
//     the page says so plainly instead of drawing an empty chain, because an operator reading a blank chain would
//     conclude nobody gets paged — which is true today, and worth stating in words rather than by omission.
//   • THE MATRIX IS CHECKED, NOT ASSUMED. If P1 ever had less time than P0, every ticket would be mis-prioritised and
//     nothing would say so. The page verifies the ordering and shouts if it is wrong.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { humanMinutes, matrixIsCoherent, type SlaRow } from '../../../features/support/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('esc.title'), robots: { index: false, follow: false } };
}

interface MatrixView {
  severities: SlaRow[]; source: string; sourceNote: string;
  escalationChainConfigured: boolean; escalationChainNote: string;
}

export default async function EscalationMatrixPage() {
  requireAdmin();
  const t = getTranslator();

  let view: MatrixView | null = null; let notice: string | undefined;
  try { view = (await adminGet<MatrixView>('support/sla-matrix')).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const rows = view?.severities ?? [];
  const coherent = matrixIsCoherent(rows);

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('esc.title')}</h1>
      <p className="kv-field__hint">{t.t('esc.hint')}</p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        <p className="kv-empty">{t.t('esc.none')}</p>
      ) : (
        <>
          {/* An incoherent matrix would mis-prioritise every ticket, silently. */}
          {!coherent && <p className="kv-error" role="alert">{t.t('esc.incoherent')}</p>}

          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('esc.severity')}</th>
              <th scope="col">{t.t('esc.firstResponse')}</th>
              <th scope="col">{t.t('esc.resolution')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.severity}>
                  <td><span className="kv-status">{r.severity}</span></td>
                  <td>{humanMinutes(r.firstResponseMinutes)}</td>
                  <td>{humanMinutes(r.resolutionMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Where these numbers come from — said plainly, because the canon implies they are editable here. */}
          <p className="kv-notice" role="note">{t.t('esc.sourceNote')}</p>

          <h2>{t.t('esc.chainTitle')}</h2>
          {view?.escalationChainConfigured ? (
            <p className="kv-empty">{t.t('esc.chainEmpty')}</p>
          ) : (
            // NOT an empty chain diagram: a blank chain would be read as "nobody is paged", which is true and deserves
            // words rather than white space.
            <p className="kv-error" role="alert">{t.t('esc.chainMissing')}</p>
          )}
          <p className="kv-field__hint">{t.t('esc.chainNote')}</p>
        </>
      )}
    </section>
  );
}
