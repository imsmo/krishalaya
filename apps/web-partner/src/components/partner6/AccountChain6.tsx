// apps/web-partner/src/components/partner6/AccountChain6.tsx · PC-56 PARTNER-6c — ONE chain page of every partner person's two account pages, a
// query state of its parent page (founder 6c-5):
//   • `notification_form` (`/account/notifications/preferences?form=error|review|success|failure`, W2960–W2963) — REAL: THE LANGUAGE ACT.
//     error = the code is not one of the package's live languages, nothing was set; review = the chosen language NAMED IN ITSELF (its own
//     script, `lang`-marked) and ONE button that posts it to the Server Action (the button carries the code — no other field); success = the
//     cookie is set and the page re-renders in it, naming it; failure = it could not be set, nothing changed. The canon's three other triggers
//     (Change time, Change window, Save preferences) print their refusals in every state; no state claims a confirm page;
//   • `notification_act` (`?act=` on the preferences page, W2964–W2966) — DECOR: Retry on a page that reads nothing;
//   • `notifications_act` (`?act=` on `/account/notifications`, W2967–W2969) — DECOR: "Mark all read", refused by name.
// Each state prints its page's founder-approved statement first, its own sentence, its refusals BY NAME, and ONE link back to the TRIGGERING
// page. No figure, no checkbox, no select.
import Link from 'next/link';
import type { LanguageDef } from '@krishalaya/i18n';
import type { Tr } from '../NotYet';
import { Refusals6 } from './LenderChain6';
import { chain6ById, type Chain6Id } from '../../features/partner6/refusals';
import { isPreviewLanguage } from '../../features/partner6/language';
import { choosePreviewLanguageAction } from '../../app/account/notifications/preferences/actions';

export type LanguageAct = (formData: FormData) => Promise<void>;

export function AccountChain6({ t, chain, state, chosen, current, act, previewAct = choosePreviewLanguageAction }: {
  t: Tr; chain: Chain6Id; state: string; chosen?: LanguageDef | null; current?: LanguageDef; act?: LanguageAct;
  /** PC-56 RTL-1d: the preview (machine-draft) language's OWN act — a preview choice posts there, a live one to `act` (default: the real
   *  Server Action, so the page's wiring is unchanged). */
  previewAct?: LanguageAct;
}) {
  const c = chain6ById(chain);
  const k = c.key(state);
  const href = c.page;
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {c.real === 'language' && state === 'review' && chosen && (
        <div className="kv-lang-choice" data-kv-language-review={chosen.code}>
          <p><span className="kv-muted">{t.t('partner6.language.chosen')}</span> <strong lang={chosen.code} data-kv-language-chosen={chosen.code}>{chosen.nameNative}</strong>{isPreviewLanguage(chosen) && <> <span className="kv-lang-choice__draft" data-kv-lang-draft="true">({t.t('lang.draft')})</span></>}</p>
          <form action={(isPreviewLanguage(chosen) ? previewAct : act) as never} className="kv-inline-form">
            <button type="submit" name="lang" value={chosen.code} className="kv-btn">{t.t('partner6.language.use')}</button>
          </form>
        </div>
      )}
      {c.real === 'language' && state === 'success' && current && (
        <p data-kv-language-current={current.code}><span className="kv-muted">{t.t('partner6.language.current')}</span> <strong lang={current.code}>{current.nameNative}</strong></p>
      )}
      <Refusals6 t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner6.chain.back')}</Link></p>
    </section>
  );
}
