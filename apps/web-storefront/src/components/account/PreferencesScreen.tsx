// apps/web-storefront/src/components/account/PreferencesScreen.tsx · PC-56 STORE-4c · C3 — canon W302 "Preferences & accessibility" and its REAL
// save chain (W3134 confirm → W3135 success / W3136 failure), under WHICHEVER chrome the person is in (the platform's /account/preferences and an
// organisation's /<slug>/account/preferences render THIS component — one copy, 4a's pattern; preferences are PERSON-level, founder Q13). PROTECTED.
//   • LANGUAGE (founder D3) — ONE select (the platform's active registry this site can speak); "this site and your notices use this language";
//     the account language is printed beside the site's so a mismatch is visible; the rest of the registry is the switcher's honest "coming soon";
//   • SENIOR FARMER MODE (founder D4) — the toggle posts the existing device cookie (`/api/mechanism`); "on this device" — never "everywhere";
//   • NOTIFICATIONS — the BUYER matrix (`matrix({ audience: 'buyer' })`): tiers; per event its channels as switches; a LOCKED event (the payment
//     notice, founder D1) drawn disabled and "always on"; the PROMOTIONAL group as ONE opt-in switch, OFF unless opted in, that records the
//     `marketing` consent with it (founder D2 — both halves printed); the routine rule sentence from the server;
//   • QUIET HOURS (survey C-7) — the window in force and the zone it is read in, FROM THE MATRIX (the organisation's zone, or the person's own);
//     no zone literal anywhere; the channels quiet hours hold and the ones they never hold, from the matrix;
//   • THE CHAIN — Save → `?step=review` (W3134): the SERVER's reviews (preferences: locked refused / the diff; quiet hours: the window maths and the
//     zone; language: the active registry) + the consent half; the key minted at render rides it → W3135 "saved" / W3136 the failure by name,
//     values and key kept (Retry = the same Save);
//   • the refused canon claims printed by name (features/store4c/refusals.ts).
import { randomUUID } from 'crypto';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { formatDate, formatNumber, isSupported } from '@krishalaya/i18n';
import type { NotificationMatrix, PreferenceReview, QuietWindowReview, LanguageReview } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { getSeniorMode } from '../../lib/mechanism';
import { reloadHref } from '../../features/home/load-result';
import { accountHref, chromeField, type AccountChrome } from '../../features/store4a/account';
import { channelKey, eventKey, tierKey } from '../../features/store4c/inbox';
import {
  PREFS_DRAFT_COOKIE, PREFS_ERRORS, PREFS_FAILURES, PREFS_OK, decodePrefsDraft, isBlocking, languageOptions, matrixView, readOne, readPrefsKey, refusalKey,
  windowView, zoneOptions,
} from '../../features/store4c/preferences';
import { reviewPreferencesAction, submitPreferencesAction } from '../../app/(platform)/account/preferences/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function PreferencesScreen({ chrome, searchParams }: { chrome: AccountChrome; searchParams: SP }) {
  const self = accountHref(chrome, 'preferences');
  await requireSession(self);
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  const key = readPrefsKey(searchParams.k) ?? `prefs:${randomUUID()}`;   // minted at render; the chain carries it to Save and back on Retry
  const ok = readOne(searchParams.ok, PREFS_OK);
  const error = readOne(searchParams.error, PREFS_ERRORS);
  const failure = readOne(searchParams.failure, PREFS_FAILURES);
  const failedEvent = one(searchParams.event);
  const senior = getSeniorMode();
  const label = (k: string, fallback: string) => { const v = t.t(k); return v === k ? fallback : v; };
  const eventName = (code: string, fallback?: string) => label(eventKey(code), fallback ?? code);
  const crumbs = (
    <nav aria-label={t.t('store4a.crumb.label')}>
      <ol className="kv-crumb">
        <li><Link href={accountHref(chrome)}>{t.t('account.title')}</Link></li>
        <li aria-current="page">{t.t('store4c.prefs.title')}</li>
      </ol>
    </nav>
  );

  let matrix: NotificationMatrix | null = null;
  try { matrix = await api.notifications.matrix({ audience: 'buyer' }); } catch { matrix = null; }
  if (!matrix) {
    return (
      <section className="kv-prefs" data-kv-screen="preferences" data-kv-chrome={chromeField(chrome)}>
        {crumbs}<h1>{t.t('store4c.prefs.title')}</h1>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store4c.prefs.loadError')}</p>
          <a href={reloadHref(self, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="preferences" />
      </section>
    );
  }
  const m = matrix;
  const langs = languageOptions(m, isSupported);
  const langName = (code: string | null) => (code ? m.language.active.find((l) => l.code === code)?.nameNative ?? code : null);

  /* ------------------------------------------------------------------------------------------------------------------------------ */
  /* W3134 / W3136 — THE REVIEW (the server's three reviews are the confirm)                                                         */
  /* ------------------------------------------------------------------------------------------------------------------------------ */
  const draft = one(searchParams.step) === 'review' ? decodePrefsDraft(cookies().get(PREFS_DRAFT_COOKIE)?.value, readPrefsKey(searchParams.k)) : null;
  if (draft) {
    const [pr, qr, lr] = await Promise.all([
      draft.changes.length > 0 ? api.notifications.previewPreferences(draft.changes).catch(() => null) : Promise.resolve(null as PreferenceReview | null),
      draft.quiet ? api.notifications.previewQuietHours(draft.quiet).catch(() => null) : Promise.resolve(null as QuietWindowReview | null),
      draft.language ? api.notifications.previewLanguage(draft.language).catch(() => null) : Promise.resolve(null as LanguageReview | null),
    ]);
    const reviewFailed = (draft.changes.length > 0 && !pr) || (!!draft.quiet && !qr) || (!!draft.language && !lr);
    const blocking = [...(pr?.refusals ?? []), ...(qr?.refusals ?? []), ...(lr?.refusals ?? [])].filter((r) => isBlocking(r.code));
    const cellLabel = (name: string | null) => {
      if (!name || !name.includes('::')) return null;
      const [ev, ch] = name.split('::');
      return `${eventName(ev)} · ${t.t(channelKey(ch))}`;
    };
    const at = (iso: string | null | undefined, zone: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) }) : '');
    return (
      <section className="kv-prefs" data-kv-screen="preferences-review" data-kv-chrome={chromeField(chrome)}>
        {crumbs}<h1>{t.t('store4c.review.title')}</h1>
        {failure && (
          <p className="kv-form__error" role="alert" data-kv-failure={failure}>
            {failure === 'cannot_opt_out' && failedEvent ? t.t('store4c.failure.cannot_opt_out_event', { event: eventName(failedEvent) }) : t.t(`store4c.failure.${failure}`)}
          </p>
        )}
        {reviewFailed && <p className="kv-form__error" role="alert" data-kv-state="review-error">{t.t('store4c.review.unavailable')}</p>}

        {draft.changes.length > 0 && (
          <div data-kv-review="preferences">
            <h2>{t.t('store4c.prefs.notifications')}</h2>
            {pr && (pr.diff ?? []).length > 0 && (
              <table className="kv-table" data-kv-diff={(pr.diff ?? []).length}>
                <thead><tr><th>{t.t('store4c.review.notice')}</th><th>{t.t('store4a.review.from')}</th><th>{t.t('store4a.review.to')}</th></tr></thead>
                <tbody>{(pr.diff ?? []).map((d) => (
                  <tr key={d.field} data-kv-diff-field={d.field}>
                    <td>{cellLabel(d.field) ?? d.field}</td><td>{t.t(`store4c.review.state.${d.before === 'on' ? 'on' : 'off'}`)}</td><td>{t.t(`store4c.review.state.${d.after === 'on' ? 'on' : 'off'}`)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {pr && pr.refusals.filter((r) => isBlocking(r.code)).map((r, i) => (
              <p key={i} className="kv-form__error" role="alert" data-kv-refused={r.code}>{cellLabel(r.field) ? `${cellLabel(r.field)} — ` : ''}{t.t(refusalKey(r.code))}</p>
            ))}
          </div>
        )}
        {draft.consent !== null && (
          <p data-kv-review="consent" data-kv-consent={draft.consent ? 'grant' : 'withdraw'}>{t.t(draft.consent ? 'store4c.review.consentGrant' : 'store4c.review.consentWithdraw')}</p>
        )}
        {draft.quiet && (
          <div data-kv-review="quiet">
            <h2>{t.t('store4c.quiet.title')}</h2>
            {qr && (
              <dl className="kv-detail__facts">
                <div><dt>{t.t('store4c.quiet.window')}</dt><dd data-kv-window>{qr.stored.starts?.slice(0, 5) ?? draft.quiet.starts} – {qr.stored.ends?.slice(0, 5) ?? draft.quiet.ends}</dd></div>
                <div><dt>{t.t('store4c.quiet.zone')}</dt><dd data-kv-zone={qr.maths.zone ?? ''}>{qr.maths.zone ?? t.t('store4c.quiet.noZone')}{qr.maths.zoneFromTenant ? ` · ${t.t('store4c.quiet.zoneFromOrg')}` : ''}</dd></div>
                <div><dt>{t.t('store4c.quiet.length')}</dt><dd data-kv-length={qr.maths.lengthMinutes}>{t.t('store4c.quiet.lengthValue', { h: formatNumber(Math.floor(qr.maths.lengthMinutes / 60), lang), m: formatNumber(qr.maths.lengthMinutes % 60, lang) })}{qr.maths.crossesMidnight ? ` · ${t.t('store4c.quiet.overnight')}` : ''}</dd></div>
                {qr.maths.next && <div><dt>{t.t('store4c.quiet.next')}</dt><dd data-kv-next-window>{at(qr.maths.next.start, qr.maths.zone)} – {at(qr.maths.next.end, qr.maths.zone)}</dd></div>}
              </dl>
            )}
            {qr && qr.refusals.filter((r) => isBlocking(r.code)).map((r, i) => <p key={i} className="kv-form__error" role="alert" data-kv-refused={r.code}>{t.t(refusalKey(r.code))}</p>)}
          </div>
        )}
        {draft.language && (
          <div data-kv-review="language">
            <h2>{t.t('store4c.lang.title')}</h2>
            <p data-kv-language={draft.language}>{t.t('store4c.review.languageTo', { language: langName(draft.language) ?? draft.language })}</p>
            {lr && !lr.tenantSpeaks && <p className="kv-detail__muted" data-kv-tenant-speaks="false">{t.t('store4c.review.languageNotDeclared')}</p>}
            {lr && lr.refusals.filter((r) => isBlocking(r.code)).map((r, i) => <p key={i} className="kv-form__error" role="alert" data-kv-refused={r.code}>{t.t(refusalKey(r.code))}</p>)}
          </div>
        )}
        <p className="kv-detail__muted" data-kv-audit>{t.t('store4c.review.audit')}</p>
        {blocking.length === 0 && !reviewFailed ? (
          <form action={submitPreferencesAction} className="kv-inline-form">
            <input type="hidden" name="chrome" value={chromeField(chrome)} />
            <input type="hidden" name="key" value={draft.key} />
            <button type="submit" className="kv-btn" data-kv-submit>{t.t(failure ? 'store4c.review.retry' : 'store4c.review.save')}</button>
          </form>
        ) : (
          <p className="kv-detail__muted" data-kv-state="blocked">{t.t('store4c.review.fixFirst')}</p>
        )}
        <Link href={accountHref(chrome, 'preferences', { k: draft.key })} className="kv-btn--link" data-kv-back="form">{t.t('store4c.review.back')}</Link>
        <RefusalList surface="preferences" />
      </section>
    );
  }

  /* ------------------------------------------------------------------------------------------------------------------------------ */
  /* W302 — THE PAGE                                                                                                                 */
  /* ------------------------------------------------------------------------------------------------------------------------------ */
  const view = matrixView(m);
  const win = windowView(m);
  const zones = zoneOptions(m);
  const ownZone = m.quietHours.own?.timezone ?? null;
  const zoneChoice = win.source === 'own' && ownZone && ownZone !== m.quietHours.tenantZone ? ownZone : '';
  const accountLang = m.language.current;
  return (
    <section className="kv-prefs" data-kv-screen="preferences" data-kv-chrome={chromeField(chrome)}>
      {crumbs}<h1>{t.t('store4c.prefs.title')}</h1>
      {ok && <p className="kv-form__notice" role="status" data-kv-ok={ok}>{t.t('store4c.ok.saved')}</p>}
      {error && <p className="kv-form__error" role="alert" data-kv-error={error}>{t.t(`store4c.error.${error}`)}</p>}

      {/* SENIOR FARMER MODE — the device cookie (founder D4) — its own small form: it is not part of the account save */}
      <h2>{t.t('store4c.senior.title')}</h2>
      <div data-kv-panel="senior" data-kv-senior={senior ? 'on' : 'off'}>
        <p>{t.t(senior ? 'store4c.senior.on' : 'store4c.senior.off')}</p>
        <form action="/api/mechanism" method="post" className="kv-inline-form" data-kv-form="senior">
          <input type="hidden" name="senior" value={senior ? 'off' : 'on'} />
          <button type="submit" className="kv-btn kv-btn--ghost" data-kv-act="senior">{t.t(senior ? 'store4c.senior.turnOff' : 'store4c.senior.turnOn')}</button>
        </form>
        <p className="kv-detail__muted">{t.t('store4c.senior.deviceOnly')}</p>
      </div>

      <form action={reviewPreferencesAction} className="kv-form kv-prefs__form" data-kv-form="preferences">
        <input type="hidden" name="chrome" value={chromeField(chrome)} />
        <input type="hidden" name="key" value={key} />

        {/* LANGUAGE — ONE answer (founder D3) */}
        <h2>{t.t('store4c.lang.title')}</h2>
        <label htmlFor="p-lang" className="kv-form__label">{t.t('store4c.lang.label')}</label>
        <select id="p-lang" name="language" className="kv-field__input" defaultValue={accountLang && langs.some((l) => l.code === accountLang) ? accountLang : lang} data-kv-language-select>
          {langs.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.nameNative}</option>)}
        </select>
        <p className="kv-detail__muted" data-kv-one-language>{t.t('store4c.lang.oneAnswer')}</p>
        <p className="kv-detail__muted" data-kv-account-language={accountLang ?? ''} data-kv-site-language={lang}>
          {t.t('store4c.lang.noticesUse', { language: langName(accountLang) ?? t.t('store4a.profile.notSet') })}
          {accountLang && accountLang !== lang ? ` ${t.t('store4c.lang.mismatch')}` : ''}
        </p>

        {/* NOTIFICATIONS — the buyer matrix (B4), locked and opt-in rows (D1 / D2) */}
        <h2>{t.t('store4c.prefs.notifications')}</h2>
        {view.tiers.map((tier) => (
          <fieldset key={tier.tier} className="kv-prefs__tier" data-kv-tier={tier.tier}>
            <legend>{t.t(tierKey(tier.tier))}</legend>
            <ul className="kv-prefs__list">
              {tier.events.map((e) => (
                <li key={e.code} className="kv-prefs__row" data-kv-event={e.code} data-kv-locked={String(e.locked)}>
                  <span className="kv-prefs__label">{eventName(e.code, e.defaultName)}</span>
                  {e.locked && <span className="kv-chip" data-kv-always-on>{t.t('store4c.prefs.alwaysOn')}</span>}
                  <span className="kv-prefs__cells">
                    {e.cells.map((c) => (
                      <label key={c.name} className="kv-prefs__cell" data-kv-cell={c.name}>
                        <input type="checkbox" name={e.locked ? undefined : 'cell'} value={c.name} defaultChecked={c.enabled} disabled={e.locked} />
                        <span>{t.t(channelKey(c.channel))}</span>
                      </label>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        {view.lockedCount > 0 && <p className="kv-detail__muted" data-kv-locked-sentence>{t.t('store4c.prefs.lockedSentence')}</p>}
        {view.promotional && (
          <fieldset className="kv-prefs__tier" data-kv-tier="promotional" data-kv-promo={view.promotional.on ? 'on' : 'off'} data-kv-consent={view.promotional.consentGranted ? 'granted' : 'none'}>
            <legend>{t.t('store4c.tier.promotional')}</legend>
            <label className="kv-prefs__cell">
              <input type="checkbox" name="promo" value="on" defaultChecked={view.promotional.on} data-kv-promo-switch />
              <span>{t.t('store4c.promo.label')}</span>
            </label>
            <p className="kv-detail__muted" data-kv-promo-sentence>{t.t('store4c.promo.sentence')}</p>
            <p className="kv-detail__muted" data-kv-consent-state>{t.t(view.promotional.consentGranted ? 'store4c.promo.consentGranted' : 'store4c.promo.consentNone')}</p>
          </fieldset>
        )}
        {m.routineRule && <p className="kv-detail__muted" data-kv-routine={m.routineRule.on ? 'on' : 'off'}>{t.t(m.routineRule.on ? 'store4c.prefs.routineOn' : 'store4c.prefs.routineOff')}</p>}

        {/* QUIET HOURS — the organisation's zone, never a literal (C-7) */}
        <h2>{t.t('store4c.quiet.title')}</h2>
        <p className="kv-detail__muted" data-kv-window-source={win.source}>
          {win.source === 'none' ? t.t('store4c.quiet.none') : t.t(win.source === 'own' ? 'store4c.quiet.inForceOwn' : 'store4c.quiet.inForceOrg', { starts: win.starts, ends: win.ends, zone: win.zone ?? t.t('store4c.quiet.noZone') })}
        </p>
        <div className="kv-prefs__qhrow">
          <div className="kv-field">
            <label htmlFor="qh-start" className="kv-field__label">{t.t('notif.quietStart')}</label>
            <input id="qh-start" name="starts" type="time" defaultValue={win.starts} className="kv-field__input" />
          </div>
          <div className="kv-field">
            <label htmlFor="qh-end" className="kv-field__label">{t.t('notif.quietEnd')}</label>
            <input id="qh-end" name="ends" type="time" defaultValue={win.ends} className="kv-field__input" />
          </div>
          <div className="kv-field">
            <label htmlFor="qh-zone" className="kv-field__label">{t.t('store4c.quiet.zone')}</label>
            <select id="qh-zone" name="zone" className="kv-field__input" defaultValue={zoneChoice} data-kv-zone-select>
              {zones.map((z) => (
                <option key={z.value || 'org'} value={z.value} data-kv-zone-kind={z.kind}>
                  {z.kind === 'organisation' ? t.t('store4c.quiet.orgZone', { zone: z.zone ?? t.t('store4c.quiet.noZone') }) : t.t('store4c.quiet.ownZone', { zone: z.zone ?? '' })}
                </option>
              ))}
            </select>
          </div>
        </div>
        {win.held.length > 0 && <p className="kv-detail__muted" data-kv-held={win.held.join(',')}>{t.t('store4c.quiet.held', { channels: win.held.map((c) => t.t(channelKey(c))).join(', ') })}</p>}
        {win.neverHeld.length > 0 && <p className="kv-detail__muted" data-kv-never-held={win.neverHeld.join(',')}>{t.t('store4c.quiet.neverHeld', { channels: win.neverHeld.map((c) => t.t(channelKey(c))).join(', ') })}</p>}
        <p className="kv-detail__muted">{t.t('store4c.quiet.critical')}</p>

        <button type="submit" className="kv-btn" data-kv-review-cta>{t.t('store4c.prefs.review')}</button>
      </form>
      <RefusalList surface="preferences" />
    </section>
  );
}
