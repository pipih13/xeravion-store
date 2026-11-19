import { json } from "../../_shared/melo.js";

/** Public supported-game and zone metadata. Read-only; no account lookup occurs. */
export async function onRequestGet() {
  try {
    const response = await fetch("https://api.melostore.id/api/v1/h2h/check-nickname/games", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.games)) {
      return json({ success: false, error: "Daftar game pemeriksaan Melo belum tersedia." }, 502);
    }
    return json({
      success: true,
      source: "melo_public_game_list",
      games: payload.games.map(game => ({
        game_code: typeof game.game_code === "string" ? game.game_code : null,
        name: typeof game.name === "string" ? game.name : null,
        type: typeof game.type === "string" ? game.type : null,
        zone_required: game.zone_required === true,
        zone_values: game.zone_values ?? null,
        params: Array.isArray(game.params) ? game.params.filter(p => p && typeof p.name === "string").map(p => ({ name: p.name })) : [],
        status: typeof game.status === "string" ? game.status : null
      }))
    });
  } catch {
    return json({ success: false, error: "Gagal membaca daftar game pemeriksaan Melo." }, 502);
  }
}
