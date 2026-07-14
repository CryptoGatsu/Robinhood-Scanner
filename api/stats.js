import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

// Public site counters: total tokens scanned + total site visits.
// GET  /api/stats           -> { scans, visits }         (read, no increment)
// POST /api/stats?hit=visit -> increments visits, returns new totals
// POST /api/stats?hit=scan  -> increments scans, returns new totals
//
// Visits are de-duplicated per browser-day on the client (it only POSTs a
// visit once per day via a localStorage guard), so this stays a rough,
// honest "visits" number without per-request botting inflating it much.
export default async function handler(req) {
  const url = new URL(req.url);
  const hit = url.searchParams.get('hit');

  try {
    if (req.method === 'POST' && hit === 'scan') {
      const scans = await kv.incr('rs:scans');
      return json({ scans, visits: (await kv.get('rs:visits')) || 0 });
    }
    if (req.method === 'POST' && hit === 'visit') {
      const visits = await kv.incr('rs:visits');
      return json({ scans: (await kv.get('rs:scans')) || 0, visits });
    }
    // default: read both
    const [scans, visits] = await Promise.all([kv.get('rs:scans'), kv.get('rs:visits')]);
    return json({ scans: scans || 0, visits: visits || 0 });
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
