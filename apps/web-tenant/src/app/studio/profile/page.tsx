// apps/web-tenant/src/app/studio/profile/page.tsx · W419 — profile & credentials · PC-56 TENANT-7d.
//
// W419: *"Learners trust the person before the playlist."* The instructor's record as the API holds it: the name learners
// see, the bio, the languages taught (codes from the platform registry, each with its own name), who may see the profile,
// the credentials with the desk's review on each, and the VERIFICATION — drawn only from `isVerified`, which since 0173 is
// written by the desk's `verify` act alone (maker ≠ checker as a trigger; on an accepted credential) and revoked by
// `unverify`. `?instructor=` is the desk reaching for another instructor's record; the same page, the desk's acts offered.
//
// WHAT THIS PAGE DOES NOT DRAW, BY NAME. W419's *"Rating 4.8 / 5 from enrolled learners only"* has no table (the API types
// `rating: null`); its *"verified against the certificate face"* names a face match nothing here performs — the desk's
// ACCEPT is a person's act, and the badge says so; its *"Couldn't verify the credential … Retry"* names an automated check
// this platform does not run. Each is a sentence on the page, never a number or a button.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { InstructorView } from '@krishalaya/sdk-js';
import { courseTransportState, pageStateKey, type CoursePageState } from '../../../features/courses/desk';
import { mutateRefusalKey } from '../../../features/mutate/chain';
import {
  actLabelKey, addCredentialHref, completenessKey, credentialStatusKey, documentState, documentStateKey, editProfileHref, instructorActHref, offeredActs, profileHref, refusedKey,
  reuploadHref, studioHref, verifiedBadge, visibilityKey,
} from '../../../features/studio/instructor';

export const dynamic = 'force-dynamic';

const MODULE = 'instructor';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('profile.title'), robots: { index: false, follow: false } };
}

export default async function ProfilePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const instructorId = typeof searchParams.instructor === 'string' && searchParams.instructor.length > 0 ? searchParams.instructor : null;
  await requireSession(profileHref(instructorId));
  const t = getTranslator();
  const lang = getLang();
  const done = typeof searchParams.done === 'string' ? searchParams.done : null;

  let v: InstructorView | null = null; let state: CoursePageState | 'noProfile' | null = null;
  try { v = instructorId ? await tenantClient().instructors.get(instructorId) : await tenantClient().instructors.me(); }
  catch (e) {
    if (e instanceof SdkError && e.code === 'INSTRUCTOR_NOT_FOUND') state = instructorId ? 'notFound' : 'noProfile';
    else state = e instanceof SdkError ? courseTransportState(e.code, e.status) : 'error';
  }

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('profile.title')} {v && verifiedBadge(v) && <span className="kv-badge kv-badge--ok">{t.t('profile.verifiedBadge')}</span>}</h1>
        {v && v.isSelf && <Link href={editProfileHref()} className="kv-btn">{t.t('profile.save')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('profile.lead')}</p>
      <p className="kv-field__hint"><Link href={studioHref()} className="kv-btn--link">← {t.t('studio.title')}</Link></p>
      {done && <p className="kv-success" role="status">{t.t(`profile.done.${done}`) || t.t('mutate.step.success')}</p>}

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(state === 'noProfile' ? 'profile.state.noProfile' : pageStateKey(state))}</p>
          {state === 'noProfile' && <p><Link href={editProfileHref()} className="kv-btn">{t.t('studio.createProfile')}</Link></p>}
          {state === 'error' && <p><Link href={profileHref(instructorId)} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
        </div>
      )}

      {v && (() => {
        const rowActs = offeredActs(v.acts, null);
        const owned = v.isSelf || v.privileged;
        return (
          <>
            {/* ---- the person ---- */}
            <div className="kv-card">
              <h2>{v.name ?? t.t('studio.unnamed')}</h2>
              {v.instructor.displayName === null && v.isSelf && <p className="kv-field__hint">{t.t('profile.nameFallback')}</p>}
              <p style={{ whiteSpace: 'pre-line' }}>{v.instructor.bio ?? <span className="kv-field__hint">{t.t('profile.noBio')}</span>}</p>
              <p><span className="kv-field__hint">{t.t('profile.languages')}:</span> {v.instructor.languages.length === 0 ? <span className="kv-field__hint">{t.t('profile.noLanguages')}</span>
                : v.instructor.languages.map((code) => { const l = v.languages.find((x) => x.code === code); return <span className="kv-badge" key={code}>{l ? `${l.nameNative} · ${code}` : code}</span>; })}</p>
              {owned && <p className="kv-field__hint">{t.t(visibilityKey(v.instructor.visibility))}</p>}
              {v.isSelf && <p className="kv-field__hint">{t.t('profile.readOnlyNote')}</p>}
            </div>

            {/* ---- the verification: a fact with a checker and an instant, or its absence ---- */}
            {owned && (
              <div className="kv-card">
                <h2>{t.t('profile.verificationTitle')}</h2>
                {v.instructor.isVerified && v.instructor.verifiedAt
                  ? <p>{t.t('profile.verifiedOn', { at: formatDate(v.instructor.verifiedAt, lang) })}{v.instructor.verificationNote && <> · <span className="kv-field__hint">{v.instructor.verificationNote}</span></>}</p>
                  : <p className="kv-field__hint">{t.t('profile.notVerified')}</p>}
                <ul className="kv-list">{v.completeness.map((c) => <li key={c.check}>{c.done ? '✓' : '○'} {t.t(completenessKey(c.check))}</li>)}</ul>
                {rowActs.length > 0 && (
                  <ul className="kv-list">
                    {rowActs.map((a) => (
                      <li key={a.act}>
                        {a.allowed ? <Link href={instructorActHref(v.instructor.id, a.act)} className="kv-btn">{t.t(actLabelKey(a.act))}</Link>
                          : <><span className="kv-badge">{t.t(actLabelKey(a.act))}</span> <span className="kv-field__hint">{t.t(mutateRefusalKey(MODULE, a.why ?? 'ILLEGAL_FROM_STATUS'))}</span></>}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="kv-field__hint">{t.t('profile.verificationRule')}</p>
              </div>
            )}

            {/* ---- the credentials, each with the desk's review and the acts on it ---- */}
            {owned && (
              <div className="kv-card">
                <div className="kv-page-head"><h2>{t.t('profile.credentialsTitle')}</h2>{v.isSelf && <Link href={addCredentialHref()} className="kv-btn kv-btn--muted">{t.t('profile.addCredential')}</Link>}</div>
                {v.credentials.length === 0 ? (
                  <div className="kv-card kv-card--notice" role="status"><p>{t.t('profile.credentialsEmpty')}</p><p className="kv-field__hint">{t.t('profile.credentialsEmptyHint')}</p></div>
                ) : (
                  <ul className="kv-list">
                    {v.credentials.map((c) => {
                      const cr = c.credential; const acts = offeredActs(v.acts, cr.id); const ds = documentState(c);
                      return (
                        <li key={cr.id} className="kv-card">
                          <p><strong>{cr.title}</strong>{cr.issuer && <> — {cr.issuer}</>}{cr.yearAwarded !== null && <> · {formatNumber(cr.yearAwarded, lang)}</>} <span className="kv-badge">{t.t(credentialStatusKey(cr.status))}</span></p>
                          <p className="kv-field__hint">{t.t(documentStateKey(ds))} · <code>{cr.documentMediaId}</code> · {t.t('profile.filedOn', { at: formatDate(cr.submittedAt, lang) })}</p>
                          {cr.status === 'accepted' && cr.reviewedAt && <p className="kv-field__hint">{t.t('profile.acceptedOn', { at: formatDate(cr.reviewedAt, lang) })}{cr.reviewNote && <> · {cr.reviewNote}</>}</p>}
                          {cr.status === 'rejected' && (
                            <div className="kv-error" role="alert">
                              <p>{t.t('profile.rejectedTitle')}</p>
                              <p>{t.t('profile.rejectedReason', { reason: cr.reviewNote ?? '' })}</p>
                              {v.isSelf && <p><Link href={reuploadHref(cr.id)} className="kv-btn kv-btn--muted">{t.t('profile.reupload')}</Link></p>}
                            </div>
                          )}
                          {acts.length > 0 && (
                            <ul className="kv-list">
                              {acts.map((a) => (
                                <li key={a.act}>
                                  {a.allowed ? <Link href={instructorActHref(v.instructor.id, a.act, cr.id)} className="kv-btn kv-btn--muted">{t.t(actLabelKey(a.act))}</Link>
                                    : <><span className="kv-badge">{t.t(actLabelKey(a.act))}</span> <span className="kv-field__hint">{t.t(mutateRefusalKey(MODULE, a.why ?? 'ILLEGAL_FROM_STATUS'))}</span></>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="kv-field__hint">{t.t(refusedKey('faceMatch'))}</p>
                <p className="kv-field__hint">{t.t(refusedKey('retry'))}</p>
              </div>
            )}

            {/* ---- W419's rating: nothing records one ---- */}
            <div className="kv-card">
              <h2>{t.t('profile.ratingTitle')}</h2>
              <p className="kv-field__hint">{t.t('studio.notMeasured')} · {t.t(refusedKey('rating'))}</p>
            </div>
            {v.isSelf && <p className="kv-field__hint">{t.t(refusedKey('deactivate'))}</p>}
          </>
        );
      })()}
    </section>
  );
}
