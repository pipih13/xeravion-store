// Cloudflare Pages Function: batched public-site translations for XERAVION.
// Accepts a small batch to avoid dozens of browser-side cross-origin requests.
const ALLOWED_LANGUAGES = new Set(["en","ms","ar","es","pt","fr","de","ja","ko","zh-CN","th","vi","tl"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600",
      "x-content-type-options": "nosniff"
    }
  });
}

function normalize(value, source, target) {
  const output = String(value || "").trim() || source;
  return target === "en" ? output.replace(/\bfamous\b/gi, "renowned") : output;
}

async function translateOne(source, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", source);

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: { "accept": "application/json" },
        cf: { cacheTtl: 3600, cacheEverything: true }
      });
      if (!response.ok) throw new Error("Translation provider HTTP " + response.status);
      const payload = await response.json();
      const translated = (payload[0] || []).map(part => part && part[0] || "").join("");
      return normalize(translated, source, target);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  console.warn("XERAVION translation provider failed:", lastError);
  return null;
}

export async function onRequestGet() {
  return json({ service: "xeravion-translation", status: "ready", languages: [...ALLOWED_LANGUAGES] }, 200);
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
    const workers = Array.from({ length: Math.min(3, clean.length) }, async () => {
      while (cursor < clean.length) {
        const index = cursor++;
        translations[index] = await translateOne(clean[index], target);
      }
    });
    await Promise.all(workers);
    return json({ target, translations });
  } catch (error) {
    return json({ error: "Translation request could not be processed.", detail: error?.message || String(error) }, 400);
  }
}
