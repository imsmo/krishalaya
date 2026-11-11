// apps/web-gov/src/components/gov4/SignInsViews.tsx · PC-56 GOV-4b — W356 as the "Sign-ins" section of `/access` (W359's page, GOV-1a),
// presentational (rendered inside components/gov1/AccessView and by the render tests). GOV-4 Q4-A (lead-applied; the founder may reopen).
//
// THE SECTION takes NOTHING but the translator: there is no sign-in, attempt, person, time, address or device it could print. Q4's sentence
// verbatim; the lock, as the code proves it (OtpService.verifyDetailed locks a code after the attempt cap; the sign-in page states the minutes
// from the API's retryAfterSec) — no number, since the cap and the wait are deploy configuration; the download sentence; the refusals BY
// NAME. No list, table, count, form, button or link. All copy via i18n; no inline styles; no physical direction.
import { Gov4Refusals } from './VerificationViews';
import type { Tr } from '../../features/gov4/refusals';

/** The section's sentences, in the order printed (Q4 first). */
export const GOV4B_STATEMENTS = ['gov4.q4', 'gov4.signins.lock', 'gov4.signins.download'] as const;

export function SignInsSection({ t }: { t: Tr }) {
  return (
    <section className="kv-card" data-kv-signins="" aria-labelledby="kv-signins">
      <h2 id="kv-signins" className="kv-card__title">{t.t('gov4.signins.title')}</h2>
      {GOV4B_STATEMENTS.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
      <Gov4Refusals t={t} surface="access_signins" />
    </section>
  );
}
