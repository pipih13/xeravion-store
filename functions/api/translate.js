// Cloudflare Pages Function: same-origin translation service for XERAVION.
const ALLOWED_LANGUAGES = new Set(["en","ms","ar","es","pt","fr","de","ja","ko","zh-CN","th","vi","tl"]);
const memoryCache = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function normalize(value, source, target) {
  const output = String(value || "").trim() || source;
  return target === "en" ? output.replace(/\\bfamous\\b/gi, "renowned") : output;
}

async function translateOne(source, target) {
  const key = target + "|" + source;
  if (memoryCache.has(key)) return memoryCache.get(key);

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "id");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", source);

  let translated = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: { "accept": "application/json" },
        cf: { cacheTtl: 3600, cacheEverything: true }
      });
      if (!response.ok) throw new Error("Google translation HTTP " + response.status);
      const payload = await response.json();
      translated = (payload[0] || []).map(part => part && part[0] || "").join("").trim();
      if (!translated) throw new Error("Empty Google translation");
      break;
    } catch (error) {
      console.warn("XERAVION primary translation attempt failed:", error);
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  // Secondary provider for short strings if Google's unofficial endpoint is unavailable.
  if (!translated && new TextEncoder().encode(source).length <= 450) {
    try {
      const fallback = new URL("https://api.mymemory.translated.net/get");
      fallback.searchParams.set("q", source);
      fallback.searchParams.set("langpair", "id|" + target);
      const response = await fetch(fallback.toString(), { headers: { "accept": "application/json" } });
      if (response.ok) {
        const data = await response.json();
        const candidate = data?.responseData?.translatedText;
        if (typeof candidate === "string" && candidate.trim() &&
            Number(data?.responseStatus || 200) === 200) translated = candidate.trim();
      }
    } catch (error) {
      console.warn("XERAVION fallback translation failed:", error);
    }
  }

  const result = translated ? normalize(translated, source, target) : null;
  if (result) {
    memoryCache.set(key, result);
    if (memoryCache.size > 1500) memoryCache.delete(memoryCache.keys().next().value);
  }
  return result;
}

export async function onRequestGet() {
  return json({ service: "xeravion-translation", status: "ready", languages: [...ALLOWED_LANGUAGES] });
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const target = String(body?.target || "");
    const texts = body?.texts;
    if (!ALLOWED_LANGUAGES.has(target)) return json({ error: "Unsupported target language." }, 400);
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 12) {
      return json({ error: "Send between 1 and 12 text items." }, 400);
    }
    const clean = texts.map(value => typeof value === "string" ? value.trim() : "");
    if (clean.some(value => !value || value.length > 4000) || clean.join("").length > 9000) {
      return json({ error: "Text batch is empty or too large." }, 400);
    }

    const translations = new Array(clean.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(2, clean.length) }, async () => {
      while (cursor < clean.length) {
        const index = cursor++;
        translations[index] = await translateOne(clean[index], target);
      }
    });
    await Promise.all(workers);
    return json({ target, translations });
  } catch (error) {
    console.error("XERAVION translation request error:", error);
    return json({ error: "Translation request could not be processed." }, 400);
  }
}
