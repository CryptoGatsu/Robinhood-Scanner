// Thin KV wrapper. Uses Vercel KV (Upstash Redis) when configured,
// otherwise an in-process Map so `vercel dev` and tests work offline.

let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import('@vercel/kv');
    kv = mod.kv;
  }
} catch { /* package not installed; use memory */ }

const mem = new Map();

export async function kvGet(key) {
  if (kv) return await kv.get(key);
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp && Date.now() > e.exp) { mem.delete(key); return null; }
  return e.val;
}

export async function kvSet(key, val, ttlSeconds) {
  if (kv) {
    if (ttlSeconds) return await kv.set(key, val, { ex: ttlSeconds });
    return await kv.set(key, val);
  }
  mem.set(key, { val, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
}

/** Acquire a short lock so only one refresh runs at a time. Returns true if acquired. */
export async function kvLock(key, ttlSeconds = 60) {
  if (kv) {
    const ok = await kv.set(key, '1', { nx: true, ex: ttlSeconds });
    return ok === 'OK' || ok === true;
  }
  const e = mem.get(key);
  if (e && e.exp > Date.now()) return false;
  mem.set(key, { val: '1', exp: Date.now() + ttlSeconds * 1000 });
  return true;
}

export async function kvUnlock(key) {
  if (kv) { try { await kv.del(key); } catch {} return; }
  mem.delete(key);
}

export const KEYS = {
  tokens: 'rhscan:tokens:v1',
  tokensAt: 'rhscan:tokens:at:v1',
  lock: 'rhscan:lock:refresh',
  token: a => `rhscan:token:${a}:v1`,
  series: a => `rhscan:series:${a}:v1`
};

/** BigInt-safe JSON for KV round-trips. */
export const ser = o => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
export const de = s => JSON.parse(typeof s === 'string' ? s : JSON.stringify(s), (_, v) =>
  (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));

/** INCR with a TTL applied only on first write (so the window doesn't slide). */
export async function kvIncr(k, ttlSeconds) {
  if (kv) {
    const n = await kv.incr(k);
    if (Number(n) === 1 && ttlSeconds) await kv.expire(k, ttlSeconds);
    return Number(n);
  }
  const cur = Number((mem.get(k) || {}).val || 0) + 1;
  mem.set(k, { val: cur, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  return cur;
}
