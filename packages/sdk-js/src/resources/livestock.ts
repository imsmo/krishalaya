// @krishalaya/sdk-js · livestock resource (PC-50 W10-1 Pashupalak). Animal registry (farmer-owned; server
// enforces ownership — 404 on cross-owner, never enumeration), species/breeds lookups, vet directory and the
// vet-booking lifecycle (requested → accepted → en_route → in_consult → prescribed → completed | cancelled |
// no_show). Money is bigint minor-unit STRINGS (Law 2: booking fee is SERVER-snapshotted from vet_services —
// never client-supplied). Animal registration and booking completion (the payment leg) are Idempotency-Keyed.
import { HttpClient } from '../http';
import { Page } from '../types';

export const VET_BOOKING_STATUSES = ['requested', 'accepted', 'en_route', 'in_consult', 'prescribed', 'completed', 'cancelled', 'no_show'] as const;
export const ANIMAL_RETIRE_REASONS = ['sold', 'deceased', 'lost'] as const;

export interface AnimalSpecies { id: string; code?: string; defaultName?: string; name?: string }
export interface AnimalBreed { id: string; speciesId?: string; defaultName?: string; name?: string }
export interface Animal {
  id: string; ownerUserId: string; speciesId: string; breedId?: string | null; pashuAadhaar?: string | null;
  name?: string | null; sex?: string | null; dobEstimated?: string | null; parity?: number | null;
  lactationStage?: string | null; currentYieldLpd?: string | null; pregnancyStatus?: string | null;
  bodyConditionScore?: string | null; status: string; acquiredVia?: string | null; createdAt?: string;
}
export interface CreateAnimalInput {
  speciesId: string; breedId?: string; pashuAadhaar?: string; name?: string; sex?: 'male' | 'female';
  dobEstimated?: string; parity?: number; lactationStage?: string; currentYieldLpd?: string;
  pregnancyStatus?: string; bodyConditionScore?: string; acquiredVia?: string;
}
export interface VetProfile { id: string; userId?: string; registrationNo?: string | null; displayName?: string | null; qualificationText?: string | null; baseRegionId?: string | null; isAiTechnician?: boolean; createdAt?: string; [k: string]: unknown }
export interface VetService { id: string; vetId: string; serviceTypeId: string; priceMinor: string; pricingUnit?: string; [k: string]: unknown }
export interface VetBooking {
  id: string; farmerUserId: string; vetId: string; serviceId: string; animalId?: string | null;
  urgency: string; mode: string; status: string; feeMinor: string; scheduledAt?: string | null; completedAt?: string | null; createdAt?: string;
}
export interface BookVetInput { vetId: string; serviceId: string; animalId?: string; urgency?: 'emergency' | 'urgent' | 'routine'; mode?: 'visit' | 'tele'; symptomsText?: string; scheduledAt?: string }

export class LivestockResource {
  constructor(private readonly http: HttpClient) {}

  // --- lookups (reference data) ---
  async species(signal?: AbortSignal): Promise<AnimalSpecies[]> {
    return (await this.http.request<AnimalSpecies[]>('GET', 'livestock/species', { signal })).data;
  }
  async breeds(speciesId?: string, signal?: AbortSignal): Promise<AnimalBreed[]> {
    return (await this.http.request<AnimalBreed[]>('GET', 'livestock/breeds', { query: { speciesId }, signal })).data;
  }

  // --- the animal registry (owner-scoped) ---
  async registerAnimal(input: CreateAnimalInput, idempotencyKey: string): Promise<Animal> {
    return (await this.http.request<Animal>('POST', 'livestock/animals', { body: input, idempotencyKey })).data;
  }
  async animals(params: { box?: 'mine' | 'all'; speciesId?: string; pashuAadhaar?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Animal>> {
    const r = await this.http.request<Animal[]>('GET', 'livestock/animals', { query: { box: params.box ?? 'mine', speciesId: params.speciesId, pashuAadhaar: params.pashuAadhaar, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async animal(id: string, signal?: AbortSignal): Promise<Animal> {
    return (await this.http.request<Animal>('GET', `livestock/animals/${encodeURIComponent(id)}`, { signal })).data;
  }
  async updateAnimal(id: string, input: Partial<Omit<CreateAnimalInput, 'speciesId' | 'pashuAadhaar' | 'acquiredVia'>>): Promise<Animal> {
    return (await this.http.request<Animal>('PATCH', `livestock/animals/${encodeURIComponent(id)}`, { body: input })).data;
  }
  async retireAnimal(id: string, reason: 'sold' | 'deceased' | 'lost'): Promise<Animal> {
    return (await this.http.request<Animal>('POST', `livestock/animals/${encodeURIComponent(id)}/retire`, { body: { reason } })).data;
  }

  // --- the vet directory ---
  async vets(params: { baseRegionId?: string; isAiTechnician?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<VetProfile>> {
    const r = await this.http.request<VetProfile[]>('GET', 'livestock/vets', { query: { baseRegionId: params.baseRegionId, isAiTechnician: params.isAiTechnician, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async vet(id: string, signal?: AbortSignal): Promise<{ vet: VetProfile | null; services: VetService[] }> {
    return (await this.http.request<{ vet: VetProfile | null; services: VetService[] }>('GET', `livestock/vets/${encodeURIComponent(id)}`, { signal })).data;
  }

  // --- the vet's OWN practice (PC-50 W10-3; server-gated by vet.manage) ---
  /** Vet self-registration — idempotent (a licence number must never double-register). */
  async registerVet(input: { registrationNo: string; isAiTechnician?: boolean; serviceRadiusKm?: number; baseRegionId?: string }, idempotencyKey: string): Promise<VetProfile> {
    return (await this.http.request<VetProfile>('POST', 'livestock/vets', { body: input, idempotencyKey })).data;
  }
  /** One price per vet+service type (idempotent upsert). priceMinor is a bigint minor STRING (Law 2). */
  async upsertVetService(input: { serviceTypeCode: string; priceMinor: string; pricingUnit?: string; isEmergencyAvailable?: boolean }): Promise<VetService> {
    return (await this.http.request<VetService>('POST', 'livestock/vets/services', { body: input })).data;
  }
  async myVetProfile(signal?: AbortSignal): Promise<{ vet: VetProfile | null; services: VetService[] }> {
    return (await this.http.request<{ vet: VetProfile | null; services: VetService[] }>('GET', 'livestock/vets/me', { signal })).data;
  }
  /** The VET drives the service lifecycle: accept | en_route | in_consult | prescribed | no_show. */
  async progressVetBooking(id: string, action: 'accept' | 'en_route' | 'in_consult' | 'prescribed' | 'no_show'): Promise<VetBooking> {
    return (await this.http.request<VetBooking>('POST', `livestock/vet-bookings/${encodeURIComponent(id)}/progress`, { body: { action } })).data;
  }

  // --- vet bookings (farmer side; fee server-snapshotted) ---
  async bookVet(input: BookVetInput, idempotencyKey: string): Promise<VetBooking> {
    return (await this.http.request<VetBooking>('POST', 'livestock/vet-bookings', { body: input, idempotencyKey })).data;
  }
  async vetBookings(params: { box?: 'farmer' | 'vet'; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<VetBooking>> {
    const r = await this.http.request<VetBooking[]>('GET', 'livestock/vet-bookings', { query: { box: params.box ?? 'farmer', status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async vetBooking(id: string, signal?: AbortSignal): Promise<VetBooking> {
    return (await this.http.request<VetBooking>('GET', `livestock/vet-bookings/${encodeURIComponent(id)}`, { signal })).data;
  }
  async cancelVetBooking(id: string, reason?: string): Promise<VetBooking> {
    return (await this.http.request<VetBooking>('POST', `livestock/vet-bookings/${encodeURIComponent(id)}/cancel`, { body: reason ? { reason } : {} })).data;
  }
  /** Completes the visit and settles the fee (the money leg) — idempotent by law. */
  async completeVetBooking(id: string, idempotencyKey: string): Promise<VetBooking> {
    return (await this.http.request<VetBooking>('POST', `livestock/vet-bookings/${encodeURIComponent(id)}/complete`, { idempotencyKey })).data;
  }

  // --- PC-54 W54-4 livestock depth ---
  /** Lifetime health file (0009 §18.12). eventTypeCode from the 'animal_health_event' vocabulary. */
  async recordHealthEvent(animalId: string, input: { eventTypeCode: string; vetBookingId?: string; batchNo?: string; diagnosis?: string; outcome?: string; nextDueDate?: string }): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', `livestock/animals/${encodeURIComponent(animalId)}/health-events`, { body: input })).data;
  }
  async healthEvents(animalId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', `livestock/animals/${encodeURIComponent(animalId)}/health-events`, { signal })).data;
  }
  /** The written pad — VET-OF-RECORD only (server-enforced); one per booking; Schedule-H flagged per line. */
  async writePrescription(bookingId: string, input: { validUntil?: string; items: Array<{ drugName: string; dosage: string; durationDays?: number; isScheduleH?: boolean; productId?: string }> }): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', `livestock/vet-bookings/${encodeURIComponent(bookingId)}/prescription`, { body: input })).data;
  }
  async prescription(bookingId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    return (await this.http.request<Record<string, unknown> | null>('GET', `livestock/vet-bookings/${encodeURIComponent(bookingId)}/prescription`, { signal })).data;
  }
}
