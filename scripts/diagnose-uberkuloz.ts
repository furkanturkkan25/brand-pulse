import Parser from "rss-parser";
import { isRelevantToKeywords, titleMatchesBrand } from "../src/lib/text";
import { decodeGoogleNewsUrl, fetchArticleContent } from "../src/lib/article";

const keys = ["Uberkuloz", "uberkuloz", "Berk Keklik", "@uberkuloz"];
const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
});

async function main() {
  for (const term of ['"Uberkuloz"', "uberkuloz", "Uberkuloz", '"Berk Keklik"']) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(term)}%20when%3A365d&hl=tr&gl=TR&ceid=TR:tr`;
    try {
      const feed = await parser.parseURL(url);
      console.log(`\nGN [${term}] =>`, (feed.items || []).length);
      for (const it of (feed.items || []).slice(0, 4)) {
        console.log(" -", it.title);
        console.log("   match", titleMatchesBrand(it.title || "", keys));
        console.log("   decode", decodeGoogleNewsUrl(it.link || ""));
      }
    } catch (e) {
      console.log("GN err", term, e);
    }
  }

  try {
    const feed = await parser.parseURL(
      `https://www.bing.com/news/search?q=${encodeURIComponent("uberkuloz")}&format=rss`
    );
    console.log("\nBing", (feed.items || []).length);
    for (const it of (feed.items || []).slice(0, 4)) {
      console.log(" -", it.title, titleMatchesBrand(it.title || "", keys));
    }
  } catch (e) {
    console.log("Bing err", e);
  }

  try {
    const feed = await parser.parseURL(
      `https://www.reddit.com/search.rss?q=${encodeURIComponent("uberkuloz")}&sort=new&limit=15`
    );
    console.log("\nReddit", (feed.items || []).length);
    for (const it of (feed.items || []).slice(0, 4)) {
      console.log(" -", it.title, isRelevantToKeywords(`${it.title}`, keys));
    }
  } catch (e) {
    console.log("Reddit err", e);
  }

  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent("uberkuloz")}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    }
  );
  const html = await res.text();
  console.log("\nDDG", res.status, html.length, "results", (html.match(/result__a/gi) || []).length);
  for (const block of html.split(/class="result__a"/i).slice(1, 5)) {
    const title = (block.match(/>([^<]+)</)?.[1] || "").trim();
    console.log(" -", title, titleMatchesBrand(title, keys));
  }

  // sample content fetch from first GN hit without quotes
  const feed = await parser.parseURL(
    `https://news.google.com/rss/search?q=${encodeURIComponent("uberkuloz")}&hl=tr&gl=TR&ceid=TR:tr`
  );
  const first = feed.items?.[0];
  if (first?.link) {
    console.log("\nFetch first:", first.title);
    const art = await fetchArticleContent(first.link);
    console.log(" fetched", art.fetched, art.method, "body", art.body.length, "title", art.title.slice(0, 80));
    console.log(" url", art.url.slice(0, 100));
  }
}

main().catch(console.error);
