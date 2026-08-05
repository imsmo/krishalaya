// core/backpressure/backpressure.interceptor.ts · PC-51. Global interceptor: classify → tryAcquire →
// (503 + Retry-After on shed) → release on finalize (success, error, or client abort — always exactly once).
// Registered AFTER auth guards run is irrelevant — this is capacity, not authorization; it must be cheap.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { ConcurrencyLimiter, classify, configFromEnv } from './backpressure';

@Injectable()
export class BackpressureInterceptor implements NestInterceptor {
  readonly limiter = new ConcurrencyLimiter(configFromEnv(process.env));

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const acquired = this.limiter.tryAcquire(classify(req.url ?? req.originalUrl ?? '', req.method));
    if (!acquired.ok) {
      if (res?.setHeader) res.setHeader('Retry-After', String(acquired.retryAfterSec));
      throw new ServiceUnavailableException({ code: 'OVERLOADED', message: 'Server is shedding load; retry shortly.' });
    }
    return next.handle().pipe(finalize(acquired.release));
  }
}
