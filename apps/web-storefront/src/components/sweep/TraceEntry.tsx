// apps/web-storefront/src/components/sweep/TraceEntry.tsx · PC-56 STORE-SWEEP-b · D5 — the trace ENTRY ("How farm-to-fork trace works" + the typed-code
// form), ONE screen under both chromes. It was the platform's page only (`(platform)/trace/page.tsx`, STORE-1b): on a store's own host `/trace`
// rendered the platform's chrome under the organisation's domain (SW-a's founder question Q2). Now a store host rewrites `/trace` to
// `/<slug>/trace` (brand-theme.ts `hostRewritePath`) and the store renders this same entry inside its own chrome; a well-formed code goes to the
// store's own `/trace/<code>` (its trace page sends another organisation's lot on to the platform's, 5b). `base` = '' on the platform and on a
// store's own host, `/<slug>` on a path store. No camera scanner, no demo lot — refused by name (1b).
import { redirect } from 'next/navigation';
import { getTranslator } from '../../lib/i18n';
import { traceCodeHref } from '../../features/home/trace-code';
import { refusalKey } from '../../features/home/refusals';

export function TraceEntry({ base, searchParams }: { base: string; searchParams: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  const typed = searchParams.code;
  const href = typed !== undefined ? traceCodeHref(typed) : null;
  if (href) redirect(`${base}${href}`);
  const value = (Array.isArray(typed) ? typed[0] : typed) ?? '';
  return (
    <section className="kv-prose" aria-labelledby="kv-trace-how" data-kv-trace-entry={base === '' ? 'root' : base.slice(1)}>
      <h1 id="kv-trace-how">{t.t('trace.how.title')}</h1>
      <p>{t.t('home.trace.body')}</p>
      {typed !== undefined && <p className="kv-form__error" role="alert" id="kv-trace-err">{t.t('trace.code.invalid')}</p>}
      <form method="get" action={`${base}/trace`} className="kv-trace-entry">
        <span className="kv-field">
          <label htmlFor="kv-trace-code" className="kv-field__label">{t.t('home.trace.label')}</label>
          <input id="kv-trace-code" name="code" type="text" required maxLength={128} autoComplete="off" className="kv-field__input" defaultValue={value}
            aria-invalid={typed !== undefined ? true : undefined} aria-describedby={typed !== undefined ? 'kv-trace-err kv-trace-hint' : 'kv-trace-hint'} />
        </span>
        <button type="submit" className="kv-btn">{t.t('home.trace.submit')}</button>
      </form>
      <p id="kv-trace-hint" className="kv-field__hint">{t.t(refusalKey('camera_scanner'))}</p>
      <p className="kv-refusal">{t.t(refusalKey('trace_demo'))}</p>
    </section>
  );
}
