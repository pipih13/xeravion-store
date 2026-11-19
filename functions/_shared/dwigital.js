import { authorizeXeravionAdmin, json } from "./melo.js";

const DWIGITAL_BASE_URL = "https://dwigital.id/api/v1";

export async function dwigitalRequest(env, path) {
  const key = env.DWIGITAL_API_KEY;
  if (!key || !String(key).startsWith("dwg_test_")) {
    return { ok: false, status: 503, error: "API Key Dwigital Development belum dipasang. Gunakan key dwg_test_ saja; key Production ditolak pada tahap pengujian." };
  }
  const response = await fetch(DWIGITAL_BASE_URL + path, {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + key,
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success !== true) {
    return { ok: false, status: 502, error: payload?.message || payload?.error || "Dwigital menolak permintaan atau mengembalikan respons tidak valid." };
  }
  const environment = payload?.data?.environment || payload?.meta?.environment;
  if (environment && environment !== "development") {
    return { ok: false, status: 502, error: "Mode API bukan Development. Respons dihentikan demi keamanan." };
  }
  return { ok: true, payload };
}

export { authorizeXeravionAdmin, json };
