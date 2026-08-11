// apps/web-tenant/src/app/people/[userId]/page.tsx · W154, member detail. The page a field officer opens when a farmer
// rings (PC-56 TENANT-1b).
//
// **THREE OF W154's FOUR AT-A-GLANCE TILES HAVE A REAL SOURCE AND ONE DOES NOT, AND THE PAGE SAYS WHICH.** The money is
// this tenant's settled payouts, the orders are this tenant's orders, the dairy is this tenant's collections. The
// "Trust · trusted · 81" badge has no source anywhere on this platform — so the tile shows the DISPUTE RECORD it was
// summarising, and the score is absent rather than invented. A made-up integer here would be read by staff as a reason to
// extend or withhold credit to a farmer, which is the worst possible place for one.
//
// **AND W154's "Active days (30d)" IS ABSENT FOR A REASON THAT IS ITSELF THE FINDING.** The only per-day record of
// somebody using the platform is `login_events`, which carries no tenant_id: counting it would tell this organisation how
// often the member opened the app for a DIFFERENT one. Twelfth time this programme has hit the realm-identity problem,
// and the answer is the same every time.
//
// **AND THE DANGER ZONE IS NOW BUILT, TENANT-SCOPED (PC-56 TENANT-1b-2).** The previous wave refused to render it, because
// the obvious wiring — `UserService.changeStatus`, which existed with no route — sets `users.status`, a column on the
// GLOBAL users table: one FPO's member desk would have locked a farmer out of every OTHER FPO, the storefront and the app.
// 0127 replaced it with a tenant-scoped record enforced at four points, and `SuspensionPanel` below is the control.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import type { Translator } from '@krishalaya/i18n';
import { formatMoneyMinor, formatDate, formatRelative } from '@krishalaya/i18n';
import { SdkError, type MemberDetail, type SuspensionRecord } from '@krishalaya/sdk-js';
import { disputeRecordKey, hasRoleLabel, hasKycLabel, MIN_REVEAL_REASON } from '../../../features/people/roster';
import {
  suspensionState, isSelf, SUSPENSION_EFFECT_KEYS, MIN_SUSPENSION_REASON,
} from '../../../features/people/suspension';
import { suspendMemberAction, reinstateMemberAction } from './actions';
import { RevealField } from '../RevealField';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('member.title'), robots: { index: false, follow: false } };
}

const roleName = (code: string, t: Translator) => (hasRoleLabel(code) ? t.t(`people.role.${code}`) : code);
const kycName = (s: string, t: Translator) => (hasKycLabel(s) ? t.t(`people.kycStatus.${s}`) : s);

const OK_KEYS = new Set(['suspended', 'alreadySuspended', 'reinstated']);
const ERR_KEYS = new Set(['reason', 'forbidden', 'notFound', 'notSuspended', 'failed']);

export default async function MemberPage(
  { params, searchParams }: { params: { userId: string }; searchParams: { ok?: string; error?: string } },
) {
  await requireSession(`/people/${params.userId}`);
  const t = getTranslator();
  const lang = getLang();

  let m: MemberDetail | null = null;
  let live: SuspensionRecord | null = null;
  let history: SuspensionRecord[] = [];
  let viewerUserId: string | null = null;
  let failed = false;
  try {
    const client = tenantClient();
    // Three reads in parallel. The suspension status and the viewer's own id are allowed to FAIL SOFTLY (Law 12): a
    // member desk that cannot render a profile because the suspension history endpoint hiccuped is worse than one that
    // renders the profile and hides one panel. The detail read is the one that must succeed.
    const [detail, suspension, me] = await Promise.all([
      client.members.get(params.userId),
      client.members.suspensionStatus(params.userId).catch(() => ({ live: null, history: [] as SuspensionRecord[] })),
      client.users.me().catch(() => null),
    ]);
    m = detail;
    live = suspension.live;
    history = suspension.history;
    viewerUserId = me?.id ?? null;
  } catch (e) {
    // 404 is a real Next 404: "they may have moved tenants — membership history stays with the member, not with you"
    // (W154's own words). Any other failure is the load-error state, because **partial data is never shown as complete**.
    if (e instanceof SdkError && e.status === 404) notFound();
    failed = true;
  }
  if (failed || !m) {
    return (
      <section>
        <h1>{t.t('member.title')}</h1>
        <p className="kv-error" role="alert">{t.t('member.loadError')}</p>
        <p><Link href="/people" className="kv-link">{t.t('member.back')}</Link></p>
      </section>
    );
  }

  const dispute = disputeRecordKey(m.glance);
  const okKey = searchParams.ok && OK_KEYS.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR_KEYS.has(searchParams.error) ? searchParams.error : null;
  const revealLabels = {
    open: t.t('people.reveal.open'),
    heading: t.t('people.reveal.heading'),
    field: t.t('people.reveal.field'),
    fieldOption: {
      phone: t.t('people.reveal.field.phone'),
      email: t.t('people.reveal.field.email'),
      aadhaar_last4: t.t('people.reveal.field.aadhaar'),
    },
    reason: t.t('people.reveal.reason'),
    reasonHint: t.t('people.reveal.reasonHint', { min: MIN_REVEAL_REASON }),
    submit: t.t('people.reveal.submit'),
    working: t.t('people.reveal.working'),
    hide: t.t('people.reveal.hide'),
    empty: t.t('people.reveal.empty'),
    recorded: t.t('people.reveal.recorded'),
    error: {
      field: t.t('people.reveal.error.field'),
      reason: t.t('people.reveal.error.reason'),
      forbidden: t.t('people.reveal.error.forbidden'),
      notFound: t.t('people.reveal.error.notFound'),
      failed: t.t('people.reveal.error.failed'),
    },
  };

  return (
    <section>
      <nav aria-label={t.t('member.breadcrumb')} className="kv-fine">
        <Link href="/people" className="kv-link">{t.t('people.title')}</Link> › {m.fullName ?? t.t('people.unnamed')}
      </nav>

      <div className="kv-page-head">
        <h1>{m.fullName ?? t.t('people.unnamed')}</h1>
        <p className="kv-muted">
          <span className="kv-badge">{m.platformStatus}</span>
          {' · '}{m.phoneMasked}
          {m.villageName ? ` · ${m.villageName}` : ''}
          {' · '}{m.languageCode}
          {m.memberSince ? ` · ${t.t('member.since', { date: formatDate(m.memberSince, lang) })}` : ''}
        </p>
        <RevealField userId={m.userId} name={m.fullName ?? t.t('people.unnamed')} labels={revealLabels} />
        {/*
          **A LAPSED MEMBER RENDERS, FLAGGED, RATHER THAN 404-ING.** They still have payouts, orders and a KYC history
          this organisation is accountable for. Hiding the record the moment somebody deactivated a role would make a
          tenant's own books unreachable.
        */}
        {m.membershipInactive && <p className="kv-notice" role="status">{t.t('member.inactive')}</p>}
        {okKey && <p className="kv-success" role="status">{t.t(`member.ok.${okKey}`)}</p>}
        {errorKey && <p className="kv-error" role="alert">{t.t(`member.error.${errorKey}`)}</p>}
        {/* **THE SUSPENSION IS ANNOUNCED AT THE TOP, NOT ONLY IN THE DANGER ZONE AT THE BOTTOM.** Every number on this
            page — the money, the orders, the dairy — reads differently once you know the member is currently suspended,
            and a staff member should not have to scroll to find that out. */}
        {suspensionState(live) === 'suspended' && (
          <p className="kv-error" role="status">
            {t.t('member.suspendedBanner', { date: formatDate(live!.createdAt, lang) })}{' '}
            <strong>{live!.reason}</strong>
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------------- At a glance */}
      <h2 className="kv-section-title">{t.t('member.glance')}</h2>
      <div className="kv-cards">
        <div className="kv-card">
          <span className="kv-card__title">{t.t('member.tile.received')}</span>
          <strong>{formatMoneyMinor(m.glance.lifetimeReceivedMinor, 'INR', lang)}</strong>
          {/* W154 prints "Lifetime sales · 42 orders since Nov 2024". The MONEY figure is settled payouts and the
              ORDER count is orders — two different facts, so they are labelled as two rather than implied to be one. */}
          <span className="kv-fine">
            {t.t('member.tile.receivedNote', { payouts: m.glance.paidPayoutCount, orders: m.glance.sellerOrderCount })}
            {m.glance.firstSellerOrderAt ? ` · ${t.t('member.tile.since', { date: formatDate(m.glance.firstSellerOrderAt, lang) })}` : ''}
          </span>
        </div>

        {/* **NO DAIRY MEMBERSHIP IS AN ABSENT TILE, NOT A ₹0 TILE.** A groundnut grower showing "Dairy ₹0" is a
            question staff waste time on; unknown ≠ zero, for the ninth time in this programme. */}
        {m.glance.dairy && (
          <div className="kv-card">
            <span className="kv-card__title">{t.t('member.tile.dairy')}</span>
            <strong>{formatMoneyMinor(m.glance.dairy.amountMinor, 'INR', lang)}</strong>
            <span className="kv-fine">
              {t.t('member.tile.dairyNote', {
                litres: m.glance.dairy.litres, fat: m.glance.dairy.avgFatPct,
                snf: m.glance.dairy.avgSnfPct, animals: m.glance.dairy.animalCount,
              })}
            </span>
          </div>
        )}

        {/* W154's trust tile, with only the record that exists behind it. */}
        <div className="kv-card">
          <span className="kv-card__title">{t.t('member.tile.disputes')}</span>
          <strong>{t.t(`member.dispute.${dispute}`)}</strong>
          <span className="kv-fine">
            {t.t('member.tile.disputesNote', {
              total: m.glance.disputesAgainst, upheld: m.glance.disputesAgainstUpheld, open: m.glance.disputesOpen,
            })}
          </span>
        </div>

        {/* The two disclosed absences, drawn as absences. A dash with a sentence beats a plausible number. */}
        <div className="kv-card">
          <span className="kv-card__title">{t.t('member.tile.trust')}</span>
          <strong>{t.t('common.dash')}</strong>
          <span className="kv-fine">{t.t('member.tile.trustAbsent')}</span>
        </div>
        <div className="kv-card">
          <span className="kv-card__title">{t.t('member.tile.activeDays')}</span>
          <strong>{m.lastActiveAt ? formatRelative(m.lastActiveAt, lang) : t.t('people.never')}</strong>
          <span className="kv-fine">{t.t('member.tile.activeDaysAbsent')}</span>
        </div>
      </div>

      {/* ---------------------------------------------------------------- Roles & KYC */}
      <h2 className="kv-section-title">{t.t('member.rolesHeading')}</h2>
      <p className="kv-fine">{t.t('member.rolesNote')}</p>
      <table className="kv-table">
        <thead>
          <tr>
            <th scope="col">{t.t('member.colRole')}</th>
            <th scope="col">{t.t('member.colKyc')}</th>
            <th scope="col">{t.t('member.colSince')}</th>
            <th scope="col">{t.t('member.colDocs')}</th>
          </tr>
        </thead>
        <tbody>
          {m.roles.map((r) => (
            <tr key={r.roleCode}>
              <td>
                {roleName(r.roleCode, t)}
                {/* An inactive role is shown, marked. Deleting it from the view would hide why a payout was refused. */}
                {!r.isActive && <> <span className="kv-badge">{t.t('member.roleInactive')}</span></>}
              </td>
              <td><span className="kv-badge">{kycName(r.kycStatus, t)}</span></td>
              <td>{r.since ? formatDate(r.since, lang) : t.t('common.dash')}</td>
              <td>
                {r.documents.length === 0 ? t.t('member.noDocs') : r.documents.map((d, i) => (
                  <span key={`${d.docType}-${i}`}>
                    {i > 0 ? ' · ' : ''}{d.docType} ({kycName(d.status, t)}
                    {d.validUntil ? `, ${t.t('member.until', { date: formatDate(d.validUntil, lang) })}` : ''})
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------------------------------------------------------- The member's own choices */}
      <h2 className="kv-section-title">{t.t('member.prefsHeading')}</h2>
      <p className="kv-fine">{t.t('member.prefsNote')}</p>
      <dl className="kv-facts">
        <div className="kv-facts__row">
          <dt>{t.t('member.prefLanguage')}</dt><dd>{m.preferences.languageCode}</dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('member.prefQuiet')}</dt>
          <dd>
            {m.preferences.quietHours
              ? t.t('member.quietValue', {
                  from: m.preferences.quietHours.starts, to: m.preferences.quietHours.ends,
                  tz: m.preferences.quietHours.timezone,
                })
              // **NO ROW MEANS THE MEMBER NEVER SET ONE, NOT THAT THEY WELCOME A 22:00 CALL.** The platform default is
              // named so staff know which it is.
              : t.t('member.quietDefault')}
          </dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('member.prefAlerts')}</dt>
          <dd>
            {m.preferences.priceAlerts.length === 0 ? t.t('member.noAlerts') : m.preferences.priceAlerts.map((a, i) => (
              <span key={i}>
                {i > 0 ? ' · ' : ''}
                {a.productName ?? t.t('member.unknownProduct')} {a.direction === 'above' ? '>' : '<'}{' '}
                {formatMoneyMinor(a.thresholdMinor, 'INR', lang)}
                {a.isActive ? '' : ` (${t.t('member.alertOff')})`}
              </span>
            ))}
          </dd>
        </div>
        {m.preferences.mutedEvents.length > 0 && (
          <div className="kv-facts__row">
            <dt>{t.t('member.prefMuted')}</dt>
            <dd>{m.preferences.mutedEvents.map((e) => `${e.eventCode}/${e.channel}`).join(' · ')}</dd>
          </div>
        )}
      </dl>

      {/* ---------------------------------------------------------------- Recent activity */}
      <h2 className="kv-section-title">{t.t('member.activityHeading')}</h2>
      {m.activity.length === 0 ? <p className="kv-empty-state">{t.t('member.noActivity')}</p> : (
        <ul className="kv-notif-list">
          {m.activity.map((a, i) => (
            <li key={i} className="kv-notif-item">
              <span className="kv-notif-title">
                {t.t(`member.activity.${a.kind}`)}
                {a.label ? ` · ${a.label}` : ''}
                {a.amountMinor ? ` · ${formatMoneyMinor(a.amountMinor, 'INR', lang)}` : ''}
              </span>
              <span className="kv-notif-meta">{a.status} · {formatRelative(a.at, lang)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------------- PII vault */}
      <h2 className="kv-section-title">{t.t('member.vaultHeading')}</h2>
      <p className="kv-fine">{t.t('member.vaultNote')}</p>
      <dl className="kv-facts">
        <div className="kv-facts__row">
          <dt>{t.t('member.aadhaar')}</dt>
          <dd>
            {/* Last four and the PRESENCE of a vault reference. The reference itself is never selected by the read
                model, let alone sent: what we cannot leak, we cannot lose. */}
            {m.aadhaarLast4 ? `XXXX-XXXX-${m.aadhaarLast4}` : t.t('member.noAadhaar')}
            {m.hasAadhaarVault ? ` · ${t.t('member.vaultRefOnly')}` : ''}
          </dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('member.pan')}</dt>
          <dd>{m.hasPanVault ? t.t('member.vaultRefOnly') : t.t('member.noPan')}</dd>
        </div>
      </dl>

      <SuspensionPanel
        t={t} userId={m.userId} live={live} history={history}
        self={isSelf(viewerUserId, m.userId)} lang={lang}
      />

      <p><Link href="/people" className="kv-link">{t.t('member.back')}</Link></p>
    </section>
  );
}

/**
 * **W154's DANGER ZONE, BUILT — AND SCOPED TO THIS ORGANISATION ONLY (PC-56 TENANT-1b-2).**
 *
 * The previous wave rendered this as a disclosed absence, because the obvious implementation was dangerous:
 * `UserService.changeStatus` existed with no route, and `users.status` is a column on the GLOBAL `users` table, so wiring
 * it here would have let one FPO's member desk lock a farmer out of every OTHER FPO they belong to, out of the consumer
 * storefront, and out of the app. 0127 replaces it with a tenant-scoped record, enforced at four points, and this is the
 * control on top of it.
 *
 * **THE EFFECT LIST IS PRINTED BEFORE THE BUTTON, INCLUDING THE TWO THINGS THIS DOES NOT DO.** A staff member's first
 * question is whether suspension stops the member's money; the answer — it does not, money owed still pays out — belongs
 * on the screen and not in a manual. The list is generated from the same key set the API's `SUSPENSION_EFFECTS` mirrors,
 * so the screen and the code describe one act.
 */
function SuspensionPanel(
  { t, userId, live, history, self, lang }:
  { t: Translator; userId: string; live: SuspensionRecord | null; history: SuspensionRecord[]; self: boolean; lang: string },
) {
  const state = suspensionState(live);
  const past = history.filter((h) => h.liftedAt !== null);

  return (
    <>
      <h2 className="kv-section-title">{t.t('member.suspendHeading')}</h2>

      {/* SCOPE FIRST. The sentence that stops somebody assuming this is a platform ban. */}
      <p className="kv-notice">{t.t('member.suspendScope')}</p>

      <ul className="kv-prefs-list">
        {SUSPENSION_EFFECT_KEYS.map((k) => (
          <li key={k} className="kv-prefs-row">{t.t(`member.suspendEffect.${k}`)}</li>
        ))}
      </ul>

      {/* **THE CONTROL IS HIDDEN ON YOUR OWN RECORD, NOT DISABLED.** The API and the CHECK constraint both refuse a
          self-suspension, so offering a form that cannot succeed would only waste somebody's typing. */}
      {self ? (
        <p className="kv-fine">{t.t('member.suspendSelf')}</p>
      ) : state === 'active' ? (
        <details className="kv-disclosure">
          <summary className="kv-btn--link">{t.t('member.suspendOpen')}</summary>
          <form action={suspendMemberAction} className="kv-form">
            <input type="hidden" name="userId" value={userId} />
            <label htmlFor="susReason" className="kv-field__label">{t.t('member.suspendReason')}</label>
            <textarea
              id="susReason" name="reason" className="kv-textarea" rows={3} required
              minLength={MIN_SUSPENSION_REASON} maxLength={500} aria-describedby="susHint"
            />
            <p id="susHint" className="kv-field__hint">{t.t('member.suspendReasonHint', { min: MIN_SUSPENSION_REASON })}</p>
            <button type="submit" className="kv-btn kv-danger">{t.t('member.suspendSubmit')}</button>
          </form>
        </details>
      ) : (
        <details className="kv-disclosure" open>
          <summary className="kv-btn--link">{t.t('member.reinstateOpen')}</summary>
          {/* The ORIGINAL reason and its author are shown beside the reinstate form, because the person lifting a
              suspension is frequently not the person who applied it. */}
          <p className="kv-fine">
            {t.t('member.suspendedSince', { date: formatDate(live!.createdAt, lang) })} · {live!.reason}
          </p>
          <form action={reinstateMemberAction} className="kv-form">
            <input type="hidden" name="userId" value={userId} />
            <label htmlFor="liftReason" className="kv-field__label">{t.t('member.reinstateReason')}</label>
            <textarea
              id="liftReason" name="reason" className="kv-textarea" rows={3} required
              minLength={MIN_SUSPENSION_REASON} maxLength={500} aria-describedby="liftHint"
            />
            <p id="liftHint" className="kv-field__hint">{t.t('member.reinstateReasonHint', { min: MIN_SUSPENSION_REASON })}</p>
            <button type="submit" className="kv-btn">{t.t('member.reinstateSubmit')}</button>
          </form>
        </details>
      )}

      {/* **THE HISTORY, BECAUSE A TABLE RATHER THAN A FLAG IS THE WHOLE REASON 0127 EXISTS.** A member suspended three
          times over two seasons is a different conversation from one suspended once, and a boolean column would have told
          staff neither. */}
      {past.length > 0 && (
        <>
          <h3 className="kv-section-title">{t.t('member.suspendHistory')}</h3>
          <ul className="kv-notif-list">
            {past.map((h) => (
              <li key={h.id} className="kv-notif-item">
                <span className="kv-notif-title">{h.reason}</span>
                <span className="kv-notif-meta">
                  {formatDate(h.createdAt, lang)} → {formatDate(h.liftedAt!, lang)}
                  {h.liftReason ? ` · ${h.liftReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
