import { TOPUP_GAMES, TOPUP_VERIFICATION_STATES } from "../../_shared/topup.js";

/**
 * Public, read-only capability manifest for the top-up storefront.
 * No supplier credentials, prices, account checks, or order actions are exposed.
 */
export async function onRequestGet() {
  return new Response(JSON.stringify({
    success: true,
    service: "XERAVION Game Top-Up",
    mode: "preparation",
    orders_enabled: false,
    supplier_orders_enabled: false,
    supported_regions: ["ID"],
    region_policy: {
      mode: "indonesia_only",
      allowed_country_codes: ["ID"],
      reject_non_indonesia: true,
      reject_unknown_region: true,
      require_explicit_supplier_region: true
    },
    games: TOPUP_GAMES,
    verification_states: TOPUP_VERIFICATION_STATES,
    safety: {
      requireVerifiedAccount: true,
      requireVerifiedRegion: true,
      rejectUnknownRegion: true,
      allowRegionGuessing: false,
      nicknameIsRegionProof: false
    }
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "https://xeravion.my.id"
    }
  });
}
