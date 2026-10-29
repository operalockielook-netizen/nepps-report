// GET / - the site's home page shows the new dashboard (dev/index.html).
// The classic report page stays available at /report (see report.js).
export async function onRequestGet(ctx) {
  const u = new URL(ctx.request.url);
  u.pathname = '/dev/';
  return ctx.env.ASSETS.fetch(new Request(u.toString(), ctx.request));
}
