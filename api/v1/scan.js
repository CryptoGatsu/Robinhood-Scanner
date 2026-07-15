import { guard, json, apiError, normalizeAddress, cacheGet, cacheSet } from '../../lib/apikit.js';
import { getToken, getHolders, getDeployAndOG, getSafety, getSignal, getVerdict } from '../../lib/engine.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const g = await guard(req);
  if (g.fail) return g.fail;

  const url = new URL(req.url);
  const addr = normalizeAddress(url.searchParams.get('token'));
  if (!addr) return apiError('invalid_token', 'Provide a valid 0x token address.', 400);

  const cacheKey = 'cache:scan:' + addr;
  if (!url.searchParams.get('fresh')) {
    const hit = await cacheGet(cacheKey);
    if (hit) return json({ ...hit, cached: true }, 200, g.rlHeaders);
  }

  try {
    // identity + market first (fast, and needed by the rest)
    const { token, market, liquidity, holdersCount } = await getToken(addr);
    if (!token.symbol && !token.name) return apiError('not_found', 'No token found at that address on Robinhood Chain.', 404);

    const hasPool = !!(liquidity && liquidity.usd);
    // run the remaining pieces in parallel
    const [holders, og, safety] = await Promise.all([
      getHolders(addr, token.totalSupply),
      getDeployAndOG(addr, token.symbol, market && market.pairCreatedAt),
      getSafety(addr, hasPool),
    ]);

    const signal = getSignal(market, holders);
    const verdict = getVerdict(safety, holders, liquidity);

    const body = {
      token: {
        address: addr, name: token.name, symbol: token.symbol, decimals: token.decimals,
        totalSupply: token.totalSupply, logo: token.logo, verified: token.verified,
        deployedAt: og.deployedMs ? new Date(og.deployedMs).toISOString() : null, isOG: og.isOG,
      },
      verdict,
      safety,
      holders: {
        count: holders.count || holdersCount || 0,
        top1Pct: holders.top1Pct, top10Pct: holders.top10Pct,
        creatorPct: null,
        lpPct: liquidity && liquidity.pool ? lpPctOf(holders, liquidity.pool) : null,
        bundle: { detected: false, maxFunderPct: 0 },
        truncated: false,
      },
      liquidity,
      market: market ? {
        priceUsd: market.priceUsd, marketCap: market.marketCap, volume24h: market.volume24h,
        change24h: market.change24h, change1h: market.change1h,
      } : null,
      signal,
      dupes: { sameTicker: og.sameTicker, isOriginal: og.isOG === true },
      links: {
        explorer: 'https://robinhoodchain.blockscout.com/token/' + addr,
        scanner: 'https://www.robinscan4u.com/?token=' + addr,
        dexscreener: 'https://dexscreener.com/robinhood/' + addr,
      },
      cached: false,
      asOf: new Date().toISOString(),
      notFinancialAdvice: true,
    };
    await cacheSet(cacheKey, body, 300);
    return json(body, 200, g.rlHeaders);
  } catch (e) {
    if (String(e.message || '').includes('abort')) return apiError('scan_timeout', 'Scan took too long. Try again.', 504);
    return apiError('internal', 'Scan failed: ' + (e.message || 'unknown'), 500);
  }
}

function lpPctOf(holders, pool) {
  const p = String(pool).toLowerCase();
  const lp = (holders.list || []).find(h => h.addr === p);
  return lp ? lp.pct : null;
}
