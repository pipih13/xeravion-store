import { authorizeXeravionAdmin, json, dwigitalRequest } from "../../_shared/dwigital.js";

export async function onRequestOptions() { return json({ ok: true }); }

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authorizeXeravionAdmin(request);
    if (!auth.ok) return auth.response;
    const result = await dwigitalRequest(env, "/balance");
    if (!result.ok) return json({ error: result.error }, result.status);
    const data = result.payload.data || {};
    return json({
      success: true,
      environment: data.environment || result.payload.meta?.environment || "development",
      data: {
        balance: data.balance ?? null,
        tier: data.tier ?? null,
        daily_limit: data.daily_limit ?? null,
        spent_today: data.spent_today ?? null
      }
    });
  } catch (error) {
    return json({ error: "Gagal memeriksa koneksi Dwigital.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
