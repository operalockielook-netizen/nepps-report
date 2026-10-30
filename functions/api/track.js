// POST /api/track - for pinned tenders, finds the award and contract in KHMDHS.
// Body: {items:[{k, refs:[notice ref, ...]}]}. Uses GET /adamChain/{ref} and POST /auction
// {referenceNumber}. Results are cached in KV (binding PINS): checked again after 6 hours,
// award details kept for good. Never fails: on an upstream problem it returns what it has.
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
const API = 'https://cerpp.eprocurement.gov.gr/khmdhs-opendata';
const FRESH = 6 * 3600 * 1000;

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function walk(o, key, out) {
  if (Array.isArray(o)) o.forEach(function (v) { walk(v, key, out); });
  else if (o && typeof o === 'object') for (const k in o) { if (k === key) out.push(o[k]); walk(o[k], key, out); }
  return out;
}
function contractors(it) {
  const seen = {};
  walk(it, 'contractingMembersDataList', []).forEach(function (l) {
    (Array.isArray(l) ? l : []).forEach(function (m) {
      const n = ((m && m.name) || '').trim();
      if (n) seen[((m.vatNumber || n) + '').trim()] = n;
    });
  });
  return Object.values(seen);
}
function val(o) { return o && typeof o === 'object' ? (o.value || '') : (o || ''); }

export async function onRequestPost(ctx) {
  const env = ctx.env;
  if (!who(ctx.request)) return json({ error: 'not signed in' }, 401);
  if (!env.PINS) return json({ error: 'storage not configured' }, 500);
  let body;
  try { body = await ctx.request.json(); } catch (x) { return json({ error: 'bad json' }, 400); }
  const items = (body && Array.isArray(body.items) ? body.items : []).slice(0, 60);
  let budget = 40, blocked = false;
  async function up(path, init) {
    if (blocked || budget <= 0) return null;
    budget--;
    try {
      const r = await fetch(API + path, Object.assign({ headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } }, init || {}));
      if (r.status === 429) { blocked = true; return null; }
      if (!r.ok) return null;
      return await r.json();
    } catch (x) { return null; }
  }
  async function award(ref) {
    const c = await env.PINS.get('aw_v2:' + ref, 'json');
    if (c) return c;
    const d = await up('/auction?page=0', { method: 'POST', body: JSON.stringify({ referenceNumber: ref }) });
    const it = d && (d.content || []).filter(function (x) { return x.referenceNumber === ref; })[0];
    if (!it) return null;
    let amt = it.totalCostWithoutVAT;
    if (typeof amt !== 'number' || amt <= 0) amt = it.auctionAmount;
    const a = {
      ref: ref, ctr: contractors(it), av: typeof amt === 'number' && amt > 0 ? amt : null,
      day: (it.submissionDate || it.signedDate || '').slice(0, 10), sig: (it.signedDate || '').slice(0, 10), dv: it.diavgeiaLink || '',
      pdf: API + '/auction/attachment/' + ref, cancelled: !!it.cancelled
    };
    await env.PINS.put('aw_v2:' + ref, JSON.stringify(a));
    return a;
  }
  const out = {};
  for (const item of items) {
    const k = String(item.k || ''), refs = (Array.isArray(item.refs) ? item.refs : []).slice(0, 2).map(String);
    if (!k || !refs.length) continue;
    const cached = await env.PINS.get('trk_v2:' + k, 'json');
    if (cached && ((cached.aw && cached.aw.length && cached.sy && cached.sy.length) || Date.now() - cached.t < FRESH)) { out[k] = cached; continue; }
    let auctions = [], contracts = [], ok = false;
    for (const ref of refs) {
      const ch = await up('/adamChain/' + encodeURIComponent(ref));
      if (!ch) continue;
      ok = true;
      (ch.auctions || []).forEach(function (r) { if (auctions.indexOf(r) < 0) auctions.push(r); });
      (ch.contracts || []).forEach(function (r) { if (contracts.indexOf(r) < 0) contracts.push(r); });
      if (auctions.length) break;
    }
    if (!ok) { if (cached) out[k] = cached; continue; }
    const aw = [];
    for (const r of auctions.slice(0, 3)) { const a = await award(r); if (a && !a.cancelled) aw.push(a); }
    const res = { aw: aw, sy: contracts, t: Date.now() };
    if (auctions.length && !aw.length && cached && cached.aw) res.aw = cached.aw; // details not reachable now
    await env.PINS.put('trk_v2:' + k, JSON.stringify(res));
    out[k] = res;
  }
  return json({ items: out, partial: blocked || budget <= 0 });
}

export async function onRequest() {
  return json({ error: 'POST only' }, 405);
}
