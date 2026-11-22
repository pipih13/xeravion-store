import { json } from "../../_shared/melo.js";

const BASE = "https://dwigital.id/api/v1";

export async function onRequestGet({ env }) {
  try {
    // Safety lock: public buyer-facing preparation endpoints may only use
    // the Development key. A Production secret must never be selected
    // automatically just because it exists in the Cloudflare environment.
    const testKey = String(env.DWIGITAL_API_KEY || "");
    const key = testKey.startsWith("dwg_test_") ? testKey : "";
    if (!key) return json({ success: false, error: "API Key Dwigital Development (dwg_test_) belum tersedia. Endpoint persiapan ini tidak menerima API Production." }, 503);
    const expected = "development";
    const response = await fetch(BASE + "/products?type=game&q=mobile%20legends&page=1&per_page=1000", {
      headers: { "Authorization": "Bearer " + key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
      const code = String(payload?.code || "");
      const message = code === "ip_not_allowed"
        ? "Dwigital menolak IP server. Endpoint persiapan hanya menggunakan Development; jangan pasang key Production untuk melewati pemeriksaan ini."
        : String(payload?.message || "Katalog Dwigital gagal dimuat.");
      return json({ success: false, error: message, code }, 502);
    }
    const actual = String(payload.data?.environment || payload.meta?.environment || "").toLowerCase();
    if (actual && !["development", "sandbox"].includes(actual)) {
      return json({ success: false, error: "Environment API bukan Development/Sandbox. Respons dihentikan demi keamanan." }, 502);
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
