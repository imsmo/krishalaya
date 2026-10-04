// apps/web-tenant/src/app/governance/register/import/[id]/act/page.tsx · W2626 confirm → W2627 success / W2628 failure for the register
// import's acts — PC-56 TENANT-SW-d. The confirm screen names the object (how many lines will be written, how many skipped) and what the
// act does; "Retry" is DECOR (a re-read of the import, never a re-send).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { RegisterImport } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator } from '../../../../../../lib/i18n';
import { REASON_MAX, REASON_MIN, importActHref, importHref, isImportAct, swdCodeKey, swdPageState } from '../../../../../../features/swd/console';
import { parseCodes } from '../../../../../../features/swc/console';
import { importActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.import.title'), robots: { index: false, follow: false } };
}

export default async function ImportActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(importHref(params.id));
  const t = getTranslator();
  const act = isImportAct(searchParams.act) ? searchParams.act : 'retry';
  const step = ['confirm', 'success', 'failure'].includes(searchParams.step ?? '') ? searchParams.step! : 'confirm';
  let imp: RegisterImport | null = null; let state: string | null = null;
  try { imp = await tenantClient().registerImports.get(params.id); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status, true); }
  const codes = parseCodes(searchParams.error);

  return (
    <section>
      <nav className="kv-field__hint"><Link href={importHref(params.id)} className="kv-btn--link">{t.t('swd.import.previewTitle')}</Link> › {t.t(`swd.import.act.${act}`)}</nav>
      <h1>{t.t(`swd.import.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(`mutate.step.${step}`)}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p></div>}
      {act === 'retry' && <p><Link href={importHref(params.id)} className="kv-btn kv-btn--secondary">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}

      {imp && act !== 'retry' && step === 'confirm' && (
        <form action={importActAction} className="kv-form kv-form__card">
          <input type="hidden" name="id" value={imp.id} /><input type="hidden" name="act" value={act} /><input type="hidden" name="key" value={randomUUID()} />
          <p>{t.t(`swd.import.confirm.${act}`, { valid: imp.validCount, errors: imp.errorCount, dup: imp.duplicateCount })}</p>
          {act !== 'confirm' && (
            <label className="kv-field" htmlFor="imp-reason"><span>{t.t('swd.field.reason')}</span>
              <textarea id="imp-reason" name="reason" className="kv-textarea" rows={3} minLength={REASON_MIN} maxLength={REASON_MAX} required /></label>
          )}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t(`swd.import.act.${act}`)}</button>{' '}
          <Link href={importHref(imp.id)} className="kv-btn--link">{t.t('swd.chain.cancel')}</Link>
        </form>
      )}
      {step === 'success' && <p className="kv-card kv-success" role="status">{t.t(`swd.import.done.${act}`)} <Link href={importHref(params.id)} className="kv-btn--link">{t.t('swd.chain.back')}</Link></p>}
      {step === 'failure' && (
        <div className="kv-error" role="alert"><strong>{t.t('swd.chain.failure')}</strong>
          <ul className="kv-list">{(codes.length ? codes : ['unknown']).map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul>
          <p>{t.t('swd.chain.untouched')} <Link href={importActHref(params.id, act)} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> · <Link href={importHref(params.id)} className="kv-btn--link">{t.t('swd.chain.back')}</Link></p>
        </div>
      )}
    </section>
  );
}
