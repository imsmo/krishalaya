// apps/web-partner/src/components/partner1/ChainNotice.tsx · PC-56 PARTNER-1a — ONE DECOR / PARITY-DECOR chain page (W2926–W2928, W2937–W2943,
// W3002–W3005): a query state of its parent page (`/dashboard?retry=confirm` …). It says what is TRUE of that step — a re-read writes nothing,
// no ticket desk exists, nothing on the settings page is writable by a partner — prints the chain's refusals by name, and links back to the
// page (never the canon's "Retry — back to confirm" on a form chain: DELTA chain_retry_defect). No form, no act, nothing written.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { RefusalList } from './RefusalList';
import { chainById, type ChainId } from '../../features/partner1/refusals';

export function ChainNotice({ t, chain, state }: { t: Tr; chain: ChainId; state: string }) {
  const c = chainById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p>{t.t(`${k}.body`)}</p>
      <RefusalList t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={c.page} data-kv-back={c.page}>{t.t('partner1.chain.reload')}</Link></p>
    </section>
  );
}
