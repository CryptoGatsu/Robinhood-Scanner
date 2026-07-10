// IP-based daily scan quota (server-side; survives new browsers/incognito).
// Raw IP is never stored — only a salted, truncated hash. TTL to UTC midnight.
import crypto from 'node:crypto';
import { kvGet, kvIncr } from './kv.js';

const FREE = Number(process.env.FREE_SCANS || 5);
const SALT = process.env.QUOTA_SALT || 'robinscan';

function realIp(req) {
  const xff = req.headers['x-forwarded-for'] || '';
  const first = String(xff).split(',')[0].trim();
  return first || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '0.0.0.0';
}
function normaliseIp(ip) {
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':') + '::/64'; // group IPv6 by /64
}
function key(req) {
  const h = crypto.createHash('sha256').update(normaliseIp(realIp(req)) + '|' + SALT).digest('hex').slice(0, 32);
  return `rs:q:${h}`;
}
function ttlToMidnight() {
  const now = Date.now(), d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return Math.max(60, Math.ceil((next - now) / 1000));
}

// enforced=false means KV isn't configured; caller should not hard-block.
export async function checkQuota(req) {
  try {
    const used = Number((await kvGet(key(req))) || 0);
    return { enforced: true, allow: used < FREE, left: Math.max(0, FREE - used), used };
  } catch { return { enforced: false, allow: true, left: FREE, used: 0 }; }
}
export async function consumeQuota(req) {
  try {
    const k = key(req);
    const used = Number((await kvGet(k)) || 0);
    if (used >= FREE) return { enforced: true, allow: false, left: 0, used };
    const n = await kvIncr(k, ttlToMidnight());
    return { enforced: true, allow: true, left: Math.max(0, FREE - n), used: n };
  } catch { return { enforced: false, allow: true, left: FREE, used: 0 }; }
}
