import { json, readSession } from '../../lib/gate.js';

export const config = { runtime: 'edge' };

/* Gated proxy to the Uniswap Trading API for Robinhood Chain (4663).
   The Trading API requires a server-side x-api-key and rejects browser CORS,
   so all calls go through here. Holder-gated like the rest of the members area.

   POST /api/swap/trade  body: { action, ...payload }
     action='quote'          -> POST /v1/quote
     action='check_approval' -> POST /v1/check_approval
     action='swap'           -> POST /v1/swap

   The client never sees the API key. We also pin chainId to 4663 on quote so a
   bad client can't retarget the swap to another chain.
*/

const TRADE_API = 'https://trade-api.gateway.uniswap.org/v1';
const CHAIN_ID = 4663;                         // Robinhood Chain
const UR_VERSION = '2.1.1';                    // Universal Router version for 4663
const ALLOWED_ACTIONS = { quote: '/quote', check_approval: '/check_approval', swap: '/swap' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // holder gate — readSession returns the address STRING (or null), like the other endpoints
  const address = await readSession(req);
  if (!address) return json({ error: 'not_authorized' }, 401);

  const key = process.env.UNISWAP_TRADE_API_KEY;
  if (!key) return json({ error: 'swap_unconfigured', detail: 'UNISWAP_TRADE_API_KEY not set' }, 200);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }

  const action = body && body.action;
  const path = ALLOWED_ACTIONS[action];
  if (!path) return json({ error: 'bad_action', detail: 'action must be quote|check_approval|swap' }, 400);

  // build the upstream payload (strip our own 'action' field)
  const payload = { ...body };
  delete payload.action;

  // For /swap: the API expects { quote: <quote object>, signature, permitData }.
  // The client already sends exactly that shape. Do NOT spread the quote — the
  // endpoint requires it under a `quote` key ("quote is required" otherwise).
  // Just strip permitData if it's null (never forward permitData: null).
  if (action === 'swap') {
    if (payload.permitData == null) delete payload.permitData;
    return forward(path, payload, key);
  }

  // Pin the chain on quote/check_approval so the swap can't be retargeted.
  if (action === 'quote') {
    payload.tokenInChainId = CHAIN_ID;
    payload.tokenOutChainId = CHAIN_ID;
    // force the connected wallet as swapper — never trust a client-supplied one
    payload.swapper = address;
    // Restrict routing to the Uniswap AMM protocols (V2/V3/V4), which return a
    // signable on-chain transaction. This EXCLUDES UniswapX, whose gasless
    // off-chain orders must be POSTed to /order (a different flow we don't run).
    // NOTE: routingPreference only accepts BEST_PRICE|FASTEST — it does NOT take
    // "CLASSIC". Protocol restriction is done via the `protocols` array.
    payload.protocols = ['V2', 'V3', 'V4'];
    // Smart-account (7702/EIP-1271) wallets can't produce a standard Permit2
    // ECDSA signature, so the permit-based swap reverts. When the client flags a
    // smart-contract wallet, tell the API to build a LEGACY (direct-allowance)
    // route with no permitData, per the "legacy for smart accounts" guidance.
    if (payload.smartContractWallet === true) {
      // keep the flag for the API; it drives the non-Permit2 route
    } else {
      delete payload.smartContractWallet;
    }
  }
  if (action === 'check_approval') {
    payload.chainId = CHAIN_ID;
    payload.walletAddress = address;
  }

  return forward(path, payload, key);
}

// POST a payload to the Trading API and pass the response straight through.
async function forward(path, payload, key) {
  try {
    const upstream = await fetch(TRADE_API + path, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'content-type': 'application/json',
        'accept': 'application/json',
        'x-universal-router-version': UR_VERSION,
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return json({ error: 'trade_api_unreachable', detail: String(e && e.message || e) }, 502);
  }
}
