// modules/tenant-api-keys/guards/api-key-idempotency.interceptor.ts · PC-56 TENANT-13c · LAW 3 FOR KEY-AUTHENTICATED WRITES.
//
// The guard refuses a key write without an Idempotency-Key; this interceptor makes the key MEAN something: the first call runs and its
// response is remembered (core/idempotency, 24 h, scoped by `api_key:<id>` + method + path so one key can never replay another's
// answer), a retry of the same key returns the remembered response and acts nothing twice, a retry while the first is in flight is a
// 409. Applies only to a WRITE scope (orders.status.write, listings.write): the PII reveal is a POST that reads, and its answer is
// never written into the idempotency store.
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, Observable } from 'rxjs';
import { API_SCOPES_KEY } from '../../../core/auth/api-key.port';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { tryGetRequestContext } from '../../../core/tenancy-context/request-context';
import { isWriteScope } from '../domain/api-scopes';

@Injectable()
export class ApiKeyIdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rc = tryGetRequestContext();
    if (!rc?.apiKey || ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const scope = this.reflector.get<string | undefined>(API_SCOPES_KEY, ctx.getHandler());
    if (!scope || !isWriteScope(scope) || req.method === 'GET') return next.handle();
    const key = String(req.headers['idempotency-key'] ?? '');
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    // idempotency_keys.key is varchar(120) and holds `<caller>::<endpoint>::<key>`: the caller is the key id without dashes, the endpoint a
    // 12-hex digest of the exact method + path (so one Idempotency-Key on two different orders is two acts), the key ≤ 64 (the guard).
    const caller = `k:${rc.apiKey.keyId.replace(/-/g, '')}`;
    const endpoint = `${req.method}:${createHash('sha256').update(`${req.method} ${path}`).digest('hex').slice(0, 12)}`;
    return from(this.idem.remember(key, caller, endpoint, () => lastValueFrom(next.handle(), { defaultValue: null })));
  }
}
