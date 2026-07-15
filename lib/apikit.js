import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';

// ---- config ----
export const TIERS = {
  free: { perMin: 5, perDay: 200 },
  bot:  { perMin: 30, perDay: 10000 },
  pro:  { perMin: 60, perDay: 50000 },
};

// ---- JSON response helper (consistent shape + rate headers) ----
export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function apiError(code, message, status, extra = {}) {
  return json({ error: code, message, ...extra }, status);
}

// ---- key hashing (store only the hash) ----
export function hashKey(rawKey) {
  return createHash('sha256').update(String(rawKey)).digest('hex').slice(0, 32);
}

// ---- auth: resolve the API key -> { owner, tier } or null ----
export async function authKey(req) {
  const raw = req.headers.get('x-api-key');
  if (!raw) return null;
  try {
    const rec = await kv.get('key:' + hashKey(raw));
    if (!rec || rec.active === false) return null;
    return { owner: rec.owner || 'unknown', tier: rec.tier || 'free', keyhash: hashKey(raw) };
  } catch (e) {
    return null;
  }
}

// ---- rate limit: returns { ok, remainingMin, remainingDay, retryAfter } ----
export async function rateLimit(keyhash, tier) {
  const limits = TIERS[tier] || TIERS.free;
  const now = new Date();
  const minKey = `rl:${keyhash}:min:${now.getUTCFullYear()}${now.getUTCMonth()}${now.getUTCDate()}${now.getUTCHours()}${now.getUTCMinutes()}`;
  const dayKey = `rl:${keyhash}:day:${now.getUTCFullYear()}${now.getUTCMonth()}${now.getUTCDate()}`;
  try {
    const [minCount, dayCount] = await Promise.all([kv.incr(minKey), kv.incr(dayKey)]);
    // set TTLs on first hit
    if (minCount === 1) await kv.expire(minKey, 60);
    if (dayCount === 1) await kv.expire(dayKey, 86400);
    const remainingMin = Math.max(0, limits.perMin - minCount);
    const remainingDay = Math.max(0, limits.perDay - dayCount);
    if (minCount > limits.perMin) return { ok: false, remainingMin: 0, remainingDay, retryAfter: 60 - now.getUTCSeconds() };
    if (dayCount > limits.perDay) return { ok: false, remainingMin, remainingDay: 0, retryAfter: 3600 };
    return { ok: true, remainingMin, remainingDay };
  } catch (e) {
    // if KV fails, fail-open but don't crash (better to serve than hard-fail)
    return { ok: true, remainingMin: 1, remainingDay: 1 };
  }
}

// ---- the gate every protected endpoint runs first ----
// returns { auth } on success, or a Response to return immediately on failure.
export async function guard(req) {
  const auth = await authKey(req);
  if (!auth) return { fail: apiError('unauthorized', 'Missing or invalid API key. Send it in the x-api-key header.', 401) };
  const rl = await rateLimit(auth.keyhash, auth.tier);
  const rlHeaders = {
    'x-ratelimit-remaining-min': String(rl.remainingMin),
    'x-ratelimit-remaining-day': String(rl.remainingDay),
  };
  if (!rl.ok) {
    return { fail: apiError('rate_limited', `Too many requests. Try again in ${rl.retryAfter}s.`, 429, { retryAfter: rl.retryAfter }) };
  }
  return { auth, rlHeaders };
}

// ---- cache helpers ----
export async function cacheGet(key) {
  try { return await kv.get(key); } catch (e) { return null; }
}
export async function cacheSet(key, value, ttlSeconds) {
  try { await kv.set(key, value, { ex: ttlSeconds }); } catch (e) {}
}

// ---- address validation ----
export function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(s) ? s : null;
}
