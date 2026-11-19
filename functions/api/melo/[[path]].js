// Cloudflare Pages Function: secure Melo H2H API proxy for XERAVION admins.
// Required Pages secrets: MELO_API_KEY and MELO_SECRET_KEY.
// Melo credentials are never sent to the browser.
const SUPABASE_URL = "https://holebdvalywkpjvgqffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_um4DOwh3uTZLSfIs2ddmyA_-RRPKbYm";
const MELO_BASE = "https://api.melostore.id/api/v1/h2h";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "vary": "Authorization"
    }
  });
}

async function requireAdmin(request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return { response: json({ error: "Sesi admin tidak ditemukan. Silakan login ulang." }, 401) };

  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token }
  });
  if (!userResponse.ok) return { response: json({ error: "Sesi login tidak valid atau sudah berakhir." }, 401) };

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
    return { response: json({ error: "Akses integrasi Melo hanya tersedia untuk admin XERAVION." }, 403) };
  }
  return { ok: true };
}

function allowedEndpoint(path) {
  if (["profile", "profile/balance", "pricelists/categories", "smart-pricelists/categories", "smart-pricelists"].includes(path)) return true;
  return /^(pricelists|smart-pricelists)\/[a-z0-9][a-z0-9-]{0,100}$/.test(path);
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request).catch(error => ({ response: json({ error: error?.message || "Pemeriksaan admin gagal." }, 500) }));
  if (!auth.ok) return auth.response;

  if (!env.MELO_API_KEY || !env.MELO_SECRET_KEY) {
    return json({
      setupRequired: true,
      error: "Kredensial Melo belum tersedia di Cloudflare Pages. Pastikan MELO_API_KEY dan MELO_SECRET_KEY sudah disimpan sebagai Secret."
    }, 503);
  }

  const incoming = new URL(request.url);
  const path = incoming.pathname.replace(/^\/api\/melo\/?/, "").replace(/\/$/, "");
  if (!allowedEndpoint(path)) return json({ error: "Endpoint Melo tidak diizinkan oleh proxy XERAVION." }, 404);

  const target = new URL(MELO_BASE + "/" + path);
  for (const key of ["limit", "cursor", "server", "search", "brand_id"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null && value.length <= 500) target.searchParams.set(key, value);
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": env.MELO_API_KEY,
        "X-Secret-Key": env.MELO_SECRET_KEY
      }
    });
    const body = await upstream.text();
    let payload;
    try { payload = JSON.parse(body); }
    catch { payload = { error: "Respons Melo bukan JSON yang valid." }; }
    return json({
      ...payload,
      _proxy: {
        provider: "Melo H2H",
        endpoint: "/" + path,
        httpStatus: upstream.status
      }
    }, upstream.status);
  } catch (error) {
    return json({ error: "Tidak dapat menghubungi server Melo H2H.", detail: error?.message || String(error) }, 502);
  }
}
