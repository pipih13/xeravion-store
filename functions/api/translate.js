// Cloudflare Pages Function: XERAVION translation API with explicit provider diagnostics.
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

function normalize(value, target) {
  const output = String(value || "").trim();
  return target === "en" ? output.replace(/\bfamous\b/gi, "renowned") : output;
}

async function requestGoogle(source, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", source);
  const response = await fetch(url.toString(), {
    headers: { "accept": "application/json", "user-agent": "Mozilla/5.0 XERAVION/1.0" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Google HTTP " + response.status + ": " + (await response.text()).slice(0,180));
  const payload = await response.json();
  const value = (payload[0] || []).map(part => part && part[0] || "").join("").trim();
  if (!value) throw new Error("Google returned an empty translation");
  return value;
}

async function requestMyMemory(source, target) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", source);
  url.searchParams.set("langpair", "id|" + target);
  const response = await fetch(url.toString(), {
    headers: { "accept": "application/json", "user-agent": "XERAVION/1.0" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("MyMemory HTTP " + response.status + ": " + (await response.text()).slice(0,180));
  const data = await response.json();
  const value = data?.responseData?.translatedText;
  if (Number(data?.responseStatus) !== 200 || typeof value !== "string" || !value.trim()) {
    throw new Error("MyMemory response " + String(data?.responseStatus) + ": " + String(data?.responseDetails || "empty translation").slice(0,180));
  }
  return value.trim();
}

async function translateOne(source, target) {
  const key = target + "|" + source;
  if (memoryCache.has(key)) return { translation: memoryCache.get(key), provider: "cache", errors: [] };

  const errors = [];
  const providers = [
    ["Google Translate", requestGoogle],
    ["MyMemory", requestMyMemory]
  ];
  for (const [name, provider] of providers) {
    try {
      const value = normalize(await provider(source, target), target);
      if (value && value.toLowerCase() !== source.trim().toLowerCase()) {
        memoryCache.set(key, value);
        if (memoryCache.size > 1500) memoryCache.delete(memoryCache.keys().next().value);
        return { translation: value, provider: name, errors };
      }
      errors.push(name + ": returned unchanged text");
    } catch (error) {
      errors.push(name + ": " + String(error?.message || error).slice(0,220));
    }
  }
  return { translation: null, provider: null, errors };
}

export async function onRequestGet() {
  const test = await translateOne("Halo, selamat datang di XERAVION.", "en");
  return json({
    service: "xeravion-translation",
    status: "ready",
    provider_status: test.translation ? "working" : "unavailable",
    sample_translation: test.translation,
    provider: test.provider,
    provider_errors: test.errors,
    languages: [...ALLOWED_LANGUAGES]
  });
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
    if (clean.some(value => !value || value.length > 4000) || clean.join("").length > 30000) {
      return json({ error: "Text batch is empty or too large." }, 400);
    }

    const results = new Array(clean.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, clean.length) }, async () => {
      while (cursor < clean.length) {
        const index = cursor++;
        results[index] = await translateOne(clean[index], target);
      }
    });
    await Promise.all(workers);
    return json({
      target,
      translations: results.map(result => result.translation),
      providers: results.map(result => result.provider),
      errors: results.map(result => result.errors)
    });
  } catch (error) {
    console.error("XERAVION translation request error:", error);
    return json({ error: String(error?.message || "Translation request could not be processed.").slice(0,300) }, 400);
  }
}
