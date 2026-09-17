import {
  buildNewsQueriesForType,
  buildWebQueriesForType,
  isEntityType,
  type EntityType,
} from "./entityTypes";
import Parser from "rss-parser";
import { prisma } from "./db";
import { getEntityTypeForQuery } from "./queryMeta";
import { fetchArticleContent, unwrapRedirectUrl } from "./article";
import { fetchGdeltArticles, sentimentFromGdeltTone } from "./gdelt";
import { analyzeNewsSentiment, analyzeSentiment } from "./sentiment";
import {
  compactTr,
  extractThemes,
  isRelevantToKeywords,
  normalizeTr,
  parseKeywords,
  summarizeArticle,
  titleMatchesBrand,
} from "./text";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
});

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** rss-parser.parseURL eski url.parse kullanıyor — modern fetch + URL API */
async function parseFeedUrl(feedUrl: string) {
  const url = new URL(feedUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
    const xml = await res.text();
    return parser.parseString(xml);
  } finally {
    clearTimeout(timer);
  }
}

type Discovery = {
  source: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: Date;
  author?: string;
  tone?: number;
  domain?: string;
};

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker())
  );
  return out;
}

/** Haber: türe göre sorgu varyasyonları */
export function buildNewsQueries(brand: string, entityType: EntityType = "company") {
  return buildNewsQueriesForType(brand, entityType);
}

/** Web/forum: türe göre */
export function buildWebQueries(brand: string, entityType: EntityType = "company") {
  return buildWebQueriesForType(brand, entityType);
}

async function googleNews(
  query: string,
  locale: { hl: string; gl: string; ceid: string } = { hl: "tr", gl: "TR", ceid: "TR:tr" }
): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const feed = await parseFeedUrl(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`
    );
    return {
      items: (feed.items || []).slice(0, 50).map((item) => ({
        source: "news",
        title: item.title || "",
        url: item.link || "",
        snippet: String(item.contentSnippet || item.content || ""),
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        author: item.creator || "Google News",
      })),
    };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Google News hata" };
  }
}

async function googleNewsMulti(query: string) {
  const locales = [
    { hl: "tr", gl: "TR", ceid: "TR:tr" },
    { hl: "en-US", gl: "US", ceid: "US:en" },
    { hl: "en-GB", gl: "GB", ceid: "GB:en" },
    { hl: "de", gl: "DE", ceid: "DE:de" },
    { hl: "fr", gl: "FR", ceid: "FR:fr" },
  ];
  const results = await Promise.all(locales.map((loc) => googleNews(query, loc)));
  const items = results.flatMap((r) => r.items);
  const error = results.find((r) => r.error && !r.items.length)?.error;
  return { items, error: items.length ? undefined : error };
}

async function bingNews(query: string): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const feed = await parseFeedUrl(
      `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`
    );
    return {
      items: (feed.items || []).slice(0, 50).map((item) => ({
        source: "bing",
        title: (item.title || "").replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        url: item.link || "",
        snippet: String(item.contentSnippet || item.content || ""),
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        author: "Bing News",
      })),
    };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Bing News hata" };
  }
}

async function yahooNews(query: string): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const feed = await parseFeedUrl(
      `https://news.search.yahoo.com/news/rss?p=${encodeURIComponent(query)}`
    );
    return {
      items: (feed.items || []).slice(0, 40).map((item) => ({
        source: "yahoo",
        title: item.title || "",
        url: item.link || "",
        snippet: String(item.contentSnippet || item.content || ""),
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        author: "Yahoo News",
      })),
    };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Yahoo News hata" };
  }
}

async function reddit(query: string): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const feed = await parseFeedUrl(
      `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new&limit=25`
    );
    return {
      items: (feed.items || []).slice(0, 12).map((item) => ({
        source: "reddit",
        title: item.title || "",
        url: item.link || "",
        snippet: String(item.contentSnippet || item.content || "").replace(/<[^>]+>/g, " "),
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        author: item.creator || "Reddit",
      })),
    };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Reddit hata" };
  }
}

function unwrapDdg(href: string) {
  try {
    if (href.startsWith("//")) href = "https:" + href;
    const u = new URL(href, "https://html.duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return /^https?:/i.test(href) ? href : u.toString();
  } catch {
    return href.startsWith("http") ? href : "";
  }
}

async function duckduckgo(query: string): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
    });
    clearTimeout(t);
    if (!res.ok) return { items: [], error: `DuckDuckGo HTTP ${res.status}` };
    const html = await res.text();
    const out: Discovery[] = [];
    for (const block of html.split(/class="result__a"/i).slice(1, 14)) {
      const href = block.match(/href="([^"]+)"/i)?.[1] || "";
      const title = (block.match(/>([^<]+)</)?.[1] || "").trim();
      const snippet = (
        block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//i)?.[1] || ""
      )
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .trim();
      const url = unwrapDdg(href);
      if (!url || !title || /duckduckgo\.com|google\./i.test(url)) continue;
      out.push({ source: "web", title, url, snippet, author: "Web" });
    }
    return { items: out };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "DuckDuckGo hata" };
  }
}

async function hackerNews(query: string): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const bare = query.replace(/"/g, "");
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(bare)}&tags=story&hitsPerPage=12`,
      { headers: { "User-Agent": UA } }
    );
    if (!res.ok) return { items: [], error: `Hacker News HTTP ${res.status}` };
    const data = await res.json();
    return {
      items: (data.hits || []).map(
        (h: {
          title?: string;
          url?: string;
          objectID?: string;
          author?: string;
          created_at?: string;
          story_text?: string;
        }) => ({
          source: "hackernews",
          title: h.title || "",
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          snippet: h.story_text || "",
          publishedAt: h.created_at ? new Date(h.created_at) : undefined,
          author: h.author || "HN",
        })
      ),
    };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Hacker News hata" };
  }
}

async function wikipedia(query: string): Promise<{ items: Discovery[]; error?: string }> {
  try {
    const bare = query.replace(/"/g, "");
    const res = await fetch(
      `https://tr.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(bare)}&limit=6&namespace=0&format=json`,
      { headers: { "User-Agent": UA } }
    );
    if (!res.ok) return { items: [], error: `Wikipedia HTTP ${res.status}` };
    const data = await res.json();
    const titles: string[] = data[1] || [];
    const descs: string[] = data[2] || [];
    const urls: string[] = data[3] || [];
    return {
      items: titles.map((title, i) => ({
        source: "wikipedia",
        title,
        url: urls[i] || "",
        snippet: descs[i] || "",
        author: "Wikipedia",
      })),
    };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Wikipedia hata" };
  }
}

function dedupe(items: Discovery[]) {
  const map = new Map<string, Discovery>();
  for (const item of items) {
    if (!item.url && !item.title) continue;
    let key = item.url;
    try {
      const u = new URL(item.url);
      key = u.origin + u.pathname;
    } catch {
      key = normalizeTr(item.title) || item.url;
    }
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

/** Haber adayları: katı eşleşme + kompakt alt dizge (gövde çekilene kadar daha geniş tut) */
function softKeywordMatch(text: string, keys: string[]) {
  if (isRelevantToKeywords(text, keys) || titleMatchesBrand(text, keys)) return true;
  const blob = compactTr(text);
  if (!blob) return false;
  for (const k of keys) {
    const n = compactTr(k);
    // ≥4: Tesla, Dal…; çok kısa iğneler gürültü üretir
    if (n.length >= 4 && blob.includes(n)) return true;
  }
  return false;
}

function passesPrefilter(item: Discovery, keys: string[]) {
  const blob = `${item.title}\n${item.snippet}`;
  if (item.source === "news" || item.source === "bing" || item.source === "yahoo" || item.source === "gdelt") {
    return softKeywordMatch(item.title, keys) || softKeywordMatch(blob, keys);
  }
  return isRelevantToKeywords(blob, keys);
}

function prioritizeDiscoveries(items: Discovery[]) {
  const rank = (s: string) =>
    s === "gdelt" || s === "news" || s === "bing" || s === "yahoo"
      ? 0
      : s === "web" || s === "reddit"
        ? 1
        : 2;
  return [...items].sort((a, b) => rank(a.source) - rank(b.source));
}

export async function runQueryScan(queryId: string) {
  const started = Date.now();
  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) throw new Error("Sorgu bulunamadı");

  const scan = await prisma.scanRun.create({
    data: { queryId, status: "running" },
  });

  try {
    const keywords = parseKeywords(query.keywords);
    const storedType =
      (query as { entityType?: string }).entityType || (await getEntityTypeForQuery(queryId));
    const entityType: EntityType = isEntityType(storedType) ? storedType : "company";
    const rawTerms = (keywords.length ? keywords : [query.name])
      .map((t) => t.trim().replace(/^@+/, ""))
      .filter((t) => normalizeTr(t).length >= 3);
    // Önce sorgu adı, sonra kısa güçlü markalar, sonra uzun varyasyonlar
    const primary = query.name.trim().replace(/^@+/, "");
    const rest = rawTerms
      .filter((t) => normalizeTr(t) !== normalizeTr(primary))
      .sort((a, b) => {
        const sa = normalizeTr(a).includes(" ") ? 1 : 0;
        const sb = normalizeTr(b).includes(" ") ? 1 : 0;
        if (sa !== sb) return sa - sb; // tek kelime önce (Model Y vs Autopilot Tesla)
        return b.length - a.length;
      });
    const terms = [...(normalizeTr(primary).length >= 3 ? [primary] : []), ...rest].slice(0, 15);
    const relevanceKeys = [...new Set([query.name, ...keywords].map((k) => k.replace(/^@+/, "")))].filter(
      Boolean
    );

    // Eski alakasız / boş içerikli bahisleri temizle (yeniden tarama)
    const old = await prisma.mention.findMany({
      where: { queryId },
      select: { id: true, title: true, text: true, platform: true },
    });
    const junkIds = old
      .filter((m) => {
        if (m.platform === "scan_report") return false;
        const blob = `${m.title || ""}\n${m.text}`;
        return !isRelevantToKeywords(blob, relevanceKeys);
      })
      .map((m) => m.id);
    if (junkIds.length) {
      await prisma.mention.deleteMany({ where: { id: { in: junkIds } } });
    }

    const sourcesChecked = new Set<string>();
    const fetchErrors: string[] = [];
    let queriesRun = 0;
    const discovered: Discovery[] = [];

    const note = (source: string, result: { items: Discovery[]; error?: string }) => {
      if (result.items.length) sourcesChecked.add(source);
      else if (result.error && fetchErrors.length < 8) {
        fetchErrors.push(`${source}: ${result.error.slice(0, 120)}`);
      }
      discovered.push(...result.items);
    };

    for (let ti = 0; ti < terms.length; ti++) {
      const term = terms[ti];
      const allNews = buildNewsQueries(term, entityType);
      const allWeb = buildWebQueries(term, entityType);
      // Ana marka: tüm sorgu varyasyonları; diğer terimler: çekirdek set (timeout koruması)
      const newsQs = ti === 0 ? allNews : ti < 4 ? allNews.slice(0, 8) : allNews.slice(0, 4);
      const webQs = ti === 0 ? allWeb.slice(0, 10) : allWeb.slice(0, 5);

      for (const q of newsQs) {
        queriesRun++;
        const [g, b, y] = await Promise.all([googleNewsMulti(q), bingNews(q), yahooNews(q)]);
        note("Google News", g);
        note("Bing News", b);
        note("Yahoo News", y);
      }

      for (const q of webQs) {
        queriesRun++;
        const [r, d, hn] = await Promise.all([reddit(q), duckduckgo(q), hackerNews(q)]);
        note("Reddit", r);
        note("DuckDuckGo", d);
        note("Hacker News", hn);
      }

      queriesRun++;
      note("Wikipedia", await wikipedia(term));
    }

    // GDELT — ücretsiz global indeks (90 gün, daha fazla terim)
    for (const term of terms.slice(0, 5)) {
      queriesRun++;
      const g = await fetchGdeltArticles(term, {
        days: 90,
        maxArticles: 1500,
        maxRequests: 48,
        delayMs: 1200,
      });
      queriesRun += Math.max(0, g.requests - 1);
      note("GDELT", {
        items: g.articles.map((a) => ({
          source: "gdelt",
          title: a.title,
          url: a.url,
          snippet: a.domain ? `Kaynak: ${a.domain}` : "",
          publishedAt: a.publishedAt,
          author: a.domain || "GDELT",
          tone: a.tone,
          domain: a.domain,
        })),
        error: g.error,
      });
    }

    // GDELT yüksek hacim; RSS/web için ayrı tavan (önceden 220 — çoğu Google haberi burada kesiliyordu)
    const relevant = dedupe(discovered).filter((item) => passesPrefilter(item, relevanceKeys));
    const gdeltPool = relevant.filter((i) => i.source === "gdelt").slice(0, 2000);
    const otherPool = prioritizeDiscoveries(relevant.filter((i) => i.source !== "gdelt")).slice(0, 700);
    const prefiltered = [...gdeltPool, ...otherPool];

    const fetched = await mapPool(prefiltered, 5, async (item) => {
      // GDELT zaten indeks; binlerce sayfa çekmek yerine başlık + ton kullan
      if (item.source === "gdelt") {
        return { item, article: null };
      }
      const direct = unwrapRedirectUrl(item.url);
      const article = direct ? await fetchArticleContent(direct) : null;
      return { item: { ...item, url: article?.url || direct || item.url }, article };
    });

    let pagesFetched = 0;
    let saved = 0;

    for (const { item, article } of fetched) {
      // Her zaman RSS başlığını esas al (çözülemeyen Google linklerinde doğru kalan bu)
      const rssTitle = (item.title || "").trim();
      const pageTitle = (article?.title || "").trim();
      const displayTitle = rssTitle || pageTitle;
      const body = article?.body || "";
      const description = article?.description || item.snippet || "";
      if (article?.fetched) pagesFetched++;

      const isNews =
        item.source === "news" ||
        item.source === "bing" ||
        item.source === "yahoo" ||
        item.source === "gdelt";
      const titleHit =
        softKeywordMatch(rssTitle, relevanceKeys) || softKeywordMatch(displayTitle, relevanceKeys);
      const blobHit = softKeywordMatch(
        [displayTitle, item.snippet, description, body].filter(Boolean).join("\n"),
        relevanceKeys
      );

      // Haber: başlık veya snippet/özet/gövde markayı taşımalı (yumuşak eşleşme)
      if (isNews && !titleHit && !blobHit) continue;
      if (!isNews && !blobHit && !titleHit) continue;

      // Başlık ayrı alanda; text alanında yalnızca kısa özet
      const summary =
        item.source === "gdelt"
          ? item.snippet ||
            (item.domain ? `Kaynak: ${item.domain}` : "GDELT haber kaydı")
          : body
            ? summarizeArticle(body, relevanceKeys, { maxSentences: 3, maxChars: 420 })
            : summarizeArticle(description || item.snippet || "", relevanceKeys, {
                maxSentences: 2,
                maxChars: 320,
              }) ||
              (description || item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 320);

      const text =
        summary ||
        (titleHit || blobHit
          ? (item.snippet || description || "Başlık markayla eşleşiyor; özet alınamadı.")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 320)
          : "");
      if (!displayTitle || !text) continue;

      const { sentiment, score } =
        item.source === "gdelt"
          ? sentimentFromGdeltTone(item.tone)
          : isNews
            ? analyzeNewsSentiment(displayTitle, `${description}\n${body}`, relevanceKeys, entityType)
            : analyzeSentiment(`${displayTitle}\n${body || text}`);
      const themes = extractThemes(body || text);
      const externalId = (
        article?.url ||
        item.url ||
        `gen_${normalizeTr(displayTitle).slice(0, 40)}`
      ).slice(0, 220);

      await prisma.mention.upsert({
        where: {
          queryId_platform_externalId: {
            queryId,
            platform: item.source,
            externalId,
          },
        },
        create: {
          queryId,
          platform: item.source,
          author: item.author || item.source,
          title: displayTitle,
          text,
          url: article?.url || item.url || null,
          publishedAt: item.publishedAt || new Date(),
          sentiment,
          score,
          externalId,
          themes: JSON.stringify(themes),
          rawPayload: JSON.stringify({
            source: item.source,
            fetched: Boolean(article?.fetched),
            method: article?.method || (item.source === "gdelt" ? "gdelt" : "none"),
            contentLength: body.length,
            rssTitle,
            tone: item.tone,
            domain: item.domain,
          }),
        },
        update: {
          author: item.author || item.source,
          title: displayTitle,
          text,
          url: article?.url || item.url || null,
          publishedAt: item.publishedAt || undefined,
          sentiment,
          score,
          themes: JSON.stringify(themes),
          rawPayload: JSON.stringify({
            source: item.source,
            fetched: Boolean(article?.fetched),
            method: article?.method || (item.source === "gdelt" ? "gdelt" : "none"),
            contentLength: body.length,
            rssTitle,
            tone: item.tone,
            domain: item.domain,
          }),
        },
      });
      saved++;
    }

    const durationMs = Date.now() - started;
    const networkHint =
      discovered.length === 0 && fetchErrors.length
        ? `Kaynaklara ulaşılamadı (${fetchErrors.slice(0, 3).join(" · ")})`
        : discovered.length === 0
          ? "Hiç kaynak sonuç döndürmedi — internet / DNS kontrol edin"
          : null;

    await prisma.scanRun.update({
      where: { id: scan.id },
      data: {
        status: networkHint && saved === 0 ? "failed" : "completed",
        sourcesChecked: JSON.stringify([...sourcesChecked]),
        queriesRun,
        urlsFound: prefiltered.length,
        pagesFetched,
        saved,
        durationMs,
        error: networkHint,
      },
    });

    return {
      scanId: scan.id,
      sourcesChecked: [...sourcesChecked],
      queriesRun,
      urlsFound: prefiltered.length,
      pagesFetched,
      saved,
      purged: junkIds.length,
      durationMs,
      error: networkHint,
      fetchErrors: fetchErrors.slice(0, 5),
    };
  } catch (err) {
    await prisma.scanRun.update({
      where: { id: scan.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : "Tarama başarısız",
        durationMs: Date.now() - started,
      },
    });
    throw err;
  }
}
