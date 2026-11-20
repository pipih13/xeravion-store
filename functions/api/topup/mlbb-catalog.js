import { json } from "../../_shared/melo.js";

const BASE = "https://dwigital.id/api/v1";

export async function onRequestGet({ env }) {
  try {
    const liveKey = String(env.DWIGITAL_PRODUCTION_API_KEY || "");
    const testKey = String(env.DWIGITAL_API_KEY || "");
    const key = liveKey.startsWith("dwg_live_") ? liveKey : testKey.startsWith("dwg_test_") ? testKey : "";
    if (!key) return json({ success: false, error: "API key Dwigital belum tersedia. Atur secret Development atau Production di Cloudflare." }, 503);
    const expected = key.startsWith("dwg_live_") ? "production" : "development";
    const response = await fetch(BASE + "/products?type=game&q=mobile%20legends&page=1&per_page=1000", {
      headers: { "Authorization": "Bearer " + key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
      const code = String(payload?.code || "");
      const message = code === "ip_not_allowed"
        ? "Dwigital menolak IP server Cloudflare. IP egress perlu didaftarkan/solusi IP tetap perlu disiapkan."
        : String(payload?.message || "Katalog Dwigital gagal dimuat.");
      return json({ success: false, error: message, code }, 502);
    }
    const actual = String(payload.data?.environment || payload.meta?.environment || "").toLowerCase();
    if (actual && (expected === "production" ? actual !== "production" : !["development", "sandbox"].includes(actual))) {
      return json({ success: false, error: "Environment API tidak sesuai dengan key yang dipilih." }, 502);
    }
    const rows = payload.data;
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
      environment: expected,
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
