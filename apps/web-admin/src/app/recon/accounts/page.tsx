// apps/web-admin/src/app/recon/accounts/page.tsx · W059, wallet accounts (PC-56 ADMIN-6).
//
// **THE DEFECT: THE CONSOLE HAS BEEN SHOWING ONE STRIPE AND CALLING IT THE BALANCE.** 0006's own comment on
// `shard_no` says "true balance = SUM over stripes", and `GET /v1/recon/accounts/:id` returned one row by id — so a
// platform escrow balance read here was roughly 1/16th of the money, with nothing on the screen saying so. There was
// also no accounts LIST at all: the drill-in was reachable only by pasting a UUID into the address bar.
//
// A Σ THE PLATFORM IS NOT SURE ABOUT DOES NOT RENDER AS A PLAIN NUMBER. A hole in the stripe set means a row that was
// never created and money that landed somewhere this query did not look, so the total carries its stripe count and the
// gap is named. "₹8,64,12,480" and "₹8,64,12,480 over 15 of 16 stripes" are different facts about the same money.
//
// AND "HASH CHAIN INTACT" NOW HAS A DATE OR SAYS NEVER. W059 printed "intact" per account code while nothing on the
// platform read `prev_hash`. A tamper-evidence claim is worth exactly as much as the last time somebody checked.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { verifyBalanceAction } from '../actions';
import { Button, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  formatMinor, sumWarningKey, sumTone, claimTone, claimKey, chainCoverage, type AccountGroup,
} from '../../../features/ledger/ledger';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wa.title'), robots: { index: false, follow: false } };
}

interface Board {
  groups: AccountGroup[]; totalStripeRows: number;
  expectedCodes: string[]; missingCodes: string[];
}
interface Owned {
  id: string; ownerKind: string; accountCode: string; currencyCode: string; shardNo: number;
  cachedBalanceMinor: string; cachedBalanceText: string; balanceVersion: string;
  hasChainHead: boolean; isFrozen: boolean; freezeReason: string | null;
}

const OK = new Set(['verified', 'drift']);

export default async function WalletAccountsPage({ searchParams }: {
  searchParams: { ownerKind?: string; frozenOnly?: string; cursor?: string; ok?: string; error?: string; delta?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const ownerKind = searchParams.ownerKind === 'user' || searchParams.ownerKind === 'tenant' ? searchParams.ownerKind : undefined;
  const frozenOnly = searchParams.frozenOnly === '1';

  let board: Board | undefined; let boardNotice: string | undefined;
  try { board = (await adminGet<Board>('ledger/accounts/platform')).data; }
  catch (e) { boardNotice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  let owned: Owned[] = []; let next: string | null = null; let ownedNotice: string | undefined;
  try {
    const r = await adminGet<Owned[]>('ledger/accounts', {
      ownerKind, ...(frozenOnly ? { frozenOnly: '1' } : {}), cursor: searchParams.cursor,
    });
    owned = r.data; next = (r.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  } catch (e) { ownedNotice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon">{t.t('lg.backRecon')}</Link></p>
      <h1>{t.t('wa.heading')}</h1>
      <p className="kv-muted">{t.t('wa.lead')}</p>
      {okKey === 'verified' && <p className="kv-success" role="status">{t.t('wa.ok.verified')}</p>}
      {okKey === 'drift' && (
        <p className="kv-error" role="alert">{t.t('wa.ok.drift', { delta: formatMinor(searchParams.delta) })}</p>
      )}
      {searchParams.error && <p className="kv-error" role="alert">{t.t('lg.error.generic')}</p>}

      <h2>{t.t('wa.platformHeading')}</h2>
      {!board ? <p className="kv-error" role="alert">{boardNotice}</p> : (
        <>
          {/* An account_code the platform expects with NO rows is money with nowhere to land, and it cannot be inferred
              from a Σ. */}
          {board.missingCodes.length > 0 && (
            <p className="kv-error" role="alert">{t.t('wa.missingCodes', { codes: board.missingCodes.join(', ') })}</p>
          )}
          <table className="kv-table">
            <thead><tr>
              <th>{t.t('wa.col.code')}</th><th>{t.t('wa.col.stripes')}</th><th>{t.t('wa.col.total')}</th>
              <th>{t.t('wa.col.chain')}</th><th>{t.t('wa.col.frozen')}</th>
            </tr></thead>
            <tbody>
              {board.groups.map((g) => {
                const warn = sumWarningKey(g.confidence);
                const cov = chainCoverage(g.chain);
                return (
                  <tr key={`${g.accountCode}-${g.currencyCode}`}>
                    <td>{g.accountCode}<div className="kv-detail__muted">{g.currencyCode}</div></td>
                    <td>{g.stripeCount}{g.missingStripes.length > 0 && <StatusPill tone="danger" label={t.t('wa.gaps', { n: g.missingStripes.join(', ') })} />}</td>
                    <td>
                      <StatusPill tone={sumTone(g.confidence)} label={g.totalText} />
                      {/* A Σ the platform is not sure about carries its reason. */}
                      {warn && <div className="kv-error">{t.t(`wa.sumWarn.${warn}`)}</div>}
                    </td>
                    <td>
                      <StatusPill tone={claimTone(g.chain?.claim)} label={t.t(`wa.chain.${claimKey(g.chain?.claim)}`)} />
                      {/* 16 stripes with 1 verification is not "intact" — the claim covers a sixteenth of the money. */}
                      {cov.known && <div className="kv-detail__muted">{t.t('wa.coverage', { v: String(cov.verified), n: String(cov.total) })}</div>}
                    </td>
                    <td>{g.frozenStripes > 0 ? t.t('wa.frozenN', { n: String(g.frozenStripes) }) : t.t('common.dash')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="kv-detail__muted">{t.t('wa.stripeTotal', { n: String(board.totalStripeRows) })}</p>
          <p className="kv-detail__muted">{t.t('wa.suspenseNote')}</p>
        </>
      )}

      <h2>{t.t('wa.ownedHeading')}</h2>
      <nav className="kv-filters">
        <Chip as={Link} href="/recon/accounts" active={!ownerKind && !frozenOnly}>{t.t('wa.filter.all')}</Chip>
        <Chip as={Link} href="/recon/accounts?ownerKind=user" active={ownerKind === 'user'}>{t.t('wa.filter.user')}</Chip>
        <Chip as={Link} href="/recon/accounts?ownerKind=tenant" active={ownerKind === 'tenant'}>{t.t('wa.filter.tenant')}</Chip>
        <Chip as={Link} href="/recon/accounts?frozenOnly=1" active={frozenOnly}>{t.t('wa.filter.frozen')}</Chip>
      </nav>
      {ownedNotice ? <p className="kv-error" role="alert">{ownedNotice}</p> : (
        <>
          <table className="kv-table">
            <thead><tr>
              <th>{t.t('wa.col.owner')}</th><th>{t.t('wa.col.code')}</th><th>{t.t('wa.col.balance')}</th>
              <th>{t.t('wa.col.version')}</th><th>{t.t('wa.col.frozen')}</th><th>{t.t('wa.col.verify')}</th>
            </tr></thead>
            <tbody>
              {owned.map((a) => (
                <tr key={a.id}>
                  <td>{a.ownerKind}<div className="kv-detail__muted"><code>{a.id.slice(0, 8)}…</code></div></td>
                  <td>{a.accountCode}<div className="kv-detail__muted">{a.currencyCode}</div></td>
                  <td>{a.cachedBalanceText}{!a.hasChainHead && <div className="kv-detail__muted">{t.t('wa.neverWritten')}</div>}</td>
                  <td>{a.balanceVersion}</td>
                  <td>{a.isFrozen ? <StatusPill tone="danger" label={a.freezeReason ?? t.t('wa.frozen')} /> : t.t('common.dash')}</td>
                  <td>
                    {/* W059's "Verify balances vs ledger", per account. The same comparison the scheduled sweep makes —
                        the query that existed twice since 0006 and had never run. */}
                    <form action={verifyBalanceAction}>
                      <input type="hidden" name="accountId" value={a.id} />
                      <Button type="submit" variant="tertiary">{t.t('wa.verifyBalance')}</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {owned.length === 0 && <EmptyState variant="empty" title={t.t('wa.ownedEmpty')} />}
          {next && (
            <p className="kv-pager">
              <Link href={`/recon/accounts?${new URLSearchParams({ ...(ownerKind ? { ownerKind } : {}), ...(frozenOnly ? { frozenOnly: '1' } : {}), cursor: next }).toString()}`}>
                {t.t('common.next')}
              </Link>
            </p>
          )}
        </>
      )}
      <p className="kv-detail__muted">{t.t('wa.cacheNote')}</p>
    </section>
  );
}
