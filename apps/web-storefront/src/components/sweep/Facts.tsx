// apps/web-storefront/src/components/sweep/Facts.tsx · PC-56 STORE-SWEEP-a · C2 (founders D3 / D7) — ONE FACT, AS DATA. A published fact prints its
// value (a mailbox as a `mailto:` link when it is one address); an empty one prints "not published yet" — never a placeholder, never a guessed
// mailbox. A FAILED read prints the error sentence with a reload (ERROR ≠ EMPTY). Every line carries `data-kv-fact` + `data-kv-fact-state`
// (`set` | `unpublished`) so the render tests and the probe count them.
import { getTranslator } from '../../lib/i18n';
import { mailtoHref, type FactLine } from '../../features/sweep/facts';

/** `label` = the fact's name; `setKey` = a sentence carrying {n} for a figure fact (printed instead of "label: value"). */
export function FactItem({ id, label, line, setKey }: { id: string; label: string; line: FactLine; setKey?: string }) {
  const t = getTranslator();
  if (line.kind === 'unpublished') {
    return <li data-kv-fact={id} data-kv-fact-state="unpublished">{label}: <em>{t.t('sweep.fact.unpublished')}</em></li>;
  }
  if (setKey) return <li data-kv-fact={id} data-kv-fact-state="set">{t.t(setKey, { n: line.value })}</li>;
  const mail = mailtoHref(line);
  return <li data-kv-fact={id} data-kv-fact-state="set">{label}: {mail ? <a href={mail}>{line.value}</a> : line.value}</li>;
}

/** The facts read failed: said, with a reload of this page (a read — no confirm, no key). */
export function FactsError({ retryHref }: { retryHref: string }) {
  const t = getTranslator();
  return (
    <div className="kv-state kv-state--error" role="status" data-kv-state="facts-error">
      <p>{t.t('sweep.fact.error')}</p>
      <a href={retryHref} className="kv-btn" data-kv-retry="reload">{t.t('sweep.fact.retry')}</a>
    </div>
  );
}
