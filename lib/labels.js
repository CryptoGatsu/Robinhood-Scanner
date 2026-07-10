// Pure risk logic. No I/O, so it is unit-testable and identical on server & client.

export const ZERO = '0x0000000000000000000000000000000000000000';
export const DEAD = '0x000000000000000000000000000000000000dead';

export const SEL = {
  mint: '40c10f19', addBlackList: '0ecb93c0', blacklist: 'f9f92be4', setBlacklist: '153b0d1e',
  pause: '8456cb59', setFee: '69fe0e2d', setFees: '0b78f9c0', setTaxes: 'c647b20e',
  setMaxTx: 'ec28438a', setMaxWallet: '27a14fc2', owner: '8da5cb5b',
  transfer: 'a9059cbb', balanceOf: '70a08231', totalSupply: '18160ddd',
  name: '06fdde03', symbol: '95d89b41', decimals: '313ce567',
  token0: '0dfe1681', token1: 'd21220a7'
};

export const TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const TOPIC_SYNC     = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';
export const EIP1967_IMPL   = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

const strip = h => (h && h.startsWith('0x')) ? h.slice(2) : (h || '');

export function codeFlags(code) {
  const rt = strip(code);
  const has = s => rt.includes(s);
  return {
    hasCode: rt.length > 0,
    mint: has(SEL.mint),
    blacklist: has(SEL.addBlackList) || has(SEL.blacklist) || has(SEL.setBlacklist),
    pausable: has(SEL.pause),
    feeSetter: has(SEL.setFees) || has(SEL.setTaxes) || has(SEL.setFee),
    limits: has(SEL.setMaxTx) || has(SEL.setMaxWallet),
    minimalProxy: rt.length > 0 && rt.length < 800 && rt.indexOf('363d3d373d3d3d363d73') >= 0
  };
}

// holders: [{ addr, isContract, val: BigInt }]
export function concentration(holders, totalSupply, tokenAddr, poolAddr) {
  const sys = new Set([ZERO, DEAD, (tokenAddr || '').toLowerCase()]);
  const rows = holders
    .filter(h => h.val > 0n && !sys.has(h.addr))
    .sort((a, b) => (b.val < a.val ? -1 : 1));
  const wallets = rows.filter(r => r.addr !== poolAddr);
  const total = totalSupply > 0n ? totalSupply : rows.reduce((s, r) => s + r.val, 0n);
  if (total === 0n) return null;

  const pct = v => Number(v * 100000n / total) / 1000;
  const top1 = wallets.length ? pct(wallets[0].val) : 0;
  let cum = 0n;
  for (let i = 0; i < 10 && i < wallets.length; i++) cum += wallets[i].val;
  const top10 = pct(cum);

  // bundle fingerprint: >= 3 wallets holding an identical NON-DUST balance
  const freq = {};
  wallets.forEach(w => { const k = w.val.toString(); freq[k] = (freq[k] || 0) + 1; });
  const minChunk = total / 200n; // 0.5% of supply
  let equalCluster = 0;
  for (const k in freq) {
    if (freq[k] >= 3 && BigInt(k) >= minChunk) equalCluster = Math.max(equalCluster, freq[k]);
  }

  const poolRow = poolAddr ? rows.find(r => r.addr === poolAddr) : null;
  return { top1, top10, equalCluster, holderCount: rows.length, poolPct: poolRow ? pct(poolRow.val) : 0 };
}

/**
 * The label. Precedence matters: anything that makes a token unsellable or
 * rug-able outranks distribution stats.
 * NEVER returns "clean" — the honest ceiling for an automated screen is "ok".
 */
export function riskLabel({ flags, conc, sim, lp }) {
  if (!flags || !flags.hasCode) return { label: 'unsafe', why: 'No contract code at this address' };
  if (flags.mint)         return { label: 'unsafe', why: 'Mint function present — supply can be inflated' };
  if (flags.blacklist)    return { label: 'unsafe', why: 'Blacklist function present — wallets can be frozen' };
  if (flags.minimalProxy) return { label: 'unsafe', why: 'Minimal proxy — logic can be swapped out' };

  if (sim && sim.transferFrozen) return { label: 'unsafe', why: 'Live test: transfers are frozen' };
  if (sim && sim.sellBlocked)    return { label: 'unsafe', why: 'Live test: selling into the pool is blocked — honeypot' };

  if (!conc) return { label: 'unknown', why: 'No holder data yet — treat as high risk' };

  if (conc.top1 >= 30 || conc.top10 >= 85)
    return { label: 'unsafe', why: `Extreme concentration — top wallet holds ${conc.top1.toFixed(1)}%` };

  if (lp && lp.kind === 'v2' && lp.securedPct != null && lp.securedPct < 50)
    return { label: 'unsafe', why: `Only ${lp.securedPct.toFixed(0)}% of LP burned/locked — team can pull liquidity` };

  if (conc.equalCluster >= 3)
    return { label: 'bundled', why: `${conc.equalCluster} wallets hold identical amounts — likely one owner` };
  if (conc.top10 >= 70)
    return { label: 'bundled', why: `Top 10 wallets hold ${conc.top10.toFixed(0)}%` };

  if (!sim || !sim.ran) return { label: 'caution', why: 'Could not simulate a sell — unverified' };

  const soft = [];
  if (flags.pausable)  soft.push('trading can be paused');
  if (flags.feeSetter) soft.push('tax can be changed after you buy');
  if (flags.limits)    soft.push('max-sell can be shrunk');
  if (soft.length) return { label: 'caution', why: 'Owner switches present: ' + soft.join(', ') };

  return { label: 'ok', why: 'Live sell test passed, no dangerous switches, ownership spread — still not a guarantee' };
}

// Market data must never borrow another chain's numbers.
export const RH_CHAIN_IDS = new Set(['robinhood', 'robinhoodchain', 'robinhood-chain', '4663']);

export function pickPair(pairs, totalSupply, dec) {
  const on = (pairs || []).filter(p => RH_CHAIN_IDS.has(String(p.chainId || '').toLowerCase()));
  if (!on.length) return null;
  const use = on.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
  const price = parseFloat(use.priceUsd) || null;
  let mcap = use.marketCap || use.fdv || null;
  if (!mcap && price && totalSupply) {
    const supply = Number(totalSupply) / Math.pow(10, dec || 18);
    if (isFinite(supply) && supply > 0) mcap = price * supply;
  }
  return {
    price,
    mcap,
    change: use.priceChange || {},
    txns: (use.txns && use.txns.h24) || {},
    volH1: (use.volume && use.volume.h1) || 0,
    pairCreatedAt: use.pairCreatedAt || null,
    vol: (use.volume && use.volume.h24) || null,
    liq: (use.liquidity && use.liquidity.usd) || null,
    dex: use.dexId || null,
    pairAddress: use.pairAddress || null
  };
}

// Decode Uniswap-v2 Sync(uint112,uint112) logs into a price series.
export function decodeSyncSeries(logs, { tokenIs0, tokenDec, quoteDec }) {
  const pts = [];
  for (const l of logs) {
    const t0 = (l.topics || [])[0];
    if (!t0 || t0.toLowerCase() !== TOPIC_SYNC) continue;
    const d = strip(l.data);
    if (d.length < 128) continue;
    const r0 = BigInt('0x' + d.slice(0, 64));
    const r1 = BigInt('0x' + d.slice(64, 128));
    const base  = tokenIs0 ? r0 : r1;
    const quote = tokenIs0 ? r1 : r0;
    if (base === 0n) continue;
    const S = 10n ** 12n;
    const scaled = quote * S * (10n ** BigInt(tokenDec)) / (base * (10n ** BigInt(quoteDec)));
    const p = Number(scaled) / 1e12;
    const blk = Number(l.blockNumber != null ? l.blockNumber : l.block_number);
    if (isFinite(p) && p > 0 && isFinite(blk)) pts.push({ x: blk, y: p });
  }
  pts.sort((a, b) => a.x - b.x);
  return pts;
}
