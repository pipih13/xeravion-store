import { authorizeXeravionAdmin, json, meloRequest } from "../../_shared/melo.js";

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authorizeXeravionAdmin(request);
    if (!auth.ok) return auth.response;

    const result = await meloRequest(env, "/profile");
    if (!result.ok) return json({ error: result.error }, result.status);

    const data = result.payload.data || {};
    const tier = data.tier && typeof data.tier === "object" ? data.tier : {};
    return json({
      success: true,
      data: {
        name: data.name || null,
        tier: tier.name || null,
        tier_code: tier.code || null,
        rate_limit: tier.rate_limit ?? null,
        max_ips: tier.max_ips ?? null,
        h2h_balance: data.h2h_balance ?? null,
        is_sandbox_mode: data.is_sandbox_mode ?? null,
        webhook_configured: Boolean(data.webhook_url)
      }
    });
  } catch (error) {
    return json({ error: "Gagal memeriksa profil API Melo H2H.", detail: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
}
