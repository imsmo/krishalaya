// apps/web-storefront/src/app/(platform)/trace/page.tsx · PC-56 STORE-1b · C1/C2 — "How farm-to-fork trace works" (the platform footer's
// link) AND the target of the home's "Scan a trace QR" GET form: `/trace?code=<typed>` with a well-formed code goes straight to that lot's
// record (/trace/<code>); a malformed one is answered here, with the code kept in the field. No camera scanner (refused by name); no demo
// lot (refused by name — no public demonstration lot exists).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslator } from '../../../lib/i18n';
import { traceCodeHref } from '../../../features/home/trace-code';
import { refusalKey } from '../../../features/home/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('trace.how.title'), description: t.t('home.trace.body') };
}

export default function TraceHowPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  const typed = searchParams.code;
  const href = typed !== undefined ? traceCodeHref(typed) : null;
  if (href) redirect(href);
  const value = (Array.isArray(typed) ? typed[0] : typed) ?? '';
  return (
    <section className="kv-prose" aria-labelledby="kv-trace-how">
      <h1 id="kv-trace-how">{t.t('trace.how.title')}</h1>
      <p>{t.t('home.trace.body')}</p>
      {typed !== undefined && <p className="kv-form__error" role="alert" id="kv-trace-err">{t.t('trace.code.invalid')}</p>}
      <form method="get" action="/trace" className="kv-trace-entry">
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
