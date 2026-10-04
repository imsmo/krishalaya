// apps/web-tenant/src/app/governance/register/import/[id]/page.tsx · W2627 the import's preview — PC-56 TENANT-SW-d.
// Every line with its status; every error NAMED with its line number; phones masked (last four). The acts the import can take now:
// validated → propose (with a reason); proposed → a second tenant_admin confirms, or anyone with the verb rejects (with a reason);
// confirmed → the apply job writes the register (source = import, the batch id), idempotently.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { RegisterImport, RegisterImportLine } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { LINE_STATUSES, REGISTER_HREF, REGISTER_IMPORT_HREF, importActHref, importHref, importStatusKey, istLabel, lineStatusKey, rowErrorKey, swdPageState } from '../../../../../features/swd/console';
import type { ImportAct } from '../../../../../features/swd/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.import.title'), robots: { index: false, follow: false } };
}
const actsFor = (s: string): ImportAct[] => (s === 'validated' ? ['propose', 'reject'] : s === 'proposed' ? ['confirm', 'reject'] : s === 'failed' || s === 'confirmed' ? ['retry'] : []);

export default async function RegisterImportPreviewPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(importHref(params.id));
  const t = getTranslator(); const lang = getLang();
  const status = (LINE_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? (searchParams.status as RegisterImportLine['status']) : undefined;
  const after = Number(searchParams.after ?? 0);
  let imp: RegisterImport | null = null; let lines: RegisterImportLine[] = []; let nextAfter: number | null = null; let currency: string | null = null; let state: string | null = null;
  try {
    imp = await tenantClient().registerImports.get(params.id);
    const r = await tenantClient().registerImports.lines(params.id, { ...(Number.isInteger(after) && after > 0 ? { after } : {}), ...(status ? { status } : {}) });
    lines = r.items; nextAfter = r.nextAfterLine; currency = r.currency;
  } catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status, true); }
  const filterHref = (s?: string) => `${importHref(params.id)}${s ? `?status=${s}` : ''}`;

  return (
    <section>
      <nav className="kv-field__hint"><Link href={REGISTER_HREF} className="kv-btn--link">{t.t('reg.title')}</Link> › <Link href={REGISTER_IMPORT_HREF} className="kv-btn--link">{t.t('swd.import.title')}</Link></nav>
      <h1>{t.t('swd.import.previewTitle')}</h1>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={importHref(params.id)} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}</div>}
      {imp && (
        <>
          <p><strong>{t.t(importStatusKey(imp.status))}</strong> · {t.t('swd.import.counts', { rows: imp.rowCount, valid: imp.validCount, errors: imp.errorCount, dup: imp.duplicateCount })}</p>
          <dl className="kv-dl">
            <dt>{t.t('swd.import.field.consentKind')}</dt><dd>{t.t(`swd.import.consent.${imp.consentKind}`)} · <code>{imp.consentMediaId}</code></dd>
            <dt>{t.t('swd.import.fileSha')}</dt><dd><code style={{ overflowWrap: 'anywhere' }}>{imp.fileSha256}</code></dd>
            {imp.proposedAt && <><dt>{t.t('swd.import.proposed')}</dt><dd>{istLabel(imp.proposedAt)} · {imp.proposeReason}</dd></>}
            {imp.confirmedAt && <><dt>{t.t('swd.import.confirmed')}</dt><dd>{istLabel(imp.confirmedAt)}</dd></>}
            {imp.rejectedAt && <><dt>{t.t('swd.import.status.rejected')}</dt><dd>{istLabel(imp.rejectedAt)} · {imp.rejectReason}</dd></>}
            {imp.appliedAt && <><dt>{t.t('swd.import.status.applied')}</dt><dd>{istLabel(imp.appliedAt)} · {t.t('swd.import.appliedCounts', { applied: imp.appliedCount, skipped: imp.skippedCount })} · <code>{imp.batchId}</code></dd></>}
            {imp.failureCode && <><dt>{t.t('swd.import.status.failed')}</dt><dd><code>{imp.failureCode}</code></dd></>}
          </dl>
          {imp.status === 'confirmed' && <p className="kv-card kv-card--notice">{t.t('swd.import.applying')}</p>}
          {actsFor(imp.status).length > 0 && <p>{actsFor(imp.status).map((a) => <span key={a}><Link href={importActHref(imp!.id, a)} className={a === 'reject' || a === 'retry' ? 'kv-btn kv-btn--secondary' : 'kv-btn kv-btn--primary'}>{t.t(`swd.import.act.${a}`)}</Link>{' '}</span>)}</p>}
          {imp.status === 'proposed' && <p className="kv-field__hint">{t.t('swd.import.checkerNote')}</p>}

          <h2>{t.t('swd.import.lines')}</h2>
          <nav className="kv-tabs">
            <Link href={filterHref()} className={!status ? 'kv-tab kv-tab--active' : 'kv-tab'}>{t.t('swd.import.filter.all')}</Link>
            {LINE_STATUSES.map((s) => <Link key={s} href={filterHref(s)} className={status === s ? 'kv-tab kv-tab--active' : 'kv-tab'}>{t.t(lineStatusKey(s))}</Link>)}
          </nav>
          {lines.length === 0 ? <p className="kv-field__hint">{t.t('swd.import.noLines')}</p> : (
            <table className="kv-table"><thead><tr><th>{t.t('swd.import.col.line')}</th><th>{t.t('swd.import.col.phone')}</th><th>{t.t('swd.import.col.folio')}</th><th>{t.t('swd.import.col.shares')}</th><th>{t.t('swd.import.col.paidUp')}</th><th>{t.t('swd.import.col.status')}</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.phoneMasked}</td><td>{l.folio ?? '—'}</td><td>{l.shares ?? '—'}</td><td>{l.paidUpMinor !== null ? (currency ? formatMoneyMinor(l.paidUpMinor, currency, lang) : l.paidUpMinor) : '—'}</td>
                  <td>{t.t(lineStatusKey(l.status))}{l.errorCode && <> · {t.t(rowErrorKey(l.errorCode), { line: l.lineNo })}</>}</td></tr>))}</tbody></table>
          )}
          {nextAfter !== null && <p><Link href={`${importHref(params.id)}?${new URLSearchParams({ after: String(nextAfter), ...(status ? { status } : {}) }).toString()}`} className="kv-btn--link">{t.t('swd.more')}</Link></p>}
        </>
      )}
    </section>
  );
}
