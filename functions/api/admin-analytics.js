// Cloudflare Pages Function: authenticated XERAVION admin traffic analytics.
// Required Cloudflare Pages bindings:
//   CF_ZONE_ID (plain variable)
//   CF_ANALYTICS_API_TOKEN (encrypted secret; Zone Analytics:Read)
// Admin authorization is verified against the existing Supabase is_admin() RPC.
const SUPABASE_URL = "https://holebdvalywkpjvgqffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_um4DOwh3uTZLSfIs2ddmyA_-RRPKbYm";

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

export async function onRequestGet({ request, env }) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ error: "Sesi admin tidak ditemukan. Silakan login ulang." }, 401);

  try {
    const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token }
    });
    if (!userResponse.ok) return json({ error: "Sesi login tidak valid atau sudah berakhir." }, 401);

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
      return json({ error: "Akses analytics hanya tersedia untuk admin XERAVION." }, 403);
    }

    if (!env.CF_ZONE_ID || !env.CF_ANALYTICS_API_TOKEN) {
      return json({
        setupRequired: true,
        error: "Analytics Cloudflare belum dikonfigurasi. Tambahkan CF_ZONE_ID dan CF_ANALYTICS_API_TOKEN di Cloudflare Pages."
      }, 503);
    }

    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get("days") || 7);
    const days = requestedDays === 30 ? 30 : 7;
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const iso = d => d.toISOString().slice(0, 10);
    const startDate = iso(start);
    const endDate = iso(end);

    const query = `query XERAVIONTraffic($zoneTag: string, $dateStart: Date, $dateEnd: Date, $timeStart: Time, $timeEnd: Time) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          total: httpRequests1dGroups(
            limit: 1
            filter: { date_geq: $dateStart, date_leq: $dateEnd }
          ) {
            sum { requests pageViews }
            uniq { uniques }
          }
          daily: httpRequests1dGroups(
            limit: 40
            filter: { date_geq: $dateStart, date_leq: $dateEnd }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests pageViews }
            uniq { uniques }
          }
          countries: httpRequestsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $timeStart, datetime_lt: $timeEnd, requestSource: "eyeball" }
            orderBy: [count_DESC]
          ) {
            dimensions { clientCountryName }
            count
            sum { requests visits }
          }
        }
      }
    }`;
    const nextDay = new Date(end);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const variables = {
      zoneTag: env.CF_ZONE_ID,
      dateStart: startDate,
      dateEnd: endDate,
      timeStart: start.toISOString(),
      timeEnd: nextDay.toISOString()
    };
    const cfResponse = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.CF_ANALYTICS_API_TOKEN,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const responseText = await cfResponse.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return json({
        error: "Cloudflare Analytics mengembalikan respons non-JSON.",
        detail: "HTTP " + cfResponse.status + ". Periksa Cloudflare GraphQL API dan izin token Zone Analytics:Read.",
        upstreamStatus: cfResponse.status
      }, 502);
    }
    if (!cfResponse.ok || payload.errors?.length) {
      return json({
        error: "Cloudflare Analytics gagal mengambil data.",
        detail: payload.errors?.[0]?.message || "HTTP " + cfResponse.status + ". Periksa token dan Zone ID."
      }, 502);
    }

    const zone = payload.data?.viewer?.zones?.[0];
    if (!zone) return json({ error: "Zone XERAVION tidak ditemukan. Periksa CF_ZONE_ID." }, 502);
    const daily = (zone.daily || []).map(row => ({
      date: row.dimensions?.date,
      requests: Number(row.sum?.requests || 0),
      pageViews: Number(row.sum?.pageViews || 0),
      uniqueVisitors: Number(row.uniq?.uniques || 0)
    }));
    const countries = (zone.countries || []).map(row => ({
      country: row.dimensions?.clientCountryName || "Unknown",
      requests: Number(row.sum?.requests || 0),
      pageViews: 0,
      visits: Number(row.sum?.visits || 0),
      requests: Number(row.count || 0)
    })).sort((a, b) => b.uniqueVisitors - a.uniqueVisitors);
    return json({
      periodDays: days,
      startDate,
      endDate,
      totals: {
        requests: Number(zone.total?.[0]?.sum?.requests || 0),
        pageViews: Number(zone.total?.[0]?.sum?.pageViews || 0),
        uniqueVisitors: Number(zone.total?.[0]?.uniq?.uniques || 0)
      },
      daily,
      countries
    });
  } catch (error) {
    return json({ error: "Terjadi kesalahan saat memuat analytics.", detail: error?.message || String(error) }, 500);
  }
}
