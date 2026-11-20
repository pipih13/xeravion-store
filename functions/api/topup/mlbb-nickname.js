import { json } from "../../_shared/melo.js";

const BASE = "https://dwigital.id/api/v1";

export async function onRequestOptions() {
  return json({ ok: true }, 200, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" });
}

export async function onRequestPost({ request, env }) {
  try {
    const key = String(env.DWIGITAL_API_KEY || "");
    if (!key.startsWith("dwg_test_")) {
      return json({ success: false, error: "Pengecekan buyer saat ini hanya dibuka pada mode Development. API Production belum diaktifkan." }, 503);
    }
    const body = await request.json().catch(() => null);
    const variantId = Number(body?.variant_id);
    const target = String(body?.target || "").trim();
    const targetZone = String(body?.target_zone || "").trim();
    if (!Number.isSafeInteger(variantId) || variantId <= 0) return json({ success: false, error: "Paket verifikasi tidak valid." }, 400);
    if (!/^[A-Za-z0-9#._-]{2,64}$/.test(target)) return json({ success: false, error: "User ID tidak valid." }, 400);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(targetZone)) return json({ success: false, error: "Zone ID wajib diisi dan formatnya tidak valid." }, 400);

    const headers = { "Authorization": "Bearer " + key, "Accept": "application/json" };
    const detailResponse = await fetch(BASE + "/products/" + variantId, { headers, signal: AbortSignal.timeout(12000) });
    const detail = await detailResponse.json().catch(() => null);
    const product = detail?.data;
    if (!detailResponse.ok || detail?.success !== true || !product) return json({ success: false, error: "Paket verifikasi tidak ditemukan." }, 400);
    const productName = String(product.product || product.name || "").toLowerCase();
    if (product.type !== "game" || !productName.includes("mobile legends") || product.nickname_check !== true || product.zone_required !== true) {
      return json({ success: false, error: "Paket ini tidak memenuhi aturan cek nickname Dwigital untuk MLBB." }, 400);
    }
    const fields = Array.isArray(product.fields) ? product.fields : [];
    for (const [value, field, label] of [
      [target, fields.find(f => f?.name === "target"), "User ID"],
      [targetZone, fields.find(f => f?.name === "target_zone"), "Zone ID"]
    ]) {
      if (field?.pattern && !(new RegExp(field.pattern).test(value))) return json({ success: false, error: label + " tidak sesuai format paket Dwigital." }, 400);
    }
    const detailEnv = String(product.environment || detail.meta?.environment || "").toLowerCase();
    if (detailEnv && !["development", "sandbox"].includes(detailEnv)) return json({ success: false, error: "Respons paket bukan Development/Sandbox." }, 502);

    const upstream = await fetch(BASE + "/nickname", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ variant_id: variantId, target, target_zone: targetZone }),
      signal: AbortSignal.timeout(15000)
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload?.success !== true || !payload?.data) {
      const codes = {
        account_not_found: "Akun tidak ditemukan. Periksa User ID dan Zone ID.",
        invalid_target: "User ID atau Zone ID tidak valid.",
        nickname_unsupported: "Paket ini tidak mendukung cek nickname.",
        provider_unavailable: "Layanan game sedang sibuk. Coba lagi beberapa saat.",
        rate_limited: "Terlalu banyak pengecekan. Tunggu sebentar lalu coba lagi."
      };
      const code = String(payload?.code || "nickname_check_failed");
      return json({ success: false, code, error: codes[code] || String(payload?.message || "Pengecekan nickname gagal.") }, [422,429,503].includes(upstream.status) ? upstream.status : 502);
    }
    const responseEnv = String(payload.data.environment || "").toLowerCase();
    if (!["development", "sandbox"].includes(responseEnv)) return json({ success: false, error: "Respons nickname bukan dari Development/Sandbox." }, 502);
    return json({
      success: true,
      environment: "development_simulation",
      nickname: String(payload.data.nickname || ""),
      target,
      target_zone: targetZone,
      account_found: true,
      orders_enabled: false,
      payment_enabled: false,
      message: "Nickname dari simulasi Development Dwigital. Belum bisa digunakan untuk transaksi sungguhan."
    });
  } catch (error) {
    return json({ success: false, error: "Pengecekan nickname gagal.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
