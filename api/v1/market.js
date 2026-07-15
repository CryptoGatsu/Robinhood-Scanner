import { guard, json, apiError, normalizeAddress, cacheGet, cacheSet } from '../../lib/apikit.js';
import { getToken } from '../../lib/engine.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  const g = await guard(req);
  if (g.fail) return g.fail;

  const url = new URL(req.url);
  const addr = normalizeAddress(url.searchParams.get('token'));
  if (!addr) return apiError('invalid_token', 'Provide a valid 0x token address.', 400);

  const cacheKey = 'cache:market:' + addr;
  if (!url.searchParams.get('fresh')) {
    const hit = await cacheGet(cacheKey);
    if (hit) return json({ ...hit, cached: true }, 200, g.rlHeaders);
  }

  try {
    const { market, liquidity } = await getToken(addr);
    if (!market) return apiError('not_found', 'No market data for that token (no DEX pair?).', 404);
    const body = {
      token: addr,
      market: {
        priceUsd: market.priceUsd, marketCap: market.marketCap, volume24h: market.volume24h,
        change24h: market.change24h, change1h: market.change1h,
      },
      liquidity,
      cached: false,
      asOf: new Date().toISOString(),
    };
    await cacheSet(cacheKey, body, 30);
    return json(body, 200, g.rlHeaders);
  } catch (e) {
    return apiError('internal', 'Failed to load market: ' + (e.message || 'unknown'), 500);
  }
}
