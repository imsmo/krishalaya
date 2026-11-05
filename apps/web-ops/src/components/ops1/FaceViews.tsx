// apps/web-ops/src/components/ops1/FaceViews.tsx · PC-56 OPS-1b · W397–W399 — NO FACE CAPTURE IN PHASE 1 (founder Q5-A), presentational.
// Three HONEST pages that READ NOTHING (no input, no API client, no error state):
//   • FaceEnrollView (W397, /attendance/face-enroll) — there is nothing to enrol; attendance is recorded by the worker's own clock-in, a signed
//     sheet the desk records, or a reviewer's vouch.
//   • FaceAttendanceView (W398, /attendance/face-attendance) — HONEST, not a read: `GET /v1/labour/attendance/summary` gives tenant-wide review
//     tiles, not a booking's counts by method (attendance.repository.ts:151-167), so no count is printed; no wage figure.
//   • BiometricCanonView (W399, /canon/biometric) — the full truth of what is stored: the AePS record's fields after Q7-A, attendance's place
//     and method, PICTURES OF FACES (profile photo, KYC selfie) and that erasure anonymises those files rather than deleting them; and that
//     no fingerprint or face pattern is stored anywhere.
import Link from 'next/link';
import type { Tr } from '../../features/ops1/refusals';
import { AEPS_HOME, BIOMETRIC_CANON, FACE_ATTENDANCE, FACE_ENROLL } from '../../features/ops1/aeps';
import { Ops1Refusals } from './Ops1Chain';

function FaceStatement({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="face">
      <p className="kv-statement" data-kv-statement="ops1.face.statement">{t.t('ops1.face.statement')}</p>
    </div>
  );
}
function Methods({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-methods="attendance">
      <h2 className="kv-card__title">{t.t('ops1.face.methodsTitle')}</h2>
      <ul>
        <li data-kv-method="self">{t.t('ops1.face.method.self')}</li>
        <li data-kv-method="paper_backfill">{t.t('ops1.face.method.sheet')}</li>
        <li data-kv-method="vouch">{t.t('ops1.face.method.vouch')}</li>
      </ul>
      <p data-kv-fact="confirm">{t.t('ops1.face.confirmPays')}</p>
    </div>
  );
}

export function FaceEnrollView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="face_enroll" data-kv-state="honest">
      <h1>{t.t('ops1.face.enroll.title')}</h1>
      <FaceStatement t={t} />
      <p className="kv-muted">{t.t('ops1.face.enroll.lead')}</p>
      <Methods t={t} />
      <p className="kv-pager" data-kv-links="face_enroll">
        <Link className="kv-btn--link" href={FACE_ATTENDANCE} data-kv-real="attendance">{t.t('ops1.face.attendanceLink')}</Link>{' '}
        <Link className="kv-btn--link" href={BIOMETRIC_CANON} data-kv-real="policy">{t.t('ops1.aeps.home.policyLink')}</Link>
      </p>
      <Ops1Refusals t={t} surface="face_enroll" />
    </section>
  );
}

export function FaceAttendanceView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="face_attendance" data-kv-state="honest">
      <h1>{t.t('ops1.face.attendance.title')}</h1>
      <FaceStatement t={t} />
      <p className="kv-muted">{t.t('ops1.face.attendance.lead')}</p>
      <Methods t={t} />
      <div className="kv-card" data-kv-facts="face_attendance">
        <p data-kv-fact="no-counts">{t.t('ops1.face.attendance.noCounts')}</p>
        <p data-kv-fact="no-wage">{t.t('ops1.face.attendance.noWage')}</p>
      </div>
      <p className="kv-pager" data-kv-links="face_attendance">
        <Link className="kv-btn--link" href={FACE_ENROLL} data-kv-real="enroll">{t.t('ops1.face.enrollLink')}</Link>{' '}
        <Link className="kv-btn--link" href={BIOMETRIC_CANON} data-kv-real="policy">{t.t('ops1.aeps.home.policyLink')}</Link>
      </p>
      <Ops1Refusals t={t} surface="face_attendance" />
    </section>
  );
}

/** The stored-data list, in order. Each entry is one `ops1.bio.<id>.title` + `.body` (+ optional `.more`). */
export const BIO_SECTIONS = ['notStored', 'aeps', 'attendance', 'photos'] as const;
const MORE: Readonly<Record<string, readonly string[]>> = { aeps: ['ops1.bio.aeps.not', 'ops1.bio.aeps.logged'], photos: ['ops1.bio.photos.erasure'] };

export function BiometricCanonView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="biometric_canon" data-kv-state="honest">
      <h1>{t.t('ops1.bio.title')}</h1>
      <p className="kv-muted">{t.t('ops1.bio.lead')}</p>
      {BIO_SECTIONS.map((id) => (
        <div key={id} className="kv-card" data-kv-stored={id}>
          <h2 className="kv-card__title">{t.t(`ops1.bio.${id}.title`)}</h2>
          <p>{t.t(`ops1.bio.${id}.body`)}</p>
          {(MORE[id] ?? []).map((k) => <p key={k} data-kv-fact={k}>{t.t(k)}</p>)}
        </div>
      ))}
      <p data-kv-fact="alternatives">{t.t('ops1.bio.alternatives')}</p>
      <p className="kv-pager" data-kv-links="biometric_canon">
        <Link className="kv-btn--link" href={AEPS_HOME} data-kv-real="aeps">{t.t('ops1.bio.aepsLink')}</Link>{' '}
        <Link className="kv-btn--link" href={FACE_ENROLL} data-kv-real="attendance">{t.t('ops1.bio.attendanceLink')}</Link>
      </p>
      <Ops1Refusals t={t} surface="biometric_canon" />
    </section>
  );
}
