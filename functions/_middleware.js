// Aggregate HTML page visits into D1 without storing IP addresses or raw User-Agent strings.
const BOT_UA = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|twitterbot|linkedinbot|pinterest|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|chatgpt-user|claudebot|anthropic-ai|google-extended|applebot|yandex|baiduspider|duckduckbot|uptimerobot|headlesschrome|phantomjs|selenium|puppeteer|playwright|curl\/|wget\/|python-requests|httpclient|go-http-client|java\/|okhttp|libwww-perl/i;

function classifyTraffic(request) {
  const ua = request.headers.get("User-Agent") || "";
  if (!ua.trim()) return "unclassified";
  return BOT_UA.test(ua) ? "bot" : "human";
}

export async function onRequest(context) {
  const response = await context.next();
  const { request, env } = context;

  // Analytics are best-effort: never block or alter the storefront response.
  if (!env.ANALYTICS_DB || request.method !== "GET" || response.status !== 200) return response;

  const url = new URL(request.url);

  // Do not count visits to the private admin portal as storefront traffic.
  // XERAVION admin is served from the root URL with the ?admin-portal query flag.
  const isAdminPortal =
    url.searchParams.has("admin-portal") ||
    url.pathname === "/admin" ||
    url.pathname.startsWith("/admin/");
  if (isAdminPortal) return response;
  if (url.pathname.startsWith("/api/") || /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return response;
  if (!(request.headers.get("Accept") || "").includes("text/html")) return response;
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return response;

  const day = new Date().toISOString().slice(0, 10);
  const country = String(request.cf?.country || "XX").slice(0, 2).toUpperCase();
  const trafficClass = classifyTraffic(request);

  try {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO traffic_daily (day, country, traffic_class, page_views)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(day, country, traffic_class)
       DO UPDATE SET page_views = page_views + 1`
    ).bind(day, country, trafficClass).run();
  } catch (error) {
    console.error("[xeravion-analytics] D1 write failed", error?.message || String(error));
  }

  return response;
}
