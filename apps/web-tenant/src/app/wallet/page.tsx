// apps/web-tenant/src/app/wallet/page.tsx · W143 — THE ORGANISATION's wallet (PC-56 TENANT-4a).
// Server-first, requireSession-gated, noindex, every string via i18n.
//
// WHAT CHANGED HERE, AND WHY IT IS NOT A REGRESSION.
// Until this wave this page read `wallet.balance` / `wallet.ledger`, and both resolve their subject from
// `ctx.userId` — the signed-in STAFF MEMBER's PERSONAL wallet. In the FPO's own console, under a sidebar
// that says Money, that is the wrong party: an FPO with money in its main account saw a staff member's
// personal balance, which for most staff is zero. The organisation's three accounts (main · commission ·
// hold) have been written since 0006 by five code paths and read by nothing, anywhere. This page is the
// first reader. A staff member's personal wallet lives in the member app, and the page says so rather
// than leaving somebody to wonder where their own balance went.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • each card's figure is the LEDGER's own sum, and where the cached balance disagrees the card says so;
//   • the hold card reads zero and states WHY — no code path freezes tenant money (TENANT-3b);
//   • ledger health reports only what a tenant can assert about its OWN book (its cached balances against
//     its own entries; its own hash chain, verified with the writer's own function) and says plainly that
//     platform-wide reconciliation is the platform's assurance, not a number restated here;
//   • the escrow figure is the exact net of escrow legs carrying this tenant's id, labelled with that basis;
//   • "Add funds (UPI)" and the payout-bank change with its 24h cooling period are NAMED as not built,
//     rather than drawn as controls that would look like they moved money.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  ORG_ACCOUNTS, cardMinor, cardState, needsDriftNotice, holdNoteKey, healthIcon, healthLabelKey,
  chainPhraseKey, escrowNoteKey, direction, gapNoteKey, isGapNamed, referenceHref,
} from '../../features/wallet/org-console';
import type { OrgWalletOverview } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wal.title'), robots: { index: false, follow: false } };
}

export default async function WalletPage() {
  await requireSession('/wallet');
  const t = getTranslator();
  const lang = getLang();
  const canView = tenantHasPerm('wallet.org_view');

  // Reflect-never-grant: the permission gate is the API's (0142's `wallet.org_view`); the page reflects it
  // so an operator without the key reads a sentence instead of an empty screen that looks broken.
  if (!canView) {
    return (
      <section>
        <h1>{t.t('wal.title')}</h1>
        <p className="kv-empty" role="status">{t.t('wal.restricted')}</p>
      </section>
    );
  }

  let ov: OrgWalletOverview | null = null;
  try {
    ov = await tenantClient().orgWallet.overview();
  } catch {
    ov = null;
  }

  if (!ov) {
    return (
      <section>
        <h1>{t.t('wal.title')}</h1>
        {/* Law 12: the balances failed to load; the ledger is unaffected and payouts run on schedule. */}
        <p className="kv-error" role="alert">{t.t('wal.loadError')}</p>
      </section>
    );
  }

  const ccy = ov.currencyCode;
  const hold = ov.accounts.find((a) => a.code === 'hold');

  return (
    <section>
      <h1>{t.t('wal.title')}</h1>
      <p className="kv-muted">{t.t('wal.intro')}</p>
      {/* The personal wallet is a different party's money and lives in a different app. Said once, here. */}
      <p className="kv-field__hint">{t.t('wal.notYourPersonalWallet')}</p>

      <div className="kv-cards">
        {ORG_ACCOUNTS.map((code) => {
          const a = ov!.accounts.find((x) => x.code === code)!;
          return (
            <div key={code} className="kv-card kv-card--money">
              <h2 className="kv-card__title">{t.t(`wal.account.${code}`)}</h2>
              <p className="kv-card__figure">{formatMoneyMinor(cardMinor(a.verdict), ccy, lang)}</p>
              <p className="kv-field__hint">{t.t(`wal.accountMeaning.${code}`)}</p>
              <p className="kv-badge">{t.t(`wal.state.${cardState(a.verdict)}`)}</p>
              {a.isFrozen && <p className="kv-badge kv-badge--frozen">{t.t('wal.frozen')}</p>}
              {/* Drift is stated on the card that has it — the figure above is the ledger's, always. */}
              {needsDriftNotice(a.verdict) && a.verdict.kind === 'drifted' && (
                <p className="kv-note" role="status">
                  {t.t('wal.driftNotice', { cached: formatMoneyMinor(a.verdict.cachedMinor, ccy, lang), drift: formatMoneyMinor(a.verdict.driftMinor, ccy, lang) })}
                </p>
              )}
              {code === 'hold' && <p className="kv-note">{t.t(holdNoteKey(ov!.holdBasis))}</p>}
            </div>
          );
        })}
      </div>

      {/* W143's "Add funds (UPI)" and the payout-bank card: named, not drawn. */}
      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('wal.gapsTitle')}</h2>
        <ul className="kv-list">
          {isGapNamed(ov.gaps, 'add_funds') && <li>{t.t(gapNoteKey('add_funds'))}</li>}
          {isGapNamed(ov.gaps, 'payout_bank_change') && <li>{t.t(gapNoteKey('payout_bank_change'))}</li>}
          {isGapNamed(ov.gaps, 'tenant_hold_freeze') && <li>{t.t(gapNoteKey('tenant_hold_freeze'))}</li>}
        </ul>
      </div>

      <h2 className="kv-section-title">{t.t('wal.todayTitle')}</h2>
      {ov.today.length === 0 ? (
        <p className="kv-empty" role="status">{t.t('wal.todayEmpty')}</p>
      ) : (
        <ul className="kv-feed">
          {ov.today.map((m) => {
            const href = referenceHref(m.referenceType, m.referenceId);
            return (
              <li key={m.entryId} className={`kv-feed__row kv-feed__row--${direction(m.amountMinor)}`}>
                <span className="kv-feed__type">{m.txnType ?? t.t('common.dash')}</span>
                <span className="kv-feed__amount">{formatMoneyMinor(m.amountMinor, m.currencyCode, lang)}</span>
                <span className="kv-feed__account">{t.t(`wal.account.${m.accountCode}`)}</span>
                <span className="kv-feed__ref">
                  {href ? <Link href={href}>{m.referenceId}</Link> : (m.referenceId ?? t.t('common.dash'))}
                </span>
                <span className="kv-feed__at">{formatDate(m.createdAt, lang)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="kv-section-title">{t.t('wal.healthTitle')}</h2>
      <ul className="kv-list kv-health">
        {ov.health.map((h) => (
          <li key={h.check} className={`kv-health__row kv-health__row--${h.state}`}>
            <span aria-hidden="true">{healthIcon(h.state)}</span>
            <span>{t.t(healthLabelKey(h.check))}</span>
            {/* Four vocabularies, deliberately: 'unverifiable' must never read as a tick. */}
            <span className="kv-badge">{t.t(`wal.healthState.${h.state}`)}</span>
            {h.check === 'own_chain' && ov!.chain && (
              <span className="kv-muted">{t.t(chainPhraseKey(ov!.chain.verdict.kind as never, ov!.chain.headMatches))}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="kv-field__hint">{t.t('wal.healthPlatformNote')}</p>

      <h2 className="kv-section-title">{t.t('wal.escrowTitle')}</h2>
      <div className="kv-card">
        <p className="kv-card__figure">{formatMoneyMinor(ov.escrow.heldMinor, ccy, lang)}</p>
        <p className="kv-field__hint">{t.t(escrowNoteKey(ov.escrow.heldMinor), { count: String(ov.escrow.orderCount) })}</p>
        {/* The basis, named on the screen: this is the net of the platform escrow account's legs that carry
            this tenant's id — arithmetic off the book, not a cached projection. */}
        <p className="kv-note">{t.t('wal.escrowBasis')}</p>
      </div>

      <p className="kv-pager">
        <Link href="/wallet/transactions" className="kv-btn--link">{t.t('wal.openLedger')}</Link>
      </p>
      {hold && hold.entryCount === 0 && <p className="kv-field__hint">{t.t('wal.holdNeverWritten')}</p>}
    </section>
  );
}
