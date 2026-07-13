import { kv } from '@vercel/kv';
import { recoverAddress } from '../../lib/recover.js';
import { json, balanceOf, issueSession, THRESHOLD } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

// wrap any promise so nothing can hang the request forever
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + label)), ms)),
  ]);
}

// POST /api/auth/verify  { address, signature }
export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad body' }, 400); }
  const address = (body.address || '').toLowerCase();
  const signature = body.signature || '';

  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'invalid address' }, 400);
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return json({ error: 'invalid signature' }, 400);

  // fetch + consume the single-use nonce (KV read, timeout-guarded)
  let nonce;
  try {
    nonce = await withTimeout(kv.get('nonce:' + address), 4000, 'kv.get');
  } catch (e) {
    return json({ error: 'nonce_lookup_failed', detail: String(e.message || e) }, 500);
  }
  if (!nonce) return json({ error: 'no_nonce' }, 400);
  // delete (best-effort, timeout-guarded, don't block on it)
  try { await withTimeout(kv.del('nonce:' + address), 3000, 'kv.del'); } catch (e) {}

  // rebuild the message EXACTLY as nonce.js created it
  const message =
    'Sign in to RobinScan members.\n\n' +
    'Wallet: ' + address + '\n' +
    'Nonce: ' + nonce + '\n\n' +
    'This proves you hold $ROBINSCAN. It is free, is NOT a transaction, ' +
    'and cannot move your funds or approve any spending.';

  // recover signer (pure crypto, cannot hang)
  const signer = recoverAddress(message, signature);
  if (!signer) return json({ error: 'signature_verification_failed' }, 401);
  if (signer !== address) return json({ error: 'signature_mismatch' }, 401);

  // on-chain balance check (already timeout-guarded internally, but double-cap here)
  let bal;
  try {
    bal = await withTimeout(balanceOf(address), 9000, 'balanceOf');
  } catch (e) {
    return json({ error: 'balance_read_failed', detail: String(e.message || e) }, 502);
  }

  if (bal < THRESHOLD) {
    const have = Number(bal / (10n ** 18n));
    const need = Number(THRESHOLD / (10n ** 18n));
    return json({
      error: 'insufficient_holdings',
      have, need, short: need - have,
      message: 'You hold ' + have.toLocaleString() + ' $ROBINSCAN. You need ' + need.toLocaleString() + ' to enter.',
    }, 403);
  }

  let token;
  try {
    token = await withTimeout(issueSession(address), 3000, 'issueSession');
  } catch (e) {
    return json({ error: 'session_failed', detail: String(e.message || e) }, 500);
  }
  return json({ token, address, expiresInHours: 6 });
}
