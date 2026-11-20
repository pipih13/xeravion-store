import { dwigitalRequest, json } from "../../_shared/dwigital.js";

export async function onRequestGet({ env }) {
  try {
    const result = await dwigitalRequest(env, "/products?type=game&q=mobile%20legends&page=1&per_page=1000");
    if (!result.ok) return json({ success: false, error: result.error }, result.status);
    const rows = Array.isArray(result.payload.data) ? result.payload.data : [];
    const products = rows
      .filter(p => p.type === "game" && String(p.product || p.name || "").toLowerCase().includes("mobile legends"))
      .map(p => ({
        variant_id: Number(p.variant_id),
        product: p.product || p.name || "Mobile Legends",
        name: p.name || p.product || "Paket MLBB",
        price: Number(p.price),
        nickname_check: p.nickname_check === true,
        zone_required: p.zone_required === true,
        zone_label: p.zone_label || "Zone ID",
        target_label: p.target_label || "User ID",
        fields: Array.isArray(p.fields) ? p.fields : [],
        delivery: p.delivery || null,
        stock: p.stock ?? null
      }))
      .filter(p => Number.isSafeInteger(p.variant_id) && p.variant_id > 0 && Number.isFinite(p.price) && p.price > 0);
    return json({
      success: true,
      environment: "development",
      game: "mobile-legends",
      products,
      nickname_variant_id: products.find(p => p.nickname_check && p.zone_required)?.variant_id || null,
      orders_enabled: false,
      payment_enabled: false
    }, 200, { "cache-control": "public, max-age=180" });
  } catch (error) {
    return json({ success: false, error: "Katalog top-up MLBB belum dapat dimuat.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
