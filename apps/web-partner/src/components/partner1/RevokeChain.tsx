// apps/web-partner/src/components/partner1/RevokeChain.tsx · PC-56 PARTNER-1b · founder D1 — REVOKE ONE OF YOUR KEYS (REAL): W2911 confirm →
// W2912 success → W2913 failure, each a query state of `/account/api` (`?act=revoke&id=…[&state=success|failure&code=…]`).
//   • confirm: what happens (every call with it fails at once; permanent), the reason typed HERE (20–300; it travels in the form body — never
//     in a URL), the Idempotency-Key minted by the SERVER at render in a hidden field (a double submit cannot revoke twice or audit twice);
//   • success: revoked at <time> (read back from the list — the server's instant), the prefix; the reason is kept with the revocation;
//   • failure: the NAMED refusal (not yours / already revoked / the reason / the role) and "nothing was changed"; Retry goes back to confirm.
// Presentational: the page reads, this prints.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { PartnerKey } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { KEY_REVOKE_REASON_MAX, KEY_REVOKE_REASON_MIN, REVOKE_STEP_FILES, revokeErrorKey } from '../../features/partner1/keys';

export function RevokeConfirm({ t, keyRow, idempotencyKey, action }: { t: Tr; keyRow: PartnerKey | null; idempotencyKey: string; action: string | ((fd: FormData) => void) }) {
  if (!keyRow || keyRow.status === 'revoked') {
    return (
      <section className="kv-card kv-chain" data-kv-revoke="confirm" data-kv-canon={REVOKE_STEP_FILES.confirm} data-kv-revoke-missing>
        <h1>{t.t('partner1.keys.confirm.title')}</h1>
        <p role="alert">{t.t('partner1.keys.confirm.missing')}</p>
        <p><Link className="kv-btn" href="/account/api">{t.t('partner1.keys.back')}</Link></p>
      </section>
    );
  }
  return (
    <section className="kv-card kv-chain" data-kv-revoke="confirm" data-kv-canon={REVOKE_STEP_FILES.confirm}>
      <h1>{t.t('partner1.keys.confirm.title')}</h1>
      <p>{t.t('partner1.keys.confirm.body', { name: keyRow.name, prefix: keyRow.keyPrefix, min: KEY_REVOKE_REASON_MIN })}</p>
      <form action={action as never} className="kv-form">
        <input type="hidden" name="id" value={keyRow.id} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <label className="kv-field" htmlFor="p1-key-reason"><span className="kv-field__label">{t.t('partner1.keys.confirm.reason')}</span>
          <textarea id="p1-key-reason" name="reason" className="kv-input" required minLength={KEY_REVOKE_REASON_MIN} maxLength={KEY_REVOKE_REASON_MAX} />
        </label>
        <button type="submit" className="kv-btn kv-btn--danger">{t.t('partner1.keys.confirm.proceed')}</button>{' '}
        <Link className="kv-btn kv-btn--muted" href="/account/api">{t.t('partner1.keys.confirm.cancel')}</Link>
      </form>
    </section>
  );
}

export function RevokeSuccess({ t, lang, keyRow }: { t: Tr; lang: string; keyRow: PartnerKey | null }) {
  const time = keyRow?.revokedAt ? formatDate(keyRow.revokedAt, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '';
  return (
    <section className="kv-card kv-chain kv-success" data-kv-revoke="success" data-kv-canon={REVOKE_STEP_FILES.success} role="status">
      <h1>{t.t('partner1.keys.success.title')}</h1>
      {keyRow?.status === 'revoked'
        ? <p>{t.t('partner1.keys.success.body', { prefix: keyRow.keyPrefix, time })}</p>
        : <p>{t.t('partner1.keys.success.unread')}</p>}
      <p className="kv-field__hint">{t.t('partner1.keys.success.trail')}</p>
      <p className="kv-pager"><Link className="kv-btn" href="/account/api">{t.t('partner1.keys.back')}</Link></p>
    </section>
  );
}

export function RevokeFailure({ t, id, code }: { t: Tr; id: string; code: string | null }) {
  return (
    <section className="kv-card kv-chain" data-kv-revoke="failure" data-kv-canon={REVOKE_STEP_FILES.failure} data-kv-code={code ?? 'unknown'} role="alert">
      <h1>{t.t('partner1.keys.failure.title')}</h1>
      <p>{t.t(revokeErrorKey(code), { min: KEY_REVOKE_REASON_MIN, max: KEY_REVOKE_REASON_MAX })}</p>
      <p>{t.t('partner1.keys.failure.unchanged')}</p>
      <p className="kv-pager">
        <Link className="kv-btn" href={`/account/api?act=revoke&id=${encodeURIComponent(id)}`}>{t.t('partner1.keys.failure.retry')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/account/api">{t.t('partner1.keys.back')}</Link>
      </p>
    </section>
  );
}
