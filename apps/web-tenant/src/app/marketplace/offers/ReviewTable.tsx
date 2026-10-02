// apps/web-tenant/src/app/marketplace/offers/ReviewTable.tsx · the review table the New promotion (W2721) and New coupon
// (W2540) chains share · PC-56 TENANT-10b. With refusals it IS the form-error screen (W2720 / W2539): every refusal against
// its field, the entries kept, nothing written. Money fields are paise from the API and are formatted, never re-typed.
import type { DairyReviewField, DairyReviewRefusal } from '@krishalaya/sdk-js';
import type { Translator } from '@krishalaya/i18n';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { nothingStoredKey, refusalsFor, generalRefusals, normalisedKey } from '../../../features/forms/chain';
import { codeKey, isMoneyField } from '../../../features/promos/offers';

export function ReviewTable({ t, lang, review, fieldKey, names = {} }: {
  t: Translator; lang: string; review: { fields: DairyReviewField[]; refusals: DairyReviewRefusal[]; diff: null; ready: boolean; entityType: string };
  fieldKey: (name: string) => string; names?: Record<string, string>;
}) {
  const show = (field: string, v: string | null): string | null => {
    if (v === null) return null;
    if (isMoneyField(field) && /^\d+$/.test(v)) return formatMoneyMinor(v, 'INR', lang);
    if ((field === 'startsAt' || field === 'endsAt') && !Number.isNaN(new Date(v).getTime()) && /T/.test(v)) return formatDate(v, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    if (field === 'promoType') return t.t(`promo.type.${v}.name`);
    if (field === 'discountType') return t.t(`promo.discount.${v === 'flat' ? 'flat' : 'percent'}`);
    if (field === 'promotionId') return names[v] ?? v;
    return v;
  };
  const general = generalRefusals(review as never);
  return (
    <>
      {general.map((r) => <div key={r.code} className="kv-error" role="alert"><p>{t.t(codeKey(r.code))}</p></div>)}
      <table className="kv-table">
        <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
        <tbody>{review.fields.map((f) => {
          const bad = refusalsFor(review as never, f.name);
          return (
            <tr key={f.name}>
              <th scope="row">{t.t(fieldKey(f.name))}</th>
              <td>{show(f.name, f.entered) ?? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>}</td>
              <td>{show(f.name, f.stored) ?? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>}
                {f.normalised && f.entered !== null && f.stored !== null && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                {bad.map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
    </>
  );
}
