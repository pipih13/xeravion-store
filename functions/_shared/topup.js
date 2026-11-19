/**
 * XERAVION multi-game top-up foundation.
 * This file is configuration only: it does not verify accounts or place orders.
 * Keep each game's identifier fields and regional policy explicit.
 */
export const TOPUP_GAMES = Object.freeze([
  {
    id: "mobile-legends",
    name: "Mobile Legends: Bang Bang",
    shortName: "MLBB",
    status: "pilot_pending_verification",
    enabledForOrders: false,
    regionPolicy: {
      mode: "allowlist",
      allowed: ["ID"],
      rejectUnsupported: true,
      requireVerifiedRegion: true
    },
    targetFields: [
      { id: "user_id", label: "User ID", required: true },
      { id: "zone_id", label: "Zone ID", required: true }
    ],
    verification: {
      required: true,
      provider: null,
      returnsRegion: false,
      failClosed: true
    },
    note: "Pilot Indonesia saja. Belum menerima pesanan sampai verifikasi ID dan wilayah teruji."
  },
  {
    id: "pubg-mobile",
    name: "PUBG Mobile",
    shortName: "PUBG",
    status: "planned",
    enabledForOrders: false,
    regionPolicy: {
      mode: "verify_before_enable",
      allowed: [],
      rejectUnsupported: true,
      requireVerifiedRegion: true
    },
    targetFields: [
      { id: "player_id", label: "Character ID", required: true }
    ],
    verification: {
      required: true,
      provider: null,
      returnsRegion: false,
      failClosed: true
    },
    note: "Akan diaktifkan setelah metode verifikasi akun dan region terkonfirmasi."
  },
  {
    id: "free-fire",
    name: "Free Fire",
    shortName: "Free Fire",
    status: "planned",
    enabledForOrders: false,
    regionPolicy: {
      mode: "verify_before_enable",
      allowed: [],
      rejectUnsupported: true,
      requireVerifiedRegion: true
    },
    targetFields: [
      { id: "player_id", label: "Player ID", required: true }
    ],
    verification: {
      required: true,
      provider: null,
      returnsRegion: false,
      failClosed: true
    },
    note: "Akan diaktifkan setelah metode verifikasi akun dan region terkonfirmasi."
  },
  {
    id: "genshin-impact",
    name: "Genshin Impact",
    shortName: "Genshin",
    status: "planned",
    enabledForOrders: false,
    regionPolicy: {
      mode: "verify_before_enable",
      allowed: [],
      rejectUnsupported: true,
      requireVerifiedRegion: true
    },
    targetFields: [
      { id: "uid", label: "UID", required: true },
      { id: "server", label: "Server", required: true }
    ],
    verification: {
      required: true,
      provider: null,
      returnsRegion: false,
      failClosed: true
    },
    note: "Direncanakan untuk tahap lanjutan."
  },
  {
    id: "honor-of-kings",
    name: "Honor of Kings",
    shortName: "HOK",
    status: "planned",
    enabledForOrders: false,
    regionPolicy: {
      mode: "verify_before_enable",
      allowed: [],
      rejectUnsupported: true,
      requireVerifiedRegion: true
    },
    targetFields: [
      { id: "player_id", label: "Player ID", required: true },
      { id: "server", label: "Server / Region", required: true }
    ],
    verification: {
      required: true,
      provider: null,
      returnsRegion: false,
      failClosed: true
    },
    note: "Direncanakan untuk tahap lanjutan."
  },
  {
    id: "efootball",
    name: "eFootball",
    shortName: "eFootball",
    status: "planned",
    enabledForOrders: false,
    regionPolicy: {
      mode: "verify_before_enable",
      allowed: [],
      rejectUnsupported: true,
      requireVerifiedRegion: true
    },
    targetFields: [
      { id: "player_id", label: "User ID", required: true }
    ],
    verification: {
      required: true,
      provider: null,
      returnsRegion: false,
      failClosed: true
    },
    note: "Direncanakan untuk tahap lanjutan."
  }
]);

export const TOPUP_VERIFICATION_STATES = Object.freeze([
  "verified_supported",
  "verified_unsupported_region",
  "not_found",
  "unknown"
]);

/**
 * A fail-closed decision helper for future verification adapters.
 * A nickname response alone must never be treated as proof of region.
 */
export function evaluateTopupVerification(result, game) {
  if (!result || result.status !== "verified" || !result.region) {
    return { allowed: false, state: result?.status === "not_found" ? "not_found" : "unknown" };
  }
  const allowed = game?.regionPolicy?.allowed || [];
  if (!allowed.includes(String(result.region).toUpperCase())) {
    return { allowed: false, state: "verified_unsupported_region" };
  }
  return { allowed: true, state: "verified_supported" };
}
