// apps/web-storefront/src/components/account/AccessibilityScreen.tsx · PC-56 STORE-5a · C4 (founder D4 / Q17) — canon W324 "Accessibility" and
// its save chain (W3074 confirm = DELTA · W3075 success · W3076 failure), ONE screen under WHICHEVER chrome the person is in (the platform's
// /account/accessibility and an organisation's /<slug>/account/accessibility — the 4a/4c pattern). NO sign-in: the modes are THIS DEVICE's
// cookies, not the account's (founder D4: per device — "elsewhere on next open" is refused by name).
//   • three modes that STACK — Senior Farmer Mode (`kvs_senior`), High contrast (`kvs_contrast`), Calm motion (`kvs_motion`) — each its own small
//     form posting `/api/mechanism` with `chain=a11y` (no confirm: a device preference — the switch IS the save, DELTA `a11y_no_confirm`);
//   • W3075: `?a11y=saved&mode=` — the page re-rendered in the mode(s) (the root layout sets the attributes) + "Saved on this device";
//   • W3076: `?a11y=err&want=` — "Couldn't save — the previous setting still applies" + Retry re-posting the SAME values;
//   • "Always true" — only what the stylesheet proves (44px targets, 56px money actions in every mode, a visible focus ring);
//   • the phone's own settings (`prefers-contrast`, `prefers-reduced-motion`) are honoured without a switch — said;
//   • refused by name (surface `accessibility`): Voice-first, "every button speaks", "set by a helper", "applied everywhere else on next
//     open", the phone line and the short code, the seller preview sentence, the unaudited floor claims.
import Link from 'next/link';
import type { AccessibilityMode } from '@krishalaya/ui';
import { getTranslator, getLang } from '../../lib/i18n';
import { getSeniorMode, getContrastMode, getCalmMotion } from '../../lib/mechanism';
import { accountHref, chromeField, type AccountChrome } from '../../features/store4a/account';
import { formatNumber } from '@krishalaya/i18n';
import { A11Y_FLOOR, A11Y_FLOOR_PX, A11Y_MODES, modeValue, readA11yQuery } from '../../features/store5a/accessibility';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;

export function AccessibilityScreen({ chrome, searchParams }: { chrome: AccountChrome; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const on: Record<AccessibilityMode, boolean> = { senior: getSeniorMode(), contrast: getContrastMode(), motion: getCalmMotion() };
  const { status, mode, want } = readA11yQuery(searchParams);
  const active = A11Y_MODES.filter((m) => on[m]);
  return (
    <section className="kv-a11y" data-kv-screen="accessibility" data-kv-chrome={chromeField(chrome)} data-kv-active={active.join(' ') || 'none'}>
      <nav aria-label={t.t('store4a.crumb.label')}>
        <ol className="kv-crumb">
          <li><Link href={accountHref(chrome)}>{t.t('account.title')}</Link></li>
          <li aria-current="page">{t.t('store5a.a11y.crumb')}</li>
        </ol>
      </nav>
      <h1>{t.t('store5a.a11y.title')}</h1>
      <p className="kv-detail__muted">{t.t('store5a.a11y.lead')}</p>
      <p className="kv-detail__muted" data-kv-device="only">{t.t('store5a.a11y.deviceOnly')}</p>

      {status === 'saved' && (
        <p className="kv-form__notice" role="status" data-kv-a11y="saved" data-kv-saved-mode={mode ?? ''}>
          {t.t('store5a.a11y.saved')} {active.length > 1 && <span data-kv-stacked={active.length}>{t.t('store5a.a11y.stacked')}</span>}
        </p>
      )}
      {status === 'err' && (
        <div className="kv-state kv-state--error" role="alert" data-kv-a11y="err">
          <p>{t.t('store5a.a11y.failed')}</p>
          {want ? (
            <form action="/api/mechanism" method="post" className="kv-inline-form" data-kv-form="a11y-retry">
              <input type="hidden" name="chain" value="a11y" />
              <input type="hidden" name={want.mode} value={want.value} />
              <button type="submit" className="kv-btn" data-kv-act="retry" data-kv-want={`${want.mode}:${want.value}`}>{t.t('store5a.a11y.retry')}</button>
            </form>
          ) : (
            <a href={accountHref(chrome, 'accessibility')} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          )}
        </div>
      )}

      {A11Y_MODES.map((m) => (
        <div key={m} className="kv-a11y__mode" data-kv-mode={m} data-kv-on={on[m] ? 'true' : 'false'}>
          <h2>{t.t(`store5a.a11y.mode.${m}`)}</h2>
          <p><strong>{t.t(on[m] ? 'store5a.a11y.on' : 'store5a.a11y.off')}</strong></p>
          <p>{t.t(`store5a.a11y.what.${m}`)}</p>
          <form action="/api/mechanism" method="post" className="kv-inline-form" data-kv-form={`a11y-${m}`}>
            <input type="hidden" name="chain" value="a11y" />
            <input type="hidden" name={m} value={modeValue(m, !on[m])} />
            <button type="submit" className="kv-btn kv-btn--ghost" data-kv-act={m} aria-pressed={on[m]}>{t.t(on[m] ? 'store5a.a11y.turnOff' : 'store5a.a11y.turnOn')}</button>
          </form>
        </div>
      ))}

      <h2>{t.t('store5a.a11y.floorTitle')}</h2>
      <ul className="kv-a11y__floor" data-kv-floor={A11Y_FLOOR.length}>
        {A11Y_FLOOR.map((f) => <li key={f} data-kv-floor-item={f}>{t.t(`store5a.a11y.floor.${f}`, { targets: formatNumber(A11Y_FLOOR_PX.targets, lang), money: formatNumber(A11Y_FLOOR_PX.money, lang) })}</li>)}
      </ul>
      <RefusalList surface="accessibility" />
    </section>
  );
}
