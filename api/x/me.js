import { json, readSession, balanceOf, THRESHOLD } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

// GET /api/x/me  — a gated endpoint. Every explorer data route will follow
// this exact pattern: read the session, 403 if absent/invalid, then serve.
export default async function handler(req) {
  const address = await readSession(req);
  if (!address) return json({ error: 'not_authenticated' }, 401);

  // Optional freshness check: re-confirm they still hold the threshold.
  // (Cheap insurance so a wallet that sold out loses access mid-session.)
  let stillHolds = true;
  try {
    const bal = await balanceOf(address);
    stillHolds = bal >= THRESHOLD;
  } catch (e) { /* if RPC hiccups, trust the token for now */ }

  if (!stillHolds) return json({ error: 'holdings_dropped' }, 403);

  return json({ ok: true, address, role: 'holder' });
}
