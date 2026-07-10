const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = a => a ? a.slice(0, 7) + '…' + a.slice(-5) : '';
function money(n) {
  if (n == null || !isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toPrecision(3);
}
function fmtPrice(p) {
  if (!isFinite(p) || p <= 0) return '—';
  if (p >= 1) return '$' + p.toFixed(4);
  if (p >= 0.0001) return '$' + p.toFixed(6);
  return '$' + p.toExponential(3);
}

/* ---------------- wallet + gate ---------------- */
let WALLET = null, IS_HOLDER = false, WALLET_BAL = '0', SERVER = null;

async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) { alert('No browser wallet found. Install MetaMask, Rabby, or similar.'); return; }
  try {
    const a = await eth.request({ method: 'eth_requestAccounts' });
    if (!a || !a.length) return;
    WALLET = a[0].toLowerCase();
    try { localStorage.setItem('rs.wallet', WALLET); } catch (e) {}
    await refreshGate();
    if (eth.on && !eth._rsBound) {
      eth._rsBound = true;
      eth.on('accountsChanged', x => {
        WALLET = (x && x[0]) ? x[0].toLowerCase() : null;
        try { WALLET ? localStorage.setItem('rs.wallet', WALLET) : localStorage.removeItem('rs.wallet'); } catch (e) {}
        refreshGate();
      });
    }
  } catch (e) { if (e && e.code !== 4001) alert('Connect failed: ' + (e.message || e)); }
}
function disconnectWallet() {
  WALLET = null; IS_HOLDER = false; WALLET_BAL = '0';
  try { localStorage.removeItem('rs.wallet'); } catch (e) {}
  refreshGate();
}

async function refreshGate() {
  try {
    const r = await fetch('/api/gate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET || '' })
    });
    const j = await r.json();
    SERVER = j;
    IS_HOLDER = !!j.holder;
    WALLET_BAL = j.balance || '0';
  } catch (e) { SERVER = null; }
  renderGate();
}

function renderGate() {
  const btn = $('wbtn'), st = $('gstatus');
  if (btn) {
    btn.textContent = WALLET ? short(WALLET) : 'Connect wallet';
    btn.classList.toggle('on', !!WALLET);
    btn.title = WALLET ? 'Click to disconnect' : 'Read-only. No signature, no transaction.';
  }
  if (!st) return;
  const left = SERVER && SERVER.left != null ? SERVER.left : null;
  if (IS_HOLDER) {
    st.innerHTML = '<span class="gpill hold">Holder · unlimited scans</span>'
      + '<span class="gsub">' + esc(Number(WALLET_BAL).toLocaleString()) + ' $ROBINSCAN</span>';
  } else if (WALLET) {
    st.innerHTML = '<span class="gpill free">' + (left != null ? left : '—') + ' free scans left today</span>'
      + '<span class="gsub">Hold 1,000+ $ROBINSCAN for unlimited · you have ' + esc(Number(WALLET_BAL).toLocaleString()) + '</span>';
  } else {
    st.innerHTML = '<span class="gpill free">' + (left != null ? left : '—') + ' free scans left today</span>'
      + '<span class="gsub">Connect a wallet to check your $ROBINSCAN balance</span>';
  }
}

/* ---------------- scan ---------------- */
function log(msg, cls) {
  const el = $('log');
  const d = document.createElement('div');
  d.className = 'logline' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  el.appendChild(d);
}
function clearLog() { $('log').innerHTML = ''; }
function showErr(html) { const e = $('err'); e.className = 'err'; e.innerHTML = html; e.style.display = 'block'; }
function hideErr() { const e = $('err'); e.style.display = 'none'; e.className = 'err'; }

async function run() {
  hideErr(); clearLog(); $('result').innerHTML = '';
  const addr = $('addr').value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) { showErr('<b>That doesn’t look like a token address.</b> Paste the full 0x… address.'); return; }

  const btn = $('scan'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  log('› scanning on the server…');

  try {
    const r = await fetch('/api/scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: addr, wallet: WALLET || '' })
    });
    if (r.status === 429) {
      showPaywall();
      btn.disabled = false; btn.textContent = 'Check this token';
      refreshGate();
      return;
    }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
    const data = await r.json();
    log('✓ done', 'ok');
    render(data, addr);
    refreshGate();
  } catch (e) {
    showErr('<b>Scan failed.</b> ' + esc(String(e.message || e)));
  } finally {
    btn.disabled = false; btn.textContent = 'Check this token';
  }
}

function showPaywall() {
  const e = $('err'); e.className = 'paywall'; e.style.display = 'block';
  e.innerHTML = '<div class="pw-h">Daily free scans used</div>'
    + '<div class="pw-b">You’ve used your free scans for today. Hold <b>1,000+ $ROBINSCAN</b> for unlimited scanning, or come back after midnight UTC.</div>'
    + '<a class="pw-a" href="https://dexscreener.com/robinhood/' + CA + '" target="_blank" rel="noopener">Get $ROBINSCAN ↗</a>'
    + (WALLET ? '' : '<div class="pw-b" style="margin-top:10px;margin-bottom:0">Already holding? <a href="#" id="pwc" style="color:var(--green)">Connect wallet</a>.</div>');
  const p = $('pwc'); if (p) p.onclick = ev => { ev.preventDefault(); connectWallet(); };
}

/* ---------------- render ---------------- */
const VMAP = {
  ok:      { cls: 'ok',    big: 'Looks okay',        sub: 'The checks that ran found no traps. Still not a guarantee.' },
  caution: { cls: 'risky', big: 'Risky — be careful', sub: 'No dealbreakers, but things to watch.' },
  bundled: { cls: 'avoid', big: 'Avoid this one',     sub: 'Signs of a coordinated launch.' },
  avoid:   { cls: 'avoid', big: 'Avoid this one',     sub: 'At least one serious red flag — read the details.' },
  unknown: { cls: 'unknown', big: 'Can’t fully check it', sub: 'Key data was missing — not a clean bill of health.' }
};
const SIG_TONE = { good: 'sig-good', watch: 'sig-watch', wait: 'sig-wait', danger: 'sig-danger', muted: 'sig-muted' };

function render(d, addr) {
  const v = VMAP[d.label] || VMAP.unknown;
  const sig = d.signal;
  const shareUrl = location.origin + '/api/s/' + addr;
  let html = '';

  // verdict banner
  html += '<div class="banner ' + v.cls + '"><div class="big">' + esc(d.why ? (v.big) : v.big) + '</div>'
    + '<div class="bsub">' + esc(d.why || v.sub) + '</div></div>';

  // entry signal
  if (sig) {
    html += '<div class="sigcard ' + (SIG_TONE[sig.tone] || 'sig-muted') + '">'
      + '<div class="sig-h"><span class="sig-dot"></span><span class="sig-title">' + esc(sig.head) + '</span></div>'
      + '<div class="sig-body">' + esc(sig.body) + '</div>';
    if (sig.levels) {
      const L = sig.levels;
      html += '<div class="levels">'
        + lvl('Now', fmtPrice(L.now), true)
        + lvl('Support', fmtPrice(L.support))
        + lvl('Resistance', fmtPrice(L.resistance))
        + '</div>'
        + '<div class="sig-body" style="padding-top:0"><b>Dip zone</b> ' + fmtPrice(L.dipZone[0]) + ' – ' + fmtPrice(L.dipZone[1])
        + ' · <b>Fair</b> ' + fmtPrice(L.fairZone[0]) + ' – ' + fmtPrice(L.fairZone[1])
        + ' · extended above ' + fmtPrice(L.extendedAbove)
        + '<br><span style="color:var(--fg-faint)">Levels are technical reference points from recent price action, not instructions.</span></div>';
    }
    html += '</div>';
  }

  // market row
  if (d.mkt) {
    html += '<div class="statrow">'
      + stat('Market cap', money(d.mkt.mcap))
      + stat('24h volume', money(d.mkt.vol))
      + stat('Liquidity', money(d.mkt.liq))
      + stat('Price', fmtPrice(d.mkt.price))
      + '</div>';
  }

  // token identity
  html += '<div class="tokcard"><div class="tokname">' + esc(d.sym ? '$' + d.sym : (d.name || short(addr))) + '</div>'
    + '<div class="tokmeta mono">' + short(addr) + '</div>'
    + '<div class="toklinks">'
    + tlink('Explorer', 'https://robinhoodchain.blockscout.com/token/' + addr)
    + tlink('DexScreener', 'https://dexscreener.com/robinhood/' + addr)
    + '</div></div>';

  // findings from modules
  if (d.top || d.flags || d.lp) {
    html += '<div class="findings">' + renderFindings(d) + '</div>';
  }

  // share bar
  const tweet = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(
    (d.sym ? '$' + d.sym : 'This token') + ' — ' + (v.big) + (sig ? ' · ' + sig.head : '') + '\n\nScanned with RobinScan #robinscan'
  ) + '&url=' + encodeURIComponent(shareUrl);
  html += '<div class="sharebar">'
    + '<a class="sharebtn" href="' + tweet + '" target="_blank" rel="noopener">Share on X</a>'
    + '<button class="sharebtn" id="copyShare">Copy link</button>'
    + '</div>';

  $('result').innerHTML = html;
  const cs = $('copyShare');
  if (cs) cs.onclick = () => { try { navigator.clipboard.writeText(shareUrl); cs.textContent = 'Copied ✓'; setTimeout(() => cs.textContent = 'Copy link', 1400); } catch (e) {} };
}

function lvl(k, v, now) { return '<div class="lvl' + (now ? ' now' : '') + '"><div class="lvl-k">' + k + '</div><div class="lvl-v">' + v + '</div></div>'; }
function stat(k, v) { return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
function tlink(t, h) { return '<a class="tlink" href="' + h + '" target="_blank" rel="noopener">' + t + ' ↗</a>'; }

function renderFindings(d) {
  const rows = [];
  if (d.flags) {
    const f = d.flags;
    rows.push(finding(f.mint ? 'fail' : 'pass', 'Mint function', f.mint ? 'Present — supply can be inflated' : 'None found'));
    rows.push(finding(f.blacklist ? 'fail' : 'pass', 'Blacklist / freeze', f.blacklist ? 'Present — wallets can be frozen' : 'None found'));
    if (f.feeSetter) rows.push(finding('warn', 'Adjustable tax', 'Owner can change the trading tax'));
    if (f.pausable) rows.push(finding('warn', 'Pausable', 'Trading can be paused'));
  }
  if (d.sim) {
    rows.push(finding(d.sim.sellBlocked || d.sim.transferFrozen ? 'fail' : (d.sim.ran ? 'pass' : 'warn'),
      'Can you sell it?', d.sim.sellBlocked ? 'Sell blocked — honeypot' : d.sim.transferFrozen ? 'Transfers frozen' : d.sim.ran ? 'Live sell test passed' : 'Could not simulate'));
  }
  if (d.conc) {
    rows.push(finding(d.conc.top1 >= 30 ? 'fail' : d.conc.top1 >= 10 ? 'warn' : 'pass',
      'Biggest wallet', d.conc.top1.toFixed(1) + '%'));
    rows.push(finding(d.conc.top10 >= 70 ? 'warn' : 'pass', 'Top 10 wallets', d.conc.top10.toFixed(1) + '%'));
  }
  if (d.bundle && d.bundle.maxRecipients >= 3) {
    rows.push(finding('fail', 'Bundled launch', d.bundle.maxRecipients + ' wallets funded in one transaction'));
  }
  if (d.lp) {
    if (d.lp.kind === 'v2' && d.lp.securedPct != null && isFinite(d.lp.securedPct)) {
      rows.push(finding(d.lp.securedPct < 50 ? 'fail' : d.lp.securedPct >= 95 ? 'pass' : 'warn',
        'Liquidity locked', d.lp.securedPct.toFixed(0) + '% burned/locked'));
    } else if (d.lp.kind === 'v3v4') {
      rows.push(finding('info', 'Liquidity', 'v3 position — LP-burn check N/A'));
    }
  }
  return rows.join('');
}
function finding(sev, q, a) {
  return '<div class="finding f-' + sev + '"><span class="fq">' + esc(q) + '</span><span class="fa">' + esc(a) + '</span></div>';
}

/* ---------------- boot ---------------- */
(function () {
  $('scan').addEventListener('click', run);
  $('addr').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  const cc = $('caCopy');
  if (cc) cc.addEventListener('click', () => { try { navigator.clipboard.writeText(CA); cc.textContent = 'copied ✓'; setTimeout(() => cc.textContent = 'copy', 1400); } catch (e) {} });
  const wb = $('wbtn');
  if (wb) wb.addEventListener('click', () => WALLET ? disconnectWallet() : connectWallet());

  try {
    const saved = localStorage.getItem('rs.wallet');
    if (saved && /^0x[0-9a-f]{40}$/.test(saved)) { WALLET = saved; }
  } catch (e) {}
  refreshGate();

  // deep-link: /?token=0x…
  const q = new URLSearchParams(location.search).get('token');
  if (q && /^0x[0-9a-f]{40}$/i.test(q)) { $('addr').value = q.toLowerCase(); run(); }
})();
