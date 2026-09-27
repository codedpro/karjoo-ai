// Refresh the ITMaster-fed pages of a freshly started slot before it goes live.
// Runs INSIDE the new container (deploy/activate.sh:
//   docker exec karjoo-app-<colour> node deploy/lightsail/refresh-content.mjs).
//
// Why: the image is built on GitHub, which cannot reach ITMaster (its pull API
// only answers Lightsail), so `next build` prerenders /blog with no articles and
// robots.txt / sitemap.xml / llms.txt without the engine's content. This sends
// the slot the same signed push ITMaster sends on publish (X-Thoth-Signature =
// HMAC-SHA256 of the body with PUBLISH_PUSH_SECRET), which revalidates those
// paths (src/app/api/itmaster-webhook/route.ts), then requests each page so it
// is regenerated before the edge points at the slot. Exit 1 if /blog is still
// empty while the engine has articles.
const env = process.env;
const local = "http://127.0.0.1:3000";
const need = ["ITMASTER_API_URL", "PUBLISH_SITE", "PUBLISH_PULL_KEY", "PUBLISH_PUSH_SECRET"].filter((k) => !env[k]);
if (need.length) {
  console.log(`refresh skipped: ${need.join(", ")} not set`);
  process.exit(0);
}

const base = `${env.ITMASTER_API_URL.replace(/\/$/, "")}/v1/publish/${encodeURIComponent(env.PUBLISH_SITE)}`;
const res = await fetch(`${base}/articles?limit=100`, { headers: { Authorization: `Bearer ${env.PUBLISH_PULL_KEY}` } });
if (!res.ok) {
  console.log(`refresh: ITMaster answered ${res.status}; pages keep their build-time content`);
  process.exit(1);
}
const slugs = ((await res.json()).articles ?? []).map((a) => a.slug).filter(Boolean);

const { createHmac } = await import("node:crypto");
async function push(slug) {
  const body = JSON.stringify({ event: "publish", article: { slug, status: "published" } });
  const sig = createHmac("sha256", env.PUBLISH_PUSH_SECRET).update(body).digest("hex");
  const r = await fetch(`${local}/api/itmaster-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-thoth-signature": sig },
    body,
  });
  if (!r.ok) throw new Error(`webhook ${slug}: ${r.status}`);
}
// One push revalidates /blog and the shared routes; one per slug refreshes each article page.
for (const slug of slugs) await push(slug);

const paths = ["/blog", "/sitemap.xml", "/robots.txt", "/llms.txt", ...slugs.map((s) => `/blog/${encodeURIComponent(s)}`)];
let blogLinks = 0;
for (let pass = 0; pass < 2; pass++) {
  for (const p of paths) {
    const r = await fetch(local + p);
    const text = await r.text();
    if (p === "/blog") blogLinks = new Set(text.match(/href="\/blog\/[^"]+"/g) ?? []).size;
  }
  if (blogLinks >= Math.min(slugs.length, 1)) break;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`refresh: ${slugs.length} article(s) from ITMaster, /blog now lists ${blogLinks}`);
process.exit(slugs.length && !blogLinks ? 1 : 0);
