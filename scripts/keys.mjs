#!/usr/bin/env node
// API key admin. Run locally with your Vercel KV env vars loaded.
//   node scripts/keys.mjs mint <owner> <tier>     -> creates a key, prints it ONCE
//   node scripts/keys.mjs revoke <rawkey>          -> deactivates a key
//   node scripts/keys.mjs info <rawkey>            -> shows a key's record
//
// Keys are stored as a HASH; the raw key is shown only at creation. Save it then.

import { kv } from '@vercel/kv';
import { createHash, randomBytes } from 'node:crypto';

const hashKey = (raw) => createHash('sha256').update(String(raw)).digest('hex').slice(0, 32);

const [, , cmd, a, b] = process.argv;

async function main() {
  if (cmd === 'mint') {
    const owner = a || 'unnamed';
    const tier = b || 'free';
    if (!['free', 'bot', 'pro'].includes(tier)) throw new Error('tier must be free|bot|pro');
    const raw = 'rsk_live_' + randomBytes(20).toString('hex');
    await kv.set('key:' + hashKey(raw), { owner, tier, created: new Date().toISOString(), active: true });
    console.log('\nKey created for "' + owner + '" (tier: ' + tier + ')');
    console.log('SAVE THIS NOW — it is not recoverable:\n');
    console.log('  ' + raw + '\n');
  } else if (cmd === 'revoke') {
    if (!a) throw new Error('provide the raw key');
    const k = 'key:' + hashKey(a);
    const rec = await kv.get(k);
    if (!rec) { console.log('No such key.'); return; }
    await kv.set(k, { ...rec, active: false });
    console.log('Revoked key for "' + rec.owner + '".');
  } else if (cmd === 'info') {
    if (!a) throw new Error('provide the raw key');
    const rec = await kv.get('key:' + hashKey(a));
    console.log(rec ? JSON.stringify(rec, null, 2) : 'No such key.');
  } else {
    console.log('usage: keys.mjs mint <owner> <tier> | revoke <rawkey> | info <rawkey>');
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
