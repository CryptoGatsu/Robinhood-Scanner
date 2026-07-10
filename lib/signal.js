// Entry-signal engine.
//
// Produces a framed read of "what the data shows" — never a directive to buy or
// sell. Safety always overrides: a token that fails the risk scan gets no entry
// read, regardless of how its chart looks. Levels are labelled technical
// reference points, not instructions.

function pct(n) { return (n >= 0 ? '+' : '') + (n || 0).toFixed(1) + '%'; }

export function entrySignal({ verdict, price, change = {}, vol = {}, liq, mcap, txns = {}, series }) {
  // Hard safety gate.
  if (verdict === 'avoid' || verdict === 'bundled') {
    return {
      tone: 'danger',
      head: 'Not an entry — failed a safety check',
      body: 'The risk scan flagged this token. No price level turns an unsellable, rug-prone, or bundled token into a good entry.',
      levels: null, posture: 'blocked'
    };
  }
  if (verdict === 'unknown') {
    return {
      tone: 'muted',
      head: 'Can’t read entry — not enough data',
      body: 'Holder or pool data was missing, so momentum can’t be assessed. Treat as high risk until it verifies.',
      levels: null, posture: 'nodata'
    };
  }

  const c1 = change.h1 || 0, c6 = change.h6 || 0, c24 = change.h24 || 0;
  const buys = txns.buys || 0, sells = txns.sells || 0;
  const flow = (buys + sells) > 0 ? buys / (buys + sells) : 0.5;
  const liqRatio = mcap > 0 ? (liq || 0) / mcap : 0;

  // Technical levels from the recent series.
  let levels = null, posInRange = 0.5;
  if (series && series.length >= 5) {
    const ys = series.map(p => p.y);
    const hi = Math.max(...ys), lo = Math.min(...ys), range = Math.max(1e-18, hi - lo);
    posInRange = (price - lo) / range;
    levels = {
      now: price, support: lo, resistance: hi,
      dipZone: [lo, lo + range * 0.25],
      fairZone: [lo + range * 0.25, lo + range * 0.6],
      extendedAbove: lo + range * 0.6
    };
  }

  const momentumUp = c1 > 2 && c6 > 0;
  const momentumDown = c1 < -3 || c6 < -8;
  const buyPressure = flow > 0.55;
  const sellPressure = flow < 0.45;
  const thinLiq = liqRatio > 0 && liqRatio < 0.03;

  let posture = 'watch';
  if (momentumDown && posInRange < 0.35 && buyPressure) posture = 'accumulation';
  else if (posInRange < 0.3 && !momentumDown) posture = 'near-support';
  else if (posInRange > 0.75 && momentumUp) posture = 'extended';
  else if (momentumUp && buyPressure && posInRange < 0.7) posture = 'breakout';
  else if (momentumDown || sellPressure) posture = 'falling';

  const READS = {
    'accumulation': { tone: 'good', head: 'Pulling back into support with buyers active',
      body: `Price is in the lower part of its recent range (${pct(c1)} 1h) while buys outnumber sells (${(flow * 100).toFixed(0)}% buy flow). The kind of zone where entries have historically had less room to the recent floor — no guarantee it holds.` },
    'near-support': { tone: 'good', head: 'Sitting near its recent floor',
      body: `Trading in the bottom third of its recent range — closer to support than resistance. That's where risk-to-reward on an entry tends to be more favourable, if support holds.` },
    'breakout': { tone: 'watch', head: 'Breaking up with momentum',
      body: `Rising (${pct(c1)} 1h) with buyers in control and some room below resistance. Momentum entries carry a higher risk of buying a local top.` },
    'extended': { tone: 'wait', head: 'Extended — near recent highs',
      body: `Up ${pct(c24)} on the day and pressing the top of its range. Entering here means buying near resistance; a pullback toward mid-range would be a lower-risk spot if the trend stays intact.` },
    'falling': { tone: 'wait', head: 'Falling — no floor established yet',
      body: `Down ${pct(c1)} 1h / ${pct(c6)} 6h with sellers in control. Entering before it bases risks more downside. Waiting for the bleeding to stop is the lower-risk read.` },
    'watch': { tone: 'watch', head: 'Ranging — no clear edge right now',
      body: `No strong momentum either way (${pct(c1)} 1h, ${(flow * 100).toFixed(0)}% buy flow). Nothing says now over later — watch for a push off support or a clean breakout.` }
  };

  const out = Object.assign({}, READS[posture] || READS.watch);
  if (thinLiq) {
    out.body += ` Liquidity is thin (${(liqRatio * 100).toFixed(1)}% of market cap), so expect heavy slippage and sharper moves both ways.`;
    if (out.tone === 'good') out.tone = 'watch';
    posture = 'thin-' + posture;
  }
  out.levels = levels;
  out.posture = posture;
  out.flow = flow;
  return out;
}
