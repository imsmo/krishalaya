// apps/web-tenant/src/app/people/page.tsx · W153, the PEOPLE roster. The most-used screen in an FPO console.
//
// **WHY THIS IS `/people` AND NOT `/members`.** `/members` already renders PC-28's paid membership-TIER manager — tiers,
// fees, subscribe — which shares a word with this screen and nothing else. Taking that route would break every existing
// link; so the register of PEOPLE lives here and both pages cross-link, and a staff member who guesses either word
// arrives somewhere that tells them where the other thing is.
//
// **THE COLUMN THIS PAGE EXISTS FOR IS KYC-PER-ROLE.** TENANT-1 found the money gate accepting a verified status on ANY
// of a member's roles, so a worker verification opened a farmer settlement (0125 fixed it). This is the surface that lets
// a tenant SEE the same rule: a rule enforced in the money path and invisible in the console is a rule staff cannot work.
//
// Server component, no client JS except the reveal control (which must hold a value in memory rather than in a URL).
// Every phone arrives already masked from the read model, so this page cannot leak one even by accident.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import type { Translator } from '@krishalaya/i18n';
import { formatMoneyMinor, formatRelative } from '@krishalaya/i18n';
import { rosterKycLabel, type RosterMember, type RosterCensus } from '@krishalaya/sdk-js';
import {
  parseRosterFilters, rosterHref, isFiltered, sharePct, hasRoleLabel, hasKycLabel,
  ROSTER_ROLE_FILTERS, ROSTER_KYC_FILTERS, ROSTER_PAGE_SIZES, DORMANT_DAYS, MIN_REVEAL_REASON, type RawParams,
} from '../../features/people/roster';
import { RevealField } from './RevealField';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('people.title'), robots: { index: false, follow: false } };
}

/** A translated role name, or the raw code when this console has no label for it (see `hasRoleLabel`). */
function roleName(code: string, t: Translator): string {
  return hasRoleLabel(code) ? t.t(`people.role.${code}`) : code;
}
function kycName(status: string, t: Translator): string {
  return hasKycLabel(status) ? t.t(`people.kycStatus.${status}`) : status;
}
function roleNames(roles: { roleCode: string; isActive: boolean }[], t: Translator): string {
  return roles.filter((r) => r.isActive).map((r) => roleName(r.roleCode, t)).join(', ');
}

export default async function PeoplePage({ searchParams }: { searchParams: RawParams }) {
  await requireSession('/people');
  const t = getTranslator();
  const lang = getLang();
  const f = parseRosterFilters(searchParams);

  let items: RosterMember[] = [];
  let census: RosterCensus | null = null;
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const res = await tenantClient().members.roster({
      q: f.q, roleCode: f.roleCode, kycStatus: f.kycStatus, dormantDays: f.dormantDays, cursor: f.cursor, limit: f.limit,
    });
    items = res.items; census = res.census; nextCursor = res.nextCursor;
  } catch { failed = true; }

  // Built ONCE and handed to every row: the reveal control is a client component and this console's translator is
  // server-only, so the strings cross the boundary as data rather than the translator crossing it as code.
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

  const verifiedPct = census ? sharePct(census.fullyVerified, census.activeMembers) : null;
  const activePct = census ? sharePct(census.activeLast30d, census.activeMembers) : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('people.title')}</h1>
        <p className="kv-muted">{t.t('people.subtitle')}</p>
        {/* The cross-link that keeps the two "members" pages from being a trap. */}
        <p className="kv-fine">
          {t.t('people.tierHint')} <Link href="/members" className="kv-link">{t.t('people.tierLink')}</Link>
        </p>
      </div>

      {/* --- W153's census tiles. Each one is a real count; the fourth is a DISCLOSED ABSENCE, not a number. --- */}
      {census && (
        <div className="kv-cards">
          <div className="kv-card">
            <span className="kv-card__title">{t.t('people.tile.active')}</span>
            <strong>{census.activeMembers.toLocaleString(lang)}</strong>
          </div>
          <div className="kv-card">
            <span className="kv-card__title">{t.t('people.tile.verified')}</span>
            <strong>{census.fullyVerified.toLocaleString(lang)}</strong>
            {/* The worst-status reading, stated on the tile: this is the number the money gate agrees with. */}
            <span className="kv-fine">
              {verifiedPct === null ? t.t('common.dash') : `${verifiedPct}%`} · {t.t('people.tile.verifiedNote')}
            </span>
          </div>
          <div className="kv-card">
            <span className="kv-card__title">{t.t('people.tile.active30')}</span>
            <strong>{census.activeLast30d.toLocaleString(lang)}</strong>
            <span className="kv-fine">{activePct === null ? t.t('common.dash') : `${activePct}%`}</span>
          </div>
          <div className="kv-card">
            <span className="kv-card__title">{t.t('people.tile.dormant')}</span>
            <strong>{census.dormant.toLocaleString(lang)}</strong>
            <span className="kv-fine">{t.t('people.tile.dormantNote')}</span>
          </div>
          {/*
            **W153's FOURTH TILE IS "Voice-first users · 64%" AND IT IS NOT DRAWN AS A NUMBER.** Nothing on this platform
            records whether a session used voice: `users.language_code` says which LANGUAGE, not which modality. A share
            derived from language would be a different quantity wearing this one's label. The tile says so instead.
          */}
          {census.voiceFirstShare === null && (
            <div className="kv-card">
              <span className="kv-card__title">{t.t('people.tile.voice')}</span>
              <strong>{t.t('common.dash')}</strong>
              <span className="kv-fine">{t.t('people.tile.voiceAbsent')}</span>
            </div>
          )}
        </div>
      )}

      {/* --- Search + filters. GET forms and links, so every view is a URL a staff member can bookmark or send. --- */}
      <form action="/people" method="get" className="kv-search" role="search">
        <label htmlFor="q" className="kv-field__label">{t.t('people.search')}</label>
        <input id="q" name="q" defaultValue={f.q ?? ''} className="kv-input" placeholder={t.t('people.searchHint')} maxLength={80} />
        {/* The other filters ride along as hidden fields so searching does not silently clear them. The CURSOR does
            not: a new search is a new result set, and carrying a keyset position into it would skip rows. */}
        {f.roleCode && <input type="hidden" name="role" value={f.roleCode} />}
        {f.kycStatus && <input type="hidden" name="kyc" value={f.kycStatus} />}
        {f.dormantDays && <input type="hidden" name="dormant" value="1" />}
        {f.limit !== ROSTER_PAGE_SIZES[0] && <input type="hidden" name="rows" value={String(f.limit)} />}
        <button type="submit" className="kv-btn">{t.t('people.searchGo')}</button>
      </form>

      <nav className="kv-notif-filters" aria-label={t.t('people.filters')}>
        <Link href={rosterHref(f, { roleCode: undefined })} className={`kv-btn--link${!f.roleCode ? ' is-active' : ''}`}
          aria-current={!f.roleCode ? 'page' : undefined}>{t.t('people.allRoles')}</Link>
        {ROSTER_ROLE_FILTERS.map((role) => (
          <Link key={role} href={rosterHref(f, { roleCode: role })}
            className={`kv-btn--link${f.roleCode === role ? ' is-active' : ''}`}
            aria-current={f.roleCode === role ? 'page' : undefined}>{t.t(`people.role.${role}`)}</Link>
        ))}
      </nav>

      <nav className="kv-notif-filters" aria-label={t.t('people.kycFilters')}>
        {ROSTER_KYC_FILTERS.map((k) => (
          <Link key={k} href={rosterHref(f, { kycStatus: f.kycStatus === k ? undefined : k })}
            className={`kv-btn--link${f.kycStatus === k ? ' is-active' : ''}`}
            aria-current={f.kycStatus === k ? 'page' : undefined}>{t.t('people.kycChip', { status: t.t(`people.kycStatus.${k}`) })}</Link>
        ))}
        <Link href={rosterHref(f, { dormantDays: f.dormantDays ? undefined : DORMANT_DAYS })}
          className={`kv-btn--link${f.dormantDays ? ' is-active' : ''}`}
          aria-current={f.dormantDays ? 'page' : undefined}>{t.t('people.dormantChip', { days: DORMANT_DAYS })}</Link>
      </nav>

      {failed ? (
        // W153's error state, and its exact promise: the DATA is fine, this VIEW failed (Law 12).
        <p className="kv-error" role="alert">{t.t('people.loadError')}</p>
      ) : (
        <>
          <table className="kv-table">
            <caption className="kv-fine">{t.t('people.tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t.t('people.colMember')}</th>
                <th scope="col">{t.t('people.colVillage')}</th>
                <th scope="col">{t.t('people.colRoles')}</th>
                <th scope="col">{t.t('people.colKyc')}</th>
                <th scope="col">{t.t('people.colReceived')}</th>
                <th scope="col">{t.t('people.colLastActive')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const label = rosterKycLabel(m.roles);
                return (
                  <tr key={m.userId}>
                    <td>
                      <Link href={`/people/${m.userId}`} className="kv-link">{m.fullName ?? t.t('people.unnamed')}</Link>
                      {' · '}
                      {/* Masked in the READ MODEL, not here: the full number never crossed the wire. */}
                      <span className="kv-muted">{m.phoneMasked}</span>
                      <RevealField userId={m.userId} name={m.fullName ?? t.t('people.unnamed')} labels={revealLabels} />
                    </td>
                    <td>{m.villageName ?? t.t('common.dash')}</td>
                    <td>{roleNames(m.roles, t) || t.t('common.dash')}</td>
                    <td>
                      {/* "verified ×2" for a member whose roles agree; the WORST status named with its role when they
                          do not. That difference is the whole reason this column exists. */}
                      <span className="kv-badge">
                        {label.key === 'verifiedMany' ? t.t('people.kyc.verifiedMany', { count: label.count })
                          : label.key === 'verifiedOne' ? t.t('people.kycStatus.verified')
                          : label.key === 'noRoles' ? t.t('people.kyc.noRoles')
                          : t.t('people.kyc.mixed', { role: roleName(label.roleCode ?? '', t), status: kycName(label.status, t) })}
                      </span>
                    </td>
                    {/* **"Lifetime sales" IS RENDERED AS MONEY RECEIVED, WHICH IS WHAT THE FIGURE IS.** It sums SETTLED
                        payouts: an order that never paid out is not income, and W155 says so in its own words. */}
                    <td>{formatMoneyMinor(m.lifetimeReceivedMinor, 'INR', lang)}</td>
                    <td>{m.lastActiveAt ? formatRelative(m.lastActiveAt, lang) : t.t('people.never')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {items.length === 0 && (
            // Two different empty states, because they are two different situations for two different readers.
            <p className="kv-empty-state">
              {isFiltered(f) ? t.t('people.emptyFiltered') : t.t('people.emptyNone')}
            </p>
          )}

          <nav className="kv-pager" aria-label={t.t('people.pager')}>
            {f.cursor && <Link href={rosterHref(f, { cursor: null })} className="kv-btn--link">{t.t('people.first')}</Link>}
            {nextCursor && <Link href={rosterHref(f, { cursor: nextCursor })} className="kv-btn--link">{t.t('people.next')}</Link>}
            <span className="kv-fine">{t.t('people.rows')}</span>
            {ROSTER_PAGE_SIZES.map((n) => (
              <Link key={n} href={rosterHref(f, { limit: n })}
                className={`kv-btn--link${f.limit === n ? ' is-active' : ''}`}
                aria-current={f.limit === n ? 'page' : undefined}>{n}</Link>
            ))}
          </nav>
          {/* **NO TOTAL COUNT NEXT TO A KEYSET PAGER, AND NO PAGE NUMBERS.** W153 draws "1 2 … 52", which needs an
              OFFSET count this read model deliberately does not compute: at 300,000 members a COUNT(*) per page view is
              the query that takes the roster down. The census tile above already gives the honest total. */}
          <p className="kv-fine kv-note">{t.t('people.pagerNote')}</p>
        </>
      )}
    </section>
  );
}
