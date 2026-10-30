// GET/PUT /api/pins - each signed-in person's pinned items, kept in Cloudflare KV (binding PINS).
// The site is behind Cloudflare Access, so the person is identified by their Access email.
function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function who(request) {
  let e = request.headers.get('Cf-Access-Authenticated-User-Email') || '';
  if (!e) {
    // Fall back to the Access token (header or cookie); Access has already verified it.
    let tok = request.headers.get('Cf-Access-Jwt-Assertion') || '';
    if (!tok) {
      const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') || '');
      tok = m ? m[1] : '';
    }
    try {
      const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      e = JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).email || '';
    } catch (x) { e = ''; }
  }
  return e.trim().toLowerCase();
}

export async function onRequestGet(ctx) {
  const e = who(ctx.request);
  if (!e) return json({ error: 'not signed in' }, 401);
  if (!ctx.env.PINS) return json({ error: 'storage not configured' }, 500);
  const v = await ctx.env.PINS.get('pins:' + e, 'json');
  return json({ email: e, pins: Array.isArray(v) ? v : [] });
}

export async function onRequestPut(ctx) {
  const e = who(ctx.request);
  if (!e) return json({ error: 'not signed in' }, 401);
  if (!ctx.env.PINS) return json({ error: 'storage not configured' }, 500);
  let body;
  try { body = await ctx.request.json(); } catch (x) { return json({ error: 'bad json' }, 400); }
  const pins = body && body.pins;
  if (!Array.isArray(pins) || pins.length > 500) return json({ error: 'bad pins' }, 400);
  const s = JSON.stringify(pins);
  if (s.length > 500000) return json({ error: 'too large' }, 413);
  await ctx.env.PINS.put('pins:' + e, s);
  return json({ ok: true, n: pins.length });
}
