import { prisma } from "./db";
import { parseKeywords } from "./text";

export type BrandKitPayload = {
  perception: string[];
  toneOfVoice: string[];
  messaging: {
    promise: string;
    pillars: string[];
    proof: string[];
  };
  avoid: string[];
  brief: string;
  sampleHeadlines: string[];
};

type RadarContext = {
  name: string;
  entityType: string;
  keywords: string[];
  total: number;
  positiveRate: number;
  negativeRate: number;
  avgScore: number;
  topThemes: { theme: string; count: number }[];
  byPlatform: Record<string, number>;
  positiveTitles: string[];
  negativeTitles: string[];
  neutralTitles: string[];
  /** Google / müşteri yorumları */
  reviews: {
    count: number;
    avgRating: number | null;
    positiveRate: number;
    negativeRate: number;
    positiveExcerpts: string[];
    negativeExcerpts: string[];
  };
};

function cleanReviewBody(text: string) {
  return text
    .replace(/^Google yorum[^\n]*\n*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ratingFromMention(rawPayload: string | null | undefined, title: string | null | undefined) {
  try {
    const raw = JSON.parse(rawPayload || "{}") as { rating?: number | null };
    if (typeof raw.rating === "number") return raw.rating;
  } catch {
    /* ignore */
  }
  const stars = (title || "").match(/★/g);
  return stars?.length ? stars.length : null;
}

export async function buildRadarContext(queryId: string): Promise<RadarContext | null> {
  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) return null;

  // Haber/sosyal örneklem + TÜM Google yorumları (yorumlar branding için kritik)
  const [newsSample, reviewRows] = await Promise.all([
    prisma.mention.findMany({
      where: { queryId, NOT: { platform: "google_reviews" } },
      orderBy: { createdAt: "desc" },
      take: 350,
      select: {
        title: true,
        text: true,
        sentiment: true,
        score: true,
        platform: true,
        themes: true,
        rawPayload: true,
      },
    }),
    prisma.mention.findMany({
      where: { queryId, platform: "google_reviews" },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        title: true,
        text: true,
        sentiment: true,
        score: true,
        platform: true,
        themes: true,
        rawPayload: true,
      },
    }),
  ]);

  const mentions = [...reviewRows, ...newsSample];
  const total = mentions.length;
  const positive = mentions.filter((m) => m.sentiment === "positive");
  const negative = mentions.filter((m) => m.sentiment === "negative");
  const neutral = mentions.filter((m) => m.sentiment === "neutral");
  const avgScore = total
    ? Number((mentions.reduce((s, m) => s + m.score, 0) / total).toFixed(3))
    : 0;

  const byPlatform: Record<string, number> = {};
  const themeFreq = new Map<string, number>();
  for (const m of mentions) {
    byPlatform[m.platform] = (byPlatform[m.platform] || 0) + 1;
    try {
      for (const t of JSON.parse(m.themes || "[]") as string[]) {
        themeFreq.set(t, (themeFreq.get(t) || 0) + 1);
      }
    } catch {
      /* ignore */
    }
  }

  const topThemes = [...themeFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([theme, count]) => ({ theme, count }));

  const pickTitles = (rows: typeof mentions, n: number) =>
    rows
      .filter((m) => m.platform !== "google_reviews")
      .map((m) => (m.title || m.text || "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 12)
      .slice(0, n);

  const reviewPos = reviewRows.filter((m) => m.sentiment === "positive");
  const reviewNeg = reviewRows.filter((m) => m.sentiment === "negative");
  const ratings = reviewRows
    .map((m) => ratingFromMention(m.rawPayload, m.title))
    .filter((n): n is number => typeof n === "number");
  const avgRating = ratings.length
    ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
    : null;

  const pickReviewExcerpts = (rows: typeof reviewRows, n: number) =>
    rows
      .map((m) => cleanReviewBody(m.text || ""))
      .filter((t) => t.length > 20)
      .slice(0, n)
      .map((t) => (t.length > 160 ? `${t.slice(0, 160)}…` : t));

  return {
    name: query.name,
    entityType: query.entityType || "company",
    keywords: parseKeywords(query.keywords),
    total,
    positiveRate: total ? Math.round((positive.length / total) * 100) : 0,
    negativeRate: total ? Math.round((negative.length / total) * 100) : 0,
    avgScore,
    topThemes,
    byPlatform,
    positiveTitles: pickTitles(positive, 8),
    negativeTitles: pickTitles(negative, 8),
    neutralTitles: pickTitles(neutral, 5),
    reviews: {
      count: reviewRows.length,
      avgRating,
      positiveRate: reviewRows.length
        ? Math.round((reviewPos.length / reviewRows.length) * 100)
        : 0,
      negativeRate: reviewRows.length
        ? Math.round((reviewNeg.length / reviewRows.length) * 100)
        : 0,
      positiveExcerpts: pickReviewExcerpts(reviewPos, 6),
      negativeExcerpts: pickReviewExcerpts(reviewNeg, 6),
    },
  };
}

function heuristicKit(ctx: RadarContext): BrandKitPayload {
  const themes = ctx.topThemes.map((t) => t.theme).slice(0, 5);
  const themeLine = themes.length ? themes.join(", ") : "genel gündem";
  const mood =
    ctx.positiveRate >= ctx.negativeRate + 10
      ? "ağırlıklı olumlu"
      : ctx.negativeRate >= ctx.positiveRate + 10
        ? "risk ve eleştiri baskın"
        : "karışık / nötr";

  const r = ctx.reviews;
  const reviewMood =
    r.count === 0
      ? null
      : r.positiveRate >= r.negativeRate + 15
        ? "müşteri yorumları genel olarak olumlu"
        : r.negativeRate >= r.positiveRate + 15
          ? "müşteri yorumlarında şikayet baskın"
          : "müşteri yorumları karışık";

  const perception = [
    `${ctx.name} kamuoyunda şu an ${mood} bir algıya sahip (pozitif %${ctx.positiveRate}, negatif %${ctx.negativeRate}, ${ctx.total} bahis).`,
    r.count
      ? `Google / müşteri yorumu: ${r.count} adet` +
        (r.avgRating != null ? `, ortalama ${r.avgRating}/5` : "") +
        ` · pozitif %${r.positiveRate}, negatif %${r.negativeRate}` +
        (reviewMood ? ` — ${reviewMood}.` : ".")
      : "Henüz Google/müşteri yorumu yüklenmemiş; yorum eklemek branding kalitesini yükseltir.",
    themes.length
      ? `Öne çıkan temalar: ${themeLine}.`
      : "Henüz net tema kümesi oluşmamış; daha fazla tarama önerilir.",
    r.positiveExcerpts[0]
      ? `Olumlu müşteri yorumu: “${r.positiveExcerpts[0]}”.`
      : ctx.positiveTitles[0]
        ? `Olumlu gündem örneği: “${ctx.positiveTitles[0].slice(0, 120)}”.`
        : "Olumlu örnek henüz yok.",
    r.negativeExcerpts[0]
      ? `Dikkat: müşteri şikayeti — “${r.negativeExcerpts[0]}”.`
      : ctx.negativeTitles[0]
        ? `Dikkat gerektiren başlık: “${ctx.negativeTitles[0].slice(0, 120)}”.`
        : "Belirgin negatif örnek yok.",
    `Kaynak dağılımı: ${
      Object.entries(ctx.byPlatform)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k} (${v})`)
        .join(", ") || "—"
    }.`,
  ];

  const toneOfVoice = [
    "Net ve özgüvenli; abartılı süperlatiflerden kaçın.",
    r.count && r.negativeRate >= 30
      ? "Müşteri şikayetlerine açık, sakin ve çözüm odaklı dil kullan (bekleme, personel, kayıp eşya vb.)."
      : mood.includes("risk")
        ? "Eleştiriye açık, sakin ve çözüm odaklı dil kullan."
        : "Başarıyı somut kanıtlarla anlat; sloganı boş bırakma.",
    "Türkçe gündemde anlaşılır, jargon-light bir üslup tercih et.",
    "İnsan ve deneyim odaklı cümleler kur; sadece özellik listesi yapma.",
    r.count
      ? "İletişimde gerçek ziyaretçi deneyimini (yorumları) kanıt olarak kullan."
      : ctx.entityType === "company"
        ? "Markayı kurumsal ama samimi konumlandır."
        : "Kişisel güven ve tutarlılık vurgula.",
  ];

  const promise =
    ctx.entityType === "company"
      ? r.count && r.avgRating != null && r.avgRating >= 4
        ? `${ctx.name}: aileler için güvenilir ve keyifli deneyim.`
        : r.count && (r.avgRating == null || r.avgRating < 3.5)
          ? `${ctx.name}: deneyimi iyileştiren, şeffaf ve misafir odaklı marka.`
          : `${ctx.name}: güvenilir deneyim ve seçilebilir kalite.`
      : `${ctx.name}: güvenilir, tutarlı ve gündemde güçlü bir isim.`;

  const pillars =
    themes.length >= 3
      ? themes.slice(0, 3).map((t) => `${t} alanında net duruş`)
      : r.count
        ? ["Misafir deneyimi", "Güven ve şeffaflık", "Aile / çocuk odaklı eğlence"]
        : ["Güven ve şeffaflık", "Somut fayda", "Tutarlı iletişim"];

  const proof = [
    ...r.positiveExcerpts.slice(0, 2).map((t) => `Müşteri yorumu: ${t}`),
    ...ctx.positiveTitles.slice(0, 2).map((t) => `Medya/kanıt: ${t.slice(0, 100)}`),
    r.count && r.avgRating != null
      ? `Google yorum ort.: ${r.avgRating}/5 (${r.count} yorum)`
      : `Radar skoru ort.: ${ctx.avgScore} · pozitif oran %${ctx.positiveRate}`,
  ].slice(0, 4);

  const avoid = [
    r.negativeExcerpts.length
      ? "Müşteri şikayetlerini yok saymak veya savunmacı sert üslup"
      : mood.includes("risk")
        ? "Negatif gündemi yok saymak veya savunmacı sert üslup"
        : "Kanıtsız ‘en iyi / bir numara’ iddiaları",
    "Rakibi aşağılayan veya spekülatif kriz dili",
    r.count
      ? "Yorumlardaki operasyon sorunlarını (kuyruk, personel, kayıp) gizleyip abartılı vaat vermek"
      : "Anahtar kelime doldurma ve yapay slogan yığını",
  ];

  const brief = [
    `# ${ctx.name} — Branding brief`,
    "",
    `## Durum`,
    perception[0],
    perception[1],
    themes.length ? `Temalar: ${themeLine}` : "",
    "",
    `## Müşteri yorumları`,
    r.count
      ? `${r.count} yorum` +
        (r.avgRating != null ? ` · ort. ${r.avgRating}/5` : "") +
        ` · +%${r.positiveRate} / −%${r.negativeRate}`
      : "Yorum verisi yok — CSV veya Places ile ekleyin.",
    ...r.positiveExcerpts.slice(0, 2).map((t) => `- (+) ${t}`),
    ...r.negativeExcerpts.slice(0, 2).map((t) => `- (−) ${t}`),
    "",
    `## Hedef`,
    `Markayı ${
      (r.count && r.negativeRate >= 30) || mood.includes("risk")
        ? "güveni onaracak ve misafir deneyimini netleştirecek"
        : "olumlu algıyı güçlendirecek"
    } bir konumlandırmaya oturtmak.`,
    "",
    `## Ana vaat`,
    promise,
    "",
    `## Mesaj direkleri`,
    ...pillars.map((p, i) => `${i + 1}. ${p}`),
    "",
    `## Ton`,
    ...toneOfVoice.map((t) => `- ${t}`),
    "",
    `## Kaçınılacaklar`,
    ...avoid.map((a) => `- ${a}`),
    "",
    `## Kanıt`,
    ...proof.map((p) => `- ${p}`),
  ]
    .filter(Boolean)
    .join("\n");

  const sampleHeadlines = [
    `${ctx.name}: ${pillars[0] || "net vaat"}`,
    r.count && r.negativeRate >= 30
      ? `${ctx.name}: misafir deneyiminde şeffaflık`
      : `${ctx.name} ile farkı somutlaştır`,
    themes[0] ? `${ctx.name} × ${themes[0]}` : `${ctx.name} yeni dönem`,
  ];

  return {
    perception,
    toneOfVoice,
    messaging: { promise, pillars, proof },
    avoid,
    brief,
    sampleHeadlines,
  };
}

async function generateWithOpenAI(ctx: RadarContext): Promise<BrandKitPayload | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const prompt = {
    role: "user" as const,
    content: `Sen bir marka stratejisti ve copywriter'sın. Türkçe yaz.
Aşağıdaki RADAR verisine dayanarak JSON üret. Sadece JSON döndür, markdown yok.

ZORUNLU: "reviews" alanı doluysa (count > 0) algı, vaat, kanıt, kaçınılacaklar ve brief içinde mutlaka Google/müşteri yorumlarını kullan.
Olumlu ve olumsuz yorum alıntılarından en az birer madde geçir.

Şema:
{
  "perception": string[5-7],
  "toneOfVoice": string[5],
  "messaging": { "promise": string, "pillars": string[3], "proof": string[3-4] },
  "avoid": string[3],
  "brief": string (markdown brief, 1400 karakteri geçmesin; "Müşteri yorumları" başlığı olsun),
  "sampleHeadlines": string[3]
}

RADAR:
${JSON.stringify(ctx, null, 2)}`,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Marka itibarı ve branding kitleri üretirsin. Haber + Google müşteri yorumlarını birlikte kullan. Abartma, veriye dayan, Türkçe yaz.",
        },
        prompt,
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI hatası: ${res.status} ${err.slice(0, 180)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw) as BrandKitPayload;
  if (!parsed.perception?.length || !parsed.messaging?.promise) {
    throw new Error("OpenAI yanıtı eksik");
  }
  return {
    perception: parsed.perception.slice(0, 8),
    toneOfVoice: (parsed.toneOfVoice || []).slice(0, 8),
    messaging: {
      promise: parsed.messaging.promise,
      pillars: (parsed.messaging.pillars || []).slice(0, 5),
      proof: (parsed.messaging.proof || []).slice(0, 5),
    },
    avoid: (parsed.avoid || []).slice(0, 6),
    brief: String(parsed.brief || ""),
    sampleHeadlines: (parsed.sampleHeadlines || []).slice(0, 5),
  };
}

export async function generateBrandKit(queryId: string) {
  const ctx = await buildRadarContext(queryId);
  if (!ctx) throw new Error("Sorgu bulunamadı");
  if (ctx.total === 0) {
    throw new Error("Önce derin tarama yapın veya Google yorumu ekleyin; branding için veri gerekli.");
  }

  let kit: BrandKitPayload;
  let provider = "heuristic";
  try {
    const llm = await generateWithOpenAI(ctx);
    if (llm) {
      kit = llm;
      provider = "openai";
    } else {
      kit = heuristicKit(ctx);
    }
  } catch (err) {
    kit = heuristicKit(ctx);
    provider = `heuristic_fallback:${err instanceof Error ? err.message.slice(0, 80) : "error"}`;
  }

  const last = await prisma.brandKit.findFirst({
    where: { queryId },
    orderBy: { version: "desc" },
  });
  const version = (last?.version || 0) + 1;

  const row = await prisma.brandKit.create({
    data: {
      queryId,
      version,
      perception: JSON.stringify(kit.perception),
      toneOfVoice: JSON.stringify(kit.toneOfVoice),
      messaging: JSON.stringify(kit.messaging),
      brief: kit.brief,
      avoid: JSON.stringify(kit.avoid),
      sampleHeadlines: JSON.stringify(kit.sampleHeadlines),
      sourceStats: JSON.stringify({
        total: ctx.total,
        positiveRate: ctx.positiveRate,
        negativeRate: ctx.negativeRate,
        avgScore: ctx.avgScore,
        topThemes: ctx.topThemes,
        byPlatform: ctx.byPlatform,
        reviews: ctx.reviews,
      }),
      provider: provider.startsWith("heuristic") ? "heuristic" : "openai",
    },
  });

  return serializeBrandKit(row);
}

export function serializeBrandKit(row: {
  id: string;
  queryId: string;
  version: number;
  perception: string;
  toneOfVoice: string;
  messaging: string;
  brief: string;
  avoid: string;
  sampleHeadlines: string;
  sourceStats: string;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    queryId: row.queryId,
    version: row.version,
    perception: JSON.parse(row.perception || "[]"),
    toneOfVoice: JSON.parse(row.toneOfVoice || "[]"),
    messaging: JSON.parse(row.messaging || "{}"),
    brief: row.brief,
    avoid: JSON.parse(row.avoid || "[]"),
    sampleHeadlines: JSON.parse(row.sampleHeadlines || "[]"),
    sourceStats: JSON.parse(row.sourceStats || "{}"),
    provider: row.provider,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
