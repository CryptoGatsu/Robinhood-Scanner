import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

/* Public site counters + recent-scans feed.
   GET  /api/stats                         -> { scans, visits }
   GET  /api/stats?token=0x..              -> { scans, visits, tokenScans }
   GET  /api/stats?feed=1                  -> { recent: [ {token,sym,mcap,ts}, ... ] }
   POST /api/stats?hit=visit               -> increments visits
   POST /api/stats?hit=scan&token=0x..&sym=X&mcap=123
        -> increments global + per-token scan count, pushes to recent feed
*/

const FEED_KEY = 'rs:recent';
const FEED_MAX = 12;

export default async function handler(req) {
  const url = new URL(req.url);
  const hit = url.searchParams.get('hit');
  const token = (url.searchParams.get('token') || '').toLowerCase();

  try {
    // --- recent-scans feed (for the live toast) ---
    if (req.method === 'GET' && url.searchParams.get('feed')) {
      let recent = [];
      try { recent = (await kv.get(FEED_KEY)) || []; } catch (e) {}
      return json({ recent });
    }

    // --- scan increment ---
    if (req.method === 'POST' && hit === 'scan') {
      const scans = await kv.incr('rs:scans');
      let tokenScans = null;
      if (/^0x[0-9a-f]{40}$/.test(token)) {
        tokenScans = await kv.incr('rs:tok:' + token);
        // push to the recent feed (best-effort)
        try {
          const sym = (url.searchParams.get('sym') || '').slice(0, 16);
          const mcap = Number(url.searchParams.get('mcap')) || 0;
          let recent = (await kv.get(FEED_KEY)) || [];
          recent.unshift({ token, sym, mcap, ts: Date.now() });
          recent = recent.slice(0, FEED_MAX);
          await kv.set(FEED_KEY, recent, { ex: 3600 });
        } catch (e) {}
      }
      return json({ scans, tokenScans, visits: (await kv.get('rs:visits')) || 0 });
    }

    // --- visit increment ---
    if (req.method === 'POST' && hit === 'visit') {
      const visits = await kv.incr('rs:visits');
      return json({ scans: (await kv.get('rs:scans')) || 0, visits });
    }

    // --- default read (optionally with per-token count) ---
    const [scans, visits] = await Promise.all([kv.get('rs:scans'), kv.get('rs:visits')]);
    const out = { scans: scans || 0, visits: visits || 0 };
    if (/^0x[0-9a-f]{40}$/.test(token)) {
      out.tokenScans = (await kv.get('rs:tok:' + token)) || 0;
    }
    return json(out);
  } catch (e) {
    return json({ scans: null, visits: null, error: 'counter_unavailable' }, 200);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
