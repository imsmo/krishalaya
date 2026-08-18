// apps/web-admin/src/app/recon/ledger/[id]/page.tsx · W065, one transaction (PC-56 ADMIN-6).
//
// W065 prints the arithmetic — `−4860000 + 72900 + 48600 + 4738500 = 0 ✓` — and the hash chain, and says of a
// mismatch: **"Verification recomputes locally — a mismatch here is a P0 incident, not a retry."**
//
// UNTIL THIS WAVE NOTHING ON THE PLATFORM READ `prev_hash`. Every entry has carried a hash since 0006 and no code
// recomputed one, compared one, or selected the column at all; `last_entry_hash` was read in exactly one place and
// only to EXTEND the chain. So "tamper-evident" was a comment, and this screen's Verify button had nothing behind it.
//
// TWO KINDS OF BREAK, REPORTED SEPARATELY, because they are different investigations: a `hash_mismatch` means somebody
// EDITED a row, a `chain_break` means somebody INSERTED or REMOVED one. And a clean walk with a DIFFERING HEAD is
// still a tampered ledger — it is the only signal that notices a tail deleted and a head hash rewritten to match.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { verifyChainAction } from '../../actions';
import { Button, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  balanceTone, balanceLabel, legDirection, legTone, shortHash, referenceText, txnTypeCell,
  outcomeTone, verifyMessageKey, isIncident, type Leg, type TxnBalance, type VerifyResult,
} from '../../../../features/ledger/ledger';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lg.txnTitle'), robots: { index: false, follow: false } };
}

interface Txn {
  id: string; txnType: string | null; txnTypeResolved: boolean; tenantId: string | null;
  referenceType: string | null; referenceId: string | null; description: string | null;
  idempotencyKey: string | null; initiatedBy: string | null; createdAt: string;
  legs: Leg[]; balance: TxnBalance; hashPreimage: string; writerSources: string[];
}

const ERR = new Set(['elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function LedgerTxnPage({ params, searchParams }: {
  params: { id: string }; searchParams: { error?: string; verified?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let x: Txn | undefined; let notice: string | undefined;
  try { x = (await adminGet<Txn>(`ledger/transactions/${encodeURIComponent(params.id)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  let verify: VerifyResult | undefined;
  if (searchParams.verified) {
    try { verify = JSON.parse(Buffer.from(searchParams.verified, 'base64').toString()) as VerifyResult; }
    catch { verify = undefined; }
  }
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!x) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/recon/ledger">{t.t('lg.backExplorer')}</Link></p>
        <h1>{t.t('lg.txnHeading')}</h1>
        {/* W065's own empty state names the way to find one: retried operations share a transaction. */}
        <p className="kv-error" role="alert">{notice}</p>
        <p className="kv-muted">{t.t('lg.findByKey')}</p>
      </section>
    );
  }

  const ty = txnTypeCell(x);
  const msgKey = verifyMessageKey(verify);
  const incident = isIncident(verify);

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon/ledger">{t.t('lg.backExplorer')}</Link></p>
      <h1><code>{x.id}</code></h1>
      {errKey && <p className="kv-error" role="alert">{t.t(`lg.error.${errKey}`)}</p>}

      {/* The Σ, recomputed from the legs on every read. There is no `is_balanced` column and there should not be: a
          stored flag is a claim that can disagree with the rows this screen exists to show. */}
      <p><StatusPill tone={balanceTone(x.balance)} label={balanceLabel(x.balance)} /></p>

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('lg.col.type')}</dt><dd>{ty.known ? ty.text : t.t('lg.typeUnresolved')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('lg.col.reference')}</dt><dd>{referenceText(x)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('lg.col.tenant')}</dt><dd>{x.tenantId ?? t.t('lg.platform')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('lg.initiatedBy')}</dt><dd>{x.initiatedBy ?? t.t('common.dash')}</dd></div>
        {/* Shown because W065 shows it and because "retried operations share one txn" is how an operator finds this
            row again after a timeout. */}
        <div className="kv-facts__row"><dt>{t.t('lg.idempotencyKey')}</dt><dd><code>{x.idempotencyKey ?? t.t('common.dash')}</code></dd></div>
        <div className="kv-facts__row"><dt>{t.t('lg.col.when')}</dt><dd>{x.createdAt}</dd></div>
        {x.description && <div className="kv-facts__row"><dt>{t.t('lg.description')}</dt><dd>{x.description}</dd></div>}
      </dl>

      <h2>{t.t('lg.legsHeading')}</h2>
      <table className="kv-table">
        <thead><tr>
          <th>{t.t('lg.col.entry')}</th><th>{t.t('lg.col.account')}</th><th>{t.t('lg.col.minor')}</th>
          <th>{t.t('lg.col.amount')}</th><th>{t.t('lg.col.balanceAfter')}</th><th>{t.t('lg.col.hash')}</th>
        </tr></thead>
        <tbody>
          {x.legs.map((l) => {
            const d = legDirection(l.amountMinor);
            return (
              <tr key={l.id}>
                <td><code>{l.id}</code></td>
                <td>
                  {l.accountCode ?? t.t('common.dash')}
                  {l.shardNo !== null && l.ownerKind === 'platform' && <span className="kv-detail__muted"> · stripe {l.shardNo}</span>}
                  <div className="kv-detail__muted">{l.ownerKind ?? t.t('common.unknown')} · {l.tenantId ?? t.t('lg.platform')}</div>
                </td>
                {/* The raw minor units beside the formatted figure. On the money screens the unrounded integer is the
                    value of record and the pretty one is the courtesy. */}
                <td><code><StatusPill tone={legTone(d)} label={l.amountMinor} /></code></td>
                <td>{l.amountText}</td>
                <td>{l.balanceAfterText}</td>
                <td>
                  <code title={l.entryHash}>{shortHash(l.entryHash)}</code>
                  <div className="kv-detail__muted">{t.t('lg.prev')} <code title={l.prevHash ?? ''}>{shortHash(l.prevHash)}</code></div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {x.legs.length === 0 && <EmptyState variant="empty" title={t.t('lg.noLegs')} />}

      {/* W065 prints the arithmetic so a reader can check it by eye — which is the entire point of showing it rather
          than a tick. */}
      <pre className="kv-pre">{x.balance.equation}</pre>
      <p className="kv-detail__muted">{t.t('lg.chainNote', { preimage: x.hashPreimage })}</p>

      <h2>{t.t('lg.verifyHeading')}</h2>
      <p className="kv-muted">{t.t('lg.verifyLead')}</p>
      {x.legs.length > 0 && (
        <form action={verifyChainAction} className="kv-form">
          <input type="hidden" name="txnId" value={x.id} />
          <label htmlFor="acct" className="kv-field__label">{t.t('lg.verifyAccount')}</label>
          <select id="acct" name="accountId" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('common.choose')}</option>
            {x.legs.map((l) => (
              <option key={l.accountId} value={l.accountId}>
                {l.accountCode ?? l.accountId}{l.ownerKind === 'platform' && l.shardNo !== null ? ` · stripe ${l.shardNo}` : ''}
              </option>
            ))}
          </select>
          <Button type="submit">{t.t('lg.verify')}</Button>
        </form>
      )}

      {verify && (
        <>
          {/* A P0 is announced as one. W065: "a mismatch here is a P0 incident, not a retry" — so there is no retry
              button on this result, and the banner says what to do instead. */}
          {incident && <p className="kv-error" role="alert">{t.t('lg.p0Banner')}</p>}
          <dl className="kv-facts">
            <div className="kv-facts__row">
              <dt>{t.t('lg.outcome')}</dt>
              <dd><StatusPill tone={outcomeTone(verify.outcome)} label={t.t(`lg.outcome.${verify.outcome}`)} /></dd>
            </div>
            <div className="kv-facts__row"><dt>{t.t('lg.entriesChecked')}</dt><dd>{verify.entriesChecked}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('lg.fromGenesis')}</dt><dd>{t.t(verify.fromGenesis ? 'common.yes' : 'common.no')}</dd></div>
            {verify.truncated && (
              <div className="kv-facts__row"><dt>{t.t('lg.truncated')}</dt><dd>{t.t('lg.truncatedNote', { n: String(verify.walkLimit) })}</dd></div>
            )}
            <div className="kv-facts__row"><dt>{t.t('lg.headCheck')}</dt><dd>{t.t(`lg.head.${verify.headCheck?.kind ?? 'unknown'}`)}</dd></div>
          </dl>
          <p className={incident ? 'kv-error' : 'kv-muted'} role={incident ? 'alert' : undefined}>{t.t(`lg.verifyMsg.${msgKey}`)}</p>
          {verify.outcome === 'broken' && (
            <pre className="kv-pre">{`entry ${verify.brokenAtEntryId}\nexpected ${verify.expectedHash}\nstored   ${verify.storedHash}`}</pre>
          )}
          <p className="kv-detail__muted">{t.t('lg.verificationRecorded', { id: verify.verificationId })}</p>
        </>
      )}
    </section>
  );
}
