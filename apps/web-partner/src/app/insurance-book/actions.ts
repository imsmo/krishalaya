'use server';
// apps/web-partner/src/app/insurance-book/actions.ts · insurer authoring writes (PC-55 B7, on W54-9).
// Two acts: publish a product (its premium formula IS the product) and issue a policy.
//
// NO PREMIUM, NO COVER — the API refuses issuance until a premium payment is linked, and only from 'proposed'. This
// action does not try to be clever about that: it sends, and translates a refusal into a sentence. What it DOES
// guarantee locally is that a policy number is real text and that any parametric trigger JSON parses, so an insurer
// is never told "invalid" for something the console could have explained precisely.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildIssue, buildProduct } from '../../features/insurance/authoring';
import { parseMajorToMinor } from '../../features/money';

function back(qs: string): never { redirect(`/insurance-book?${qs}`); }
function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';     // includes "no premium payment linked — no premium, no cover"
    if (e.status === 400 || e.status === 422) return 'invalid';
  }
  return 'generic';
}

export async function createProductAction(formData: FormData): Promise<void> {
  await requirePartner();
  const built = buildProduct({
    partnerId: String(formData.get('partnerId') ?? ''),
    productKindId: String(formData.get('productKindId') ?? ''),
    defaultName: String(formData.get('defaultName') ?? ''),
    mode: String(formData.get('mode') ?? ''),
    pct: String(formData.get('pct') ?? ''),
    flatMajor: String(formData.get('flatMajor') ?? ''),
    parametricJson: String(formData.get('parametricJson') ?? ''),
    sumInsuredJson: String(formData.get('sumInsuredJson') ?? ''),
    govtSubsidyBps: String(formData.get('govtSubsidyBps') ?? ''),
    ourCommissionBps: String(formData.get('ourCommissionBps') ?? ''),
  }, parseMajorToMinor);
  if (!built.ok) back(`error=pr_${built.error}`);
  try {
    // A product is a catalogue entry a double-submit must not duplicate (Law 3).
    await partnerClient().insuranceAuthoring.createProduct(built.value, randomUUID());
  } catch (e) { back(`error=${apiErrorKey(e)}`); }
  revalidatePath('/insurance-book'); revalidatePath('/insurance-products');
  back('ok=product');
}

export async function issuePolicyAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = String(formData.get('policyId') ?? '').trim();
  if (!id) redirect('/insurance-book');
  const built = buildIssue({
    policyNo: String(formData.get('policyNo') ?? ''),
    triggersJson: String(formData.get('triggersJson') ?? ''),
  });
  if (!built.ok) back(`error=is_${built.error}`);
  try { await partnerClient().insuranceAuthoring.issuePolicy(id, built.value); }
  catch (e) { back(`error=${apiErrorKey(e)}`); }
  revalidatePath('/insurance-book'); revalidatePath('/insurance-policies');
  back('ok=issued');
}
