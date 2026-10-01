// apps/web-tenant/src/app/content/banners/[id]/page.tsx · W174 — one banner: its words per language, its image, its
// audience and who it reaches today, its window, its place in the slot, its variants, and its acts · PC-56 TENANT-8d.
//
// W174: *"Language variants (language_code per row)"* · *"Headline (lives in record, not image)"* · *"Members see exactly
// their language. Missing variant = banner hidden for that language, never English-forced."* · *"Estimated reach: 742
// members"* · *"Publishing is recorded · reach estimate shown before every save"* · Pause · Save changes.
//
// WHAT THIS PAGE PRINTS, AND FROM WHERE (`cms.banners.get`): the words are `banner_texts` rows, one card per language —
// a REQUIRED language without words is a dashed card that says the banner cannot be activated and would be hidden for
// that language's members; the image is ONE per banner (its file name and scan status — the canon's per-language images
// are the variant GROUP, printed below as the group's other banners); the acts are the API's verdicts (allowed → the
// mutate chain; refused → every reason, e.g. "gu has no words"); the reach is the audience evaluator over the
// cooperative's members TODAY, split by the language they read (not an estimate — and who would not see it); the window
// is the cooperative's wall-clock in its zone; the slot shows the banner's place and moves it (the banners-mutate chain).
//
// REFUSED BY NAME: impressions and CTR (no reader, no counter), the member-app preview (no app renders banners — the
// cards are the stored words, never an imitation of the app), the deep link (`app://…` — no route registry), min-orders /
// KYC / cluster audiences, money-linked banners needing a live promotion (no promotion link on a banner), "voice-first"
// (not a recorded attribute — the share by language IS printed). *"Couldn't save → Retry"* (→ W2507) is the form chain's
// own retry — PARITY-DECOR. The canon's kebabs → `data-decor`.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsBannerView } from '@krishalaya/sdk-js';
import { auditHref, canLinkAudit, mutateRefusalKey } from '../../../../features/mutate/chain';
import {
  BANNERS_HREF, BANNER_MUTATE, REQUIRED_LANGUAGES, actLabelKey, bannerActHref, bannerHref, bannersTransportState, editBannerHref, headlineFor, isKnownPlacement, moveLabelKey,
  offeredActs, pageStateKey, phaseKey, placementKey, refusedActs, refusedKey, shareOf, slotMoveHref, stateKey, windowText, type BannersPageState,
} from '../../../../features/banners/banners';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('banner.title'), robots: { index: false, follow: false } };
}

export default async function BannerPage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  await requireSession(bannerHref(id));
  const t = getTranslator();
  const lang = getLang();

  let v: CmsBannerView | null = null;
  let state: BannersPageState | null = null;
  try { v = await tenantClient().cms.banners.get(id); }
  catch (e) { state = e instanceof SdkError ? bannersTransportState(e.code, e.status) : 'error'; }

  if (!v) {
    return (
      <section>
        <p className="kv-field__hint"><Link href={BANNERS_HREF} className="kv-btn--link">{t.t('banner.backToList')}</Link></p>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state ?? 'error'))}</p>
          {state === 'error' && <p><Link href={bannerHref(id)} className="kv-btn--link">{t.t('banners.retry')}</Link></p>}
        </div>
      </section>
    );
  }

  const h = headlineFor(v.texts, lang);
  const placementName = isKnownPlacement(v.placement) ? t.t(placementKey(v.placement)) : v.placement;
  const missing = new Set(v.missingLanguages);
  const rowLangs = [...REQUIRED_LANGUAGES, ...v.offeredLanguages.filter((l) => !(REQUIRED_LANGUAGES as readonly string[]).includes(l))];
  const textOf = (l: string) => v!.texts.find((x) => x.languageCode === l) ?? null;
  const refused = refusedActs(v.acts);

  return (
    <section>
      <nav aria-label={t.t('banners.breadcrumb')} className="kv-field__hint"><Link href={BANNERS_HREF} className="kv-btn--link">{t.t('banner.backToList')}</Link></nav>
      <div className="kv-page-head">
        <h1 lang={h?.lang}>{h ? h.text : t.t('banners.noWords')} <span className="kv-badge">{t.t(phaseKey(v.phase))}</span></h1>
        {v.canManage && v.state !== 'archived' && <Link href={editBannerHref(v.id)} className="kv-btn">{t.t('banner.edit')}</Link>}
      </div>
      <p className="kv-field__hint">
        {t.t('banner.headLine', { placement: placementName, window: windowText(v.startsLocal, v.endsLocal), zone: v.timezone, clicks: formatNumber(v.clickCount, lang) })}
      </p>
      <p className="kv-field__hint">{t.t(refusedKey('impressions'))}</p>
      {v.state === 'paused' && v.pausedReason && <div className="kv-card kv-card--notice" role="status"><p>{t.t('banner.pausedBecause', { reason: v.pausedReason, who: v.who.pausedBy ?? t.t('banner.someone') })}</p></div>}
      {v.state === 'archived' && v.archivedReason && <div className="kv-card kv-card--notice" role="status"><p>{t.t('banner.archivedBecause', { reason: v.archivedReason, who: v.who.archivedBy ?? t.t('banner.someone') })}</p></div>}

      {/* ---- THE ACTS, as the API judged them ---- */}
      {v.canManage && (
        <div className="kv-card">
          <h2>{t.t('banner.acts')}</h2>
          <p>
            {offeredActs(v.acts).map((a) => <Link key={a.act} href={bannerActHref(v!.id, a.act)} className="kv-btn">{t.t(actLabelKey(a.act))}</Link>)}
          </p>
          {refused.map((a) => (
            <div key={a.act} className="kv-field__hint">
              <strong>{t.t(actLabelKey(a.act))}</strong> — {a.refusals.map((r) => t.t(mutateRefusalKey(BANNER_MUTATE, r), { langs: a.missingLanguages.join(' · ') })).join(' ')}
            </div>
          ))}
          {v.activation.codes.length > 0 && v.state !== 'archived' && <p className="kv-field__hint">{t.t('banner.activationLaw')}</p>}
        </div>
      )}

      {/* ---- THE WORDS, one card per language ---- */}
      <h2>{t.t('banner.words')}</h2>
      <p className="kv-field__hint">{t.t('banner.wordsNote')}</p>
      {rowLangs.map((l) => {
        const x = textOf(l);
        if (!x && !missing.has(l)) return (
          <p key={l} className="kv-field__hint">{t.t('banner.hiddenFor', { lang: l })}</p>
        );
        return x ? (
          <div key={l} className="kv-banner-words" lang={l}>
            <p className="kv-field__hint">{l}</p>
            <p><strong>{x.headline}</strong></p>
            {x.body && <p>{x.body}</p>}
            {x.ctaLabel && <span className="kv-banner-words__cta">{x.ctaLabel}</span>}
          </div>
        ) : (
          <div key={l} className="kv-banner-words kv-banner-words--missing" role="note">
            <p><strong>{t.t('banner.missingWords', { lang: l })}</strong></p>
            {v!.canManage && v!.state !== 'archived' && <p><Link href={editBannerHref(v!.id)} className="kv-btn--link">{t.t('banner.addVariant', { lang: l })}</Link></p>}
          </div>
        );
      })}
      <p className="kv-field__hint">{t.t(refusedKey('previewInApp'))}</p>

      {/* ---- THE IMAGE (one per banner) and the variant group ---- */}
      <h2>{t.t('banner.image')}</h2>
      {v.image ? (
        <p>{v.image.fileName} · {v.image.mimeType} · {v.image.clean ? t.t('banner.imageClean') : t.t('banner.imageNotClean', { status: v.image.scanStatus })}</p>
      ) : <p className="kv-error">{t.t('banner.imageMissing')}</p>}
      <p className="kv-field__hint">{t.t('banner.imageNote')}</p>
      {v.groupKey && (
        <div className="kv-card">
          <p><strong>{t.t('banner.groupHeading', { key: v.groupKey })}</strong></p>
          {v.siblings.length === 0 ? <p className="kv-field__hint">{t.t('banner.groupAlone')}</p> : (
            <ul>
              {v.siblings.map((s) => <li key={s.id}><Link href={bannerHref(s.id)} className="kv-link">{s.languages.join(' · ') || t.t('banners.noWords')}</Link> · {isKnownPlacement(s.placement) ? t.t(placementKey(s.placement)) : s.placement} · {t.t(stateKey(s.state))}</li>)}
            </ul>
          )}
          <p className="kv-field__hint">{t.t(refusedKey('abAllocation'))}</p>
        </div>
      )}

      {/* ---- THE AUDIENCE, and who it reaches today ---- */}
      <h2>{t.t('banner.audience')}</h2>
      <p>{v.everyone ? t.t('banners.audience.everyone') : t.t('banner.audienceRule', { roles: v.audience.roles.join(', ') || t.t('banners.audience.anyRole'), regions: v.audienceRegions.map((g) => g.name).join(', ') || t.t('banner.anywhere') })}</p>
      <div className="kv-card">
        <p><strong>{t.t('banner.reach', { n: formatNumber(v.reach.matched, lang) })}</strong></p>
        {v.reach.byLanguage.length > 0 && (
          <table className="kv-table">
            <thead><tr><th>{t.t('banner.reach.language')}</th><th>{t.t('banner.reach.members')}</th><th>{t.t('banner.reach.sees')}</th></tr></thead>
            <tbody>
              {v.reach.byLanguage.map((r) => (
                <tr key={r.code || '-'}>
                  <td>{r.code || t.t('common.dash')}</td>
                  <td>{formatNumber(r.members, lang)} ({formatNumber(shareOf(r.members, v!.reach.matched), lang)}%)</td>
                  <td>{r.hasText ? t.t('banner.reach.yes') : t.t('banner.reach.noWords')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {v.reach.hiddenNoText > 0 && <p className="kv-field__hint">{t.t('banner.reach.hidden', { n: formatNumber(v.reach.hiddenNoText, lang) })}</p>}
        {v.reach.truncated && <p className="kv-field__hint">{t.t('banner.reach.truncated', { n: formatNumber(v.reach.considered, lang) })}</p>}
        <p className="kv-field__hint">{t.t('banner.reach.note')}</p>
      </div>
      <p className="kv-field__hint">{t.t(refusedKey('minOrders'))} {t.t(refusedKey('kyc'))} {t.t(refusedKey('clusters'))}</p>
      <p className="kv-field__hint">{t.t(refusedKey('voiceFirst'))}</p>

      {/* ---- THE WINDOW AND THE LINK ---- */}
      <h2>{t.t('banner.window')}</h2>
      <p>{windowText(v.startsLocal, v.endsLocal)} <span className="kv-field__hint">({v.timezone})</span></p>
      <p>{v.targetUrl ? <code>{v.targetUrl}</code> : <span className="kv-field__hint">{t.t('banner.noLink')}</span>}</p>
      <p className="kv-field__hint">{t.t(refusedKey('deepLink'))}</p>
      <p className="kv-field__hint">{t.t(refusedKey('promotionLink'))}</p>

      {/* ---- THE SLOT ---- */}
      <h2>{t.t('banner.slot')}</h2>
      <p>{v.slot.position !== null ? t.t('banner.slotPosition', { n: String(v.slot.position), of: String(v.slot.of), placement: placementName }) : t.t('banner.slotNone')}</p>
      {v.canManage && v.slot.position !== null && (
        <p>
          {v.slot.position > 1 && <Link href={slotMoveHref(v.id, 'up')} className="kv-btn--link">{t.t(moveLabelKey('up'))}</Link>}
          {v.slot.position < v.slot.of && <> <Link href={slotMoveHref(v.id, 'down')} className="kv-btn--link">{t.t(moveLabelKey('down'))}</Link></>}
        </p>
      )}

      {/* ---- WHO, and the trail ---- */}
      <h2>{t.t('banner.who')}</h2>
      <ul>
        <li>{t.t('banner.who.author', { name: v.who.author ?? t.t('banner.someone') })}{v.createdAt && ` · ${formatDate(v.createdAt, lang)}`}</li>
        {v.who.lastEditor && <li>{t.t('banner.who.editor', { name: v.who.lastEditor })}</li>}
        {v.activatedAt && <li>{t.t('banner.who.activated', { name: v.who.activatedBy ?? t.t('banner.someone') })} · {formatDate(v.activatedAt, lang)}</li>}
        {v.pausedAt && <li>{t.t('banner.who.paused', { name: v.who.pausedBy ?? t.t('banner.someone') })} · {formatDate(v.pausedAt, lang)}</li>}
        {v.archivedAt && <li>{t.t('banner.who.archived', { name: v.who.archivedBy ?? t.t('banner.someone') })} · {formatDate(v.archivedAt, lang)}</li>}
      </ul>
      <p className="kv-field__hint">{t.t('banner.recorded')}</p>
      {canLinkAudit('banner', v.id) && <p><Link href={auditHref('banner', v.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
      {v.legacyLanguageCode && <p className="kv-field__hint">{t.t('banner.legacyLanguage', { lang: v.legacyLanguageCode })}</p>}
      <p className="kv-field__hint">{t.t('banners.reader.none')}</p>
      <p className="kv-field__hint">{t.t(refusedKey('retryIsResave'))}</p>
      <button type="button" aria-label={t.t('banners.rowActions')} data-decor className="kv-btn--link">⋯</button>
    </section>
  );
}
