// apps/mobile/src/features/kyc/bank.api.ts · bank-account (payout destination) data layer. Lists the caller's
// tokenised accounts (read, degrade) and adds one (idempotent). An account stores a gateway-tokenised `vaultRef`
// + last-4/IFSC only — the raw account number / VPA is tokenised at the gateway and NEVER sent here in the clear.
//
// Two add paths: a UPI / pre-tokenised destination via addBank() (caller already holds a vaultRef), and a FULL
// bank account via addFullBank() (P1-16) — the raw account number + IFSC are sent ONCE and the SERVER tokenises
// them at the gateway, persisting only the vault ref + last-4 (raw number never stored/logged on device or server).
import type { BankAccount } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export async function listBanks(): Promise<BankAccount[]> {
  try { return await apiClient().bankAccounts.list(); }
  catch { return []; }
}

/** Add a tokenised payout destination (UPI, or a vaultRef the caller already holds). Idempotent (Law 3). */
export async function addBank(input: { accountKind: 'bank' | 'upi'; vaultRef: string; upiId?: string; accountLast4?: string; ifsc?: string; holderName?: string; isPrimary?: boolean }): Promise<BankAccount> {
  return apiClient().bankAccounts.add(input, newId());
}

/** P1-16 · add a FULL bank account: the server tokenises the raw account number + IFSC at the gateway and stores
 * only the vault ref + last-4. The raw number leaves the device once over TLS and is never persisted. Idempotent. */
export async function addFullBank(input: { accountNumber: string; ifsc: string; holderName: string; isPrimary?: boolean }): Promise<{ id: string }> {
  return apiClient().bankAccounts.addFull(input, newId());
}
