// apps/web-tenant/src/app/people/ambassadors/ProfileForm.tsx · the fields and the review table the recruit chain
// (W2481–W2484) and the edit chain share · PC-56 TENANT-10a. Server components, no client JS: the form is a GET to its own
// page with `step=review`, so the values travel in the URL (the shared chain's "values you entered are preserved").
import type { AmbassadorReview, AmbassadorRosterRow, LookupValue, RegionNode } from '@krishalaya/sdk-js';
import type { Translator } from '@krishalaya/i18n';
import { CLUSTER_SLOTS, codeKey, fieldKey, personKey } from '../../../features/ambassadors/console';
import { nothingStoredKey, refusalsFor, generalRefusals } from '../../../features/forms/chain';

export interface ProfileFormProps {
  t: Translator; form: 'recruit' | 'edit'; action: string; values: Record<string, string>;
  tiers: LookupValue[]; regions: RegionNode[]; mentors: AmbassadorRosterRow[]; selfId?: string;
  /** the region list's parent (`under`), so a narrower list can be asked for */
  under: string | null; parents: RegionNode[];
}

export function ProfileFormFields(p: ProfileFormProps) {
  const { t, values: v } = p;
  const sel = (name: string) => v[name] ?? '';
  return (
    <>
      <form action={p.action} method="get" className="kv-card kv-form kv-filters" aria-label={t.t('amb.form.regionsNarrow')}>
        <input type="hidden" name="step" value="edit" />
        {Object.entries(v).filter(([k]) => k !== 'under' && k !== 'step').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
        <label className="kv-field" htmlFor="f-under"><span>{t.t('amb.form.regionsUnder')}</span>
          <select id="f-under" name="under" className="kv-select" defaultValue={p.under ?? ''}>
            <option value="">{t.t('amb.form.regionsTop')}</option>
            {p.parents.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
        <button type="submit" className="kv-btn--link">{t.t('amb.form.regionsShow')}</button>
      </form>

      <form action={p.action} method="get" className="kv-card kv-form">
        <input type="hidden" name="step" value="review" />
        <input type="hidden" name="clustersTouched" value="1" />
        {p.under && <input type="hidden" name="under" value={p.under} />}
        {p.form === 'recruit' && (
          <label className="kv-field" htmlFor="f-phone"><span>{t.t(fieldKey('recruit', 'phone'))}</span>
            <input id="f-phone" name="phone" className="kv-input" inputMode="tel" autoComplete="off" maxLength={20} defaultValue={sel('phone')} required />
            <span className="kv-field__hint">{t.t('amb.form.phoneHint')}</span></label>
        )}
        <label className="kv-field" htmlFor="f-tier"><span>{t.t(fieldKey(p.form, 'tierId'))}</span>
          <select id="f-tier" name="tierId" className="kv-select" defaultValue={sel('tierId')}>
            <option value="">{t.t('amb.tier.none')}</option>
            {p.tiers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
        <fieldset className="kv-fieldset">
          <legend>{t.t(fieldKey(p.form, 'clusterRegionIds'))}</legend>
          {CLUSTER_SLOTS.map((slot, i) => (
            <label key={slot} className="kv-field" htmlFor={`f-${slot}`}><span>{t.t('amb.form.clusterSlot', { n: String(i + 1) })}</span>
              <select id={`f-${slot}`} name={slot} className="kv-select" defaultValue={sel(slot)}>
                <option value="">{t.t('amb.form.clusterNone')}</option>
                {p.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
          ))}
          <p className="kv-field__hint">{t.t('amb.form.clusterHint')} {t.t('amb.refused.exclusivity')}</p>
        </fieldset>
        <label className="kv-field" htmlFor="f-mentor"><span>{t.t(fieldKey(p.form, 'mentorAmbassadorId'))}</span>
          <select id="f-mentor" name="mentorAmbassadorId" className="kv-select" defaultValue={sel('mentorAmbassadorId')}>
            <option value="">{t.t('amb.form.mentorNone')}</option>
            {p.mentors.filter((m) => m.id !== p.selfId).map((m) => { const w = personKey(m.displayName); return <option key={m.id} value={m.id}>{t.t(w.key, w.vars)} · {m.phoneMasked}</option>; })}
          </select></label>
        <label className="kv-field" htmlFor="f-kiosk"><span>{t.t(fieldKey(p.form, 'kioskEnabled'))}</span>
          <select id="f-kiosk" name="kiosk" className="kv-select" defaultValue={sel('kiosk') || '0'}>
            <option value="0">{t.t('amb.no')}</option><option value="1">{t.t('amb.yes')}</option>
          </select></label>
        <label className="kv-field" htmlFor="f-aeps"><span>{t.t(fieldKey(p.form, 'aepsEnabled'))}</span>
          <select id="f-aeps" name="aeps" className="kv-select" defaultValue={sel('aeps') || '0'}>
            <option value="0">{t.t('amb.no')}</option><option value="1">{t.t('amb.yes')}</option>
          </select></label>
        <label className="kv-field" htmlFor="f-stipend"><span>{t.t(fieldKey(p.form, 'monthlyStipendMinor'))}</span>
          <input id="f-stipend" name="stipend" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={sel('stipend')} />
          <span className="kv-field__hint">{t.t('amb.form.stipendHint')}</span></label>
        {p.form === 'edit' && (
          <>
            <label className="kv-field" htmlFor="f-training"><span>{t.t(fieldKey('edit', 'trainingCompleted'))}</span>
              <select id="f-training" name="training" className="kv-select" defaultValue={sel('training') || '0'}>
                <option value="0">{t.t('amb.form.trainingUnchanged')}</option><option value="1">{t.t('amb.form.trainingDone')}</option>
              </select></label>
            <label className="kv-field" htmlFor="f-reason"><span>{t.t('amb.form.reason')}</span>
              <textarea id="f-reason" name="reason" className="kv-textarea" rows={2} maxLength={300} defaultValue={sel('reason')} />
              <span className="kv-field__hint">{t.t('amb.form.reasonOptional')}</span></label>
          </>
        )}
        <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
      </form>
    </>
  );
}

/** W2482 — everything entered, read-only, the stored value beside it, and every refusal against its field (W2481). */
export function ReviewTable({ t, form, review, names }: { t: Translator; form: 'recruit' | 'edit'; review: AmbassadorReview; names: Record<string, string> }) {
  const general = generalRefusals(review);
  // ids are shown by the name the platform records for them (tier, region, mentor); booleans in words; money as typed paise
  const show = (field: string, v: string | null): string | null => {
    if (v === null) return null;
    if (field === 'kioskEnabled' || field === 'aepsEnabled' || field === 'trainingCompleted') return t.t(v === 'true' ? 'amb.yes' : 'amb.no');
    if (field === 'tierId' || field === 'mentorAmbassadorId' || field === 'clusterRegionIds') return v.split(',').filter(Boolean).map((id) => names[id] ?? id).join(', ') || null;
    if (field === 'monthlyStipendMinor') return t.t('amb.form.paise', { paise: v });
    return v;
  };
  return (
    <>
      {review.member && (() => { const w = personKey(review.member.displayName); return <p className="kv-card">{t.t('amb.form.memberFound', { who: t.t(w.key, w.vars), phone: review.member.phoneMasked ?? '' })}</p>; })()}
      {general.map((r) => <div key={r.code} className="kv-error" role="alert"><p>{t.t(codeKey(r.code))}</p></div>)}
      <table className="kv-table">
        <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
        <tbody>{review.fields.map((f) => {
          const bad = refusalsFor(review, f.name);
          return (
            <tr key={f.name}>
              <th scope="row">{t.t(fieldKey(form, f.name))}</th>
              <td>{show(f.name, f.entered) ?? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>}</td>
              <td>{show(f.name, f.stored) ?? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>}
                {bad.map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {review.diff === null ? <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p> : (
        <>
          <h2>{t.t('form.diff.heading')}</h2>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('amb.form.before')}</th><th scope="col">{t.t('amb.form.after')}</th></tr></thead>
            <tbody>{review.diff.map((d) => <tr key={d.field}><th scope="row">{t.t(fieldKey(form, d.field))}</th><td>{show(d.field, d.before) ?? t.t(nothingStoredKey())}</td><td>{show(d.field, d.after) ?? t.t(nothingStoredKey())}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </>
  );
}
