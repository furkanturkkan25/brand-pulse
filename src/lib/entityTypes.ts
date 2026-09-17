export type EntityType = "company" | "person" | "influencer" | "actor" | "athlete";

export const ENTITY_TYPES: Array<{
  id: EntityType;
  label: string;
  hint: string;
  color: string;
}> = [
  {
    id: "company",
    label: "Şirket / marka",
    hint: "İşletme, marka, AVM, park — haber, yatırım, şikayet odaklı",
    color: "#0f6e56",
  },
  {
    id: "influencer",
    label: "Sosyal medya fenomeni",
    hint: "YouTuber, TikTok, Instagram — kimdir, trend, skandal odaklı",
    color: "#5b3d8a",
  },
  {
    id: "actor",
    label: "Oyuncu",
    hint: "Dizi / film oyuncusu — rol, proje, gündem odaklı",
    color: "#1d4e89",
  },
  {
    id: "athlete",
    label: "Sporcu",
    hint: "Futbolcu / sporcu — maç, transfer, performans odaklı",
    color: "#0e7490",
  },
  {
    id: "person",
    label: "Şahıs",
    hint: "Genel kişi / kamu figürü — kimdir, açıklama, gündem",
    color: "#7a5c12",
  },
];

export function isEntityType(v: unknown): v is EntityType {
  return ENTITY_TYPES.some((t) => t.id === v);
}

export function entityLabel(type: string | null | undefined) {
  return ENTITY_TYPES.find((t) => t.id === type)?.label || "Şirket / marka";
}

function quote(term: string) {
  const t = term.trim().replace(/^@+/, "");
  if (!t) return "";
  return `"${t}"`;
}

function cleanTerm(term: string) {
  return term.trim().replace(/^@+/, "");
}

/** Türe göre haber arama sorguları */
export function buildNewsQueriesForType(brand: string, entityType: EntityType = "company") {
  const t = cleanTerm(brand);
  if (!t || t.length < 3) return [];
  const q = quote(t);
  const base = [
    q,
    t,
    `${q} haber`,
    `${t} haber`,
    `${q} when:7d`,
    `${q} when:30d`,
    `${q} when:1y`,
    `${t} news`,
  ];

  const extra: Record<EntityType, string[]> = {
    company: [
      `${q} Türkiye`,
      `${q} yatirim`,
      `${t} şikayet`,
      `${t} acilis`,
      `${q} marka`,
      `${t} hisse`,
      `${t} stock`,
      `${q} recall`,
      `${t} delivery`,
      `${t} fiyat`,
      `${t} lunapark`,
      `${t} temapark`,
    ],
    influencer: [`${q} kimdir`, `${t} youtube`, `${t} tiktok`, `${q} skandal`, `${t} aciklama`],
    actor: [`${q} dizi`, `${t} film`, `${q} rol`, `${t} set`, `${q} kimdir`],
    athlete: [`${q} transfer`, `${t} mac`, `${q} gol`, `${t} milli`, `${q} sakatlik`],
    person: [`${q} kimdir`, `${t} aciklama`, `${q} gundem`, `${t} sozleri`, `${q} when:1y`],
  };

  return [...new Set([...base, ...extra[entityType]])].filter((x) => x.length > 3);
}

/** Türe göre web / forum aramaları */
export function buildWebQueriesForType(brand: string, entityType: EntityType = "company") {
  const t = cleanTerm(brand);
  if (!t || t.length < 3) return [];
  const q = quote(t);
  const base = [q, t, `${q} kimdir`, `${t} site:eksisozluk.com`, `${t} news`];

  const extra: Record<EntityType, string[]> = {
    company: [
      `${t} yorum`,
      `${t} şikayet`,
      `${q} review`,
      `${t} site:sikayetvar.com`,
      `${t} site:reddit.com`,
    ],
    influencer: [`${t} youtube`, `${t} instagram`, `${q} fenomen`, `${t} tiktok`],
    actor: [`${t} dizi`, `${t} filmografi`, `${q} oyuncu`, `${t} imdb`],
    athlete: [`${t} transfer`, `${t} istatistik`, `${q} futbolcu`, `${t} mac`],
    person: [`${t} biyografi`, `${t} kimdir`, `${q} haberleri`],
  };

  return [...new Set([...base, ...extra[entityType]])];
}

/** Başlıkta türe özel duygu ipuçları */
export function entityTitleBias(titleNorm: string, entityType: EntityType): number {
  if (entityType === "company") {
    if (/acildi|acilis|kutladi|odul|yatirim|buyume|rekor/.test(titleNorm)) return 1.2;
    if (/kaza|saldiri|tutuklama|sikayet|skandal|olum|yaraland|iflas/.test(titleNorm)) return -1.8;
  }
  if (entityType === "influencer" || entityType === "person") {
    if (/odul|rekor|basari|trend|isbirligi|anlasma/.test(titleNorm)) return 1.1;
    if (/skandal|taciz|sikayet|tutuklama|iftira|linç|linc|ozur/.test(titleNorm)) return -1.7;
  }
  if (entityType === "actor") {
    if (/odul|basrol|gise|rekor|projeye/.test(titleNorm)) return 1.2;
    if (/skandal|yasak|iptal|kovuldu|taciz/.test(titleNorm)) return -1.6;
  }
  if (entityType === "athlete") {
    if (/gol|sampiyon|transfer|rekor|milli|kariyer/.test(titleNorm)) return 1.2;
    if (/sakatlik|kirmizi|ceza|doping|skandal/.test(titleNorm)) return -1.5;
  }
  return 0;
}

export function keywordPlaceholder(entityType: EntityType) {
  const map: Record<EntityType, string> = {
    company: "Örn: Dal Lunapark, Dal Rides, Dino Lino",
    influencer: "Örn: Uberkuloz, uberkuloz, Berk Keklik",
    actor: "Örn: ad soyad, dizi adı (opsiyonel)",
    athlete: "Örn: ad soyad, kulüp (opsiyonel)",
    person: "Örn: ad soyad, bilinen unvan",
  };
  return map[entityType];
}
