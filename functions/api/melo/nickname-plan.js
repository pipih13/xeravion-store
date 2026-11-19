import { json } from "../../_shared/melo.js";

/**
 * Public Melo account-check plan. Read-only and does not consume nickname quota.
 * Exposes current published free/paid limits; never performs a check.
 */
export async function onRequestGet() {
  try {
    const response = await fetch("https://api.melostore.id/api/v1/h2h/check-nickname/plan", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || !payload?.data) {
      return json({ success: false, error: "Paket pemeriksaan akun Melo belum dapat dibaca." }, 502);
    }
    const data = payload.data;
    return json({
      success: true,
      source: "melo_public_plan",
      data: {
        free_daily_limit: Number.isFinite(Number(data.free_daily_limit)) ? Number(data.free_daily_limit) : null,
        free_minute_limit: Number.isFinite(Number(data.free_minute_limit)) ? Number(data.free_minute_limit) : null,
        paid_price_mc: Number.isFinite(Number(data.paid_price_mc)) ? Number(data.paid_price_mc) : null,
        paid_minute_limit: Number.isFinite(Number(data.paid_minute_limit)) ? Number(data.paid_minute_limit) : null,
        resets_at: typeof data.resets_at === "string" ? data.resets_at : null
      },
      note: "Informasi paket publik. Pemeriksaan akun tetap mengikuti mode dan billing akun Melo XERAVION."
    });
  } catch {
    return json({ success: false, error: "Gagal membaca paket pemeriksaan akun Melo." }, 502);
  }
}
