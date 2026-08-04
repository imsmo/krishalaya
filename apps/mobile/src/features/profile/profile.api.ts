// apps/mobile/src/features/profile/profile.api.ts · data layer for the profile/farm/bank/docs + help vertical
// (P-22). Keeps screens thin (guide §3). Reads degrade-never-die (null/empty). Writes hit the server and THROW so
// the screen shows the precise outcome: profile update (PATCH /users/me), parcel register + ticket open + bank add
// are idempotent (Law 3); CSAT is a simple rated write. Bank/KYC reads show masked data only — the app never holds
// a raw account number/Aadhaar (DPDP). Money n/a here. The server is the authority on KYC verification + SLA.
import type { UserProfile, SupportTicket, LandParcel, BankAccount, KycDocument, ReviewSummary } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';
import type { ProfilePatch, TicketInput, ParcelInput } from './profile';

export interface TicketsPage { items: SupportTicket[]; nextCursor: string | null }
export interface ParcelsPage { items: LandParcel[]; nextCursor: string | null }

// --- profile ---
export async function getMyProfile(): Promise<UserProfile | null> {
  try { return await apiClient().users.me(); } catch { return null; }
}
export function updateMyProfile(patch: ProfilePatch): Promise<UserProfile> {
  return apiClient().users.updateMe(patch); // PATCH /users/me — throws on a real error
}

/** The caller's own rating AS A BUYER (sellers rate buyers) — screen 132 "Farmer rating" stat + hero badge.
 * Public read; degrades to an empty summary so the stat shows "—" rather than crashing. */
export async function myBuyerRating(userId: string): Promise<ReviewSummary> {
  try { return await apiClient().reviews.summary({ targetType: 'buyer', targetId: userId }); }
  catch { return { averageStars: 0, count: 0 }; }
}

// --- farm parcels ---
export async function myParcels(cursor?: string): Promise<ParcelsPage> {
  try { return await apiClient().parcels.mine({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
export function registerParcel(input: ParcelInput): Promise<LandParcel> {
  return apiClient().parcels.register(input, newId()); // idempotent (Law 3)
}

// --- bank accounts (list masked; add UPI) ---
export async function myBankAccounts(): Promise<BankAccount[]> {
  try { return await apiClient().bankAccounts.list(); } catch { return []; }
}
/** Add a UPI payout destination. A VPA is a public payment address (not a secret), so it is its own vaultRef. Idempotent. */
export function addUpiAccount(input: { upiId: string; holderName?: string; isPrimary?: boolean }): Promise<BankAccount> {
  return apiClient().bankAccounts.add({ accountKind: 'upi', upiId: input.upiId, vaultRef: `upi:${input.upiId}`, holderName: input.holderName, isPrimary: input.isPrimary }, newId());
}

/** Add a FULL bank account (screen 74). The RAW account number + IFSC are sent ONCE to the server, which tokenises
 * them at the gateway (penny-drop ownership check) and persists ONLY a vault ref + last-4 — the raw number is never
 * stored/logged on client or server (§4/DPDP, P1-16). Idempotent (Law 3). Throws so the screen shows the outcome. */
export function addBankAccountFull(input: { accountNumber: string; ifsc: string; holderName: string; accountType?: 'savings' | 'current'; isPrimary?: boolean }): Promise<{ id: string }> {
  return apiClient().bankAccounts.addFull(input, newId());
}

// --- documents (KYC) ---
export async function myDocuments(): Promise<KycDocument[]> {
  try { return await apiClient().kyc.list(); } catch { return []; }
}

// --- support tickets (help + complaint) ---
export async function myTickets(cursor?: string): Promise<TicketsPage> {
  try { return await apiClient().support.myTickets({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getTicket(id: string): Promise<SupportTicket | null> {
  try { return await apiClient().support.get(id); } catch { return null; }
}
export function openTicket(input: TicketInput): Promise<SupportTicket> {
  return apiClient().support.open(input, newId()); // idempotent (Law 3)
}
export function rateTicket(id: string, score: number): Promise<SupportTicket> {
  return apiClient().support.submitCsat(id, score);
}
/** GET /v1/support/tickets/:id/thread (screen 520, KV-BL-034/052) — lazily creates (first call) or returns the
 * existing chat thread linked to this ticket. Requester-or-agent-only (404 for a stranger). THROWS on failure so
 * the "Chat with support" tap can show a precise error rather than silently doing nothing. */
export function openTicketThread(id: string): Promise<{ conversationId: string }> {
  return apiClient().support.thread(id);
}
