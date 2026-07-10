// POST /api/scan  { address, wallet? }
// The server does the entire scan and returns a complete, cached result
// including the risk verdict, price series, market data and entry signal.

import { scanToken, priceSeries } from '../lib/scan.js';
import { entrySignal } from '../lib/signal.js';
import { kvGet, kvSet, KEYS } from '../lib/kv.js';
import { isHolder } from '../lib/holder.js';
import { checkQuota, consumeQuota } from '../lib/quota.js';

const TTL = Number(process.env.SCAN_TTL || 90);

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const addr = String(body.address || '').toLowerCase();
  const wallet = String(body.wallet || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'bad address' });

  // --- gate: holder bypass, else IP quota (consume one scan) ---
  let holder = false;
  if (wallet) { try { holder = await isHolder(wallet); } catch {} }
  if (!holder) {
    const q = await consumeQuota(req);
    if (q.enforced && !q.allow) {
      return res.status(429).json({ error: 'quota', left: 0, holder: false });
    }
  }

  // --- scan (cached) ---
  const key = KEYS.token(addr);
  let data = await kvGet(key);
  if (!data) {
    try {
      // Fail loudly if the RPC isn't configured, so the UI can say so instead
      // of silently reporting every token as "no contract code".
      if (!process.env.RPC_URL) {
        return res.status(503).json({ error: 'RPC_URL is not set on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
      }
      data = await scanToken(addr);
      // price series + entry signal computed alongside
      let series = { kind: 'none' };
      try { series = await priceSeries({ addr, pool: data.pool, dec: data.dec, mkt: data.mkt }); } catch {}
      data.series = series;
      data.signal = entrySignal({
        verdict: data.label,
        price: data.mkt && data.mkt.price,
        change: (data.mkt && data.mkt.change) || {},
        vol: { h24: data.mkt && data.mkt.vol, h1: data.mkt && data.mkt.volH1 },
        liq: data.mkt && data.mkt.liq,
        mcap: data.mkt && data.mkt.mcap,
        txns: (data.mkt && data.mkt.txns) || {},
        series: series.pts || null
      });
      await kvSet(key, data, TTL);
    } catch (e) {
      return res.status(502).json({ error: String(e.message || e) });
    }
  }

  return res.status(200).json({ ...data, holder });
}
