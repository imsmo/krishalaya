// apps/web-tenant/src/app/slot-proposal/[id]/page.tsx · the member's side of W230's proposal, through the OTP link — PC-56 TENANT-SW-e.
// No session. Shows only what the member needs: the organisation, the proposed windows, when it expires and the last digits of the phone
// the code goes to. Accepting writes the windows to the member's own pickup slots (and nothing before); declining writes nothing.
import type { Metadata } from 'next';
import { SdkError } from '@krishalaya/sdk-js';
import type { SlotLinkView } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { anonClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { failedCodes, isUuid, sweCodeKey, weekdayKey } from '../../../features/swe/console';
import { decideSlotLinkAction, sendSlotCodeAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.link.title'), robots: { index: false, follow: false } }; }

export default async function SlotLinkPage({ params, searchParams }: { params: { id: string }; searchParams: { sent?: string; error?: string; done?: string } }) {
  const t = getTranslator(); const lang = getLang();
  const id = isUuid(params.id) ? params.id : null;
  let v: SlotLinkView | null = null; let failed: 'notFound' | 'error' | null = id ? null : 'notFound';
  if (id) { try { v = await anonClient().pickupSlots.linkView(id); } catch (e) { failed = e instanceof SdkError && e.status === 404 ? 'notFound' : 'error'; } }
  const errors = failedCodes(searchParams.error);
  const done = searchParams.done === 'accepted' || searchParams.done === 'declined' ? searchParams.done : null;
  return (
    <section>
      <h1>{t.t('swe.link.title')}</h1>
      {failed && <div className={failed === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><p>{t.t(`swe.link.${failed}`)}</p></div>}
      {done && <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swe.link.done.${done}`)}</p></div>}
      {v && !done && (
        <div className="kv-card">
          <p>{t.t('swe.link.from', { org: v.organisation })}</p>
          <ul className="kv-list">{v.windows.map((w, i) => <li key={i}>{t.t(weekdayKey(w.weekday))} {w.start}–{w.end}</li>)}</ul>
          <p className="kv-field__hint">{t.t('swe.link.expires', { at: formatDate(v.expiresAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
          {errors.length > 0 && <div className="kv-error" role="alert"><ul>{errors.map((c) => <li key={c}>{t.t(sweCodeKey(c))}</li>)}</ul></div>}
          {v.status !== 'proposed' ? <p className="kv-notice">{t.t(`swe.slots.status.${v.status}`)}</p> : searchParams.sent !== '1' ? (
            <form action={sendSlotCodeAction}>
              <input type="hidden" name="id" value={id ?? ''} />
              <p>{t.t('swe.link.codeTo', { tail: v.phoneTail })}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('swe.link.send')}</button>
            </form>
          ) : (
            <form action={decideSlotLinkAction} className="kv-form">
              <input type="hidden" name="id" value={id ?? ''} />
              <label className="kv-field" htmlFor="l-code"><span>{t.t('swe.link.code')}</span>
                <input id="l-code" name="code" className="kv-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required /></label>
              <label className="kv-field" htmlFor="l-why"><span>{t.t('swe.link.declineReason')}</span>
                <input id="l-why" name="reason" className="kv-input" maxLength={300} /></label>
              <button type="submit" name="decision" value="accept" className="kv-btn kv-btn--primary">{t.t('swe.link.accept')}</button>{' '}
              <button type="submit" name="decision" value="decline" className="kv-btn">{t.t('swe.link.decline')}</button>
              <p className="kv-field__hint">{t.t('swe.link.wall')}</p>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
