// Shared config + helpers for the members gate.
// Secrets (JWT_SECRET, RPC_URL) come from Vercel env vars — never hardcoded.

import { SignJWT, jwtVerify } from 'jose';

export const ROBINSCAN_TOKEN = '0xd3af2d5d83ff14ed78ce4ff9f8f98027b37cf47a';
export const THRESHOLD = 100000n * (10n ** 18n); // 100,000 $ROBINSCAN (18 decimals)
export const SESSION_HOURS = 6;
export const NONCE_TTL_SECONDS = 300; // single-use nonce lives 5 minutes

// RPC for the server-side balance read. Set RPC_URL in Vercel env;
// falls back to the public endpoint (which serves eth_call fine).
export const RPC_URL = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';

// JWT secret MUST be set in Vercel env. No insecure default in production.
function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET missing or too short (set a 32+ char secret in Vercel env)');
  return new TextEncoder().encode(s);
}

// Issue a session token bound to the verified address.
export async function issueSession(address) {
  return await new SignJWT({ sub: address.toLowerCase(), role: 'holder' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_HOURS + 'h')
    .setIssuer('robinscan-members')
    .sign(secretKey());
}

// Verify a session token from an incoming request. Returns the address or null.
export async function readSession(req) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'robinscan-members',
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (e) {
    return null;
  }
}

// balanceOf(address) via a raw eth_call — no dependency needed for one selector.
const BALANCE_OF = '0x70a08231';
export async function balanceOf(address) {
  const data = BALANCE_OF + address.toLowerCase().replace('0x', '').padStart(64, '0');
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: ROBINSCAN_TOKEN, data }, 'latest'],
    }),
  });
  if (!res.ok) throw new Error('RPC error ' + res.status);
  const j = await res.json();
  if (j.error || !j.result || j.result === '0x') return 0n;
  return BigInt(j.result);
}

export const json = (obj, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
