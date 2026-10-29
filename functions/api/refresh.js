// POST /api/refresh - starts the no-email dashboard refresh (nepps-monitor / refresh_dashboard.yml).
// The whole site sits behind Cloudflare Access, so only signed-in, allowed people reach this.
// GH_TOKEN: fine-grained GitHub token, Actions read/write on nepps-monitor only (Pages secret).
const REPO = 'operalockielook-netizen/nepps-monitor';
const WF = 'refresh_dashboard.yml';

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function gh(env, path, init) {
  init = init || {};
  const headers = Object.assign({
    'Authorization': 'Bearer ' + env.GH_TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dailypsdigest'
  }, init.headers || {});
  return fetch('https://api.github.com/repos/' + REPO + path, Object.assign({}, init, { headers: headers }));
}

export async function onRequestPost(ctx) {
  const env = ctx.env;
  if (!env.GH_TOKEN) return json({ error: 'GH_TOKEN not configured' }, 500);
  // If a refresh is already queued or running, do not start another one.
  const runs = await gh(env, '/actions/workflows/' + WF + '/runs?per_page=5');
  if (runs.ok) {
    const d = await runs.json();
    if ((d.workflow_runs || []).some(function (r) { return r.status !== 'completed'; })) {
      return json({ ok: true, already: true });
    }
  }
  const r = await gh(env, '/actions/workflows/' + WF + '/dispatches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'master' })
  });
  if (r.status === 204) return json({ ok: true });
  return json({ error: 'GitHub ' + r.status }, 502);
}

export async function onRequest() {
  return json({ error: 'POST only' }, 405);
}
