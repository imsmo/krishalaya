// apps/web-tenant/src/app/kyc/page.tsx · the signed-in staff member's own KYC + profile surface. Server-first,
// requireSession-gated, noindex. Two read sections (each degrades independently, Law 12):
//   1. Profile — auth.me() shows the caller's display name, roles + locale; an "edit profile" <details> form posts
//      the PII-minimal patch (name/email/dob/gender/language + optional avatar via the real media flow) through the
//      updateProfileAction Server Action (users.updateMe — server resolves the subject from the token, no IDOR).
//   2. KYC documents — kyc.list() renders the caller's docs + statuses; raw doc numbers are NEVER shown (only the
//      server-masked docNoMasked) and a reject reason when present.
//
// SDK-GAP (flagged, not faked): kyc.submit() needs a `docTypeId` (uuid) but the SDK exposes NO doc-type catalogue
// to enumerate the choices (the mobile app flagged the same gap). So this console ships KYC STATUS (read) + the
// profile editor, and does NOT fake a doc-type dropdown / submission. Unblocked when the SDK adds a doc-type lookup.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { MediaUploader } from '../../components/MediaUploader';
import { getTranslator } from '../../lib/i18n';
import { kycStatusKey, PROFILE_GENDERS, PROFILE_LANGUAGES } from '../../features/profile/form';
import { updateProfileAction } from './actions';
import type { UserProfile, KycDocument } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('kyc.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['email', 'dob', 'gender', 'language', 'empty', 'profile']);

export default async function KycPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/kyc');
  const t = getTranslator();

  let me: UserProfile | null = null;
  try { me = await tenantClient().auth.me(); } catch { me = null; }

  let docs: KycDocument[] = []; let docsFailed = false;
  try { docs = await tenantClient().kyc.list(); }
  catch { docsFailed = true; }

  const okKey = searchParams.ok === 'profile' ? 'profile' : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const uploaderLabels = {
    add: t.t('kyc.photoAdd'), hint: t.t('kyc.photoHint'), uploading: t.t('kyc.photoUploading'),
    failed: t.t('kyc.photoFailed'), remove: t.t('kyc.photoRemove'),
  };

  return (
    <section>
      <h1>{t.t('kyc.title')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t('kyc.ok.profile')}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`kyc.error.${errorKey}`)}</p>}

      <h2>{t.t('kyc.profileHeading')}</h2>
      {me ? (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('kyc.name')}</dt><dd>{me.displayName ?? t.t('common.dash')}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('kyc.roles')}</dt><dd>{me.roles.length ? me.roles.join(', ') : t.t('common.dash')}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('kyc.locale')}</dt><dd>{me.locale || t.t('common.dash')}</dd></div>
        </dl>
      ) : <p className="kv-error" role="alert">{t.t('kyc.profileError')}</p>}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('kyc.editProfile')}</summary>
        <p className="kv-field__hint">{t.t('kyc.editHint')}</p>
        <form action={updateProfileAction} className="kv-form">
          <label htmlFor="fullName" className="kv-field__label">{t.t('kyc.name')}</label>
          <input id="fullName" name="fullName" className="kv-input" autoComplete="name" />

          <label htmlFor="email" className="kv-field__label">{t.t('kyc.email')}</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" className="kv-input" />

          <label htmlFor="dob" className="kv-field__label">{t.t('kyc.dob')}</label>
          <input id="dob" name="dob" type="date" className="kv-input" />

          <label htmlFor="gender" className="kv-field__label">{t.t('kyc.gender')}</label>
          <select id="gender" name="gender" className="kv-input" defaultValue="">
            <option value="">{t.t('kyc.unset')}</option>
            {PROFILE_GENDERS.map((g) => <option key={g} value={g}>{t.t(`kyc.gender.${g}`)}</option>)}
          </select>

          <label htmlFor="languageCode" className="kv-field__label">{t.t('kyc.language')}</label>
          <select id="languageCode" name="languageCode" className="kv-input" defaultValue="">
            <option value="">{t.t('kyc.unset')}</option>
            {PROFILE_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          <span className="kv-field__label">{t.t('kyc.photo')}</span>
          <MediaUploader labels={uploaderLabels} fieldName="photoMediaId" single />

          <button type="submit" className="kv-btn">{t.t('kyc.save')}</button>
        </form>
      </details>

      <h2>{t.t('kyc.docsHeading')}</h2>
      {docsFailed ? <p className="kv-error" role="alert">{t.t('kyc.docsError')}</p> : (
        <DataTable
          rows={docs}
          empty={t.t('kyc.docsEmpty')}
          columns={[
            { header: t.t('kyc.colDoc'), cell: (d) => (d.docNoMasked || t.t('common.dash')) },
            { header: t.t('kyc.colStatus'), cell: (d) => <span className="kv-badge">{t.t(`kyc.status.${kycStatusKey(d.status)}`)}</span> },
            { header: t.t('kyc.colReason'), cell: (d) => (d.rejectReason || t.t('common.dash')) },
          ]}
        />
      )}

      <p className="kv-field__hint kv-note">{t.t('kyc.submitUnavailable')}</p>
    </section>
  );
}
