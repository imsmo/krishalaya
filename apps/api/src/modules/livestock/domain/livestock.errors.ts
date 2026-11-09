// modules/livestock/domain/livestock.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class AnimalNotFoundError extends NotFoundError { constructor(id: string) { super('Animal not found'); (this as any).code = 'ANIMAL_NOT_FOUND'; (this as any).details = { id }; } }
export class SpeciesNotFoundError extends NotFoundError { constructor(id: string) { super('Animal species not found'); (this as any).code = 'SPECIES_NOT_FOUND'; (this as any).details = { id }; } }
export class BreedNotFoundError extends DomainError { constructor(id: string) { super('BREED_INVALID', 'Breed does not exist or does not belong to the species', 422, { id }); } }
export class VetProfileNotFoundError extends NotFoundError { constructor(id: string) { super('Vet profile not found'); (this as any).code = 'VET_NOT_FOUND'; (this as any).details = { id }; } }
export class VetServiceNotFoundError extends NotFoundError { constructor(id: string) { super('Vet service not found'); (this as any).code = 'VET_SERVICE_NOT_FOUND'; (this as any).details = { id }; } }
export class VetBookingNotFoundError extends NotFoundError { constructor(id: string) { super('Vet booking not found'); (this as any).code = 'VET_BOOKING_NOT_FOUND'; (this as any).details = { id }; } }

/** A user may register only ONE vet profile (vet_profiles.user_id is UNIQUE). */
export class VetAlreadyRegisteredError extends AppError { constructor() { super('VET_ALREADY_REGISTERED', 'You already have a vet profile', 409); } }
/** Pashu Aadhaar (INAPH 12-digit) collides with an existing animal (UNIQUE). */
export class PashuAadhaarExistsError extends AppError { constructor() { super('PASHU_AADHAAR_EXISTS', 'An animal with this Pashu Aadhaar already exists', 409); } }
/** Service price below zero / invalid. */
export class InvalidVetServiceError extends DomainError { constructor(message: string) { super('VET_SERVICE_INVALID', message, 422); } }
/** Unknown vet_service lookup code. */
export class InvalidVetServiceTypeError extends DomainError { constructor(code: string) { super('VET_SERVICE_TYPE_INVALID', `Unknown vet service type '${code}'`, 422, { code }); } }
/** Caller is not the farmer / vet / admin entitled to act here. */
export class LivestockForbiddenError extends AppError { constructor(message = 'Not allowed on this resource') { super('LIVESTOCK_FORBIDDEN', message, 403); } }
/** Settling a fee on a booking whose state forbids it. */
export class BookingNotCompletableError extends DomainError { constructor(status: string) { super('BOOKING_NOT_COMPLETABLE', `Vet booking cannot be completed from status '${status}'`, 409, { status }); } }
/** The service does not belong to the chosen vet (anti-IDOR). */
export class ServiceVetMismatchError extends DomainError { constructor() { super('SERVICE_VET_MISMATCH', 'The chosen service does not belong to that vet', 422); } }

// [PC-56 HOTFIX-13 · founder Q1-A, 2026-11-09] NOBODY SPENDS HER MONEY OR READS HER ANIMAL'S RECORD BUT HER.
/** The vet fee moves from the FARMER's wallet — only she completes and pays (the administrator escape is gone). */
export class VetPayNotFarmerError extends AppError { constructor() { super('VET_PAY_NOT_FARMER', 'Only the farmer who booked this vet can confirm the visit and pay the fee, from her own account.', 403); } }
/** A health event names a vet booking that is not a booking on THIS animal (or, for a vet, not the vet's own booking). */
export class HealthBookingNotThisAnimalError extends DomainError { constructor() { super('HEALTH_BOOKING_NOT_THIS_ANIMAL', 'That vet booking is not a booking on this animal.', 422); } }
