// core/idempotency/idempotency.service.ts
// Records (key -> response) for 24h so a retried mutation (village 2G networks
// retry constantly) returns the original result instead of acting twice (Law 3).
// PC-56 HOTFIX-8 · B12: "for 24h" is now TRUE in the implementation — a key past its `expires_at` is treated as absent and re-claimed
// (acts once more, deterministically), never replayed-or-not depending on when the purge last ran (idempotency.service.pg.ts).
export abstract class IdempotencyService {
  abstract remember<T>(key: string, userId: string | undefined, endpoint: string, fn: () => Promise<T>): Promise<T>;
}
export const IDEMPOTENCY_SERVICE = Symbol('IDEMPOTENCY_SERVICE');
