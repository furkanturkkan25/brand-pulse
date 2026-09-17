import { prisma } from "./db";
import { analyzeSentiment } from "./sentiment";
import { extractThemes, normalizeTr } from "./text";

export type ReviewInput = {
  author?: string;
  text: string;
  rating?: number;
  date?: string;
  url?: string;
  externalId?: string;
};

export async function importReviews(queryId: string, reviews: ReviewInput[]) {
  let saved = 0;
  for (const r of reviews) {
    const text = r.text.trim();
    if (text.length < 3) continue;
    const title =
      typeof r.rating === "number"
        ? `Google yorum · ${"★".repeat(Math.min(5, Math.max(0, Math.round(r.rating))))}${"☆".repeat(Math.max(0, 5 - Math.round(r.rating)))}`
        : "Google yorum";
    const full = `${title}\n\n${text}`;
    const { sentiment, score } = analyzeSentiment(full);
    // Rating varsa skoru yumuşatarak birleştir
    let finalScore = score;
    let finalSentiment = sentiment;
    if (typeof r.rating === "number") {
      const ratingScore = (r.rating - 3) / 2; // 1→-1, 5→+1
      finalScore = Number(((score + ratingScore) / 2).toFixed(3));
      if (r.rating <= 2) finalSentiment = "negative";
      else if (r.rating >= 4) finalSentiment = "positive";
      else if (finalSentiment === "neutral") finalSentiment = "neutral";
    }

    const externalId = (
      r.externalId ||
      `greview_${normalizeTr(`${r.author || ""}|${text}`).slice(0, 60)}`
    ).slice(0, 220);

    await prisma.mention.upsert({
      where: {
        queryId_platform_externalId: {
          queryId,
          platform: "google_reviews",
          externalId,
        },
      },
      create: {
        queryId,
        platform: "google_reviews",
        author: r.author || "Google kullanıcı",
        title,
        text: full.slice(0, 5000),
        url: r.url || null,
        publishedAt: r.date ? new Date(r.date) : new Date(),
        sentiment: finalSentiment,
        score: finalScore,
        externalId,
        themes: JSON.stringify(extractThemes(text)),
        rawPayload: JSON.stringify({ rating: r.rating ?? null, source: "import" }),
      },
      update: {
        author: r.author || "Google kullanıcı",
        title,
        text: full.slice(0, 5000),
        url: r.url || null,
        publishedAt: r.date ? new Date(r.date) : undefined,
        sentiment: finalSentiment,
        score: finalScore,
        themes: JSON.stringify(extractThemes(text)),
        rawPayload: JSON.stringify({ rating: r.rating ?? null, source: "import" }),
      },
    });
    saved++;
  }
  return saved;
}

/** Yapıştırılan metni yorumlara böl (--- veya boş satır blokları) */
export function parsePastedReviews(raw: string): ReviewInput[] {
  const chunks = raw
    .split(/\n\s*---+\s*\n|\n{3,}/)
    .map((c) => c.trim())
    .filter(Boolean);

  const out: ReviewInput[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let author: string | undefined;
    let rating: number | undefined;
    let textLines = lines;

    const first = lines[0];
    const starMatch = first.match(/([1-5])\s*\/\s*5|([1-5])\s*yıldız|★{1,5}|⭐{1,5}/i);
    if (starMatch) {
      if (starMatch[1] || starMatch[2]) rating = Number(starMatch[1] || starMatch[2]);
      else rating = (first.match(/★|⭐/g) || []).length;
      textLines = lines.slice(1);
    }

    const authorMatch = first.match(/^(.+?)\s*[-–:]\s*(.+)$/);
    if (!rating && authorMatch && authorMatch[2].length > 10) {
      author = authorMatch[1];
      textLines = [authorMatch[2], ...lines.slice(1)];
    } else if (textLines[0] && textLines[0].length < 40 && textLines.length > 1) {
      author = textLines[0];
      textLines = textLines.slice(1);
    }

    const text = textLines.join("\n").trim();
    if (text.length >= 3) out.push({ author, text, rating });
  }

  // Tek blok / satır satır
  if (out.length === 0 && raw.trim().length >= 3) {
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t.length >= 8) out.push({ text: t });
    }
  }
  return out;
}

export function parseCsvReviews(csv: string): ReviewInput[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  const hasHeader = /author|yazar|text|yorum|rating|puan/.test(header);
  const rows = hasHeader ? lines.slice(1) : lines;
  const cols = hasHeader ? header.split(",").map((c) => c.trim()) : null;

  const out: ReviewInput[] = [];
  for (const row of rows) {
    const parts = splitCsvLine(row);
    if (cols) {
      const obj: Record<string, string> = {};
      cols.forEach((c, i) => {
        obj[c] = parts[i] || "";
      });
      const text = obj.text || obj.yorum || obj.comment || parts[2] || parts[1] || "";
      if (!text.trim()) continue;
      out.push({
        author: obj.author || obj.yazar || obj.name || undefined,
        text: text.trim(),
        rating: obj.rating || obj.puan ? Number(obj.rating || obj.puan) : undefined,
        date: obj.date || obj.tarih || undefined,
        url: obj.url || obj.link || undefined,
      });
    } else if (parts.length >= 1) {
      // author,rating,text  veya text
      if (parts.length >= 3) {
        out.push({
          author: parts[0],
          rating: Number(parts[1]) || undefined,
          text: parts.slice(2).join(","),
        });
      } else {
        out.push({ text: parts.join(",") });
      }
    }
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      result.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

/**
 * Google Places API (New) — ücretsiz kota için billing + API key gerekir.
 * GOOGLE_PLACES_API_KEY yoksa null döner.
 */
export async function fetchGooglePlaceReviews(placeId: string) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,reviews",
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const reviews = (data.reviews || []) as Array<{
    name?: string;
    relativePublishTimeDescription?: string;
    rating?: number;
    text?: { text?: string };
    authorAttribution?: { displayName?: string; uri?: string };
    publishTime?: string;
  }>;

  return {
    placeName: data.displayName?.text || placeId,
    rating: data.rating as number | undefined,
    count: data.userRatingCount as number | undefined,
    reviews: reviews.map((r) => ({
      author: r.authorAttribution?.displayName,
      text: r.text?.text || "",
      rating: r.rating,
      date: r.publishTime,
      url: r.authorAttribution?.uri,
      externalId: r.name || undefined,
    })).filter((r) => r.text),
  };
}

export function placesConfigured() {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}
