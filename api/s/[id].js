// GET /api/s/{addr} — shareable scan result (HTML shell with OG tags for previews).
import { kvGet, KEYS } from '../../lib/kv.js';

function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

export default async function handler(req, res) {
  const addr = String(req.query.id || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) { res.status(400).send('bad address'); return; }

  const data = await kvGet(KEYS.token(addr));
  const origin = 'https://' + (req.headers.host || 'robinscan.app');
  const img = `${origin}/api/og/${addr}`;
  const appUrl = `${origin}/?token=${addr}`;

  const sym = data ? (data.sym ? '$' + data.sym : (data.name || 'Token')) : 'Token';
  const verdict = data ? (data.label || '') : '';
  const sig = data && data.signal ? data.signal.head : '';
  const title = `${sym} — RobinScan`;
  const desc = data
    ? `${verdict.toUpperCase()}${sig ? ' · ' + sig : ''}. Scanned on RobinScan.`
    : 'Scan any Robinhood Chain token with RobinScan.';

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 's-maxage=90, stale-while-revalidate=600');
  res.status(200).send(`<!doctype html><html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(appUrl)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
</head><body>Redirecting to <a href="${esc(appUrl)}">RobinScan</a>…</body></html>`);
}
