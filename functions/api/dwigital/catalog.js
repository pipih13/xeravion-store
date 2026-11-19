import { authorizeXeravionAdmin, json, dwigitalRequest } from "../../_shared/dwigital.js";

export async function onRequestOptions() { return json({ ok: true }); }

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authorizeXeravionAdmin(request);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "mobile legends").slice(0, 80);
    const page = Math.max(1, Math.min(20, Number(url.searchParams.get("page") || 1)));
    const perPage = Math.max(1, Math.min(200, Number(url.searchParams.get("per_page") || 100)));
    const query = new URLSearchParams({ type: "game", q, page: String(page), per_page: String(perPage) });
    const cacheKey = new Request("https://xeravion.my.id/__internal/dwigital-catalog-" + encodeURIComponent(q.toLowerCase()) + "-" + page + "-" + perPage);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      return json({ ...data, source: "cache" });
    }
    const result = await dwigitalRequest(env, "/products?" + query.toString());
    if (!result.ok) return json({ error: result.error }, result.status);
    const payload = result.payload;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const safeRows = rows.map(p => ({
      variant_id: p.variant_id,
      product_id: p.product_id,
      type: p.type,
      product: p.product,
      name: p.name,
      price: p.price,
      price_unit: p.price_unit || "per_order",
      target_label: p.target_label,
      zone_required: p.zone_required === true,
      zone_label: p.zone_label || null,
      nickname_check: p.nickname_check === true,
      delivery: p.delivery || null,
      stock: p.stock ?? null
    }));
    const output = {
      success: true,
      environment: payload.meta?.environment || "development",
      page: payload.meta?.page || page,
      last_page: payload.meta?.last_page || 1,
      total: payload.meta?.total ?? safeRows.length,
      per_page: payload.meta?.per_page || perPage,
      data: safeRows
    };
    await cache.put(cacheKey, new Response(JSON.stringify(output), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=300" }
    }));
    return json({ ...output, source: "dwigital" });
  } catch (error) {
    return json({ error: "Gagal mengambil katalog Dwigital.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
