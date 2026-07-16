// Phanes-style message formatting for the RobinScan Telegram bot.
// Telegram HTML parse_mode.

const SUB = ['\u2080', '\u2081', '\u2082', '\u2083', '\u2084', '\u2085', '\u2086', '\u2087', '\u2088', '\u2089'];

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// $2.6K / $3.7M / $1.2B — compact money
export function money(n) {
  if (n == null || !isFinite(n)) return '—';
  const x = Number(n);
  if (x >= 1e9) return '$' + trim(x / 1e9) + 'B';
  if (x >= 1e6) return '$' + trim(x / 1e6) + 'M';
  if (x >= 1e3) return '$' + trim(x / 1e3) + 'K';
  if (x >= 1) return '$' + x.toFixed(2);
  return '$' + trim(x);
}
function trim(x) {
  const s = x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2);
  return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

// 1B / 250M — plain compact number
export function num(n) {
  if (n == null || !isFinite(n)) return '—';
  const x = Number(n);
  if (x >= 1e9) return trim(x / 1e9) + 'B';
  if (x >= 1e6) return trim(x / 1e6) + 'M';
  if (x >= 1e3) return trim(x / 1e3) + 'K';
  return String(Math.round(x));
}

// Phanes' subscript-zero price: 0.000004091 -> $0.0₅4091
export function price(p) {
  if (p == null || !isFinite(p) || p <= 0) return '—';
  const x = Number(p);
  if (x >= 0.01) return '$' + x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  // count zeros right after the decimal point
  const s = x.toFixed(20);
  const frac = s.split('.')[1] || '';
  let zeros = 0;
  while (zeros < frac.length && frac[zeros] === '0') zeros++;
  const sig = frac.slice(zeros).replace(/0+$/, '').slice(0, 4) || '0';
  if (zeros >= 4) {
    const subs = String(zeros).split('').map(d => SUB[Number(d)]).join('');
    return '$0.0' + subs + sig;
  }
  return '$' + x.toFixed(Math.min(8, zeros + 4)).replace(/0+$/, '').replace(/\.$/, '');
}

// +1.0% / -55%
export function pct(n, withSign = true) {
  if (n == null || !isFinite(n)) return '—';
  const x = Number(n);
  const s = Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1);
  return (withSign && x > 0 ? '+' : '') + s + '%';
}

// 5d / 3h / 2y — compact age
export function age(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  const h = ms / 3600000;
  if (h < 1) return Math.max(1, Math.round(ms / 60000)) + 'm';
  if (h < 24) return Math.round(h) + 'h';
  const d = h / 24;
  if (d < 365) return Math.round(d) + 'd';
  return (d / 365).toFixed(1).replace(/\.0$/, '') + 'y';
}

const VERDICT_EMOJI = { ok: '\u{1F7E2}', caution: '\u{1F7E1}', danger: '\u{1F534}' };

/* Build the Phanes-style scan message from our /v1/scan JSON. */
export function formatScan(s) {
  const t = s.token || {};
  const m = s.market || {};
  const h = s.holders || {};
  const liq = s.liquidity || {};
  const v = s.verdict || {};
  const sym = t.symbol || 'UNKNOWN';
  const L = [];

  // --- header ---
  const ogTag = t.isOG === true ? ' \u{1F3C6}' : (t.isOG === false ? ' \u26A0\uFE0F' : '');
  L.push(`\u{1F48A} <b>${esc(t.name || 'Unknown')}</b> (<b>$${esc(sym)}</b>)${ogTag}`);
  L.push(`\u251C <code>${esc(t.address)}</code>`);
  const meta = ['#RHC'];
  const a = age(t.deployedAt);
  if (a) meta.push(a);
  if (t.verified) meta.push('\u2705 Verified');
  if (t.isOG === true) meta.push('OG');
  else if (t.isOG === false) meta.push('NOT OG');
  L.push(`\u2514 ${meta.join(' | ')}`);
  L.push('');

  // --- stats ---
  L.push('\u{1F4CA} <b>Stats</b>');
  L.push(`\u251C USD    <b>${price(m.priceUsd)}</b> (${pct(m.change24h)})`);
  L.push(`\u251C MC     <b>${money(m.marketCap)}</b>`);
  L.push(`\u251C Vol    <b>${money(m.volume24h)}</b>`);
  const thin = liq.usd != null && liq.usd < 2000;
  L.push(`\u251C LP     <b>${money(liq.usd)}</b>${thin ? ' \u26A0\uFE0F' : ''}`);
  L.push(`\u251C Sup    <b>${supply(t.totalSupply, t.decimals)}</b>`);
  L.push(`\u2514 24H    <b>${pct(m.change24h)}</b>${m.change1h != null ? ` | 1H <b>${pct(m.change1h)}</b>` : ''}`);
  L.push('');

  // --- security ---
  L.push('\u{1F512} <b>Security</b>');
  L.push(`\u251C Verdict  ${VERDICT_EMOJI[v.level] || ''} <b>${esc(v.headline || '')}</b>`);
  L.push(`\u251C Top 10   <b>${h.top10Pct != null ? h.top10Pct + '%' : '—'}</b>${h.count != null ? ` | ${h.count} (total)` : ''}`);
  if (h.top && h.top.length) L.push(`\u251C TH       ${h.top.join('|')}`);
  // LP/burn are NOT holder concentration — label them plainly so nobody misreads
  if (h.lpPct != null) L.push(`\u251C LP held  <b>${h.lpPct}%</b> <i>(pool, not a wallet)</i>`);
  if (h.burnedPct != null) L.push(`\u251C Burned   <b>${h.burnedPct}%</b>`);
  L.push(`\u251C Sell     ${s.safety && s.safety.sellTest === 'passed' ? '\u2705 passed' : s.safety && s.safety.sellTest === 'failed' ? '\u274C FAILED' : '\u2753 untested'}`);
  const dangers = (s.safety && s.safety.dangerousFunctions) || [];
  L.push(`\u2514 Flags    ${dangers.length ? '\u26A0\uFE0F ' + dangers.map(esc).join(', ') : 'none found'}`);
  L.push('');

  // --- dupes warning ---
  const dup = s.dupes || {};
  if (dup.sameTicker) {
    L.push(t.isOG === false
      ? `\u26A0\uFE0F <b>NOT the original $${esc(sym)}</b> — ${dup.sameTicker} others share this ticker.`
      : `\u2139\uFE0F ${dup.sameTicker} other token${dup.sameTicker > 1 ? 's' : ''} share this ticker.`);
    L.push('');
  }

  // --- links ---
  const lk = s.links || {};
  const links = [];
  if (lk.scanner) links.push(`<a href="${lk.scanner}">SCAN</a>`);
  if (lk.dexscreener) links.push(`<a href="${lk.dexscreener}">DEX</a>`);
  if (lk.explorer) links.push(`<a href="${lk.explorer}">EXP</a>`);
  if (links.length) L.push(links.join(' \u00B7 '));

  // honest footer: the deep checks live on the site
  L.push('');
  L.push('<i>Fast scan \u2014 for the deep bundle + honeypot sim, tap SCAN. Not financial advice.</i>');

  return L.join('\n');
}

function supply(totalSupply, decimals) {
  if (!totalSupply) return '—';
  try {
    const d = BigInt(decimals == null ? 18 : decimals);
    const v = BigInt(String(totalSupply).split('.')[0]) / (10n ** d);
    return num(Number(v));
  } catch (e) { return '—'; }
}
