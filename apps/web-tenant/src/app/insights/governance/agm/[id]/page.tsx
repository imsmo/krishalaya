// apps/web-tenant/src/app/insights/governance/agm/[id]/page.tsx · W199 "AGM pack" — one pack, PC-56 TENANT-SW-d.
// The section table is the pack: per item, the FIGURE the API read (never one this page computes), the METHOD that read it, or the
// refusal BY NAME. Draft → (maker) issue → (a second tenant_admin) confirm → the render job → issued: document id, the PDF's sha256, the
// content sha256 printed inside the PDF, the public verify link, the export (queued / ready). An issued pack is immutable — a correction
// is an ADDENDUM (a new document that supersedes it). The verification QR is refused by name (the text PDF writer has no image seam).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AgmPack } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import {
  AGM_HREF, agmActHref, agmActsFor, agmExportHref, agmFigure, agmItemKey, agmMethodKey, agmPackHref, agmRefusalKey, agmSectionKey, agmStatusKey,
  istLabel, refusedItems, swdPageState, verifyAgmHref,
} from '../../../../../features/swd/console';
import { AsOf } from '../../../../../components/AsOf';
import { asOfLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.agm.title'), robots: { index: false, follow: false } };
}

export default async function AgmPackPage({ params }: { params: { id: string } }) {
  await requireSession(agmPackHref(params.id));
  const t = getTranslator(); const lang = getLang();
  let pack: AgmPack | null = null; let state: string | null = null; let meId: string | null = null;
  try { pack = await tenantClient().agmPacks.get(params.id); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status, true); }
  try { meId = (await tenantClient().auth.me()).id; } catch { meId = null; }
  const money = (minor: string, currency: string | null) => (currency ? formatMoneyMinor(minor, currency, lang) : '—');
  const acts = pack ? agmActsFor(pack.status, !!meId && pack.issuedBy === meId) : [];
  const refused = pack ? refusedItems(pack.sections) : [];

  return (
    <section>
      <nav className="kv-field__hint"><Link href={AGM_HREF} className="kv-btn--link">{t.t('swd.agm.title')}</Link> › {pack?.fiscalYearLabel ?? ''}</nav>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={agmPackHref(params.id)} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}</div>}
      {pack && (
        <>
          <h1>{t.t('swd.agm.packTitle', { fy: pack.fiscalYearLabel })}{pack.addendumNo > 0 && <> · {t.t('swd.agm.addendumNo', { n: pack.addendumNo })}</>}</h1>
          {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
          <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
          <p><strong>{t.t(agmStatusKey(pack.status))}</strong> · {t.t('swd.agm.fyRange', { start: pack.fyStart, end: pack.fyEnd })} · {t.t(pack.fyBasisSource === 'tenant_setting' ? 'swd.agm.basis.ownShort' : 'swd.agm.basis.countryShort')}</p>
          <dl className="kv-dl">
            <dt>{t.t('swd.agm.draftedBy')}</dt><dd>{pack.draftedByName ?? '—'} · {istLabel(pack.assembledAt)}</dd>
            {pack.issuedBy && <><dt>{t.t('swd.agm.issuedBy')}</dt><dd>{pack.issuedByName ?? '—'} · {istLabel(pack.issueRequestedAt)}</dd></>}
            {pack.confirmedBy && <><dt>{t.t('swd.agm.confirmedBy')}</dt><dd>{pack.confirmedByName ?? '—'} · {istLabel(pack.confirmedAt)}</dd></>}
            {pack.parentDocumentId && <><dt>{t.t('swd.agm.parent')}</dt><dd><code>{pack.parentDocumentId}</code> · {pack.reason}</dd></>}
            {pack.documentId && <><dt>{t.t('swd.agm.documentId')}</dt><dd><code>{pack.documentId}</code></dd></>}
            {pack.issuedAt && <><dt>{t.t('swd.agm.issuedAt')}</dt><dd>{istLabel(pack.issuedAt)} (IST)</dd></>}
            {pack.pdfSha256 && <><dt>{t.t('swd.agm.pdfSha')}</dt><dd><code style={{ overflowWrap: 'anywhere' }}>{pack.pdfSha256}</code></dd></>}
            {pack.contentSha256 && <><dt>{t.t('swd.agm.contentSha')}</dt><dd><code style={{ overflowWrap: 'anywhere' }}>{pack.contentSha256}</code><br /><span className="kv-field__hint">{t.t('swd.agm.contentShaHint')}</span></dd></>}
            {pack.verifyPath && pack.documentId && <><dt>{t.t('swd.agm.verify')}</dt><dd><Link href={verifyAgmHref(pack.documentId)} className="kv-btn--link">{pack.verifyPath}</Link></dd></>}
            <dt>{t.t('swd.agm.qr')}</dt><dd className="kv-field__hint">{t.t('swd.agm.qrRefused')}</dd>
            <dt>{t.t('swd.agm.secondLanguage')}</dt><dd className="kv-field__hint">{t.t(`swd.go.lang.${pack.secondLanguage}`)} · {t.t('swd.agm.indicRefused')}</dd>
            {pack.exportJobId && <><dt>{t.t('swd.agm.export.title')}</dt><dd><Link href={agmExportHref(pack.exportJobId)} className="kv-btn--link">{t.t('swd.agm.export.open')}</Link></dd></>}
            {pack.exportNote && <><dt>{t.t('swd.agm.export.title')}</dt><dd className="kv-field__hint">{t.t(`swd.agm.export.note.${pack.exportNote === 'exports_plane_off' ? 'off' : 'other'}`)}</dd></>}
            {pack.supersededBy && <><dt>{t.t('swd.agm.superseded')}</dt><dd><Link href={agmPackHref(pack.supersededBy)} className="kv-btn--link">{t.t('swd.agm.openAddendum')}</Link></dd></>}
            {pack.withdrawnAt && <><dt>{t.t('swd.agm.status.withdrawn')}</dt><dd>{istLabel(pack.withdrawnAt)} · {pack.withdrawReason}</dd></>}
          </dl>
          {pack.status === 'issuing' && (
            <div className={pack.renderError ? 'kv-error' : 'kv-card kv-card--notice'} role="status">
              <p>{t.t(pack.renderError ? 'swd.agm.renderFailed' : 'swd.agm.rendering', { n: pack.renderAttempts })}</p>
              {pack.renderError && <p className="kv-field__hint"><code>{pack.renderError}</code></p>}
              <p><Link href={agmPackHref(pack.id)} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>
            </div>
          )}

          <h2>{t.t('swd.agm.sections')}</h2>
          <table className="kv-table"><thead><tr><th>{t.t('swd.agm.col.section')}</th><th>{t.t('swd.agm.col.item')}</th><th>{t.t('swd.agm.col.figure')}</th><th>{t.t('swd.agm.col.method')}</th></tr></thead>
            <tbody>{pack.sections.map((s) => {
              const fig = agmFigure(s, money);
              return (
                <tr key={`${s.section}.${s.item}`}>
                  <td>{t.t(agmSectionKey(s.section))}</td>
                  <td>{t.t(agmItemKey(s.item))}</td>
                  <td>{fig ? t.t(fig.key, fig.vars) : <span className="kv-badge kv-badge--muted">{t.t('swd.agm.refusedBy')} {t.t(agmRefusalKey(s.refusalCode))} <code>{s.refusalCode}</code></span>}</td>
                  <td>{t.t(agmMethodKey(s.item))}<br /><span className="kv-field__hint">{s.method}</span></td>
                </tr>);
            })}</tbody></table>
          {refused.length > 0 && pack.status === 'draft' && <p className="kv-field__hint">{t.t('swd.agm.refusedCount', { n: refused.length })}</p>}

          {acts.length > 0 && (
            <p>{acts.map((a) => <span key={a}><Link href={agmActHref(pack!.id, a)} className={a === 'issue' || a === 'confirm' ? 'kv-btn kv-btn--primary' : 'kv-btn kv-btn--secondary'}>{t.t(`swd.agm.act.${a}`)}</Link>{' '}</span>)}</p>
          )}
          {pack.status === 'proposed' && <p className="kv-field__hint">{t.t('swd.agm.checkerNote')}</p>}
        </>
      )}
    </section>
  );
}
