// POST /api/gate { wallet } -> holder status + remaining IP quota (no scan consumed).
import { holderBalance } from '../lib/holder.js';
import { checkQuota } from '../lib/quota.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const wallet = String(body.wallet || '').toLowerCase();

  let holder = false, balance = '0';
  if (wallet) { try { const h = await holderBalance(wallet); holder = h.holder; balance = h.balance; } catch {} }

  const q = await checkQuota(req);
  return res.status(200).json({ holder, balance, left: q.enforced ? q.left : null, enforced: q.enforced });
}
