import { guard, json, apiError, normalizeAddress, cacheGet, cacheSet } from '../../lib/apikit.js';
import { getToken, getDeployAndOG } from '../../lib/engine.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const g = await guard(req);
  if (g.fail) return g.fail;

  const url = new URL(req.url);
  const addr = normalizeAddress(url.searchParams.get('token'));
  if (!addr) return apiError('invalid_token', 'Provide a valid 0x token address.', 400);

  const cacheKey = 'cache:token:' + addr;
  if (!url.searchParams.get('fresh')) {
    const hit = await cacheGet(cacheKey);
    if (hit) return json({ ...hit, cached: true }, 200, g.rlHeaders);
  }

  try {
    const { token, market, liquidity, holdersCount } = await getToken(addr);
    const og = await getDeployAndOG(addr, token.symbol, market && market.pairCreatedAt);
    const body = {
      token: { ...token, deployedAt: og.deployedMs ? new Date(og.deployedMs).toISOString() : null, isOG: og.isOG },
      market,
      liquidity,
      holdersCount,
      dupes: { sameTicker: og.sameTicker, isOriginal: og.isOG === true },
      links: buildLinks(addr),
      cached: false,
      asOf: new Date().toISOString(),
      notFinancialAdvice: true,
    };
    await cacheSet(cacheKey, body, 60);
    return json(body, 200, g.rlHeaders);
  } catch (e) {
    return apiError('internal', 'Failed to load token: ' + (e.message || 'unknown'), 500);
  }
}

function buildLinks(addr) {
  return {
    explorer: 'https://robinhoodchain.blockscout.com/token/' + addr,
    scanner: 'https://www.robinscan4u.com/?token=' + addr,
    dexscreener: 'https://dexscreener.com/robinhood/' + addr,
  };
}
