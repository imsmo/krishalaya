// apps/web-partner/src/app/help/page.tsx · PC-56 PARTNER-1a · founder D4 — help & support REBUILT (canon W272 at `account/help`: DELTA, the built
// `/help` is kept). The partners mailbox comes from the platform's published facts (`GET /v1/storefront/platform-facts`, public) — never a
// literal (F-8). `?ticket=error|review|success|failure` is the W2937–W2940 chain (DECOR: "write to the mailbox"); `?retry=confirm|success|
// failure` the W2941–W2943 chain (PARITY-DECOR: a reload). components/partner1/HelpView.tsx renders.
import type { Metadata } from 'next';
import { requirePartner } from '../../lib/session';
import { anonClient } from '../../lib/api-client';
import { getTranslator } from '../../lib/i18n';
import { HelpView, type Mailbox } from '../../components/partner1/HelpView';
import { ChainNotice } from '../../components/partner1/ChainNotice';
import { chainState } from '../../features/partner1/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.help.title'), robots: { index: false, follow: false } };
}

export default async function HelpPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  const ticket = chainState('help_ticket', searchParams);
  if (ticket) return <ChainNotice t={t} chain="help_ticket" state={ticket} />;
  const retry = chainState('help_retry', searchParams);
  if (retry) return <ChainNotice t={t} chain="help_retry" state={retry} />;
  let mailbox: Mailbox;
  try {
    const facts = await anonClient().storefront.platformFacts();
    const address = facts.contact?.partnersEmail ?? null;
    mailbox = address ? { kind: 'published', address } : { kind: 'none' };
  } catch {
    mailbox = { kind: 'error' };
  }
  return <HelpView t={t} mailbox={mailbox} />;
}
