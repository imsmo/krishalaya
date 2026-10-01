'use server';
// apps/web-tenant/src/app/content/faq/act/actions.ts · the FAQ mutate chain's act (the reorder) — W2610/W2611 · PC-56
// TENANT-8c. Posts the move WITH ITS REASON under the key the confirm step minted (F-17: a double-click is one move); the
// server locks the topic and judges the move against the order AS IT STANDS (a confirm screen is not a token).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { FAQ_ACT_HREF, FAQ_HREF, isDirection } from '../../../../features/pages/pages';

export async function faqMoveAction(formData: FormData): Promise<void> {
  await requireSession(FAQ_ACT_HREF);
  const slug = String(formData.get('slug') ?? '').trim();
  const direction = String(formData.get('direction') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const values = { slug, direction, reason };
  if (!slug || !isDirection(direction) || reason.length === 0) redirect(`${FAQ_ACT_HREF}?${carryValues('confirm', values).query}`);
  let out: { id: string | null; position: number; topic: string | null };
  try {
    out = await tenantClient().cms.faq.reorder({ slug, direction, reason }, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'move') : 'move';
    redirect(`${FAQ_ACT_HREF}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(FAQ_HREF);
  redirect(`${FAQ_ACT_HREF}?${new URLSearchParams({ step: 'success', slug, direction, position: String(out.position), topic: out.topic ?? '', id: out.id ?? '' }).toString()}`);
}
