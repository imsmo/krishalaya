// apps/web-admin/src/app/catalogue/crops/[id]/page.tsx · THE MANDI MAPPING (PC-56 ADMIN-3c, DELTA-008's other half).
//
// THIS PAGE IS WHERE THE CANON GETS CORRECTED, gently and in writing. W023 shows the mandi-feed mapping as a column on a
// CROP row, and for an operator that is the right place to see it — a crop is what they think in. But the mapping cannot
// LIVE there: `mandi_prices.product_id` is what the price series keys on, so a crop-level mapping would look perfectly
// correct on the admin table and resolve to no price at all on the farmer's Mandi Pulse.
//
// So the crop row shows a rollup and this page shows the truth: one row per PRODUCT, one commodity code each.
//
// AND A FRESH MAPPING IS "PENDING", NEVER "MAPPED". Nobody has checked that the commodity code resolves upstream. The
// same refusal-to-claim as every delivery state in this console.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { upsertMappingAction, removeMappingAction } from '../../actions';
import { syncStateOf, mandiClass, mandiKey, MIN_REASON, type ProductMappingRow } from '../../../../features/catalogue/crops';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('crop.mapTitle'), robots: { index: false, follow: false } };
}

interface MapView {
  items: ProductMappingRow[];
  rollup: { total: number; mapped: number; pct: number | null; state: string };
  basis: string; noProductsNote: string | null;
}

export default async function CropMappingPage(
  { params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: MapView | null = null; let notice: string | undefined;
  try { view = (await adminGet<MapView>(`catalogue/crops/${encodeURIComponent(params.id)}/mappings`)).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const rows = view?.items ?? [];
  const mapped = rows.filter((r) => !!r.externalId);
  const okKey = searchParams.ok?.startsWith('crop_') ? searchParams.ok.slice(5) : undefined;
  const errRaw = searchParams.error ?? '';
  const errKey = errRaw.startsWith('crop_') ? errRaw.slice(5) : errRaw.startsWith('cal_') ? errRaw.slice(4) : errRaw || undefined;
  const errNs = errRaw.startsWith('cal_') ? 'cal' : 'crop';

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/crops">{t.t('cat.back')}</Link></p>
      <h1>{t.t('crop.mapTitle')}</h1>
      {/* the correction, stated plainly */}
      <p className="kv-notice" role="note">{view?.basis ?? t.t('crop.mapLead')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`crop.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'duplicate' || errKey === 'rejected'
            ? (searchParams.why ?? t.t(`${errNs}.error.generic`))
            : t.t(`${errNs}.error.${errKey}`)}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : view?.noProductsNote ? (
        // NOT "unmapped" — there is nothing to map
        <p className="kv-empty">{view.noProductsNote}</p>
      ) : (
        <>
          <p className="kv-field__hint">
            <span className={`kv-status ${mandiClass(view?.rollup.state)}`}>
              {t.t(`crop.mandi.${mandiKey(view?.rollup.state)}`)}
            </span>
            {' '}{String(view?.rollup.mapped ?? 0)} / {String(view?.rollup.total ?? 0)}
          </p>

          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('crop.product')}</th>
              <th scope="col">{t.t('crop.commodityCode')}</th>
              <th scope="col">{t.t('crop.syncState')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const sync = syncStateOf(r);
                return (
                  <tr key={r.productId}>
                    <td>{r.defaultName}{r.code ? <> <code>{r.code}</code></> : null}</td>
                    <td>{r.externalId ? <code>{r.externalId}</code> : <span className="kv-detail__muted">{t.t('crop.unmapped')}</span>}</td>
                    <td>
                      {/* an unmapped product has NO sync state at all; inventing 'pending' would imply an attempt */}
                      {sync
                        ? <span className={`kv-status ${sync === 'synced' ? 'kv-status--ok' : sync === 'pending' ? 'kv-status--warn' : 'kv-status--danger'}`}>
                            {t.t(`crop.sync.${sync}`)}
                          </span>
                        : t.t('common.dash')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('crop.mapNewTitle')}</summary>
            <p className="kv-field__hint">{t.t('crop.mapHint')}</p>
            <form action={upsertMappingAction} className="kv-form">
              <input type="hidden" name="categoryId" value={params.id} />
              <label htmlFor="m-product" className="kv-field__label">{t.t('crop.product')}</label>
              <select id="m-product" name="productId" className="kv-input" required defaultValue="">
                <option value="" disabled>{t.t('crop.product')}</option>
                {rows.map((r) => (
                  <option key={r.productId} value={r.productId}>
                    {r.defaultName}{r.externalId ? ` — ${r.externalId}` : ''}
                  </option>
                ))}
              </select>
              <label htmlFor="m-code" className="kv-field__label">{t.t('crop.commodityCode')}</label>
              <input id="m-code" name="externalId" className="kv-input" required placeholder="AGM-1101" maxLength={40} />
              <label htmlFor="m-reason" className="kv-field__label">{t.t('eav.reason')}</label>
              <input id="m-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('crop.map')}</button>
            </form>
          </details>

          {mapped.length > 0 && (
            <details className="kv-card kv-limit-form">
              <summary className="kv-card__title">{t.t('crop.unmapTitle')}</summary>
              <p className="kv-field__hint">{t.t('crop.unmapHint')}</p>
              <form action={removeMappingAction} className="kv-form">
                <input type="hidden" name="categoryId" value={params.id} />
                <label htmlFor="u-product" className="kv-field__label">{t.t('crop.product')}</label>
                <select id="u-product" name="productId" className="kv-input" required defaultValue="">
                  <option value="" disabled>{t.t('crop.product')}</option>
                  {mapped.map((r) => (
                    <option key={r.productId} value={r.productId}>{r.defaultName} — {r.externalId}</option>
                  ))}
                </select>
                <label htmlFor="u-reason" className="kv-field__label">{t.t('eav.reason')}</label>
                <input id="u-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
                <button type="submit" className="kv-btn kv-btn--muted">{t.t('crop.unmap')}</button>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}
