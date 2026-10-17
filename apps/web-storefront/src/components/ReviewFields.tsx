// apps/web-storefront/src/components/ReviewFields.tsx · PC-56 STORE-5a · C1 / C2 — the review form's fields, ONE copy for W290 (write) and
// W3141 (edit): the overall stars (a radio group, required), each sub-rating dimension FROM THE VOCABULARY (`review_dimension` — the label is
// the API's, in the buyer's language; a radio group of five plus "not rated", optional), and the words (≤ 4,000 — the API's limit). No JS:
// the radios are real inputs (the canon's 20 ★ are the rating input, not decoration — survey F-24). Values are pre-filled when the chain
// carries them back (a form error keeps what was typed).
import type { LookupValue } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../lib/i18n';
import { REVIEW_BODY_MAX } from '../features/store5a/review';

export function ReviewFields({ dims, values }: { dims: ReadonlyArray<Pick<LookupValue, 'code' | 'name'>> | null; values: { stars: number | null; subRatings: Record<string, number>; body: string } }) {
  const t = getTranslator();
  const lang = getLang();
  const stars = (name: string, legend: string, current: number | null, required: boolean, withNone: boolean, id: string) => (
    <fieldset className="kv-stars" data-kv-stars={name}>
      <legend className="kv-field__label" id={id}>{legend}</legend>
      <div className="kv-stars__row" role="radiogroup" aria-labelledby={id}>
        {[5, 4, 3, 2, 1].map((n) => (
          <label key={n} className="kv-stars__star">
            <input type="radio" name={name} value={n} required={required} defaultChecked={current === n} />
            <span aria-hidden="true">★</span>
            <span className="kv-visually-hidden">{t.t('review.starsN', { n: String(n) })}</span>
          </label>
        ))}
      </div>
      {withNone && (
        <label className="kv-stars__none">
          <input type="radio" name={name} value="" defaultChecked={current === null} /> {t.t('store5a.form.notRated')}
        </label>
      )}
    </fieldset>
  );
  return (
    <>
      {stars('stars', t.t('store5a.form.overall'), values.stars, true, false, 'rv-overall')}
      {dims === null ? (
        <p className="kv-detail__muted" data-kv-dims="unavailable">{t.t('store5a.form.dimsUnavailable')}</p>
      ) : (
        <div className="kv-review__dims" data-kv-dims={dims.length}>
          {dims.map((d) => (
            <div key={d.code} className="kv-review__dim" data-kv-dim={d.code}>
              {stars(`dim.${d.code}`, d.name, values.subRatings[d.code] ?? null, false, true, `rv-dim-${d.code}`)}
            </div>
          ))}
        </div>
      )}
      <div className="kv-field">
        <label htmlFor="review-body" className="kv-field__label">{t.t('store5a.form.words')}</label>
        <textarea id="review-body" name="body" rows={5} maxLength={REVIEW_BODY_MAX} className="kv-field__input" defaultValue={values.body} aria-describedby="review-body-hint" />
        <p id="review-body-hint" className="kv-field__hint">{t.t('store5a.form.wordsHint', { max: formatNumber(REVIEW_BODY_MAX, lang) })}</p>
      </div>
    </>
  );
}
