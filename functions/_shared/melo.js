const SUPABASE_URL = "https://holebdvalywkpjvgqffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_um4DOwh3uTZLSfIs2ddmyA_-RRPKbYm";
const MELO_BASE_URL = "https://api.melostore.id/api/v1/h2h";

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "vary": "Authorization",
      "access-control-allow-origin": "https://xeravion.my.id",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, OPTIONS",
      ...extraHeaders
    }
  });
}

export async function authorizeXeravionAdmin(request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return { ok: false, response: json({ error: "Sesi admin tidak ditemukan. Silakan login kembali." }, 401) };

  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token }
  });
  if (!userResponse.ok) return { ok: false, response: json({ error: "Sesi login tidak valid atau sudah berakhir." }, 401) };

  const adminResponse = await fetch(SUPABASE_URL + "/rest/v1/rpc/is_admin", {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + token,
      "content-type": "application/json"
    },
    body: "{}"
  });
  if (!adminResponse.ok || (await adminResponse.json()) !== true) {
    return { ok: false, response: json({ error: "Akses API top-up hanya tersedia untuk admin XERAVION." }, 403) };
  }
  return { ok: true };
}

export async function meloRequest(env, path) {
  if (!env.MELO_API_KEY || !env.MELO_SECRET_KEY) {
    return { ok: false, status: 503, error: "Kredensial Melo Sandbox belum dipasang di Cloudflare Pages Preview secrets." };
  }
  const response = await fetch(MELO_BASE_URL + path, {
    method: "GET",
    headers: {
      "X-API-Key": env.MELO_API_KEY,
      "X-Secret-Key": env.MELO_SECRET_KEY,
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success !== true) {
    return {
      ok: false,
      status: response.status >= 400 ? 502 : 502,
      error: payload?.message || "Melo H2H menolak permintaan atau mengembalikan respons yang tidak valid."
    };
  }
  return { ok: true, payload };
}
