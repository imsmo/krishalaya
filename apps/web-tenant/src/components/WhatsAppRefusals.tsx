// apps/web-tenant/src/components/WhatsAppRefusals.tsx · PC-56 TENANT-8e · the refused-by-name register, printed.
// Each row: what the canon draws, that this platform does not do it (no WhatsApp provider — F-15), what exists instead
// (a link, when something does) and who owns the gap. The rows come from the API's own register (`WHATSAPP_REFUSED`), so
// a page cannot invent or omit an owner. Server component, no client JS.
import Link from 'next/link';
import type { WhatsAppRefusal } from '@krishalaya/sdk-js';
import { getTranslator } from '../lib/i18n';
import { ownerKey, refusalsFor, refusedKey } from '../features/comms/broadcasts';

export function WhatsAppRefusals({ all, codes, headingKey = 'wa.refused.heading' }: { all: readonly WhatsAppRefusal[]; codes: readonly string[]; headingKey?: string }) {
  const t = getTranslator();
  const rows = refusalsFor(all, codes);
  if (rows.length === 0) return null;
  return (
    <div className="kv-card">
      <h2>{t.t(headingKey)}</h2>
      <ul className="kv-list">
        {rows.map((r) => (
          <li key={r.code}>
            <strong>{t.t(refusedKey(r.code))}</strong>
            <span className="kv-field__hint"> · {t.t('wa.owner.label')} {t.t(ownerKey(r.owner))}</span>
            {r.instead && <> · <Link href={r.instead} className="kv-btn--link">{t.t(`wa.instead.${r.code}`)}</Link></>}
          </li>
        ))}
      </ul>
    </div>
  );
}
