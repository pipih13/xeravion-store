const NIAR_ENDPOINT = "https://api.digitalsoft.id/check-id-game";
const ALLOWED_ORIGINS = new Set(["https://xeravion.my.id", "https://www.xeravion.my.id"]);
const GAME_CODES = Object.freeze({
  "Mobile Legends": { type_name: "mobile_legends", zoneRequired: true },
  "Free Fire": { type_name: "ff", zoneRequired: false },
  "PUBG Mobile": { type_name: "pubgm", zoneRequired: true },
  "Valorant": { type_name: "valorant", zoneRequired: false },
  "Genshin Impact": { type_name: "genshin", zoneRequired: true }
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin"
    }
  });
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return json({ status: false, message: "Origin tidak diizinkan." }, 403);
  if (!env.NIAR_API_KEY) {
    console.error("[niar-check] NIAR_API_KEY secret is missing");
    return json({ status: false, message: "Layanan cek ID belum dikonfigurasi. Silakan hubungi admin." }, 503);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ status: false, message: "Format permintaan tidak valid." }, 415);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ status: false, message: "Permintaan terlalu besar." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ status: false, message: "Data permintaan tidak valid." }, 400);
  }

  const game = typeof body?.game === "string" ? body.game : "";
  const config = GAME_CODES[game];
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const zoneId = typeof body?.zoneId === "string" ? body.zoneId.trim() : "";

  if (!config) return json({ status: false, message: "Game ini belum didukung untuk pengecekan otomatis." }, 400);
  if (!userId || userId.length > 80 || !/^[A-Za-z0-9_#.-]+$/.test(userId)) {
    return json({ status: false, message: "User ID tidak valid. Periksa kembali ID yang dimasukkan." }, 400);
  }
  if (config.zoneRequired && (!zoneId || zoneId.length > 30 || !/^[A-Za-z0-9_-]+$/.test(zoneId))) {
    return json({ status: false, message: "Zone ID / Server ID wajib diisi dengan benar." }, 400);
  }

  const params = new URLSearchParams({
    type_name: config.type_name,
    userId,
    ...(config.zoneRequired ? { zoneId } : {})
  });

  try {
    const upstream = await fetch(`${NIAR_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        "X-API-Key": env.NIAR_API_KEY,
        "Accept": "application/json",
        "Origin": origin,
        "Referer": `${origin}/`
      },
      signal: AbortSignal.timeout(12000)
    });

    let result;
    try {
      result = await upstream.json();
    } catch {
      console.error("[niar-check] Niar returned a non-JSON response", upstream.status);
      return json({ status: false, message: "Server pengecekan sedang bermasalah. Coba beberapa saat lagi." }, 502);
    }

    if (!upstream.ok || result?.status !== true) {
      const status = upstream.status === 429 ? 429 : upstream.status === 401 || upstream.status === 403 ? 502 : 200;
      const message = upstream.status === 429
        ? "Batas pengecekan sedang tercapai. Tunggu sebentar lalu coba lagi."
        : upstream.status === 401 || upstream.status === 403
          ? "Autentikasi atau domain API bermasalah. Silakan hubungi admin XERAVION."
          : (typeof result?.message === "string" && result.message.length < 180
            ? result.message
            : "ID tidak ditemukan atau tidak dapat diverifikasi. Periksa kembali data Anda.");
      return json({ status: false, message }, status);
    }

    // Search common Niar response layouts without exposing the raw upstream payload.
    const nameKeys = ["nickname", "username", "playerName", "player_name", "name"];
    const queue = [{ value: result, depth: 0 }];
    let playerName = "";
    while (queue.length && !playerName) {
      const current = queue.shift();
      if (!current.value || typeof current.value !== "object" || current.depth > 3) continue;
      for (const key of nameKeys) {
        const value = current.value[key];
        if (typeof value === "string" && value.trim()) {
          playerName = value.trim();
          break;
        }
      }
      if (!playerName) {
        for (const [key, value] of Object.entries(current.value)) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            queue.push({ value, depth: current.depth + 1 });
          } else if (Array.isArray(value)) {
            for (const item of value.slice(0, 5)) {
              if (item && typeof item === "object") queue.push({ value: item, depth: current.depth + 1 });
            }
          }
        }
      }
    }

    if (!playerName) {
      console.warn("[niar-check] Niar success response has no recognized nickname field", {
        topLevelKeys: Object.keys(result || {}),
        nestedDataKeys: result?.data && typeof result.data === "object" ? Object.keys(result.data) : []
      });
      return json({
        status: false,
        message: "Niar menyatakan request berhasil, tetapi field nickname tidak ditemukan pada respons. Perlu penyesuaian format respons dari Niar."
      }, 502);
    }

    return json({
      status: true,
      nickname: playerName,
      game: config.type_name,
      message: "ID berhasil diverifikasi."
    });
  } catch (error) {
    console.error("[niar-check] Upstream request failed", error?.name || "Error");
    return json({
      status: false,
      message: error?.name === "TimeoutError"
        ? "Pengecekan terlalu lama. Silakan coba lagi."
        : "Tidak dapat terhubung ke layanan pengecekan. Coba lagi nanti."
    }, 502);
  }
}
