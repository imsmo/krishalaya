// apps/web-partner/src/lib/partners-mailbox.ts · PC-56 PARTNER-1b — the partners mailbox FACT for the pages that say "write to the partners
// mailbox" (keys, webhooks, readiness): the platform's published facts (public), never a literal. The help page reads the same fact itself.
import 'server-only';
import { anonClient } from './api-client';
import type { Mailbox } from '../components/partner1/HelpView';

export async function partnersMailbox(): Promise<Mailbox> {
  try {
    const facts = await anonClient().storefront.platformFacts();
    const address = facts.contact?.partnersEmail ?? null;
    return address ? { kind: 'published', address } : { kind: 'none' };
  } catch { return { kind: 'error' }; }
}
