import { kv } from '@vercel/kv';
import { json, NONCE_TTL_SECONDS } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

// GET /api/auth/nonce?address=0x...
// Returns a one-time nonce and the exact message the wallet should sign.
export default async function handler(req) {
  const url = new URL(req.url);
  const address = (url.searchParams.get('address') || '').toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return json({ error: 'invalid address' }, 400);
  }

  // random single-use nonce
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

  // store nonce keyed by address, short TTL, single-use (deleted on verify)
  try {
    await kv.set('nonce:' + address, nonce, { ex: NONCE_TTL_SECONDS });
  } catch (e) {
    return json({ error: 'could not issue nonce' }, 500);
  }

  const message =
    'Sign in to RobinScan members.\n\n' +
    'Wallet: ' + address + '\n' +
    'Nonce: ' + nonce + '\n\n' +
    'This proves you hold $ROBINSCAN. It is free, is NOT a transaction, ' +
    'and cannot move your funds or approve any spending.';

  return json({ nonce, message });
}
