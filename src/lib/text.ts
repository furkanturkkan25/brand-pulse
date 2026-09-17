export function normalizeTr(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Boşluksuz karşılaştırma: "Dal TemaPark" ↔ "Daltemapark" ↔ "Daltema Park" */
export function compactTr(text: string) {
  return normalizeTr(text).replace(/\s+/g, "");
}

export function parseKeywords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
  } catch {
    /* csv */
  }
  return raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

export function stringifyKeywords(keywords: string[]) {
  return JSON.stringify(keywords.map((k) => k.trim()).filter(Boolean));
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(text: string) {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Tek kelime / ifade / boşluksuz marka eşleşmesi */
function keywordHits(hay: string, hayCompact: string, needleRaw: string): boolean {
  const needle = normalizeTr(decodeEntities(needleRaw));
  if (!needle || needle.length < 3) return false;
  const needleCompact = needle.replace(/\s+/g, "");

  if (needle.includes(" ")) {
    if (hay.includes(needle)) return true;
    if (needleCompact.length >= 6 && hayCompact.includes(needleCompact)) return true;
    return false;
  }

  // Tam kelime veya Türkçe ekli biçim: Tesla → teslanin, teslaya, tesla'nın
  const words = hay.split(/\s+/).filter(Boolean);
  if (words.some((w) => w === needle)) return true;
  if (needle.length >= 4 && words.some((w) => w.startsWith(needle) && w.length <= needle.length + 8)) {
    return true;
  }

  // ≥5 harf: gövde/snippet içinde alt dizge (önceden yalnız ≥7 — kısa markalar kaçıyordu)
  if (needle.length >= 5 && (hay.includes(needle) || hayCompact.includes(needleCompact))) {
    return true;
  }
  const re = new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:\\s|$)`);
  if (re.test(hay)) return true;
  if (needleCompact.length >= 6 && hayCompact.includes(needleCompact)) return true;
  return false;
}

export function isRelevantToKeywords(text: string, keywords: string[]) {
  const cleaned = decodeEntities(text);
  const hay = normalizeTr(cleaned);
  const hayCompact = compactTr(cleaned);
  if (!hay) return false;

  const usable = keywords.map((k) => k.trim()).filter((k) => normalizeTr(k).length >= 3);
  if (usable.length === 0) return false;

  // Marka adı (≥4 harf) ve çok kelimeli ifadeler güçlü kabul
  const strong = usable.filter((k) => {
    const n = normalizeTr(k);
    return n.includes(" ") || n.length >= 4 || compactTr(k).length >= 6;
  });
  const weak = usable.filter((k) => !strong.includes(k));

  for (const needle of strong) {
    if (keywordHits(hay, hayCompact, needle)) return true;
  }

  if (strong.length === 0) {
    const hits = weak.filter((n) => keywordHits(hay, hayCompact, n));
    if (hits.length >= 1 && normalizeTr(weak[0]).length >= 5) return true;
    if (hits.length >= 2) return true;
  }

  return false;
}

export function titleMatchesBrand(title: string, keywords: string[]) {
  return isRelevantToKeywords(title, keywords);
}

export function excerptAroundKeywords(text: string, keywords: string[], maxLen = 1200) {
  const clean = decodeEntities(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const norms = keywords.map((k) => normalizeTr(k)).filter((k) => k.length >= 3);
  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const hits = sentences.filter((s) => {
    const h = normalizeTr(s);
    const c = compactTr(s);
    return norms.some((k) => h.includes(k) || c.includes(k.replace(/\s+/g, "")));
  });
  const picked = (hits.length ? hits : sentences.slice(0, 6)).join(" ");
  if (picked.length <= maxLen) return picked;
  const hay = normalizeTr(picked);
  let start = 0;
  for (const k of norms) {
    const idx = hay.indexOf(k);
    if (idx >= 0) {
      start = Math.max(0, idx - 160);
      break;
    }
  }
  return picked.slice(start, start + maxLen).trim();
}

/**
 * Haber gövdesinden kısa özet (2–3 cümle).
 * Markayı geçen cümleleri öne alır; yoksa ilk anlamlı cümleleri kullanır.
 */
export function summarizeArticle(
  body: string,
  keywords: string[] = [],
  opts?: { maxSentences?: number; maxChars?: number }
): string {
  const maxSentences = opts?.maxSentences ?? 3;
  const maxChars = opts?.maxChars ?? 420;
  const clean = decodeEntities(body)
    .replace(/\s+/g, " ")
    .replace(/Title:|URL Source:|Markdown Content:/gi, " ")
    .trim();
  if (!clean) return "";

  const rawSentences = clean
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 320)
    .filter((s) => !/cookie|javascript|subscribe|abone|kvkk|aydınlatma/i.test(s));

  if (rawSentences.length === 0) {
    return clean.slice(0, maxChars).trim() + (clean.length > maxChars ? "…" : "");
  }

  const norms = keywords.map((k) => normalizeTr(k)).filter((k) => k.length >= 3);
  const scored = rawSentences.map((s, i) => {
    const h = normalizeTr(s);
    const c = compactTr(s);
    let score = 0;
    for (const k of norms) {
      if (h.includes(k) || c.includes(k.replace(/\s+/g, ""))) score += 5;
    }
    // İlk paragraflara hafif öncelik
    if (i < 3) score += 1;
    if (i < 8) score += 0.3;
    return { s, score, i };
  });

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = scored
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);

  let summary = picked.join(" ");
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars).replace(/\s+\S*$/, "").trim() + "…";
  }
  return summary;
}

export function extractThemes(text: string, limit = 8): string[] {
  const stop = new Set([
    "bir", "bu", "da", "de", "ve", "ile", "icin", "çok", "cok", "daha", "en", "mi", "mu", "mü",
    "gibi", "kadar", "ama", "fakat", "veya", "the", "and", "for", "with", "that", "from", "http",
    "https", "www", "com", "org", "olarak", "sonra", "once", "önce", "var", "yok", "her", "ben",
    "title", "url", "source", "markdown", "content",
  ]);
  const words = normalizeTr(decodeEntities(text))
    .split(" ")
    .filter((w) => w.length >= 4 && !stop.has(w) && !/^\d+$/.test(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}
