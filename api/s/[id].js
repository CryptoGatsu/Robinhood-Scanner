export const config = { runtime: 'edge' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req) {
  const url = new URL(req.url);
  const token = (url.pathname.split('/').pop() || '').toLowerCase();
  const origin = url.origin;

  if (!/^0x[0-9a-f]{40}$/.test(token)) {
    return Response.redirect(origin + '/', 302);
  }

  let name = 'a token', sym = '', mcap = 0, ch = {};
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + token, { headers: { accept: 'application/json' } });
    const j = await r.json();
    const pairs = (j.pairs || []).filter(p => ['robinhood', 'robinhoodchain', '4663'].includes(String(p.chainId || '').toLowerCase()));
    const use = pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
    if (use) {
      name = (use.baseToken && use.baseToken.name) || 'a token';
      sym = (use.baseToken && use.baseToken.symbol) || '';
      mcap = use.marketCap || use.fdv || 0;
      ch = use.priceChange || {};
    }
  } catch (e) {}

  const title = (sym ? '$' + sym : name) + ' \u2014 RobinScan report';
  const chg = ch.h24 != null ? ((ch.h24 >= 0 ? '+' : '') + ch.h24.toFixed(1) + '% 24h') : '';
  const mc = mcap ? ('$' + (mcap >= 1e6 ? (mcap / 1e6).toFixed(1) + 'M' : (mcap / 1e3).toFixed(1) + 'K') + ' mcap') : '';
  const desc = ['Can you sell it, who holds it, is liquidity locked', mc, chg].filter(Boolean).join(' \u00b7 ');
  const ogImage = origin + '/og/' + token;
  const appUrl = origin + '/?token=' + token;

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(origin + '/s/' + token)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
</head><body>
<script>location.replace(${JSON.stringify(appUrl)});</script>
<p>Redirecting to <a href="${esc(appUrl)}">RobinScan</a>\u2026</p>
</body></html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' } });
}
