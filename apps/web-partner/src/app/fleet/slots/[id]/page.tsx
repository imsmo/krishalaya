// apps/web-partner/src/app/fleet/slots/[id]/page.tsx · pickup-slot detail + edit + active toggle (GET
// logistics/pickup-slots/:id; 404 → notFound). PATCH :id edits weekday + window (start<end enforced); POST
// :id/active toggles. Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { WEEKDAYS, weekdayKey, type SlotRow } from '../../../../features/logistics/fleet';
import { updateSlotAction, setSlotActiveAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('fleet.slotDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated', 'activated', 'deactivated']);
const ERR = new Set(['weekday', 'startTime', 'endTime', 'timeOrder', 'forbidden', 'conflict', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function SlotDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let s: SlotRow | undefined;
  let notice: string | undefined;
  try {
    s = (await partnerClient().request<SlotRow>('GET', `logistics/pickup-slots/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!s) {
    return <section><p className="kv-backlink"><Link href="/fleet/slots">{t.t('fleet.backSlots')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/fleet/slots">{t.t('fleet.backSlots')}</Link></p>
      <h1>{t.t(weekdayKey(s.weekday))} · {s.startTime} – {s.endTime}</h1>
      <p><span className={`kv-status kv-status--${s.isActive ? 'ok' : 'muted'}`}>{t.t(s.isActive ? 'common.active' : 'common.inactive')}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`fleet.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`fleet.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('fleet.weekday')} value={t.t(weekdayKey(s.weekday))} />
        <Field label={t.t('fleet.startTime')} value={s.startTime} />
        <Field label={t.t('fleet.endTime')} value={s.endTime} />
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('fleet.editSlot')}</summary>
        <form action={updateSlotAction} className="kv-form">
          <input type="hidden" name="id" value={s.id} />
          <label className="kv-field__label">{t.t('fleet.weekday')}</label>
          <select name="weekday" className="kv-input" defaultValue={String(s.weekday)}>{WEEKDAYS.map((d) => <option key={d} value={d}>{t.t(weekdayKey(d))}</option>)}</select>
          <label className="kv-field__label">{t.t('fleet.startTime')}</label>
          <input name="startTime" className="kv-input" type="time" defaultValue={s.startTime} required />
          <label className="kv-field__label">{t.t('fleet.endTime')}</label>
          <input name="endTime" className="kv-input" type="time" defaultValue={s.endTime} required />
          <button type="submit" className="kv-btn">{t.t('fleet.save')}</button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('fleet.activeTitle')}</summary>
        <form action={setSlotActiveAction} className="kv-inline-form">
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="isActive" value={s.isActive ? 'false' : 'true'} />
          <button type="submit" className={`kv-btn${s.isActive ? ' kv-btn--danger' : ''}`}>{t.t(s.isActive ? 'fleet.deactivate' : 'fleet.activate')}</button>
        </form>
      </details>
    </section>
  );
}
