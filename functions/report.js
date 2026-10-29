// GET /report - the classic report page (index.html), which also carries the dashboard's data.
export async function onRequestGet(ctx) {
  const u = new URL(ctx.request.url);
  u.pathname = '/';
  u.search = '';
  return ctx.env.ASSETS.fetch(new Request(u.toString(), ctx.request));
}
