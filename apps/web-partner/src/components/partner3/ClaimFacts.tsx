// apps/web-partner/src/components/partner3/ClaimFacts.tsx · PC-56 PARTNER-3b — THE WALL, RENDERED ONCE (founder Q4). Extracted from
// PARTNER-3a's `InsurerClaimView` so that the claim detail (W253), the evidence board (W256) and the survey report (W259) print the SAME fact
// block from the SAME code: one source of truth for what an insurer may see of a claim, so a leak cannot be added to one page only.
//
// What `GET /v1/partner/insurance/claims/:id` answers, and nothing else: the claim REFERENCE (its id), the policy number or "no policy number
// yet" (linked to the policy on the insurer's own book), the product, the FPO's PUBLIC name, the subject TYPE, the event type code or "not
// recorded", the event date, "reported within 72 hours" as RECORDED, the status, the approved amount as recorded, the survey's damage
// percentage when recorded (the ONE "%" any PARTNER-3 page prints), filed / last changed / closed. There is NO claimant, name, phone,
// description, media, surveyor, survey note, vet certificate, payout id, village, parcel, creator or tenant id in the SDK type to print.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel, policyNoText, subjectKey } from '../../features/partner2/figures';
import { claimStatusKey, claimStatusTone, damageText, eventLabel, reportedKey } from '../../features/partner3/figures';

/** The event type code's label (or "not recorded") — the heading of every page that prints one claim. */
export function claimEventText(t: Tr, code: string | null | undefined): string {
  const ev = eventLabel(code);
  return 'key' in ev ? t.t(ev.key) : ev.raw;
}

/** The claim's status pill. */
export function ClaimStatusPill({ t, status }: { t: Tr; status: string }) {
  return <p><span className={`kv-status kv-status--${claimStatusTone(status)}`}>{t.t(claimStatusKey(status))}</span></p>;
}

/** The fact block. `damage` = false leaves the damage row out (W259 prints it in its own report block instead, with its three branches). */
export function ClaimFacts({ t, lang, c, damage = true }: { t: Tr; lang: string; c: PartnerInsuranceClaim; damage?: boolean }) {
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const day = (d: string | null) => (d ? formatDate(d, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : t.t('partner3.none'));
  const at = (d: string | null) => (d ? asOfText(d, lang) : t.t('partner3.none'));
  const dmg = damage ? damageText(c.damagePercent) : null;
  const row = (id: string, label: string, value: ReactNode) => <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <dl className="kv-card kv-facts" data-kv-facts={c.id}>
      {row('reference', t.t('partner3.claim.reference'), <span className="kv-code">{c.id}</span>)}
      {row('policy', t.t('partner3.claim.policy'), <Link href={`/insurer/policies/${encodeURIComponent(c.policyId)}`}>{policyNoText(c.policyNo, t.t('partner2.policies.noNumber'))}</Link>)}
      {row('product', t.t('partner3.claim.product'), c.productName ?? t.t('partner3.none'))}
      {row('fpo', t.t('partner3.claim.fpo'), fpoLabel(c.fpoName, t.t('partner1.fpoUnnamed')))}
      {row('subject', t.t('partner3.claims.colSubject'), t.t(subjectKey(c.subjectType)))}
      {row('event', t.t('partner3.claims.colEvent'), claimEventText(t, c.eventTypeCode))}
      {row('event_date', t.t('partner3.claim.eventDate'), day(c.eventDate))}
      {row('reported', t.t('partner3.claims.colReported'), t.t(reportedKey(c.reportedWithin72h)))}
      {row('sum_insured', t.t('partner3.claims.colSumInsured'), money(c.sumInsuredMinor))}
      {row('approved', t.t('partner3.claim.approved'), c.approvedMinor ? t.t('partner3.claim.approvedRecorded', { amount: money(c.approvedMinor) }) : t.t('partner3.claim.noneRecorded'))}
      {dmg && row('damage', t.t('partner3.claim.damage'), t.t('partner3.claim.damageRecorded', { value: dmg }))}
      {row('filed', t.t('partner3.claim.filed'), at(c.filedAt))}
      {row('changed', t.t('partner3.claim.changed'), at(c.lastChangedAt))}
      {row('closed', t.t('partner3.claim.closed'), c.closedAt ? at(c.closedAt) : t.t('partner3.claim.notClosed'))}
    </dl>
  );
}
