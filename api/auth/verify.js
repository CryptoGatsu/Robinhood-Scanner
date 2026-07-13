import { kv } from '@vercel/kv';
import { recoverAddress } from '../../lib/recover.js';
import { json, balanceOf, issueSession, THRESHOLD } from '../../lib/gate.js';

// nodejs runtime (not edge) — the crypto libs and RPC fetch are rock-solid here.
export const config = { runtime: 'nodejs' };

// POST /api/auth/verify  { address, signature }
export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad body' }, 400); }
  const address = (body.address || '').toLowerCase();
  const signature = body.signature || '';

  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'invalid address' }, 400);
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return json({ error: 'invalid signature' }, 400);

  // fetch + consume the single-use nonce
  let nonce;
  try { nonce = await kv.get('nonce:' + address); }
  catch (e) { return json({ error: 'nonce lookup failed' }, 500); }
  if (!nonce) return json({ error: 'no nonce — request a new one' }, 400);
  try { await kv.del('nonce:' + address); } catch (e) {}

  // rebuild the message EXACTLY as nonce.js created it
  const message =
    'Sign in to RobinScan members.\n\n' +
    'Wallet: ' + address + '\n' +
    'Nonce: ' + nonce + '\n\n' +
    'This proves you hold $ROBINSCAN. It is free, is NOT a transaction, ' +
    'and cannot move your funds or approve any spending.';

  // recover the signer and confirm it matches the claimed address
  const signer = recoverAddress(message, signature);
  if (!signer) return json({ error: 'signature verification failed' }, 401);
  if (signer !== address) return json({ error: 'signature does not match address' }, 401);

  // on-chain balance check — the real gate
  let bal;
  try { bal = await balanceOf(address); }
  catch (e) { return json({ error: 'could not read balance, try again' }, 502); }

  if (bal < THRESHOLD) {
    const have = Number(bal / (10n ** 18n));
    const need = Number(THRESHOLD / (10n ** 18n));
    return json({
      error: 'insufficient_holdings',
      have, need, short: need - have,
      message: 'You hold ' + have.toLocaleString() + ' $ROBINSCAN. You need ' + need.toLocaleString() + ' to enter.',
    }, 403);
  }

  const token = await issueSession(address);
  return json({ token, address, expiresInHours: 6 });
}
