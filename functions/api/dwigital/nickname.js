import { authorizeXeravionAdmin, json } from "../../_shared/melo.js";

/**
 * Safe supplier test only.
 * Dwigital Development keys simulate nickname responses and do not verify region.
 * This endpoint is admin-only and never creates an order.
 */
export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await authorizeXeravionAdmin(request);
    if (!auth.ok) return auth.response;

    const key = String(env.DWIGITAL_API_KEY || "");
    if (!key.startsWith("dwg_test_")) {
      return json({
        error: "Pengecekan hanya diizinkan dengan API Key Dwigital Development (dwg_test_).",
        code: "development_key_required"
      }, 503);
    }

    const body = await request.json().catch(() => null);
    const variantId = Number(body?.variant_id);
    const target = String(body?.target || "").trim();
    const targetZone = String(body?.target_zone || "").trim();

    if (!Number.isSafeInteger(variantId) || variantId <= 0) {
      return json({ error: "variant_id wajib berupa angka paket yang valid.", code: "invalid_variant_id" }, 400);
    }
    if (!/^[A-Za-z0-9#._-]{2,64}$/.test(target)) {
      return json({ error: "User ID tidak valid. Gunakan 1–64 huruf, angka, #, titik, garis bawah, atau strip.", code: "invalid_target" }, 400);
    }
    if (targetZone && !/^[A-Za-z0-9._-]{1,32}$/.test(targetZone)) {
      return json({ error: "Zone ID tidak valid.", code: "invalid_target_zone" }, 400);
    }

    // Confirm the selected variant is an actual MLBB game package with nickname support.
    const detailResponse = await fetch("https://dwigital.id/api/v1/products/" + variantId, {
      headers: { "Authorization": "Bearer " + key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const detailPayload = await detailResponse.json().catch(() => null);
    const product = detailPayload?.data;
    if (!detailResponse.ok || detailPayload?.success !== true || !product) {
      return json({ error: "Paket tidak ditemukan pada katalog Dwigital Development.", code: "variant_unavailable" }, 400);
    }
    const productName = String(product.product || product.name || "").toLowerCase();
    if (product.type !== "game" || !productName.includes("mobile legends") || product.nickname_check !== true || product.zone_required !== true) {
      return json({ error: "Pilih paket Mobile Legends yang mendukung cek nickname dan membutuhkan Zone ID.", code: "unsupported_variant" }, 400);
    }
    const productEnvironment = String(product.environment || detailPayload.meta?.environment || "").toLowerCase();
    if (!["development", "sandbox"].includes(productEnvironment)) {
      return json({ error: "Detail paket bukan dari Development/Sandbox. Permintaan dihentikan.", code: "unsafe_environment" }, 502);
    }

    const upstream = await fetch("https://dwigital.id/api/v1/nickname", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        variant_id: variantId,
        target,
        ...(targetZone ? { target_zone: targetZone } : {})
      }),
      signal: AbortSignal.timeout(15000)
    });

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload?.success !== true || !payload?.data) {
      const code = String(payload?.code || "nickname_check_failed");
      const messages = {
        account_not_found: "Akun tidak ditemukan. Periksa kembali User ID dan Zone ID.",
        invalid_target: "User ID atau Zone ID tidak valid.",
        nickname_unsupported: "Paket ini belum mendukung pengecekan nickname.",
        provider_unavailable: "Layanan pengecekan nickname sedang terganggu.",
        rate_limited: "Batas pengecekan tercapai. Coba lagi nanti."
      };
      return json({
        success: false,
        code,
        error: messages[code] || String(payload?.message || "Dwigital Development tidak dapat memeriksa akun saat ini.")
      }, [422, 429, 503].includes(upstream.status) ? upstream.status : 502);
    }

    const environment = String(payload.data.environment || "").toLowerCase();
    if (!["development", "sandbox"].includes(environment)) {
      return json({
        error: "Respons supplier bukan dari Development/Sandbox. Hasil ditolak.",
        code: "unsafe_environment"
      }, 502);
    }

    return json({
      success: true,
      mode: "development_simulation",
      account_found: true,
      nickname: String(payload.data.nickname || ""),
      target,
      target_zone: targetZone || null,
      region: null,
      region_status: "unknown",
      order_enabled: false,
      message: "Nickname diterima dari simulasi Development. Ini bukan bukti negara/region akun dan bukan verifikasi akun live."
    });
  } catch (error) {
    return json({
      error: "Pengecekan nickname Dwigital gagal.",
      detail: error instanceof Error ? error.message : "Unknown error"
    }, 502);
  }
}
