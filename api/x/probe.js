import { json, readSession } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

const BASE = 'https://robinhoodchain.blockscout.com';

// One-time diagnostic: hit each candidate endpoint and report status + shape.
// Lets us confirm what THIS chain's Blockscout actually serves before building
// views against it. Gated so it's not public.
const PROBES = [
  ['stats', '/api/v2/stats'],
  ['latest_blocks', '/api/v2/main-page/blocks'],
  ['latest_txns', '/api/v2/main-page/transactions'],
  ['search', '/api/v2/search?q=0xd3aF2D5d83Ff14Ed78Ce4ff9f8f98027B37cF47a'],
  ['token', '/api/v2/tokens/0xd3aF2D5d83Ff14Ed78Ce4ff9f8f98027B37cF47a'],
  ['address', '/api/v2/addresses/0xd3aF2D5d83Ff14Ed78Ce4ff9f8f98027B37cF47a'],
  ['address_txns', '/api/v2/addresses/0xd3aF2D5d83Ff14Ed78Ce4ff9f8f98027B37cF47a/transactions'],
];

async function probe(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(BASE + path, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    let shape = null;
    if (res.ok) {
      try {
        const j = await res.json();
        // report the top-level keys (or array length) so we learn the response shape
        shape = Array.isArray(j) ? ('array[' + j.length + ']')
          : (j && typeof j === 'object' ? Object.keys(j).slice(0, 8) : typeof j);
      } catch (e) { shape = 'non-json'; }
    }
    return { status: res.status, ok: res.ok, shape };
  } catch (e) {
    return { status: 0, ok: false, error: String(e.message || e) };
  } finally { clearTimeout(t); }
}

export default async function handler(req) {
  const address = await readSession(req);
  if (!address) return json({ error: 'not_authenticated' }, 401);

  const results = {};
  await Promise.all(PROBES.map(async ([name, path]) => {
    results[name] = { path, ...(await probe(path)) };
  }));

  return json({ base: BASE, results });
}
