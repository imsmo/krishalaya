// apps/web-ops/src/components/ops1/KioskViews.tsx · PC-56 OPS-1c · W380–W389 — THE KIOSK, presentational (founder Q4-A′, Q6-A, Q8-A, Q9-A,
// Q10-A, Q11-A). The desk creates an account for a new number; everything after that she does herself, in her own sign-in, on her own phone.
//   • KioskHomeView (W380, /kiosk/home) — a READ of the signed-in person's OWN ambassador profile (`GET /v1/ambassadors/me`) as two separate
//     facts (kiosk mode; training recorded) and her newest earning rows as the server returns them (`/me/earnings` — rows, no total; none is
//     computed here). The honest states: no ambassador profile here (most staff are tenant administrators); the programme switched off.
//     Links to every step W381–W389.
//   • KioskStartView (W381, /kiosk/session-start; and the W3329 confirm state) — THE ONE FORM of the slice: phone, name, language (the
//     platform registry's list), posted to the create act. The phone never enters a URL.
//   • KioskStepView (W382–W387) — HONEST, reads nothing, zero controls: what she does in her own sign-in and why the desk does not.
//   • KioskSummaryView (W388) — HONEST: what this desk did, the founder's ₹0 sentence (Q4-A′), the helpline line (Q11-A), the undo line.
//   • KioskEarningsView (W389, /kiosk/ambassador) — a READ of her own earning rows, each amount through the money formatter; no total, no
//     rate, no multiplication; no pay-run read (none is her own — the runs controller needs a payout permission).
// Every refused canon line is printed BY NAME (`Ops1Refusals`). No input on an honest view; no figure computed anywhere. No SDK import here
// (the shapes are declared locally; the pages read).
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { Ops1Surface, Tr } from '../../features/ops1/refusals';
import { parseKioskReason, KIOSK_BANK, KIOSK_EARNINGS, KIOSK_HOME, KIOSK_KYC, KIOSK_LAND, KIOSK_LISTING, KIOSK_PROFILE, KIOSK_SCHEMES, KIOSK_START, KIOSK_STEPS, KIOSK_SUMMARY, earningPaid, type KioskReadState } from '../../features/ops1/kiosk';
import { Ops1Chain, Ops1Refusals } from './Ops1Chain';

/** The profile fields this console prints, as `GET /v1/ambassadors/me` returns them. */
export interface KioskProfileView { tierId?: string | null; kioskEnabled?: boolean; trainingCompletedAt?: string | null; isActive?: boolean }
/** One earning row as `GET /v1/ambassadors/me/earnings` returns it (amount in minor units, a digit string). */
export interface KioskEarningView { id?: string; eventCode?: string; amountMinor?: string; payoutId?: string | null; createdAt?: string }
export type KioskFormAction = string | ((formData: FormData) => void | Promise<void>);
/** A language option, as the registry carries it. */
export interface KioskLanguage { code: string; nameNative: string; nameEnglish: string }

export function KioskStatement({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="kiosk">
      <h2 className="kv-card__title">{t.t('ops1.kiosk.statementTitle')}</h2>
      <p className="kv-statement" data-kv-statement="ops1.kiosk.statement">{t.t('ops1.kiosk.statement')}</p>
    </div>
  );
}

/** An earning's label: the platform's own stream code through its i18n label, or the code itself when no label exists (never a canon code). */
const eventLabel = (t: Tr, code: string | undefined) => {
  if (!code) return t.t('ops1.kiosk.none');
  const k = `ops1.kiosk.event.${code}`; const v = t.t(k);
  return v === k ? code : v;
};
const when = (lang: string, iso: string | null | undefined, t: Tr) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) : t.t('ops1.kiosk.none'));

function EarningsTable({ t, lang, rows }: { t: Tr; lang: string; rows: readonly KioskEarningView[] }) {
  return (
    <table className="kv-table" data-kv-rows="kiosk_earnings">
      <thead><tr><th>{t.t('ops1.kiosk.earnings.colWhen')}</th><th>{t.t('ops1.kiosk.earnings.colEvent')}</th><th>{t.t('ops1.kiosk.earnings.colAmount')}</th><th>{t.t('ops1.kiosk.earnings.colPaid')}</th></tr></thead>
      <tbody>
        {rows.map((e, i) => (
          <tr key={e.id ?? i} data-kv-earning={e.id ?? String(i)}>
            <td>{when(lang, e.createdAt, t)}</td>
            <td>{eventLabel(t, e.eventCode)}</td>
            <td>{e.amountMinor && /^\d+$/.test(e.amountMinor) ? formatMoneyMinor(e.amountMinor, 'INR', lang) : t.t('ops1.kiosk.none')}</td>
            <td>{t.t(earningPaid(e) ? 'ops1.kiosk.earnings.paidYes' : 'ops1.kiosk.earnings.paidNo')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StateNote({ t, state, page }: { t: Tr; state: Exclude<KioskReadState, 'ok'>; page: string }) {
  return (
    <div className="kv-card" role={state === 'error' ? 'alert' : 'note'} data-kv-empty={state}>
      <p>{t.t(`ops1.kiosk.state.${state}`)}</p>
      {state === 'error' && <p className="kv-pager"><Link className="kv-btn--link" href={page} data-kv-reread={page}>{t.t('ops1.kiosk.reread')}</Link></p>}
    </div>
  );
}

export function KioskHomeView({ t, lang, state, profile, earnings }: { t: Tr; lang: string; state: KioskReadState; profile: KioskProfileView | null; earnings: readonly KioskEarningView[] }) {
  return (
    <section data-kv-ops1="kiosk_home" data-kv-state={state}>
      <h1>{t.t('ops1.kiosk.home.title')}</h1>
      <p className="kv-muted">{t.t('ops1.kiosk.home.lead')}</p>
      <KioskStatement t={t} />
      <div className="kv-card" data-kv-profile="kiosk_home">
        <h2 className="kv-card__title">{t.t('ops1.kiosk.home.profileTitle')}</h2>
        {state === 'ok' && profile ? (
          <>
            <p data-kv-fact="active">{t.t(profile.isActive === false ? 'ops1.kiosk.home.inactive' : 'ops1.kiosk.home.active')}</p>
            <p data-kv-fact="kiosk">{t.t(profile.kioskEnabled === true ? 'ops1.kiosk.home.kioskOn' : 'ops1.kiosk.home.kioskOff')}</p>
            <p data-kv-fact="training">{profile.trainingCompletedAt ? t.t('ops1.kiosk.home.trainingOn', { date: when(lang, profile.trainingCompletedAt, t) }) : t.t('ops1.kiosk.home.trainingOff')}</p>
            <p data-kv-fact="tier">{t.t(profile.tierId ? 'ops1.kiosk.home.tierSet' : 'ops1.kiosk.home.tierNone')}</p>
            <p className="kv-field__hint" data-kv-fact="two">{t.t('ops1.kiosk.home.twoFacts')}</p>
          </>
        ) : <StateNote t={t} state={state === 'ok' ? 'error' : state} page={KIOSK_HOME} />}
      </div>
      {state === 'ok' && (
        <div className="kv-card" data-kv-earnings="kiosk_home">
          <h2 className="kv-card__title">{t.t('ops1.kiosk.home.earningsTitle')}</h2>
          <p className="kv-field__hint">{t.t('ops1.kiosk.home.earningsLead')}</p>
          {earnings.length > 0 ? <EarningsTable t={t} lang={lang} rows={earnings} /> : <p className="kv-empty-state" data-kv-empty="earnings">{t.t('ops1.kiosk.earnings.empty')}</p>}
        </div>
      )}
      <div className="kv-card" data-kv-steps="kiosk_home">
        <h2 className="kv-card__title">{t.t('ops1.kiosk.home.stepsTitle')}</h2>
        <p className="kv-field__hint">{t.t('ops1.kiosk.home.stepsLead')}</p>
        <ol className="kv-steps">
          {KIOSK_STEPS.map((s) => <li key={s.id}><Link href={s.href} className="kv-link" data-kv-step={s.id}>{t.t(`ops1.kiosk.step.${s.id}`)}</Link></li>)}
        </ol>
      </div>
      <Ops1Refusals t={t} surface="kiosk_home" />
    </section>
  );
}

/** W381 (mode 'page') and the W3329 confirm state (mode 'confirm'): the same single form, under the page's words or the confirm sentence. */
export function KioskStartView({ t, mode, action, languages }: { t: Tr; mode: 'page' | 'confirm'; action: KioskFormAction; languages: readonly KioskLanguage[] }) {
  const confirm = mode === 'confirm';
  return (
    <section data-kv-ops1="kiosk_start" data-kv-state={confirm ? 'confirm' : 'form'} {...(confirm ? { 'data-kv-chain': 'kiosk_act', 'data-kv-chain-state': 'confirm' } : {})}>
      <h1>{confirm ? t.t('ops1.chain.kioskAct.confirm.title') : t.t('ops1.kiosk.start.title')}</h1>
      <KioskStatement t={t} />
      <p className="kv-muted">{confirm ? t.t('ops1.chain.kioskAct.confirm.body') : t.t('ops1.kiosk.start.lead')}</p>
      <form action={action} className="kv-card kv-form" data-kv-form="kiosk_start">
        <div className="kv-field">
          <label htmlFor="k-phone" className="kv-field__label">{t.t('ops1.kiosk.start.phone')}</label>
          <input id="k-phone" name="phone" className="kv-input" inputMode="tel" autoComplete="off" required aria-describedby="k-phone-hint" />
          <p id="k-phone-hint" className="kv-field__hint">{t.t('ops1.kiosk.start.phoneHint')}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="k-name" className="kv-field__label">{t.t('ops1.kiosk.start.name')}</label>
          <input id="k-name" name="fullName" className="kv-input" maxLength={120} autoComplete="off" />
        </div>
        <div className="kv-field">
          <label htmlFor="k-lang" className="kv-field__label">{t.t('ops1.kiosk.start.lang')}</label>
          <select id="k-lang" name="languageCode" className="kv-select" aria-describedby="k-lang-hint">
            {languages.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.nameNative === l.nameEnglish ? l.nameNative : `${l.nameNative} · ${l.nameEnglish}`}</option>)}
          </select>
          <p id="k-lang-hint" className="kv-field__hint">{t.t('ops1.kiosk.start.langHint')}</p>
        </div>
        <div className="kv-form__actions">
          <button type="submit" className="kv-btn" data-kv-act="create">{t.t('ops1.kiosk.start.submit')}</button>
        </div>
      </form>
      <p className="kv-field__hint" data-kv-fact="after">{t.t('ops1.kiosk.start.after')}</p>
      <p className="kv-pager">
        {confirm
          ? <Link className="kv-btn kv-btn--muted" href={KIOSK_START} data-kv-back={KIOSK_START}>{t.t('ops1.chain.back')}</Link>
          : <Link className="kv-btn--link" href={KIOSK_HOME} data-kv-real="home">{t.t('ops1.kiosk.start.homeLink')}</Link>}
      </p>
      <Ops1Refusals t={t} surface={confirm ? 'kiosk_act' : 'kiosk_start'} />
    </section>
  );
}

/** The honest step pages W382–W387: their surface and key stem; `reread` marks the four canon "Retry" pages that become a plain re-read link. */
export const KIOSK_STEP_PAGES = {
  kiosk_profile: { stem: 'profile', href: KIOSK_PROFILE, reread: true },
  kiosk_land: { stem: 'land', href: KIOSK_LAND, reread: false },
  kiosk_kyc: { stem: 'kyc', href: KIOSK_KYC, reread: true },
  kiosk_bank: { stem: 'bank', href: KIOSK_BANK, reread: false },
  kiosk_listing: { stem: 'listing', href: KIOSK_LISTING, reread: true },
  kiosk_schemes: { stem: 'schemes', href: KIOSK_SCHEMES, reread: false },
} as const;
export type KioskStepSurface = keyof typeof KIOSK_STEP_PAGES;

export function KioskStepView({ t, surface }: { t: Tr; surface: KioskStepSurface }) {
  const p = KIOSK_STEP_PAGES[surface];
  const k = `ops1.kiosk.${p.stem}`;
  return (
    <section data-kv-ops1={surface} data-kv-state="honest">
      <h1>{t.t(`${k}.title`)}</h1>
      <div className="kv-card" data-kv-statement={surface}>
        <p className="kv-statement" data-kv-statement={`${k}.statement`}>{t.t(`${k}.statement`)}</p>
        <p data-kv-fact="why">{t.t(`${k}.why`)}</p>
      </div>
      <KioskStatement t={t} />
      <p className="kv-pager" data-kv-links={surface}>
        <Link className="kv-btn--link" href={KIOSK_HOME} data-kv-real="home">{t.t('ops1.kiosk.start.homeLink')}</Link>{' '}
        {surface === 'kiosk_profile' && <><Link className="kv-btn" href={KIOSK_START} data-kv-real="start">{t.t('ops1.kiosk.step.start')}</Link>{' '}</>}
        {p.reread && <Link className="kv-btn--link" href={p.href} data-kv-reread={p.href}>{t.t('ops1.kiosk.reread')}</Link>}
      </p>
      <Ops1Refusals t={t} surface={surface as Ops1Surface} />
    </section>
  );
}

export function KioskSummaryView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="kiosk_summary" data-kv-state="honest">
      <h1>{t.t('ops1.kiosk.summary.title')}</h1>
      <p className="kv-muted">{t.t('ops1.kiosk.summary.lead')}</p>
      <div className="kv-card" data-kv-statement="kiosk_summary">
        <p className="kv-statement" data-kv-fact="did">{t.t('ops1.kiosk.summary.did')}</p>
        <p data-kv-fact="pay">{t.t('ops1.kiosk.summary.pay')}</p>
        <p data-kv-fact="helpline">{t.t('ops1.kiosk.summary.helpline')}</p>
        <p data-kv-fact="undo">{t.t('ops1.kiosk.summary.undo')}</p>
      </div>
      <KioskStatement t={t} />
      <p className="kv-pager" data-kv-links="kiosk_summary"><Link className="kv-btn--link" href={KIOSK_HOME} data-kv-real="home">{t.t('ops1.kiosk.start.homeLink')}</Link></p>
      <Ops1Refusals t={t} surface="kiosk_summary" />
    </section>
  );
}

export function KioskEarningsView({ t, lang, state, rows }: { t: Tr; lang: string; state: KioskReadState; rows: readonly KioskEarningView[] }) {
  return (
    <section data-kv-ops1="kiosk_earnings" data-kv-state={state}>
      <h1>{t.t('ops1.kiosk.earnings.title')}</h1>
      <p className="kv-muted">{t.t('ops1.kiosk.earnings.lead')}</p>
      {state === 'ok'
        ? (rows.length > 0 ? <EarningsTable t={t} lang={lang} rows={rows} /> : <p className="kv-empty-state" data-kv-empty="earnings">{t.t('ops1.kiosk.earnings.empty')}</p>)
        : <StateNote t={t} state={state} page={KIOSK_EARNINGS} />}
      <div className="kv-card" data-kv-notes="kiosk_earnings">
        <p data-kv-note="no-total">{t.t('ops1.kiosk.earnings.noTotal')}</p>
        <p data-kv-note="runs">{t.t('ops1.kiosk.earnings.runs')}</p>
        <p data-kv-note="managers">{t.t('ops1.kiosk.earnings.managers')}</p>
      </div>
      <p className="kv-pager"><Link className="kv-btn--link" href={KIOSK_HOME} data-kv-real="home">{t.t('ops1.kiosk.start.homeLink')}</Link>{' '}<Link className="kv-btn--link" href={KIOSK_SUMMARY} data-kv-real="summary">{t.t('ops1.kiosk.step.summary')}</Link></p>
      <Ops1Refusals t={t} surface="kiosk_earnings" />
    </section>
  );
}

/** W3330 — the create act answered 201: "An account exists for this number; she signs in on her own phone", and a link to what to tell her. */
export function KioskSuccessView({ t }: { t: Tr }) {
  return (
    <Ops1Chain t={t} chain="kiosk_act" state="success">
      <p className="kv-pager"><Link className="kv-btn--link" href={KIOSK_SUMMARY} data-kv-real="summary">{t.t('ops1.kiosk.success.summaryLink')}</Link></p>
    </Ops1Chain>
  );
}
/** W3331 — "Nothing was created" with the NAMED reason, parsed from the URL through `parseKioskReason` (an injected value is never echoed).
 *  It is handed the whole query on purpose: whatever else a URL carries (a name, a phone) is never printed — the reason code is all it reads. */
export function KioskFailureView({ t, searchParams }: { t: Tr; searchParams: Record<string, string | string[] | undefined> | undefined }) {
  const reason = parseKioskReason(searchParams);
  return (
    <Ops1Chain t={t} chain="kiosk_act" state="failure">
      <p className="kv-error" role="alert" data-kv-reason={reason}><strong>{t.t('ops1.kiosk.reasonLabel')}</strong> {t.t(`ops1.kiosk.reason.${reason}`)}</p>
    </Ops1Chain>
  );
}
