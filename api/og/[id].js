// GET /api/og/{addr} — 1200x630 SVG preview card for social shares.
import { kvGet, KEYS } from '../../lib/kv.js';

function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function money(n){if(n==null||!isFinite(n)||n<=0)return '—';
  if(n>=1e9)return '$'+(n/1e9).toFixed(2)+'B'; if(n>=1e6)return '$'+(n/1e6).toFixed(2)+'M';
  if(n>=1e3)return '$'+(n/1e3).toFixed(1)+'K'; return '$'+n.toFixed(2);}

const VERDICT = {
  ok:      { label: 'LOOKS OK', color: '#00c805' },
  caution: { label: 'CAUTION',  color: '#ffb800' },
  bundled: { label: 'BUNDLED',  color: '#ffb800' },
  avoid:   { label: 'AVOID',    color: '#ff5000' },
  unknown: { label: 'NO DATA',  color: '#8a8f98' }
};
const TONE = { good:'#00c805', watch:'#ffb800', wait:'#ff8a00', danger:'#ff5000', muted:'#8a8f98' };

export default async function handler(req, res) {
  const addr = String(req.query.id || '').toLowerCase();
  const data = /^0x[0-9a-f]{40}$/.test(addr) ? await kvGet(KEYS.token(addr)) : null;

  const sym = data ? esc(data.sym ? '$' + data.sym : (data.name || 'Token')) : 'Token';
  const name = data ? esc(data.name || '') : '';
  const v = VERDICT[(data && data.label) || 'unknown'] || VERDICT.unknown;
  const sig = data && data.signal ? data.signal : null;
  const sigColor = sig ? (TONE[sig.tone] || '#8a8f98') : '#8a8f98';
  const sigHead = sig ? esc(sig.head) : 'Scan a token';
  const mc = data && data.mkt ? money(data.mkt.mcap) : '—';
  const lq = data && data.mkt ? money(data.mkt.liq) : '—';
  const vol = data && data.mkt ? money(data.mkt.vol) : '—';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0d1f10"/><stop offset="1" stop-color="#050805"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00c805"/><stop offset="1" stop-color="#0a5a0f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="6" fill="${v.color}"/>
  <circle cx="110" cy="105" r="46" fill="none" stroke="url(#ring)" stroke-width="7"/>
  <text x="110" y="122" font-family="Arial,sans-serif" font-size="42" font-weight="800" fill="#00c805" text-anchor="middle">RS</text>
  <text x="180" y="98" font-family="Arial,sans-serif" font-size="30" font-weight="800" fill="#e8eaed">RobinScan</text>
  <text x="180" y="132" font-family="monospace" font-size="19" fill="#8a8f98">Robinhood Chain risk scanner</text>

  <text x="70" y="290" font-family="Arial,sans-serif" font-size="86" font-weight="900" fill="#fff">${sym}</text>
  <text x="70" y="340" font-family="Arial,sans-serif" font-size="30" fill="#8a8f98">${name}</text>

  <rect x="760" y="210" width="370" height="92" rx="16" fill="${v.color}" opacity="0.14"/>
  <rect x="760" y="210" width="370" height="92" rx="16" fill="none" stroke="${v.color}" stroke-width="2"/>
  <text x="945" y="270" font-family="Arial,sans-serif" font-size="46" font-weight="900" fill="${v.color}" text-anchor="middle">${v.label}</text>

  <rect x="70" y="400" width="1060" height="2" fill="#1e2620"/>
  <circle cx="90" cy="470" r="9" fill="${sigColor}"/>
  <text x="115" y="480" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#e8eaed">${sigHead}</text>

  <text x="70" y="565" font-family="monospace" font-size="24" fill="#8a8f98">MC <tspan fill="#e8eaed" font-weight="700">${mc}</tspan>    VOL <tspan fill="#e8eaed" font-weight="700">${vol}</tspan>    LIQ <tspan fill="#e8eaed" font-weight="700">${lq}</tspan></text>
  <text x="1130" y="565" font-family="monospace" font-size="20" fill="#4a4f57" text-anchor="end">not financial advice</text>
</svg>`;

  res.setHeader('content-type', 'image/svg+xml');
  res.setHeader('cache-control', 's-maxage=90, stale-while-revalidate=600');
  res.status(200).send(svg);
}
