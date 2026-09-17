/**
 * GDELT DOC 2.0 — ücretsiz global haber indeksi (API key yok).
 * https://api.gdeltproject.org/api/v2/doc/doc
 *
 * Tek istekte max 250 kayıt; daha fazlası için tarih penceresi bölünür.
 */

export type GdeltArticle = {
  title: string;
  url: string;
  domain: string;
  publishedAt?: Date;
  language?: string;
  sourcecountry?: string;
  tone?: number;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** GDELT: YYYYMMDDHHMMSS (UTC) */
export function formatGdeltDate(d: Date) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function parseGdeltSeenDate(raw?: string): Date | undefined {
  if (!raw) return undefined;
  // 20260913T143022Z or 20260913143022
  const m = raw.replace(/[^\d]/g, "");
  if (m.length < 14) return undefined;
  const iso = `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}T${m.slice(8, 10)}:${m.slice(10, 12)}:${m.slice(12, 14)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Marka için GDELT sorgu metni */
export function buildGdeltQuery(term: string) {
  const t = term.trim().replace(/^@+/, "");
  if (!t) return "";
  // Çok kelimeli → tam ifade; tek kelime → tırnaklı (daha az gürültü)
  if (/\s/.test(t)) return `"${t.replace(/"/g, "")}"`;
  return `"${t.replace(/"/g, "")}"`;
}

type FetchOpts = {
  days?: number;
  maxArticles?: number;
  maxRequests?: number;
  delayMs?: number;
};

async function fetchWindow(
  query: string,
  start: Date,
  end: Date
): Promise<{ articles: GdeltArticle[]; error?: string; hitCap: boolean }> {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "250");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("STARTDATETIME", formatGdeltDate(start));
  url.searchParams.set("ENDDATETIME", formatGdeltDate(end));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "BrandPulse/1.0 (GDELT client)",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return { articles: [], error: `GDELT HTTP ${res.status}`, hitCap: false };
    }
    // Bazen düz metin hata döner
    if (text.trim().startsWith("<") || text.includes("error") && !text.trim().startsWith("{")) {
      const preview = text.replace(/\s+/g, " ").slice(0, 120);
      if (!text.includes("articles") && !text.includes("ArticleList")) {
        return { articles: [], error: preview || "GDELT boş/hata yanıt", hitCap: false };
      }
    }
    let data: {
      articles?: Array<{
        title?: string;
        url?: string;
        domain?: string;
        seendate?: string;
        language?: string;
        sourcecountry?: string;
        tone?: number | string;
      }>;
    };
    try {
      data = JSON.parse(text);
    } catch {
      return { articles: [], error: "GDELT JSON parse hatası", hitCap: false };
    }
    const raw = data.articles || [];
    const articles: GdeltArticle[] = raw
      .map((a) => ({
        title: (a.title || "").trim(),
        url: (a.url || "").trim(),
        domain: (a.domain || "").trim(),
        publishedAt: parseGdeltSeenDate(a.seendate),
        language: a.language,
        sourcecountry: a.sourcecountry,
        tone: a.tone === undefined || a.tone === "" ? undefined : Number(a.tone),
      }))
      .filter((a) => a.title && a.url);
    return { articles, hitCap: articles.length >= 250 };
  } catch (err) {
    return {
      articles: [],
      error: err instanceof Error ? err.message : "GDELT istek hatası",
      hitCap: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Son N gün için GDELT makale listesi.
 * Günlük pencereler; 250 dolarsa 12 saatlik alt pencerelere bölünür.
 */
export async function fetchGdeltArticles(
  term: string,
  opts: FetchOpts = {}
): Promise<{ articles: GdeltArticle[]; requests: number; error?: string }> {
  const query = buildGdeltQuery(term);
  if (!query) return { articles: [], requests: 0, error: "Boş sorgu" };

  const days = Math.min(Math.max(opts.days ?? 30, 1), 90);
  const maxArticles = opts.maxArticles ?? 2000;
  const maxRequests = opts.maxRequests ?? 48;
  const delayMs = opts.delayMs ?? 1600;

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  type Window = { from: Date; to: Date };
  const queue: Window[] = [];
  // Günden güne geriye
  for (let i = 0; i < days; i++) {
    const to = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    if (from < start) {
      queue.push({ from: start, to });
      break;
    }
    queue.push({ from, to });
  }

  const seen = new Set<string>();
  const out: GdeltArticle[] = [];
  const errors: string[] = [];
  let requests = 0;

  while (queue.length && out.length < maxArticles && requests < maxRequests) {
    const win = queue.shift()!;
    if (requests > 0) await sleep(delayMs);
    requests++;
    const { articles, error, hitCap } = await fetchWindow(query, win.from, win.to);
    if (error && !articles.length) {
      errors.push(error);
      // Rate limit / transient — kısa bekle, devam
      await sleep(delayMs);
      continue;
    }
    for (const a of articles) {
      const key = a.url || `${a.title}|${a.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
      if (out.length >= maxArticles) break;
    }
    // Cap doluysa pencereyi ikiye böl (min 6 saat)
    const spanMs = win.to.getTime() - win.from.getTime();
    if (hitCap && spanMs > 6 * 60 * 60 * 1000 && requests < maxRequests && out.length < maxArticles) {
      const mid = new Date(win.from.getTime() + spanMs / 2);
      queue.unshift({ from: mid, to: win.to });
      queue.unshift({ from: win.from, to: mid });
    }
  }

  return {
    articles: out,
    requests,
    error: out.length ? undefined : errors[0],
  };
}

/** GDELT tone (-100..+100 civarı) → sentiment */
export function sentimentFromGdeltTone(tone?: number): { sentiment: string; score: number } {
  if (tone === undefined || Number.isNaN(tone)) {
    return { sentiment: "neutral", score: 0 };
  }
  // Tipik haber tonları dar aralıkta; eşikleri düşük tut
  const score = Math.max(-5, Math.min(5, tone / 2));
  if (tone >= 1.2) return { sentiment: "positive", score };
  if (tone <= -1.2) return { sentiment: "negative", score };
  return { sentiment: "neutral", score };
}
