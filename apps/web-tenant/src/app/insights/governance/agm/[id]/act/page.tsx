// apps/web-tenant/src/app/insights/governance/agm/[id]/act/page.tsx · the pack's mutate chain (W2475 confirm → W2476 success / W2477
// failure) — PC-56 TENANT-SW-d. The confirm screen says exactly what the act does to which pack (issue: which items are still refused by
// name and will print as refusals; confirm: the document becomes immutable; addendum: a NEW document that supersedes this one). "Retry"
// is DECOR — it re-reads the pack, never re-sends a mutation.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AgmPack } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator } from '../../../../../../lib/i18n';
import { REASON_MAX, REASON_MIN, agmActHref, agmItemKey, agmPackHref, isAgmAct, refusedItems, swdCodeKey, swdPageState } from '../../../../../../features/swd/console';
import { parseCodes } from '../../../../../../features/swc/console';
import { MediaUploader } from '../../../../../../components/MediaUploader';
import { agmActAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.agm.title'), robots: { index: false, follow: false } };
}
const NEEDS_REASON = new Set(['send_back', 'withdraw', 'addendum']);

export default async function AgmActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(agmPackHref(params.id));
  const t = getTranslator();
  const act = isAgmAct(searchParams.act) ? searchParams.act : 'retry';
  const step = ['confirm', 'success', 'failure'].includes(searchParams.step ?? '') ? searchParams.step! : 'confirm';
  let pack: AgmPack | null = null; let state: string | null = null;
  try { pack = await tenantClient().agmPacks.get(params.id); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status, true); }
  const codes = parseCodes(searchParams.error);
  const refused = pack ? refusedItems(pack.sections) : [];

  return (
    <section>
      <nav className="kv-field__hint"><Link href={agmPackHref(params.id)} className="kv-btn--link">{pack ? t.t('swd.agm.packTitle', { fy: pack.fiscalYearLabel }) : t.t('swd.agm.title')}</Link> › {t.t(`swd.agm.act.${act}`)}</nav>
      <h1>{t.t(`swd.agm.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(`mutate.step.${step}`)}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p></div>}

      {/* retry: DECOR — a re-read, never a re-send */}
      {act === 'retry' && <p><Link href={agmPackHref(params.id)} className="kv-btn kv-btn--secondary">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}

      {pack && act !== 'retry' && step === 'confirm' && (
        <form action={agmActAction} className="kv-form kv-form__card">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((pack) as never, VERIFY_FIELDS.agmPack)} />
          <input type="hidden" name="id" value={pack.id} /><input type="hidden" name="act" value={act} /><input type="hidden" name="key" value={randomUUID()} />
          <p>{t.t(`swd.agm.confirm.${act}`, { fy: pack.fiscalYearLabel, document: pack.documentId ?? '—' })}</p>
          {act === 'issue' && refused.length > 0 && (
            <><p className="kv-field__hint">{t.t('swd.agm.confirm.refusedList')}</p><ul className="kv-list">{refused.map((i) => <li key={i}>{t.t(agmItemKey(i))}</li>)}</ul></>
          )}
          {NEEDS_REASON.has(act) && (
            <label className="kv-field" htmlFor="agm-reason"><span>{t.t('swd.field.reason')}</span>
              <textarea id="agm-reason" name="reason" className="kv-textarea" rows={3} minLength={REASON_MIN} maxLength={REASON_MAX} required /></label>
          )}
          {(act === 'annexure' || act === 'addendum') && (<>
            <MediaUploader labels={{ add: t.t('swd.upload.add'), hint: t.t('swd.upload.hint'), uploading: t.t('swd.upload.uploading'), failed: t.t('swd.upload.failed'), remove: t.t('swd.upload.remove') }} fieldName="mediaId" single kind="document" inputId="agm-media-file" />
            <label className="kv-field" htmlFor="agm-media"><span>{t.t('swd.agm.field.auditorMediaId')}</span>
              <input id="agm-media" name="mediaId" className="kv-input" defaultValue={act === 'annexure' ? pack.auditorMediaId ?? '' : ''} pattern="[0-9a-fA-F-]{36}" /></label>
          </>)}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t(`swd.agm.act.${act}`)}</button>{' '}
          <Link href={agmPackHref(pack.id)} className="kv-btn--link">{t.t('swd.chain.cancel')}</Link>
        </form>
      )}
      {step === 'success' && (
        <p className="kv-card kv-success" role="status">{t.t(`swd.agm.done.${act}`)}{' '}
          <Link href={agmPackHref(searchParams.landed ?? params.id)} className="kv-btn--link">{t.t('swd.chain.back')}</Link></p>
      )}
      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${agmPackHref(params.id)}/act?${new URLSearchParams({ step: 'confirm', act }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert"><strong>{t.t('swd.chain.failure')}</strong>
          <ul className="kv-list">{(codes.length ? codes : ['unknown']).map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul>
          <p>{t.t('swd.chain.untouched')} <Link href={agmActHref(params.id, act)} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> · <Link href={agmPackHref(params.id)} className="kv-btn--link">{t.t('swd.chain.back')}</Link></p>
        </div>
      )}
    </section>
  );
}
