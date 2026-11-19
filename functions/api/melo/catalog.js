import { authorizeXeravionAdmin, json, meloRequest } from "../../_shared/melo.js";

// Melo catalogue reads are cached to avoid exhausting the supplier profile's request allowance.
const CACHE_KEYS = {
  regular: new Request("https://xeravion.my.id/__internal/melo-pricelist-cache-v2"),
  smart: new Request("https://xeravion.my.id/__internal/melo-smart-pricelist-cache-v1")
};

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authorizeXeravionAdmin(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const type = url.searchParams.get("type") === "smart" ? "smart" : "regular";
    const cache = caches.default;
    const cached = await cache.match(CACHE_KEYS[type]);
    if (cached) {
      const payload = await cached.json();
      return json({ success: true, source: "cache", catalog_type: type, fetched_at: payload.fetched_at, data: payload.data });
    }

    const endpoint = type === "smart" ? "/smart-pricelists" : "/pricelists";
    const result = await meloRequest(env, endpoint);
    if (!result.ok) return json({ error: result.error }, result.status);

    const products = Array.isArray(result.payload.data) ? result.payload.data : [];
    const cachedPayload = { fetched_at: new Date().toISOString(), data: products };
    await cache.put(CACHE_KEYS[type], new Response(JSON.stringify(cachedPayload), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=660" }
    }));

    return json({ success: true, source: "melo", catalog_type: type, ...cachedPayload });
  } catch (error) {
    return json({ error: "Gagal mengambil katalog Melo H2H.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
