const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr|article|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function meta(html: string, prop: string) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i"
  );
  return html.match(re)?.[1] || html.match(re2)?.[1] || "";
}

function isBadUrl(url: string) {
  return !url ||
    /googleusercontent\.com|gstatic\.com|ggpht\.com|\.png($|\?)|\.jpg($|\?)|\.gif($|\?)|data:image/i.test(
      url
    );
}

/** Bing News RSS apiclick sarmalayıcısından gerçek URL */
export function unwrapRedirectUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    // Bing: ?url=
    const bingUrl = u.searchParams.get("url");
    if (bingUrl && /^https?:/i.test(bingUrl)) return bingUrl;
    // Google / genel: q=, u=, target=
    for (const key of ["q", "u", "target", "continue"]) {
      const v = u.searchParams.get(key);
      if (v && /^https?:/i.test(v)) return v;
    }
  } catch {
    /* ignore */
  }
  return raw;
}

async function fetchHtml(url: string, timeoutMs = 15000) {
  if (isBadUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (/image\//i.test(ctype) || isBadUrl(res.url)) return null;
    const html = await res.text();
    // PNG/JPEG binary yanlışlıkla HTML sanılmasın
    if (html.startsWith("\uFFFDPNG") || html.startsWith("PNG") || html.includes("IHDR")) {
      return null;
    }
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Eski tip Google News article ID decode */
export function decodeGoogleNewsUrl(googleUrl: string): string | null {
  try {
    const m = googleUrl.match(/\/articles\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const buf = Buffer.from(b64, "base64");

    for (const enc of ["utf8", "latin1"] as const) {
      const text = buf.toString(enc);
      const matches = text.match(/https?:\/\/[^\s\x00-\x1f"<>\\\u007f-\uffff]+/g) || [];
      const clean = matches
        .map((u) => {
          const mm = u.match(
            /^(https?:\/\/[A-Za-z0-9][A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)/
          );
          return mm?.[1] || "";
        })
        .filter((u) => u.length > 12 && !/google\.(com|co)|gstatic|schema\.org|w3\.org/i.test(u));
      if (clean.length) {
        clean.sort((a, b) => b.length - a.length);
        return clean[0];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Google News yeni format: batchexecute ile yayıncı URL'si
 * (https://github.com/SSujitX/google-news-url-decoder yaklaşımı)
 */
async function decodeGoogleNewsViaBatch(googleUrl: string): Promise<string | null> {
  try {
    const articleId = googleUrl.match(/\/articles\/([^?]+)/)?.[1];
    if (!articleId) return null;

    // Önce sayfadan signature al
    const page = await fetchHtml(`${googleUrl}${googleUrl.includes("?") ? "&" : "?"}hl=tr&gl=TR&ceid=TR:tr`);
    if (!page) return null;

    const signature =
      page.html.match(/data-n-a-sg="([^"]+)"/)?.[1] ||
      page.html.match(/,"([^"]{20,})",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,"[^"]*articles/)?.[1];
    const timestamp =
      page.html.match(/data-n-a-ts="([^"]+)"/)?.[1] ||
      page.html.match(/,"(\d{10,})",/)?.[1];

    // HTML içinde gömülü publisher URL ara (bazen olur)
    const embedded = [
      ...page.html.matchAll(/"(https?:\/\/(?!news\.google|www\.google|schemas?|gstatic)[^"]{12,250})"/gi),
    ]
      .map((m) => m[1])
      .filter((u) => !isBadUrl(u) && !/google\./i.test(u));
    if (embedded.length) return embedded[0];

    if (!signature || !timestamp) return null;

    const payload = [
      "Fbv4je",
      JSON.stringify([
        "garturlreq",
        [
          ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
          "X",
          "X",
          2,
          1,
          {
            2: articleId,
            3: Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000,
          },
          `${articleId}:${signature}`,
          1,
        ],
      ]),
    ];

    const body = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
      {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": BROWSER_UA,
          Origin: "https://news.google.com",
          Referer: googleUrl,
        },
        body,
      }
    );
    clearTimeout(timer);
    const text = await res.text();
    const urlMatch = text.match(/https?:\/\/[^"\\\s]+/);
    if (urlMatch && !/google\./i.test(urlMatch[0]) && !isBadUrl(urlMatch[0])) {
      return urlMatch[0].replace(/\\u003d/g, "=").replace(/\\+\//g, "/");
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function resolveArticleUrl(rssLink: string): Promise<string> {
  if (!rssLink) return rssLink;
  let url = unwrapRedirectUrl(rssLink);

  if (/bing\.com\/news\/apiclick/i.test(url)) {
    url = unwrapRedirectUrl(url);
  }

  if (!/news\.google\.com/i.test(url)) return url;

  const decoded = decodeGoogleNewsUrl(url);
  if (decoded) return decoded;

  const viaBatch = await decodeGoogleNewsViaBatch(url);
  if (viaBatch) return viaBatch;

  // Çözülemezse Google linkini döndürme — çağıran RSS başlığıyla kaydedecek
  return "";
}

async function fetchViaJina(url: string): Promise<{ title: string; body: string } | null> {
  if (!url || /news\.google\.com/i.test(url) || isBadUrl(url)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: ctrl.signal,
      headers: {
        Accept: "text/plain",
        "User-Agent": BROWSER_UA,
        "X-Return-Format": "markdown",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const md = await res.text();
    if (!md || md.length < 40) return null;
    if (/failed to|blocked|captcha|AbuseAlleviation/i.test(md.slice(0, 400))) return null;

    const title =
      md.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ||
      md.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
      "";
    const body = md
      .replace(/^Title:.*$/m, "")
      .replace(/^URL Source:.*$/m, "")
      .replace(/^Markdown Content:/m, "")
      .trim()
      .slice(0, 12000);
    return { title, body };
  } catch {
    return null;
  }
}

export type ArticleContent = {
  url: string;
  title: string;
  description: string;
  body: string;
  fetched: boolean;
  method: "direct" | "jina" | "none";
};

export async function fetchArticleContent(url: string): Promise<ArticleContent> {
  const resolved = await resolveArticleUrl(url);

  if (!resolved) {
    return { url: "", title: "", description: "", body: "", fetched: false, method: "none" };
  }

  // 1) Doğrudan HTML
  const page = await fetchHtml(resolved);
  if (page) {
    const title =
      meta(page.html, "og:title") ||
      page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ||
      "";
    const description =
      meta(page.html, "og:description") || meta(page.html, "description") || "";
    const main =
      page.html.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
      page.html.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
      page.html.match(/<body[\s\S]*?<\/body>/i)?.[0] ||
      page.html;
    const body = stripTags(main).slice(0, 12000);
    if (body.length > 120 || description.length > 40) {
      return {
        url: page.finalUrl || resolved,
        title: stripTags(title).slice(0, 300),
        description: stripTags(description).slice(0, 1000),
        body,
        fetched: true,
        method: "direct",
      };
    }
  }

  // 2) Jina Reader
  const jina = await fetchViaJina(resolved);
  if (jina?.body) {
    return {
      url: resolved,
      title: jina.title.slice(0, 300),
      description: jina.body.slice(0, 400),
      body: jina.body,
      fetched: true,
      method: "jina",
    };
  }

  return {
    url: resolved,
    title: "",
    description: "",
    body: "",
    fetched: false,
    method: "none",
  };
}
