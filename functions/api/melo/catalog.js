import { authorizeXeravionAdmin, json, meloRequest } from "../../_shared/melo.js";

// Melo limits the pricelist endpoint to one request every 10 minutes.
// Cache the upstream response for 11 minutes at each Cloudflare edge location.
// Only authenticated XERAVION admins can read wholesale prices.
const CACHE_KEY = new Request("https://xeravion.my.id/__internal/melo-pricelist-cache-v1");

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authorizeXeravionAdmin(request);
    if (!auth.ok) return auth.response;

    const cache = caches.default;
    const cached = await cache.match(CACHE_KEY);
    if (cached) {
      const payload = await cached.json();
      return json({ success: true, source: "cache", fetched_at: payload.fetched_at, data: payload.data });
    }

    const result = await meloRequest(env, "/pricelists");
    if (!result.ok) return json({ error: result.error }, result.status);

    const products = Array.isArray(result.payload.data) ? result.payload.data : [];
    const cachedPayload = {
      fetched_at: new Date().toISOString(),
      data: products
    };
    await cache.put(CACHE_KEY, new Response(JSON.stringify(cachedPayload), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=660" }
    }));

    return json({ success: true, source: "melo", ...cachedPayload });
  } catch (error) {
    return json({ error: "Gagal mengambil katalog Melo H2H.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
