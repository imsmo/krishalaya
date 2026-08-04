// apps/realtime-gateway/src/config.ts · fail-closed configuration (§4: refuse to start insecure in prod).
// The gateway verifies the SAME access JWT the api mints, so it reuses JWT_ACCESS_SECRET/ISSUER/AUDIENCE.
// REDIS_URL is required (that's where the publisher fans out); without it there is nothing to relay.

export interface GatewayConfig {
  port: number;
  redisUrl: string;
  jwt: { accessSecret: string; issuer: string; audience: string };
  limits: { maxSubscriptions: number; maxBufferedBytes: number; maxQueuedMessages: number };
  prod: boolean;
}

function isWeak(s: string | undefined): boolean {
  return !s || s.length < 32 || /^(dev|test|change|secret|password|default)/i.test(s);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const prod = (env.NODE_ENV ?? 'development') === 'production';
  const cfg: GatewayConfig = {
    port: Number(env.REALTIME_PORT ?? env.PORT ?? 8090),
    redisUrl: env.REDIS_URL ?? '',
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET ?? '',
      issuer: env.JWT_ISSUER ?? 'krishalaya',
      audience: env.JWT_AUDIENCE ?? 'krishalaya-app',
    },
    limits: {
      maxSubscriptions: Number(env.RT_MAX_SUBSCRIPTIONS ?? 50),
      maxBufferedBytes: Number(env.RT_MAX_BUFFERED_BYTES ?? 1_000_000),
      maxQueuedMessages: Number(env.RT_MAX_QUEUED_MESSAGES ?? 100),
    },
    prod,
  };

  // Fail CLOSED in production: a weak/missing JWT secret would let anyone forge a socket identity.
  const problems: string[] = [];
  if (prod && isWeak(cfg.jwt.accessSecret)) problems.push('JWT_ACCESS_SECRET (unique random >=32 chars)');
  if (prod && !cfg.redisUrl) problems.push('REDIS_URL (required for cross-pod fan-out)');
  if (problems.length) throw new Error(`realtime-gateway refusing to start — insecure config: ${problems.join(', ')}`);
  return cfg;
}
