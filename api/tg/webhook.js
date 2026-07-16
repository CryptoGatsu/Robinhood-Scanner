import { kv } from '@vercel/kv';
import { getToken, getHolders, getDeployAndOG, getSafety, getSignal, getVerdict } from '../../lib/engine.js';
import { formatScan } from '../../lib/tgfmt.js';

export const config = { runtime: 'edge' };

/* RobinScan Telegram bot — webhook handler.

   Works in DMs and groups. In groups it auto-detects any 0x contract address in
   a message and replies with a scan. Commands: /scan <ca>, /start, /help.

   Setup: see scripts/tg-setup.mjs. IMPORTANT: to auto-scan in groups you must
   disable privacy mode in BotFather (/setprivacy -> Disable), otherwise Telegram
   only forwards messages that @mention the bot.

   Security: Telegram is told a secret token at registration and sends it back in
   the X-Telegram-Bot-Api-Secret-Token header. We reject anything without it, so
   randoms can't POST fake updates to this endpoint.
*/

const TG_API = 'https://api.telegram.org/bot';
const ADDR_RE = /0x[0-9a-fA-F]{40}/;
const SCAN_TTL = 300;          // share the API's 5-min scan cache
const COOLDOWN = 60;           // per chat+token, seconds — anti-spam

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const BOT = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT) return new Response('ok', { status: 200 });   // never 500 at Telegram

  let update;
  try { update = await req.json(); } catch (e) { return new Response('ok', { status: 200 }); }

  try { await route(update, BOT); } catch (e) { /* swallow — always 200 */ }
  // Always 200 quickly; Telegram retries on anything else.
  return new Response('ok', { status: 200 });
}

async function route(update, BOT) {
  const msg = update.message || update.channel_post;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // --- commands ---
  if (/^\/(start|help)/i.test(text)) {
    return send(BOT, chatId, helpText(), msg.message_id);
  }
  if (/^\/scan/i.test(text)) {
    const m = text.match(ADDR_RE);
    if (!m) return send(BOT, chatId, 'Send me a contract address:\n<code>/scan 0x...</code>', msg.message_id);
    return doScan(BOT, chatId, m[0].toLowerCase(), msg.message_id);
  }

  // --- auto-detect a CA in any message (the group behaviour) ---
  const found = text.match(ADDR_RE);
  if (!found) return;
  const addr = found[0].toLowerCase();

  // anti-spam: don't rescan the same token in the same chat too often
  const cdKey = `tg:cd:${chatId}:${addr}`;
  try {
    const seen = await kv.get(cdKey);
    if (seen) return;
    await kv.set(cdKey, 1, { ex: COOLDOWN });
  } catch (e) {}

  return doScan(BOT, chatId, addr, msg.message_id);
}

async function doScan(BOT, chatId, addr, replyTo) {
  // immediate feedback, then edit in the result (scans take a few seconds)
  const placeholder = await send(BOT, chatId, '\u{1F50D} <i>Scanning\u2026</i>', replyTo);
  const mid = placeholder && placeholder.result && placeholder.result.message_id;

  let body;
  try {
    body = await scanToken(addr);
  } catch (e) {
    const err = '\u26A0\uFE0F Scan failed. Try again in a moment.';
    return mid ? edit(BOT, chatId, mid, err) : send(BOT, chatId, err, replyTo);
  }
  if (!body) {
    const nf = '\u2753 No token found at that address on Robinhood Chain.';
    return mid ? edit(BOT, chatId, mid, nf) : send(BOT, chatId, nf, replyTo);
  }

  const out = formatScan(body);
  return mid ? edit(BOT, chatId, mid, out) : send(BOT, chatId, out, replyTo);
}

/* Run the scan via the shared engine, reusing the SAME cache key as /v1/scan so a
   website scan warms the bot and vice-versa. */
async function scanToken(addr) {
  const cacheKey = 'cache:scan:' + addr;
  try {
    const hit = await kv.get(cacheKey);
    if (hit) return hit;
  } catch (e) {}

  const { token, market, liquidity, holdersCount } = await getToken(addr);
  if (!token.symbol && !token.name) return null;

  const hasPool = !!(liquidity && liquidity.usd);
  const [holders, og, safety] = await Promise.all([
    getHolders(addr, token.totalSupply, liquidity && liquidity.pool, holdersCount),
    getDeployAndOG(addr, token.symbol, market && market.pairCreatedAt),
    getSafety(addr, hasPool),
  ]);

  const body = {
    token: {
      address: addr, name: token.name, symbol: token.symbol, decimals: token.decimals,
      totalSupply: token.totalSupply, logo: token.logo, verified: token.verified,
      deployedAt: og.deployedMs ? new Date(og.deployedMs).toISOString() : null, isOG: og.isOG,
    },
    verdict: getVerdict(safety, holders, liquidity),
    safety,
    holders: {
      count: holders.count, top1Pct: holders.top1Pct, top10Pct: holders.top10Pct,
      top: holders.top, creatorPct: null, lpPct: holders.lpPct, burnedPct: holders.burnedPct,
      bundle: { detected: false, maxFunderPct: 0 }, truncated: false,
    },
    liquidity,
    market: market ? {
      priceUsd: market.priceUsd, marketCap: market.marketCap, volume24h: market.volume24h,
      change24h: market.change24h, change1h: market.change1h,
    } : null,
    signal: getSignal(market, holders),
    dupes: { sameTicker: og.sameTicker, isOriginal: og.isOG === true },
    links: {
      explorer: 'https://robinhoodchain.blockscout.com/token/' + addr,
      scanner: 'https://www.robinscan4u.com/?token=' + addr,
      dexscreener: 'https://dexscreener.com/robinhood/' + addr,
    },
    cached: false,
    asOf: new Date().toISOString(),
    notFinancialAdvice: true,
  };
  try { await kv.set(cacheKey, body, { ex: SCAN_TTL }); } catch (e) {}
  return body;
}

// ---- Telegram helpers ----
async function send(BOT, chat_id, text, reply_to_message_id) {
  return tg(BOT, 'sendMessage', {
    chat_id, text, parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(reply_to_message_id ? { reply_to_message_id, allow_sending_without_reply: true } : {}),
  });
}
async function edit(BOT, chat_id, message_id, text) {
  return tg(BOT, 'editMessageText', {
    chat_id, message_id, text, parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}
async function tg(BOT, method, payload) {
  try {
    const r = await fetch(TG_API + BOT + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch (e) { return null; }
}

function helpText() {
  return [
    '\u{1F50D} <b>RobinScan</b> — Robinhood Chain token scanner',
    '',
    'Drop any contract address in the chat and I\u2019ll scan it automatically.',
    '',
    '<b>Commands</b>',
    '<code>/scan 0x...</code> — scan a token',
    '<code>/help</code> — this message',
    '',
    'Add me to your group and I\u2019ll auto-scan every CA posted.',
    '',
    '<i>Fast scan. For the deep bundle + honeypot sim, use the link in each scan. Not financial advice.</i>',
  ].join('\n');
}
