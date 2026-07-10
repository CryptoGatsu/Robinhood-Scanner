// The actual scanning work. Shared by the cron sweep and the on-demand token API.

import {
  rpc, rpcBatch, call, getCode, getStorage, scout,
  addressLogs, strip, toBig, addrWord, padAddr, pad32, decodeString
} from './chain.js';
import {
  SEL, ZERO, DEAD, EIP1967_IMPL, TOPIC_SYNC,
  codeFlags, concentration, riskLabel, pickPair, decodeSyncSeries
} from './labels.js';

const DEXSCREEN = 'https://api.dexscreener.com/latest/dex/tokens/';
const LOCKERS = (process.env.LP_LOCKERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** name / symbol / decimals / totalSupply / code in one batched round-trip. */
export async function tokenMeta(addr) {
  const res = await rpcBatch([
    { method: 'eth_call', params: [{ to: addr, data: '0x' + SEL.name }, 'latest'] },
    { method: 'eth_call', params: [{ to: addr, data: '0x' + SEL.symbol }, 'latest'] },
    { method: 'eth_call', params: [{ to: addr, data: '0x' + SEL.decimals }, 'latest'] },
    { method: 'eth_call', params: [{ to: addr, data: '0x' + SEL.totalSupply }, 'latest'] },
    { method: 'eth_getCode', params: [addr, 'latest'] }
  ]);
  return {
    addr,
    name: res[0] ? decodeString(res[0]) : '',
    sym: res[1] ? decodeString(res[1]) : '',
    dec: res[2] ? (Number(toBig(res[2])) || 18) : 18,
    supply: res[3] ? toBig(res[3]) : 0n,
    code: res[4] || '0x'
  };
}

/** Holder set from the explorer (RPC has no holder index). */
export async function holders(addr) {
  let items = null, creator = null, holderCount = 0;
  try {
    const j = await scout(`/api/v2/tokens/${addr}`);
    holderCount = Number(j.holders || 0);
  } catch {}
  try {
    const j = await scout(`/api/v2/tokens/${addr}/holders`);
    items = j.items || [];
  } catch {}
  try {
    const j = await scout(`/api/v2/addresses/${addr}`);
    creator = (j.creator_address_hash || '').toLowerCase() || null;
  } catch {}
  if (!items) return null;

  const rows = items.map(h => ({
    addr: ((h.address && h.address.hash) || h.address || '').toLowerCase(),
    isContract: !!(h.address && h.address.is_contract),
    val: BigInt(h.value)
  })).filter(r => /^0x[0-9a-f]{40}$/.test(r.addr) && r.val > 0n)
    .sort((a, b) => (b.val < a.val ? -1 : 1));

  const sys = new Set([ZERO, DEAD, addr.toLowerCase()]);
  const pool = (rows.find(r => r.isContract && !sys.has(r.addr)) || {}).addr || null;
  const wallets = rows.filter(r => !sys.has(r.addr) && r.addr !== pool);
  const sampleHolder = (wallets.find(r => !r.isContract) || wallets[0] || rows[0] || {}).addr || null;
  return { rows, pool, sampleHolder, creator, holderCount: holderCount || rows.length };
}

/** Live buy->sell simulation via eth_call. The piece that catches honeypots. */
export async function sellSim(addr, pool, sampleHolder) {
  if (!sampleHolder || !pool) return { ran: false };
  const burner = '0x' + '1'.repeat(40);
  const amt = pad32(1n);
  let toWallet = null, toPool = null;
  try { await call(addr, SEL.transfer + padAddr(burner) + amt, sampleHolder); toWallet = true; }
  catch { toWallet = false; }
  try { await call(addr, SEL.transfer + padAddr(pool) + amt, sampleHolder); toPool = true; }
  catch { toPool = false; }
  return {
    ran: true,
    transferFrozen: toWallet === false,
    sellBlocked: toWallet === true && toPool === false
  };
}

/** Proxy detection via EIP-1967 slot (server can afford the extra call). */
export async function isProxy(addr) {
  try {
    const a = addrWord(await getStorage(addr, EIP1967_IMPL));
    return a !== ZERO ? a : null;
  } catch { return null; }
}

/** LP lock status. Meaningful for v2-style fungible-LP pairs only. */
export async function lpStatus(tokenAddr, pool) {
  if (!pool) return { kind: 'none' };
  let t0 = null, t1 = null;
  try { t0 = addrWord(await call(pool, SEL.token0)); } catch {}
  try { t1 = addrWord(await call(pool, SEL.token1)); } catch {}
  if (!t0 || !t1 || t0 === ZERO || t1 === ZERO) {
    // v3/v4: liquidity is an NFT position, there is no fungible LP to burn.
    return { kind: 'v3v4', note: 'Liquidity is a position NFT — "LP burned" does not apply' };
  }
  let sup = 0n, dead = 0n, zero = 0n, locked = 0n;
  try { sup = toBig(await call(pool, SEL.totalSupply)); } catch {}
  try { dead = toBig(await call(pool, SEL.balanceOf + padAddr(DEAD))); } catch {}
  try { zero = toBig(await call(pool, SEL.balanceOf + padAddr(ZERO))); } catch {}
  for (const L of LOCKERS) {
    try { locked += toBig(await call(pool, SEL.balanceOf + padAddr(L))); } catch {}
  }
  if (sup === 0n) return { kind: 'v2', securedPct: null };
  const secured = dead + zero + locked;
  return {
    kind: 'v2',
    securedPct: Number(secured * 10000n / sup) / 100,
    burnedPct: Number((dead + zero) * 10000n / sup) / 100,
    lockedPct: Number(locked * 10000n / sup) / 100
  };
}

export async function market(addr, supply, dec) {
  try {
    const r = await fetch(DEXSCREEN + addr);
    if (!r.ok) return null;
    const j = await r.json();
    return pickPair(j.pairs, supply, dec);
  } catch { return null; }
}

/** Price series from pool Sync events. RPC first, explorer fallback. */
export async function priceSeries(token) {
  if (!token.pool) return { kind: 'none', reason: 'no pool found' };
  let t0 = null, t1 = null;
  try { t0 = addrWord(await call(token.pool, SEL.token0)); } catch {}
  try { t1 = addrWord(await call(token.pool, SEL.token1)); } catch {}
  if (!t0 || !t1) return { kind: 'none', reason: 'not a v2-style pool' };

  const tokenIs0 = t0 === token.addr.toLowerCase();
  if (!tokenIs0 && t1 !== token.addr.toLowerCase())
    return { kind: 'none', reason: 'token not in this pool' };

  let quoteDec = 18;
  try { quoteDec = Number(toBig(await call(tokenIs0 ? t1 : t0, SEL.decimals))) || 18; } catch {}

  const { logs, source } = await addressLogs(token.pool, 20000);
  const pts = decodeSyncSeries(logs, { tokenIs0, tokenDec: token.dec, quoteDec });
  if (pts.length < 2) return { kind: 'none', reason: 'no reserve updates indexed', source };
  return { kind: 'price', pts: pts.slice(-300), source };
}

/** Full scan of one token -> the object the UI renders. */
export async function scanToken(addr) {
  addr = addr.toLowerCase();
  const meta = await tokenMeta(addr);
  const flags = codeFlags(meta.code);
  if (!flags.hasCode) {
    return { addr, ...pub(meta), label: 'unsafe', why: 'No contract code at this address', flags };
  }

  const h = await holders(addr);
  const pool = h ? h.pool : null;
  const [sim, proxyImpl, lp, mkt] = await Promise.all([
    sellSim(addr, pool, h ? h.sampleHolder : null),
    isProxy(addr),
    lpStatus(addr, pool),
    market(addr, meta.supply, meta.dec)
  ]);
  if (proxyImpl) flags.minimalProxy = true; // treat EIP-1967 like a swappable proxy

  const conc = h ? concentration(h.rows, meta.supply, addr, pool) : null;
  const { label, why } = riskLabel({ flags, conc, sim, lp });

  return {
    addr,
    ...pub(meta),
    label, why, flags, sim, lp, proxyImpl,
    pool,
    creator: h ? h.creator : null,
    holderCount: h ? h.holderCount : 0,
    conc: conc ? { top1: conc.top1, top10: conc.top10, equalCluster: conc.equalCluster, poolPct: conc.poolPct } : null,
    top: h ? h.rows.slice(0, 22).map(r => ({
      addr: r.addr,
      isContract: r.isContract,
      pct: meta.supply > 0n ? Number(r.val * 100000n / meta.supply) / 1000 : 0
    })) : [],
    mkt,
    at: Date.now()
  };
}

const pub = m => ({ name: m.name, sym: m.sym, dec: m.dec, supply: m.supply.toString() });
