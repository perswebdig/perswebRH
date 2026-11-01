type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function consumeAttempt(key: string, now = Date.now()) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }
  bucket.count += 1;
  if (bucket.count > MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - bucket.count };
}

export function clearAttempts(key: string) {
  buckets.delete(key);
}

export function loginAttemptKey(req: {
  ip?: string;
  headers?: Record<string, unknown>;
}, email: string) {
  const forwarded = String(req.headers?.["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim();
  return `${forwarded || req.ip || "unknown"}:${email.toLowerCase()}`;
}
