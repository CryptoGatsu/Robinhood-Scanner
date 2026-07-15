import { json } from '../../lib/apikit.js';

export const config = { runtime: 'nodejs' };

export default async function handler() {
  return json({ ok: true, version: '1.0.0', service: 'robinscan-api' });
}
