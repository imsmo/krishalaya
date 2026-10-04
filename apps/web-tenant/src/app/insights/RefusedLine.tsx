// apps/web-tenant/src/app/insights/RefusedLine.tsx · PC-56 TENANT-SW-f — one figure REFUSED BY NAME: the API's sentence in the reader's
// language (ui_messages) when it sent one, else the catalogue's; the code is printed beside it. Never a number.
import type { Translator } from '@krishalaya/i18n';
import { refusedKey, wordsFor, type Words } from '../../features/swf/console';

export function RefusedLine({ t, lang, code, words, label }: { t: Translator; lang: string; code: string; words?: Words | null; label?: string }) {
  return (
    <span className="kv-refused" data-refused={code}>
      {label ? <strong>{label}: </strong> : null}
      <span className="kv-badge kv-badge--muted">{t.t('swf.refusedByName')}</span>{' '}
      {wordsFor(words, code, lang) ?? t.t(refusedKey(code))} <code>{code}</code>
    </span>
  );
}
export function MethodLine({ t, lang, code, words }: { t: Translator; lang: string; code: string; words?: Words | null }) {
  const s = wordsFor(words, code, lang);
  return <li className="kv-method" data-method={code}>{s ?? t.t('swf.method.missing')} <span className="kv-detail__muted">({code})</span></li>;
}
