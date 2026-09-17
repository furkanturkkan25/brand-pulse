import { entityTitleBias, type EntityType } from "./entityTypes";
import { compactTr, normalizeTr } from "./text";

export type SentimentResult = {
  sentiment: "positive" | "negative" | "neutral";
  score: number;
};

/** Kelime ağırlıkları (−2…+2) — haber / işletme / eğlence dili */
const LEXICON: Record<string, number> = {
  // pozitif
  harika: 2, mukemmel: 2, muhtesem: 2, enfes: 2, basarili: 1.5, basari: 1.2,
  guzel: 1.2, iyi: 1, kaliteli: 1.5, profesyonel: 1.2, guvenilir: 1.5, guvenli: 1.3,
  memnun: 1.5, memnuniyet: 1.5, tavsiye: 1.4, begendim: 1.5, sevilen: 1.2, sevildi: 1.2,
  buyume: 1.2, buyuyor: 1.2, yatirim: 1, acildi: 0.8, acilis: 0.8, kutlama: 1,
  odul: 1.3, odullu: 1.3, lider: 1.2, oncu: 1.2, yenilik: 1, yenilikci: 1.2,
  egilence: 1, eglence: 1, eglenceli: 1.4, heyecan: 1, heyecanli: 1.2, mutlu: 1.3, keyif: 1.2,
  keyifli: 1.3, olumlu: 1.3, pozitif: 1.3, destek: 0.8, tesekkur: 1.2, tesekkurler: 1.2,
  rekor: 1.2, zirve: 1.1, guclendi: 1.1, guclenen: 1, gelisim: 1, gelisiyor: 1,
  modern: 0.7, konforlu: 1.1, temiz: 0.9, duzenli: 0.8, ilgili: 0.9, ozenli: 1.1,
  awesome: 2, great: 1.3, excellent: 2, amazing: 2, love: 1.5, perfect: 2,
  recommend: 1.4, best: 1.5, wonderful: 1.8, fantastic: 1.8, success: 1.3,
  successful: 1.4, growth: 1, award: 1.2, safe: 1, fun: 1.2, happy: 1.3,

  // negatif
  kotu: -1.5, berbat: -2, rezalet: -2, korkunc: -2, igrenc: -2, vasat: -1.2,
  sikayet: -1.5, sikayetci: -1.3, pisman: -1.5, begenmedim: -1.5, hayal: -0.5,
  kiriklik: -1.2, sorun: -1.2, problem: -1.2, hata: -1, ariza: -1.3, tehlike: -1.5,
  tehlikeli: -1.6, kaza: -1.8, yaralandi: -1.8, oldu: -0.3, olum: -2, olumlu_degil: -1,
  tutuklama: -1.6, tutuklandi: -1.7, saldiri: -1.8, siddet: -1.7, dolandirici: -2,
  sahte: -1.6, skandal: -1.8, kriz: -1.4, iflas: -1.8, zarara: -1.3, zarar: -1.2,
  gecikti: -1, yavas: -1, pahali: -1, ilgisiz: -1.2, kaba: -1.4, ihmal: -1.5,
  eksik: -0.9, yetersiz: -1.2, kotuleme: -1.3, elestiri: -0.8, olumsuz: -1.4,
  negatif: -1.3, endise: -1, tepki: -0.9, ofke: -1.4, magdur: -1.5, magduriyet: -1.5,
  kuyruk: -0.6, kalabalik: -0.4, sikinti: -1.2, sikintili: -1.2, yasak: -1,
  iptal: -1.1, kapandi: -1, kapali: -0.7, awful: -2, terrible: -2, hate: -1.8,
  worst: -2, bad: -1.3, scam: -2, fraud: -2, accident: -1.7, injury: -1.6,
  complaint: -1.4, poor: -1.3, dangerous: -1.6, fail: -1.4, failed: -1.4,
};

const PHRASES: Array<{ p: string; w: number }> = [
  { p: "hayal kirikligi", w: -1.8 },
  { p: "hayal kırıklığı", w: -1.8 },
  { p: "cok memnun", w: 1.6 },
  { p: "cok guzel", w: 1.5 },
  { p: "cok iyi", w: 1.4 },
  { p: "cok kotu", w: -1.7 },
  { p: "kesinlikle tavsiye", w: 1.7 },
  { p: "asla tavsiye", w: -1.8 },
  { p: "tavsiye ederim", w: 1.5 },
  { p: "tavsiye etmem", w: -1.6 },
  { p: "guvenli egilence", w: 1.3 },
  { p: "guvenli eğlence", w: 1.3 },
  { p: "olumlu karsilandi", w: 1.4 },
  { p: "tepki cekti", w: -1.2 },
  { p: "tepki çekti", w: -1.2 },
  { p: "buyuk basari", w: 1.6 },
  { p: "buyuk basari", w: 1.6 },
  { p: "yogun ilgi", w: 1.2 },
  { p: "yogun talep", w: 1.1 },
  { p: "siddetli elestiri", w: -1.5 },
  { p: "agir yaralandi", w: -1.9 },
  { p: "gozaltina alindi", w: -1.6 },
  { p: "sorusturma baslatildi", w: -1.3 },
  { p: "rekor kirildi", w: 1.3 },
  { p: "yeni yatirim", w: 1.1 },
  { p: "acilis yapildi", w: 0.9 },
  { p: "kutlandi", w: 1.0 },
  { p: "magdur oldu", w: -1.5 },
  { p: "sikayet yagdi", w: -1.6 },
  { p: "olumsuz yorum", w: -1.4 },
  { p: "olumlu yorum", w: 1.4 },
];

const NEGATORS = new Set([
  "degil", "değil", "yok", "asla", "hic", "hiç", "no", "not", "never", "olmayan", "olmadi", "olmadı",
]);
const INTENSIFIERS = new Set(["cok", "çok", "asiri", "aşırı", "oldukca", "oldukça", "son derece", "gayet"]);

function decodeLight(text: string) {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function splitSentences(text: string): string[] {
  return decodeLight(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

function scoreSpan(text: string): { score: number; hits: number } {
  const norm = normalizeTr(text);
  if (!norm) return { score: 0, hits: 0 };

  let score = 0;
  let hits = 0;

  for (const { p, w } of PHRASES) {
    const pn = normalizeTr(p);
    if (pn && norm.includes(pn)) {
      score += w;
      hits += 1;
    }
  }

  const tokens = norm.split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const w = LEXICON[t];
    if (w === undefined) continue;

    const prev = tokens[i - 1];
    const prev2 = tokens.slice(Math.max(0, i - 2), i).join(" ");
    const negated =
      (prev && NEGATORS.has(prev)) ||
      NEGATORS.has(prev2) ||
      (prev === "degil" || prev === "değil");

    let val = w;
    if (prev && INTENSIFIERS.has(prev)) val *= 1.35;
    if (negated) val *= -1;

    score += val;
    hits += 1;
  }

  return { score, hits };
}

function sentenceMentionsBrand(sentence: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = normalizeTr(sentence);
  const compact = compactTr(sentence);
  for (const k of keywords) {
    const n = normalizeTr(k);
    if (!n || n.length < 3) continue;
    if (n.includes(" ")) {
      if (hay.includes(n) || compact.includes(n.replace(/\s+/g, ""))) return true;
    } else if (n.length >= 6) {
      if (hay.includes(n) || compact.includes(n)) return true;
    } else if (new RegExp(`(?:^|\\s)${n}(?:\\s|$)`).test(hay)) {
      return true;
    }
  }
  return false;
}

function finalize(rawScore: number, hits: number): SentimentResult {
  if (hits === 0) return { sentiment: "neutral", score: 0 };
  // hits ile normalize et ama aşırı nötrleştirmeyi azalt
  const avg = rawScore / Math.sqrt(hits);
  const score = Number(Math.max(-1, Math.min(1, avg / 2.2)).toFixed(3));
  let sentiment: SentimentResult["sentiment"] = "neutral";
  if (score >= 0.15) sentiment = "positive";
  else if (score <= -0.15) sentiment = "negative";
  return { sentiment, score };
}

/** Genel metin (yorum / kısa metin) */
export function analyzeSentiment(text: string): SentimentResult {
  const { score, hits } = scoreSpan(text);
  if (hits === 0) {
    if (/[❤️😍👍✅🎉]/u.test(text)) return { sentiment: "positive", score: 0.4 };
    if (/[😡🤬👎❌💩]/u.test(text)) return { sentiment: "negative", score: -0.4 };
  }
  return finalize(score, hits);
}

/**
 * Haber için: başlık + markanın geçtiği cümleler ağırlıklı.
 * Tam gövde okunur; özetten bağımsız skorlanır.
 */
export function analyzeNewsSentiment(
  title: string,
  body: string,
  keywords: string[] = [],
  entityType: EntityType = "company"
): SentimentResult {
  const titleScore = scoreSpan(title);
  // Başlık 2.2x
  let total = titleScore.score * 2.2;
  let hits = titleScore.hits * 2;

  const sentences = splitSentences(body);
  const brandSentences = sentences.filter((s) => sentenceMentionsBrand(s, keywords));
  const focus = brandSentences.length > 0 ? brandSentences : sentences.slice(0, 12);

  for (const s of focus) {
    const r = scoreSpan(s);
    const w = brandSentences.includes(s) ? 1.6 : 1;
    total += r.score * w;
    hits += r.hits * w;
  }

  const tNorm = normalizeTr(title);
  const bias = entityTitleBias(tNorm, entityType);
  if (bias !== 0) {
    total += bias;
    hits += 1;
  }

  const result = finalize(total, Math.max(hits, 0.01));
  if (hits < 0.8 && Math.abs(result.score) < 0.2) {
    return { sentiment: "neutral", score: 0 };
  }
  return result;
}
