import { kv } from '@vercel/kv';
import { json, readSession } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com';

// Allowlist of Blockscout paths the proxy will fetch. Prevents the gated proxy
// from being turned into an open relay to anywhere.
const ALLOWED = [
  /^\/api\/v2\/main-page\/blocks$/,
  /^\/api\/v2\/main-page\/transactions$/,
  /^\/api\/v2\/blocks(\/[^/]+)?(\/transactions)?$/,
  /^\/api\/v2\/transactions(\/[0-9a-fx]+)?(\/token-transfers|\/logs)?$/i,
  /^\/api\/v2\/addresses\/[0-9a-fx]+(\/transactions|\/token-transfers|\/tokens|\/token-balances|\/counters|\/coin-balance-history-by-day|\/coin-balance-history)?$/i,
  /^\/api\/v2\/tokens\/[0-9a-fx]+(\/holders|\/counters|\/transfers)?$/i,
  /^\/api\/v2\/search$/,
  /^\/api\/v2\/stats$/,
  /^\/api\/v2\/stats\/charts\/(transactions|market)$/,
  /^\/api\/v2\/main-page\/indexing-status$/,
];

// short cache TTLs — explorer data is fresh but repeated lookups shouldn't
// hammer Blockscout (which 500s under load). Landing = very short, detail = longer.
function ttlFor(path) {
  if (path.includes('/main-page/') || path === '/api/v2/stats') return 10;      // 10s
  if (path.includes('/transactions/') || path.includes('/blocks/')) return 60;  // 1 min (immutable-ish)
  return 20;                                                                     // default 20s
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// GET /api/x/proxy?path=/api/v2/main-page/blocks&q=...
// Requires a valid holder session. Proxies + caches an allowlisted Blockscout path.
export default async function handler(req) {
  const address = await readSession(req);
  if (!address) return json({ error: 'not_authenticated' }, 401);

  const url = new URL(req.url);
  let path = url.searchParams.get('path') || '';
  const q = url.searchParams.get('q') || '';

  if (!path.startsWith('/api/v2/')) return json({ error: 'bad_path' }, 400);
  if (!ALLOWED.some(re => re.test(path))) return json({ error: 'path_not_allowed', path }, 400);

  // build target URL (attach ?q= for search)
  let target = BLOCKSCOUT + path;
  if (path === '/api/v2/search' && q) target += '?q=' + encodeURIComponent(q);

  const cacheKey = 'bs:' + path + (q ? '?q=' + q : '');
  const ttl = ttlFor(path);

  // serve from cache if fresh
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return json({ ok: true, cached: true, data: cached });
  } catch (e) { /* cache miss/unavailable -> fetch live */ }

  // fetch live from Blockscout (server-side; no CORS). One retry on failure.
  let data = null, lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(target, 6000);
      lastStatus = res.status;
      if (res.ok) { data = await res.json(); break; }
    } catch (e) { /* timeout/network -> retry once */ }
  }

  if (data == null) {
    // last resort: serve a stale cache if we ever had one
    try {
      const stale = await kv.get('stale:' + cacheKey);
      if (stale) return json({ ok: true, cached: true, stale: true, data: stale });
    } catch (e) {}
    return json({ error: 'upstream_unavailable', status: lastStatus }, 502);
  }

  // cache fresh + keep a longer-lived stale copy for outage fallback
  try {
    await kv.set(cacheKey, data, { ex: ttl });
    await kv.set('stale:' + cacheKey, data, { ex: 900 }); // 15 min stale window
  } catch (e) {}

  return json({ ok: true, cached: false, data });
}
