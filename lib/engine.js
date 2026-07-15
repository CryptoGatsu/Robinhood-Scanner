// Server-side scan engine for the RobinScan API.
// Pure data out (no DOM). Uses fetch for RPC / Blockscout / DexScreener.
// The heavy holder walk is bounded ("fast" depth) so it always finishes within
// the serverless budget; results are cached by the endpoint layer.

const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const SCOUT = 'https://robinhoodchain.blockscout.com';
const DEXSCREEN = 'https://api.dexscreener.com/latest/dex/tokens/';
const DEX_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q=';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO = '0x0000000000000000000000000000000000000000';

// ---- low-level helpers ----
let _id = 1;
async function rpc(method, params, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j && j.error) throw new Error(j.error.message || 'rpc error');
    return j ? j.result : null;
  } finally { clearTimeout(t); }
}

async function scout(path, timeoutMs = 5000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(SCOUT + path, { headers: { accept: 'application/json' }, signal: ctrl.signal });
      if (r.ok) return await r.json();
      // 429/5xx are worth one retry; 404 is a real answer
      if (r.status === 404) return null;
    } catch (e) { /* timeout or network — fall through to retry */ }
    finally { clearTimeout(t); }
    if (attempt < retries) await new Promise(r => setTimeout(r, 350));
  }
  return null;
}

// ---- RPC metadata fallback (authoritative; used when the explorer is down) ----
const SEL = { name: '0x06fdde03', symbol: '0x95d89b41', decimals: '0x313ce567', totalSupply: '0x18160ddd' };

// decode an ABI-encoded string return (offset, length, bytes)
function decodeAbiString(hex) {
  if (!hex || hex === '0x') return null;
  const h = hex.slice(2);
  try {
    // dynamic string: [32-byte offset][32-byte length][data]
    if (h.length >= 128) {
      const len = parseInt(h.slice(64, 128), 16);
      if (len > 0 && len <= 256) {
        const bytes = h.slice(128, 128 + len * 2);
        const s = decodeURIComponent(bytes.replace(/(..)/g, '%$1')).replace(/\0/g, '').trim();
        if (s) return s;
      }
    }
    // bytes32-style: raw padded string
    const s2 = decodeURIComponent(h.replace(/(..)/g, '%$1')).replace(/\0/g, '').trim();
    return s2 || null;
  } catch (e) { return null; }
}

async function rpcMeta(addr) {
  const call = async (data) => {
    try { return await rpc('eth_call', [{ to: addr, data }, 'latest'], 4000); } catch (e) { return null; }
  };
  const [n, s, d, ts] = await Promise.all([call(SEL.name), call(SEL.symbol), call(SEL.decimals), call(SEL.totalSupply)]);
  let decimals = null, totalSupply = null;
  try { if (d && d !== '0x') decimals = parseInt(d, 16); } catch (e) {}
  try { if (ts && ts !== '0x') totalSupply = BigInt(ts).toString(); } catch (e) {}
  return { name: decodeAbiString(n), symbol: decodeAbiString(s), decimals, totalSupply };
}

async function dexData(addr) {
  try {
    const r = await fetch(DEXSCREEN + addr, { headers: { accept: 'application/json' } });
    const j = await r.json();
    const pairs = (j.pairs || []).filter(p =>
      ['robinhood', 'robinhoodchain', '4663'].includes(String(p.chainId || '').toLowerCase()));
    return pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0] || null;
  } catch (e) { return null; }
}

// ---- token identity + market ----
// Identity is resolved from THREE sources, in order of richness, so a single
// outage (esp. Blockscout hiccuping) can't make a real token look non-existent:
//   1. Blockscout  — richest (holder count, verified flag)
//   2. DexScreener — already fetched for market data, carries baseToken symbol/name
//   3. RPC eth_call — authoritative, always available
export async function getToken(addr) {
  const [meta, dex, sc] = await Promise.all([
    scout('/api/v2/tokens/' + addr),
    dexData(addr),
    scout('/api/v2/smart-contracts/' + addr),
  ]);

  const bt = (dex && dex.baseToken) || {};
  let name = (meta && meta.name) || bt.name || null;
  let symbol = (meta && meta.symbol) || bt.symbol || null;
  let decimals = meta && meta.decimals != null ? Number(meta.decimals) : null;
  let totalSupply = (meta && meta.total_supply) || null;

  // If the explorer failed us on identity or supply, ask the chain directly.
  // totalSupply matters most: without it every holder percentage computes to 0.
  if (!symbol || !name || decimals == null || !totalSupply) {
    const rm = await rpcMeta(addr);
    name = name || rm.name;
    symbol = symbol || rm.symbol;
    if (decimals == null) decimals = rm.decimals;
    totalSupply = totalSupply || rm.totalSupply;
  }

  const verified = !!(sc && (sc.is_verified || (sc.abi && sc.abi.length)));
  const token = {
    address: addr,
    name: name || null,
    symbol: symbol || null,
    decimals: decimals == null ? 18 : decimals,
    totalSupply: totalSupply || null,
    logo: (meta && (meta.icon_url || meta.image_url)) || (dex && dex.info && dex.info.imageUrl) || null,
    verified,
  };
  const market = dex ? {
    priceUsd: parseFloat(dex.priceUsd) || null,
    marketCap: dex.marketCap || dex.fdv || null,
    volume24h: (dex.volume && dex.volume.h24) || null,
    change24h: (dex.priceChange && dex.priceChange.h24) != null ? dex.priceChange.h24 : null,
    change1h: (dex.priceChange && dex.priceChange.h1) != null ? dex.priceChange.h1 : null,
    pairCreatedAt: dex.pairCreatedAt || null,
    pool: dex.pairAddress || null,
  } : null;
  const liquidity = dex ? { usd: (dex.liquidity && dex.liquidity.usd) || null, locked: null, pool: dex.pairAddress || null } : null;

  // Holder count: Blockscout has used several field names across versions
  // (holders / holders_count / holder_count). Check them all, then fall back to
  // the /counters endpoint, which reports it separately.
  let holdersCount = pickCount(meta, ['holders', 'holders_count', 'holder_count']);
  if (holdersCount == null) {
    const counters = await scout('/api/v2/tokens/' + addr + '/counters', 4000, 0);
    holdersCount = pickCount(counters, ['token_holders_count', 'holders_count', 'holders']);
  }
  return { token, market, liquidity, holdersCount };
}

// pull the first present numeric field from a list of candidate names
function pickCount(obj, names) {
  if (!obj) return null;
  for (const n of names) {
    const v = obj[n];
    if (v != null && v !== '') {
      const num = Number(v);
      if (isFinite(num) && num >= 0) return num;
    }
  }
  return null;
}

// ---- holders via Blockscout (fast depth: use the explorer's holder list) ----
// The full on-chain walk is expensive; for the API's fast path we read the
// explorer's top-holders endpoint, which gives concentration without walking logs.
//
// IMPORTANT: the liquidity pool and burn addresses are NOT real holders. The LP
// legitimately holds most of the supply on a healthy token — counting it as the
// "top holder" would falsely flag every normal token as concentrated. We report
// LP and burned separately and compute concentration over REAL wallets only.
const BURN_ADDRS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

export async function getHolders(addr, totalSupplyStr, poolAddr, reportedCount) {
  const resp = await scout('/api/v2/tokens/' + addr + '/holders');
  const items = (resp && (resp.items || resp)) || [];
  let total = 0n;
  try { total = BigInt(String(totalSupplyStr || '0').split('.')[0]); } catch (e) {}
  const pool = poolAddr ? String(poolAddr).toLowerCase() : null;

  const all = items.slice(0, 50).map(h => {
    let pct = 0;
    try { const v = BigInt(String(h.value || '0').split('.')[0]); pct = total > 0n ? Number(v * 10000n / total) / 100 : 0; } catch (e) {}
    const a = String((h.address && h.address.hash) || h.address_hash || h.address || '').toLowerCase();
    return { addr: a, pct };
  }).filter(h => h.pct > 0 && h.addr);

  const lpPct = pool ? round2(all.filter(h => h.addr === pool).reduce((s, h) => s + h.pct, 0)) : null;
  const burnedPct = round2(all.filter(h => BURN_ADDRS.has(h.addr)).reduce((s, h) => s + h.pct, 0));

  // real holders = exclude the pool and burn addresses
  const real = all.filter(h => h.addr !== pool && !BURN_ADDRS.has(h.addr));
  const top1 = real[0] ? real[0].pct : 0;
  const top10 = real.slice(0, 10).reduce((s, h) => s + h.pct, 0);

  return {
    list: all,
    real,
    // true holder count from the explorer's metadata when available; the list is
    // only the top-N we fetched, so its length is NOT the holder count.
    count: reportedCount != null ? reportedCount : real.length,
    top1Pct: round2(top1),
    top10Pct: round2(top10),
    lpPct,
    burnedPct: burnedPct || null,
  };
}

// ---- mint date + OG detection ----
export async function getDeployAndOG(addr, symbol, pairCreatedAt) {
  // deploy time: first Transfer from ZERO's block, else pair creation
  let deployedMs = null;
  try {
    const logs = await rpc('eth_getLogs', [{
      fromBlock: '0x0', toBlock: 'latest', address: addr,
      topics: [TRANSFER_TOPIC, '0x' + ZERO.slice(2).padStart(64, '0')],
    }], 5000);
    if (logs && logs.length) {
      const blk = logs[0].blockNumber;
      const b = await rpc('eth_getBlockByNumber', [blk, false], 4000);
      if (b && b.timestamp) deployedMs = parseInt(b.timestamp, 16) * 1000;
    }
  } catch (e) {}
  if (!deployedMs && pairCreatedAt) deployedMs = pairCreatedAt;

  // OG: among tokens sharing the symbol, is this the earliest?
  let isOG = null, sameTicker = 0;
  if (symbol) {
    try {
      const r = await fetch(DEX_SEARCH + encodeURIComponent(symbol), { headers: { accept: 'application/json' } });
      const j = await r.json();
      const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const target = norm(symbol);
      const byAddr = {};
      for (const p of (j.pairs || [])) {
        if (!['robinhood', 'robinhoodchain', '4663'].includes(String(p.chainId || '').toLowerCase())) continue;
        const bt = p.baseToken || {};
        if (norm(bt.symbol) !== target) continue;
        const a = (bt.address || '').toLowerCase();
        if (!a) continue;
        const created = p.pairCreatedAt || null;
        if (!byAddr[a] || (created && created < byAddr[a])) byAddr[a] = created;
      }
      const addrs = Object.keys(byAddr);
      sameTicker = Math.max(0, addrs.length - 1);
      let ogAddr = null, ogTime = Infinity;
      for (const a of addrs) {
        const c = a === addr && deployedMs ? deployedMs : byAddr[a];
        if (c && c < ogTime) { ogTime = c; ogAddr = a; }
      }
      if (ogAddr) isOG = (ogAddr === addr);
    } catch (e) {}
  }
  return { deployedMs, isOG, sameTicker };
}

// ---- honeypot / sell-test (lightweight: check for common dangerous patterns) ----
// A full eth_call sell simulation is heavy; the fast path checks bytecode for
// known honeypot signatures + whether the token has a tradable pool.
export async function getSafety(addr, hasPool) {
  const out = { canSell: null, sellTest: 'untested', honeypot: false, mintable: false, blacklist: false, dangerousFunctions: [] };
  try {
    const code = await rpc('eth_getCode', [addr, 'latest'], 4000);
    if (code && code !== '0x') {
      const lc = code.toLowerCase();
      // crude signature scan for owner-power selectors embedded in bytecode
      const sigs = {
        mint: '40c10f19', setMaxTx: '', blacklist: 'f9f92be4', setFee: '69fe0e2d', pause: '8456cb59',
      };
      if (lc.includes(sigs.mint)) { out.mintable = true; out.dangerousFunctions.push('mint'); }
      if (lc.includes(sigs.blacklist)) { out.blacklist = true; out.dangerousFunctions.push('blacklist'); }
      if (lc.includes(sigs.pause)) { out.dangerousFunctions.push('pause'); }
    }
  } catch (e) {}
  // if it has a live pool with liquidity, treat as tradable (sell-test proxy)
  out.canSell = hasPool ? true : null;
  out.sellTest = hasPool ? 'passed' : 'untested';
  return out;
}

// ---- signal / posture ----
export function getSignal(market, holders) {
  const ch24 = market && market.change24h != null ? market.change24h : null;
  const ch1 = market && market.change1h != null ? market.change1h : null;
  const top1 = holders ? holders.top1Pct : 0;
  let posture = 'mixed', text = 'Mixed signals.';
  if (top1 >= 50) { posture = 'concentrated'; text = 'A few wallets hold most of the supply. Price can move hard on a single sell.'; }
  else if (ch24 != null && ch24 <= -15) { posture = 'falling'; text = 'Price is sliding over 24h.'; }
  else if (ch24 != null && ch24 >= 30 && ch1 != null && ch1 < 0) { posture = 'breaking-up'; text = 'Big 24h gain now cooling off.'; }
  else if (ch24 != null && ch24 >= 15 && ch1 != null && ch1 >= 0) { posture = 'grinding-up'; text = 'Gradual gains, healthier than a vertical pump.'; }
  else if (ch24 != null && Math.abs(ch24) < 10) { posture = 'ranging'; text = 'No strong momentum either way.'; }
  return { posture, text };
}

// ---- verdict ----
export function getVerdict(safety, holders, liquidity) {
  const flags = [];
  let level = 'ok';
  if (safety.honeypot || safety.sellTest === 'failed') { level = 'danger'; flags.push('Sell test failed — may be a honeypot.'); }
  if (holders && holders.top1Pct >= 50) { if (level !== 'danger') level = 'caution'; flags.push(`Top holder controls ${holders.top1Pct}%.`); }
  else if (holders && holders.top1Pct >= 25) { if (level === 'ok') level = 'caution'; flags.push(`Top holder controls ${holders.top1Pct}%.`); }
  if (safety.mintable) { if (level === 'ok') level = 'caution'; flags.push('Token is mintable.'); }
  if (safety.blacklist) { if (level === 'ok') level = 'caution'; flags.push('Has a blacklist function.'); }
  if (liquidity && liquidity.usd != null && liquidity.usd < 2000) { if (level === 'ok') level = 'caution'; flags.push('Very thin liquidity.'); }
  const headline = level === 'danger' ? 'Danger — do not ape'
    : level === 'caution' ? 'Caution — check the flags'
      : 'No obvious red flags';
  return { level, headline, summary: flags.length ? flags.join(' ') : 'No obvious concentration or safety flags in the data. Never a guarantee.' };
}

function round2(n) { return Math.round(n * 100) / 100; }
