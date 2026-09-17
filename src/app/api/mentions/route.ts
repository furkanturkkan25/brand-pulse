import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { format, eachDayOfInterval, subDays } from "date-fns";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const queryId = sp.get("queryId");
  const sentiment = sp.get("sentiment");
  const platform = sp.get("platform");
  const q = sp.get("q");
  const days = Number(sp.get("days") || 365);
  const sort = sp.get("sort") || "date_desc";
  const limit = Math.min(Number(sp.get("limit") || 150), 500);
  const exportCsv = sp.get("export") === "csv";
  const exportLimit = exportCsv ? Math.min(Number(sp.get("limit") || 5000), 10000) : limit;

  if (!queryId) return NextResponse.json({ error: "queryId gerekli" }, { status: 400 });

  const since = subDays(new Date(), days);
  // Yeni taranan eski tarihli haberler de görünsün (createdAt)
  const dateFilter: Prisma.MentionWhereInput = {
    OR: [{ publishedAt: { gte: since } }, { createdAt: { gte: since } }],
  };
  const where: Prisma.MentionWhereInput = {
    queryId,
    AND: [dateFilter],
  };
  if (sentiment && sentiment !== "all") where.sentiment = sentiment;
  if (platform && platform !== "all") where.platform = platform;
  if (q) {
    (where.AND as Prisma.MentionWhereInput[]).push({
      OR: [{ text: { contains: q } }, { title: { contains: q } }],
    });
  }

  let orderBy: Prisma.MentionOrderByWithRelationInput = { publishedAt: "desc" };
  if (sort === "score_asc") orderBy = { score: "asc" };
  else if (sort === "score_desc") orderBy = { score: "desc" };
  else if (sort === "date_asc") orderBy = { publishedAt: "asc" };

  const [mentions, allForStats, scans] = await Promise.all([
    prisma.mention.findMany({ where, orderBy, take: exportLimit }),
    prisma.mention.findMany({
      where: {
        queryId,
        OR: [{ publishedAt: { gte: since } }, { createdAt: { gte: since } }],
      },
      select: {
        sentiment: true,
        score: true,
        platform: true,
        publishedAt: true,
        createdAt: true,
        themes: true,
      },
    }),
    prisma.scanRun.findMany({
      where: { queryId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const total = allForStats.length;
  const positive = allForStats.filter((m) => m.sentiment === "positive").length;
  const negative = allForStats.filter((m) => m.sentiment === "negative").length;
  const neutral = allForStats.filter((m) => m.sentiment === "neutral").length;
  const avgScore = total
    ? Number((allForStats.reduce((s, m) => s + m.score, 0) / total).toFixed(3))
    : 0;

  const byPlatform: Record<string, number> = {};
  for (const m of allForStats) {
    byPlatform[m.platform] = (byPlatform[m.platform] || 0) + 1;
  }

  const themeFreq = new Map<string, number>();
  for (const m of allForStats) {
    try {
      const themes = JSON.parse(m.themes || "[]") as string[];
      for (const t of themes) themeFreq.set(t, (themeFreq.get(t) || 0) + 1);
    } catch {
      /* ignore */
    }
  }
  const topThemes = [...themeFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([theme, count]) => ({ theme, count }));

  const daysList = eachDayOfInterval({ start: since, end: new Date() });
  const volume = daysList.map((day) => {
    const key = format(day, "yyyy-MM-dd");
    const dayMentions = allForStats.filter((m) => {
      const d = m.publishedAt || m.createdAt;
      return format(d, "yyyy-MM-dd") === key;
    });
    return {
      date: key,
      total: dayMentions.length,
      positive: dayMentions.filter((m) => m.sentiment === "positive").length,
      negative: dayMentions.filter((m) => m.sentiment === "negative").length,
      neutral: dayMentions.filter((m) => m.sentiment === "neutral").length,
    };
  });

  if (exportCsv) {
    const reviewsOnly = platform === "google_reviews";
    const header = reviewsOnly
      ? ["author", "rating", "text", "date"]
      : ["platform", "title", "author", "rating", "sentiment", "score", "publishedAt", "url", "text"];

    const lines = [
      header.join(","),
      ...mentions.map((m) => {
        let rating = "";
        try {
          const raw = JSON.parse(m.rawPayload || "{}") as { rating?: number | null };
          if (typeof raw.rating === "number") rating = String(raw.rating);
        } catch {
          /* ignore */
        }
        // Başlıktan ★ sayısı yedek
        if (!rating && m.title) {
          const stars = (m.title.match(/★/g) || []).length;
          if (stars > 0) rating = String(stars);
        }
        // text alanından "Google yorum · ...\n\n" önekini temizle
        let body = m.text || "";
        if (reviewsOnly) {
          body = body.replace(/^Google yorum[^\n]*\n+/i, "").trim();
        }
        const date =
          m.publishedAt?.toISOString().slice(0, 10) ||
          m.createdAt.toISOString().slice(0, 10);

        if (reviewsOnly) {
          return [csv(m.author || ""), rating, csv(body), date].join(",");
        }
        return [
          m.platform,
          csv(m.title || ""),
          csv(m.author || ""),
          rating,
          m.sentiment,
          m.score,
          m.publishedAt?.toISOString() || "",
          csv(m.url || ""),
          csv(m.text),
        ].join(",");
      }),
    ];

    const filename = reviewsOnly
      ? `google-yorumlar-${queryId}.csv`
      : `brand-pulse-${queryId}.csv`;
    // Excel TR için UTF-8 BOM
    const bom = "\uFEFF";
    return new Response(bom + lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    mentions,
    scans: scans.map((s) => ({
      ...s,
      sourcesChecked: JSON.parse(s.sourcesChecked || "[]"),
    })),
    stats: {
      total,
      positive,
      negative,
      neutral,
      avgScore,
      positiveRate: total ? Number(((positive / total) * 100).toFixed(1)) : 0,
      negativeRate: total ? Number(((negative / total) * 100).toFixed(1)) : 0,
      byPlatform,
      topThemes,
      volume,
      days,
    },
  });
}

function csv(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
