import { kv } from '@vercel/kv';
import { verifyMessage } from 'viem';
import { json, balanceOf, issueSession, THRESHOLD } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

// POST /api/auth/verify  { address, signature }
// 1. rebuild the exact message from the stored nonce
// 2. verify the signature was made by `address` over that message
// 3. read balanceOf(address) on-chain
// 4. if >= threshold -> issue session token, else 403 with how-short-they-are
export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad body' }, 400); }
  const address = (body.address || '').toLowerCase();
  const signature = body.signature || '';

  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'invalid address' }, 400);
  if (!/^0x[0-9a-f]+$/i.test(signature)) return json({ error: 'invalid signature' }, 400);

  // fetch + consume the nonce (single use)
  let nonce;
  try {
    nonce = await kv.get('nonce:' + address);
  } catch (e) {
    return json({ error: 'nonce lookup failed' }, 500);
  }
  if (!nonce) return json({ error: 'no nonce — request a new one' }, 400);
  // delete immediately so a signature can't be replayed
  try { await kv.del('nonce:' + address); } catch (e) {}

  // rebuild the message EXACTLY as the nonce endpoint created it
  const message =
    'Sign in to RobinScan members.\n\n' +
    'Wallet: ' + address + '\n' +
    'Nonce: ' + nonce + '\n\n' +
    'This proves you hold $ROBINSCAN. It is free, is NOT a transaction, ' +
    'and cannot move your funds or approve any spending.';

  // verify the signature came from `address`
  let ok = false;
  try {
    ok = await verifyMessage({ address, message, signature });
  } catch (e) {
    return json({ error: 'signature verification failed' }, 401);
  }
  if (!ok) return json({ error: 'signature does not match address' }, 401);

  // on-chain balance check — the real gate
  let bal;
  try {
    bal = await balanceOf(address);
  } catch (e) {
    return json({ error: 'could not read balance, try again' }, 502);
  }

  if (bal < THRESHOLD) {
    const have = Number(bal / (10n ** 18n));
    const need = Number(THRESHOLD / (10n ** 18n));
    return json({
      error: 'insufficient_holdings',
      have, need,
      short: need - have,
      message: 'You hold ' + have.toLocaleString() + ' $ROBINSCAN. ' +
               'You need ' + need.toLocaleString() + ' to enter.',
    }, 403);
  }

  const token = await issueSession(address);
  return json({ token, address, expiresInHours: 6 });
}
