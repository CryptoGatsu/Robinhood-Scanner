// Chain access with RPC primary + Blockscout fallback, CU-aware throttling.
// Runs server-side, so the RPC key never reaches the browser.

const RPC_URL = process.env.RPC_URL || '';
const SCOUT   = (process.env.BLOCKSCOUT_URL || 'https://robinhoodchain.blockscout.com').replace(/\/$/, '');
export const CHAIN_ID = Number(process.env.CHAIN_ID || 4663);

export const SCOUT_BASE = SCOUT;

// Alchemy meters compute units/second, not requests.
const CU = {
  eth_getLogs: 75, eth_call: 26, eth_getCode: 26, eth_getStorageAt: 17,
  eth_blockNumber: 10, eth_chainId: 0
};
const CU_RATE = Number(process.env.CU_RATE || 400);
const CU_CAP  = CU_RATE;
let _tokens = CU_CAP, _last = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function take(cost) {
  cost = Math.min(cost, CU_CAP);
  for (let guard = 0; guard < 64; guard++) {
    const t = Date.now();
    _tokens = Math.min(CU_CAP, _tokens + (t - _last) / 1000 * CU_RATE);
    _last = t;
    if (_tokens + 1e-6 >= cost) { _tokens -= cost; return; }
    await sleep(Math.max(15, Math.ceil((cost - _tokens) / CU_RATE * 1000)));
  }
}

const backoff = (a, ra) => (ra ? Math.min(10000, ra * 1000) : Math.min(8000, 400 * 2 ** a));

let _id = 1;
async function post(body, cost) {
  if (!RPC_URL) throw new Error('RPC_URL not configured');
  await take(cost);
  for (let attempt = 0; attempt < 4; attempt++) {
    let res = null, err = null;
    try {
      res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) { err = e; }

    if ((res && res.status === 429) || (!res && err)) {
      const ra = res ? parseInt(res.headers.get('retry-after') || '', 10) : 0;
      await sleep(backoff(attempt, isFinite(ra) ? ra : 0) + Math.random() * 200);
      await take(cost);
      continue;
    }
    let j = null;
    try { j = await res.json(); } catch { /* non-JSON */ }
    if (!j) { if (!res.ok) throw new Error('rpc HTTP ' + res.status); return null; }
    return j;
  }
  throw new Error('rpc rate limited');
}

export async function rpc(method, params) {
  const j = await post({ jsonrpc: '2.0', id: _id++, method, params }, CU[method] ?? 26);
  if (j && j.error) { const e = new Error(j.error.message || 'rpc error'); e.rpc = j.error; throw e; }
  return j ? j.result : null;
}

const BATCH_CU_MAX = Math.max(120, Math.floor(CU_CAP * 0.8));
export async function rpcBatch(reqs) {
  if (!reqs.length) return [];
  const groups = [];
  let cur = [], curCost = 0;
  reqs.forEach((r, i) => {
    const c = CU[r.method] ?? 26;
    if (cur.length && curCost + c > BATCH_CU_MAX) { groups.push(cur); cur = []; curCost = 0; }
    cur.push({ r, i }); curCost += c;
  });
  if (cur.length) groups.push(cur);

  const out = new Array(reqs.length).fill(null);
  for (const g of groups) {
    const cost = g.reduce((s, x) => s + (CU[x.r.method] ?? 26), 0);
    const body = g.map((x, k) => ({ jsonrpc: '2.0', id: k, method: x.r.method, params: x.r.params }));

    // Try the batch. Some L2 RPC endpoints (including this chain's) reject
    // JSON-RPC batches — they answer an array request with a single error
    // object. Detect that and fall back to individual calls so a scan never
    // silently comes back empty ("No contract code").
    let j = null;
    try { j = await post(body, cost); } catch { j = null; }

    const batchOk = Array.isArray(j) && j.length === g.length &&
      j.every(r => r && typeof r.id === 'number');

    if (batchOk) {
      j.forEach(res => {
        if (res && typeof res.id === 'number' && !res.error && g[res.id]) out[g[res.id].i] = res.result;
      });
    } else {
      // Fallback: one request at a time.
      for (const x of g) {
        try { out[x.i] = await rpc(x.r.method, x.r.params); }
        catch { out[x.i] = null; }
      }
    }
  }
  return out;
}

export const call = (to, data, from) =>
  rpc('eth_call', [{ to, data: '0x' + data, ...(from ? { from } : {}) }, 'latest']);
export const getCode = a => rpc('eth_getCode', [a, 'latest']);
export const getStorage = (a, s) => rpc('eth_getStorageAt', [a, s, 'latest']);

// ---------- Blockscout ----------
export async function scout(path) {
  const res = await fetch(SCOUT + path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('explorer HTTP ' + res.status);
  return res.json();
}

// ---------- logs: RPC first, explorer fallback ----------
const MAX_RANGE = Number(process.env.LOG_RANGE || 2000);

export async function getLogsRPC(filter, from, to) {
  const out = [];
  for (let b = from; b <= to; b += MAX_RANGE) {
    const hi = Math.min(to, b + MAX_RANGE - 1);
    const part = await rpc('eth_getLogs', [{
      ...filter,
      fromBlock: '0x' + b.toString(16),
      toBlock: '0x' + hi.toString(16)
    }]);
    if (Array.isArray(part)) out.push(...part);
  }
  return out;
}

/** Address-scoped logs from Blockscout, paginated. */
export async function getLogsScout(address, maxPages = 3) {
  let url = `/api/v2/addresses/${address}/logs`;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    let j;
    try { j = await scout(url); } catch { break; }
    if (!j || !Array.isArray(j.items) || !j.items.length) break;
    out.push(...j.items);
    const np = j.next_page_params;
    if (!np) break;
    const qs = Object.keys(np).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(np[k])}`).join('&');
    url = `/api/v2/addresses/${address}/logs?${qs}`;
  }
  return out;
}

/**
 * Address logs with automatic fallback. Returns { logs, source }.
 * Normalises Blockscout's `block_number` to `blockNumber`.
 */
export async function addressLogs(address, blocksBack = 20000) {
  try {
    const latest = parseInt(await rpc('eth_blockNumber', []), 16);
    const from = Math.max(0, latest - blocksBack);
    const logs = await getLogsRPC({ address }, from, latest);
    if (logs.length) return { logs, source: 'rpc' };
  } catch { /* fall through */ }

  const items = await getLogsScout(address, 3);
  const logs = items.map(l => ({
    ...l,
    blockNumber: l.block_number != null ? l.block_number : l.blockNumber
  }));
  return { logs, source: 'explorer' };
}

// ---------- decoding helpers ----------
export const strip = h => (h && h.startsWith('0x')) ? h.slice(2) : (h || '');
export const toBig = h => { const s = strip(h); return s ? BigInt('0x' + s) : 0n; };
export const addrWord = w => '0x' + strip(w).slice(24).toLowerCase();
export const padAddr = a => strip(a).toLowerCase().padStart(64, '0');
export const pad32 = n => n.toString(16).padStart(64, '0');

export function decodeString(hex) {
  const h = strip(hex);
  if (h.length < 128) {
    let s = '';
    for (let i = 0; i < h.length; i += 2) {
      const c = parseInt(h.slice(i, i + 2), 16);
      if (c > 0) s += String.fromCharCode(c);
    }
    return s.trim();
  }
  try {
    const off = parseInt(h.slice(0, 64), 16) * 2;
    const len = parseInt(h.slice(off, off + 64), 16) * 2;
    const d = h.slice(off + 64, off + 64 + len);
    let s = '';
    for (let i = 0; i < d.length; i += 2) s += String.fromCharCode(parseInt(d.slice(i, i + 2), 16));
    return s.replace(/\u0000/g, '').trim();
  } catch { return ''; }
}
