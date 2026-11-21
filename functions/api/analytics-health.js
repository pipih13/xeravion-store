// Public, non-sensitive probe to verify that Cloudflare Pages Functions are deployed.
export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    service: "xeravion-pages-functions",
    endpoint: "analytics",
    checkedAt: new Date().toISOString()
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
