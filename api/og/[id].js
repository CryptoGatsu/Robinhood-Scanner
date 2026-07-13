import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const GREEN = '#00c805';
const RED = '#ff5252';

/* tiny hyperscript so we never need JSX (plain .js builds anywhere) */
function h(type, props, ...children) {
  const kids = children.flat().filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids } };
}

function trendPoints(price, ch) {
  if (!price) return [];
  const at = p => (typeof p === 'number' && isFinite(p)) ? price / (1 + p / 100) : null;
  return [at(ch.h24), at(ch.h6), at(ch.h1), at(ch.m5), price].filter(v => v != null && isFinite(v) && v > 0);
}

function sparkSvg(ys, color) {
  const W = 1000, H = 300, pad = 16;
  if (ys.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`;
  const lo = Math.min(...ys), hi = Math.max(...ys), range = Math.max(hi - lo, hi * 1e-9);
  const x = i => pad + (i / (ys.length - 1)) * (W - 2 * pad);
  const y = v => H - pad - ((v - lo) / range) * (H - 2 * pad);
  const line = ys.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = line + ` L${(W - pad).toFixed(1)} ${H} L${pad.toFixed(1)} ${H} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${color}" stop-opacity="0.3"/>`
    + `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${area}" fill="url(#g)"/>`
    + `<path d="${line}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`
    + `</svg>`;
}

function money(n) {
  if (!n) return '$0';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const token = (url.pathname.split('/').pop() || '').toLowerCase();

    let name = 'Token', sym = '', price = 0, mcap = 0, liq = 0, ch = {}, logo = null;
    try {
      const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + token, { headers: { accept: 'application/json' } });
      const j = await r.json();
      const pairs = (j.pairs || []).filter(p => ['robinhood', 'robinhoodchain', '4663'].includes(String(p.chainId || '').toLowerCase()));
      const use = pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
      if (use) {
        name = (use.baseToken && use.baseToken.name) || 'Token';
        sym = (use.baseToken && use.baseToken.symbol) || '';
        price = parseFloat(use.priceUsd) || 0;
        mcap = use.marketCap || use.fdv || 0;
        liq = (use.liquidity && use.liquidity.usd) || 0;
        ch = use.priceChange || {};
        logo = (use.info && use.info.imageUrl) || null;
      }
    } catch (e) {}

    const ys = trendPoints(price, ch);
    const up = ys.length >= 2 ? ys[ys.length - 1] >= ys[0] : true;
    const color = up ? GREEN : RED;
    const chg = ys.length >= 2 ? ((ys[ys.length - 1] - ys[0]) / ys[0] * 100) : 0;
    const svgUri = 'data:image/svg+xml;base64,' + btoa(sparkSvg(ys, color));

    const tree = h('div', { style: { width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', background: '#080908', padding: '56px', fontFamily: 'sans-serif' } },
      h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '10px' } },
        logo
          ? h('img', { src: logo, width: 64, height: 64, style: { borderRadius: '50%' } })
          : h('div', { style: { width: '64px', height: '64px', borderRadius: '50%', background: '#171a17', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa09a', fontSize: '22px', fontWeight: 800 } }, (sym || '?').slice(0, 3).toUpperCase()),
        h('div', { style: { display: 'flex', flexDirection: 'column', marginLeft: '18px' } },
          h('div', { style: { color: '#ffffff', fontSize: '44px', fontWeight: 800 } }, sym ? '$' + sym : name),
          h('div', { style: { color: '#9aa09a', fontSize: '22px' } }, name)
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: 'auto' } },
          h('div', { style: { color: '#ffffff', fontSize: '40px', fontWeight: 700 } }, price ? String(price.toPrecision(3)) : '\u2014'),
          h('div', { style: { color: color, fontSize: '26px', fontWeight: 700 } }, (chg >= 0 ? '+' : '') + chg.toFixed(1) + '% 24h')
        )
      ),
      h('div', { style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' } },
        h('img', { src: svgUri, width: 1000, height: 300 })
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', marginTop: '10px' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', marginRight: '48px' } },
          h('div', { style: { color: '#5f655f', fontSize: '18px', fontWeight: 700 } }, 'MARKET CAP'),
          h('div', { style: { color: '#ffffff', fontSize: '30px', fontWeight: 600 } }, money(mcap))
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { color: '#5f655f', fontSize: '18px', fontWeight: 700 } }, 'LIQUIDITY'),
          h('div', { style: { color: '#ffffff', fontSize: '30px', fontWeight: 600 } }, money(liq))
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', marginLeft: 'auto' } },
          h('div', { style: { width: '34px', height: '34px', borderRadius: '50%', border: '3px solid ' + GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', color: GREEN, fontSize: '15px', fontWeight: 800, marginRight: '10px' } }, 'RS'),
          h('div', { style: { color: '#9aa09a', fontSize: '24px', fontWeight: 700 } }, 'RobinScan')
        )
      )
    );

    return new ImageResponse(tree, { width: 1200, height: 630 });
  } catch (e) {
    return new Response('og error', { status: 500 });
  }
}
