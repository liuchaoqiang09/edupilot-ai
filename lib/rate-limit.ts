/**
 * 进程内滑动窗口限流。单实例够用；多实例需前置网关或共享计数。
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export function rateLimitKey(parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim() || "-").join(":");
}

export function takeRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { ok: true; remaining: number } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - opts.windowMs;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => at > windowStart);
  if (bucket.hits.length >= opts.limit) {
    const oldest = bucket.hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000));
    buckets.set(key, bucket);
    return { ok: false, retryAfterSec };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: Math.max(0, opts.limit - bucket.hits.length) };
}

/** 测试用：清空全部桶。 */
export function resetRateLimits() {
  buckets.clear();
}
