"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";

type Query = {
  id: string;
  name: string;
  keywords: string[];
  entityType?: string;
  color: string;
  _count: { mentions: number; scans: number };
  scans: { status: string; saved: number; createdAt: string }[];
};

type Mention = {
  id: string;
  platform: string;
  author: string | null;
  title: string | null;
  text: string;
  url: string | null;
  publishedAt: string | null;
  sentiment: string;
  score: number;
  themes: string;
};

type Stats = {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  avgScore: number;
  positiveRate: number;
  negativeRate: number;
  byPlatform: Record<string, number>;
  topThemes: { theme: string; count: number }[];
  volume: { date: string; total: number; positive: number; negative: number; neutral: number }[];
};

type BrandKitView = {
  id: string;
  version: number;
  perception: string[];
  toneOfVoice: string[];
  messaging: { promise: string; pillars: string[]; proof: string[] };
  avoid: string[];
  brief: string;
  sampleHeadlines: string[];
  sourceStats: {
    total?: number;
    positiveRate?: number;
    negativeRate?: number;
    avgScore?: number;
    reviews?: {
      count?: number;
      avgRating?: number | null;
      positiveRate?: number;
      negativeRate?: number;
    };
  };
  provider: string;
  createdAt: string;
};

const PIE_COLORS = {
  positive: "#1b7a4a",
  negative: "#b43a32",
  neutral: "#667585",
};

const ENTITY_OPTIONS = [
  { id: "company", label: "Şirket / marka", hint: "İşletme, park, AVM…" },
  { id: "influencer", label: "Sosyal medya fenomeni", hint: "YouTube, TikTok, Instagram" },
  { id: "actor", label: "Oyuncu", hint: "Dizi / film" },
  { id: "athlete", label: "Sporcu", hint: "Futbolcu / sporcu" },
  { id: "person", label: "Şahıs", hint: "Genel kişi / kamu figürü" },
] as const;

const ENTITY_LABEL: Record<string, string> = Object.fromEntries(
  ENTITY_OPTIONS.map((e) => [e.id, e.label])
);

const KW_PLACEHOLDER: Record<string, string> = {
  company: "Örn: Dal Lunapark, Dal Rides, Dino Lino",
  influencer: "Örn: Uberkuloz, uberkuloz, Berk Keklik",
  actor: "Örn: ad soyad, bilinen dizi",
  athlete: "Örn: ad soyad, kulüp",
  person: "Örn: ad soyad, unvan",
};

async function readJson<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [queries, setQueries] = useState<Query[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scans, setScans] = useState<Array<{ id: string; status: string; saved: number; urlsFound: number; pagesFetched: number; sourcesChecked: string[]; durationMs: number; createdAt: string }>>([]);
  const [sentiment, setSentiment] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [days, setDays] = useState("365");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [entityType, setEntityType] = useState<string>("company");
  const [reviewPaste, setReviewPaste] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [placesConfigured, setPlacesConfigured] = useState(false);
  const [editName, setEditName] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [mainTab, setMainTab] = useState<"radar" | "branding">("radar");
  const [brandKit, setBrandKit] = useState<BrandKitView | null>(null);
  const [brandKitMeta, setBrandKitMeta] = useState<{ openaiConfigured: boolean; versions: number }>({
    openaiConfigured: false,
    versions: 0,
  });
  const [brandBusy, setBrandBusy] = useState(false);

  const selected = queries.find((x) => x.id === selectedId) || null;

  useEffect(() => {
    if (!selected) {
      setEditName("");
      setEditKeywords("");
      return;
    }
    setEditName(selected.name);
    setEditKeywords((selected.keywords || []).join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.name, (selected?.keywords || []).join("|")]);

  async function loadQueries() {
    try {
      const res = await fetch("/api/queries");
      const data = await readJson<{ queries?: Query[]; error?: string }>(res);
      if (!res.ok || !data) {
        setMessage(data?.error || `Sorgular yüklenemedi (${res.status})`);
        return;
      }
      const list: Query[] = data.queries || [];
      setQueries(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
      if (selectedId && !list.find((q) => q.id === selectedId) && list[0]) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sorgular yüklenemedi");
    }
  }

  async function loadMentions(id = selectedId) {
    if (!id) return;
    try {
      const params = new URLSearchParams({
        queryId: id,
        sentiment,
        platform,
        sort,
        days,
        limit: "800",
      });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/mentions?${params}`);
      const data = await readJson<{
        mentions?: Mention[];
        stats?: Stats;
        scans?: Array<{
          id: string;
          status: string;
          saved: number;
          urlsFound: number;
          pagesFetched: number;
          sourcesChecked: string[];
          durationMs: number;
          createdAt: string;
        }>;
        error?: string;
      }>(res);
      if (!res.ok || !data) {
        setMessage(data?.error || `Bahisler yüklenemedi (${res.status})`);
        return;
      }
      setMentions(data.mentions || []);
      setStats(data.stats || null);
      setScans(data.scans || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bahisler yüklenemedi");
    }
  }

  useEffect(() => {
    loadQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) loadMentions(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, sentiment, platform, sort, days, q]);

  async function createQuery(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
          entityType,
        }),
      });
      const raw = await res.text();
      let data: { error?: string; query?: { id: string } } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        setMessage(res.ok ? "Beklenmeyen yanıt" : `Sunucu hatası (${res.status})`);
        return;
      }
      if (!res.ok) {
        setMessage(data.error || "Oluşturulamadı");
        return;
      }
      setName("");
      setKeywords("");
      setEntityType("company");
      await loadQueries();
      setSelectedId(data.query!.id);
      setMessage("Sorgu oluşturuldu. Derin taramayı başlatın.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Oluşturulamadı");
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuery(id: string) {
    if (!confirm("Bu sorgu ve tüm bahisler silinsin mi?")) return;
    await fetch(`/api/queries/${id}`, { method: "DELETE" });
    setSelectedId("");
    await loadQueries();
  }

  async function saveQueryMeta() {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/queries/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          keywords: editKeywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || "Güncellenemedi");
        return;
      }
      await loadQueries();
      setMessage("Ad ve anahtar kelimeler kaydedildi. Yeni tarama için Derin tarama başlatın.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Güncellenemedi");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/queries/${selectedId}/reviews`)
      .then((r) => r.json())
      .then((d) => {
        setPlaceId(d.googlePlaceId || "");
        setPlacesConfigured(Boolean(d.placesConfigured));
      })
      .catch(() => undefined);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setBrandKit(null);
      return;
    }
    fetch(`/api/queries/${selectedId}/brand-kit`)
      .then((r) => r.json())
      .then((d) => {
        setBrandKitMeta({
          openaiConfigured: Boolean(d.openaiConfigured),
          versions: (d.kits || []).length,
        });
        setBrandKit(d.latest || null);
      })
      .catch(() => undefined);
  }, [selectedId]);

  async function generateBranding() {
    if (!selectedId) return;
    setBrandBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/queries/${selectedId}/brand-kit`, { method: "POST" });
      const data = await readJson<{ error?: string; kit?: BrandKitView }>(res);
      if (!res.ok || !data?.kit) {
        setMessage(data?.error || "Branding üretilemedi");
        return;
      }
      setBrandKit(data.kit);
      setBrandKitMeta((m) => ({ ...m, versions: Math.max(m.versions + 1, data.kit!.version) }));
      setMainTab("branding");
      setMessage(
        `Branding kiti v${data.kit.version} hazır (${data.kit.provider === "openai" ? "OpenAI" : "radar tabanlı"}).`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Branding üretilemedi");
    } finally {
      setBrandBusy(false);
    }
  }

  async function importReviews(mode: "paste" | "fetch_places") {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/queries/${selectedId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "paste"
            ? { mode: "paste", text: reviewPaste }
            : { mode: "fetch_places", googlePlaceId: placeId }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Yorum aktarımı başarısız");
        return;
      }
      if (mode === "paste") {
        setMessage(`${data.saved} Google yorumu eklendi.`);
        setReviewPaste("");
      } else {
        setMessage(
          `${data.placeName || "İşletme"} · ${data.saved} yorum çekildi` +
            (data.rating ? ` · Google puanı ${data.rating}` : "")
        );
      }
      await loadQueries();
      await loadMentions(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function onReviewCsv(file: File | null) {
    if (!file || !selectedId) return;
    setBusy(true);
    try {
      const csv = await file.text();
      const res = await fetch(`/api/queries/${selectedId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "csv", csv }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "CSV hatası");
        return;
      }
      setMessage(`${data.saved} yorum CSV’den aktarıldı.`);
      await loadMentions(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function runScan() {
    if (!selectedId) return;
    setBusy(true);
    setMessage("Derin tarama çalışıyor (GDELT global + TR/EN haber — birkaç dk sürebilir)…");
    try {
      const res = await fetch(`/api/queries/${selectedId}/scan`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Tarama başarısız");
        return;
      }
      const r = data.result;
      setMessage(
        r.error
          ? `Tarama sonucu yok: ${r.error}`
          : `Tarama bitti · ${r.sourcesChecked?.join(", ") || "—"} · ${r.urlsFound} aday · ${r.pagesFetched} içerik okundu · ${r.saved} kayıt${r.purged ? ` · ${r.purged} alakasız silindi` : ""} · ${Math.round(r.durationMs / 1000)} sn`
      );
      await loadQueries();
      await loadMentions(selectedId);
    } finally {
      setBusy(false);
    }
  }

  const pieData = useMemo(
    () =>
      stats
        ? [
            { name: "Pozitif", value: stats.positive, key: "positive" },
            { name: "Negatif", value: stats.negative, key: "negative" },
            { name: "Nötr", value: stats.neutral, key: "neu" },
          ].filter((d) => d.value > 0)
        : [],
    [stats]
  );

  const platformData = useMemo(
    () =>
      Object.entries(stats?.byPlatform || {}).map(([name, value]) => ({ name, value })),
    [stats]
  );

  return (
    <div className="shell mx-auto flex min-h-screen max-w-[1440px] flex-col gap-5 px-4 py-6 lg:flex-row lg:gap-6 lg:px-6">
      <aside className="panel panel-hero w-full shrink-0 p-5 lg:sticky lg:top-6 lg:h-fit lg:w-80">
        <div className="mb-6 flex items-start gap-3">
          <div className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 12h4l2.5-6 3 12L16 9h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Sosyal dinleme
            </p>
            <h1 className="font-display text-[1.75rem] leading-none text-[var(--ink)]">Brand Pulse</h1>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Marka, fenomen ve kişi gündemini izleyin; branding kitini üretin.
            </p>
          </div>
        </div>

        <form onSubmit={createQuery} className="mb-5 space-y-2.5 border-b border-[var(--line)] pb-5">
          <select
            className="input"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          >
            {ENTITY_OPTIONS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-snug text-[var(--muted)]">
            {ENTITY_OPTIONS.find((e) => e.id === entityType)?.hint}
          </p>
          <input
            className="input"
            placeholder={entityType === "company" ? "Marka / şirket adı" : "Ad / unvan"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder={KW_PLACEHOLDER[entityType] || "Anahtar kelimeler (virgülle)"}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <button className="btn btn-primary w-full" disabled={busy} type="submit">
            Sorgu ekle
          </button>
        </form>

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Sorgular
        </p>
        <ul className="space-y-2">
          {queries.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`query-item ${selectedId === item.id ? "is-active" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--ink)]">{item.name}</span>
                  <span className="chip tabular-nums">{item._count.mentions}</span>
                </div>
                <p className="mt-1 text-[11px] font-medium text-[var(--accent)]">
                  {ENTITY_LABEL[item.entityType || "company"] || "Şirket"}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {(item.keywords || []).join(", ")}
                </p>
              </button>
            </li>
          ))}
          {queries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--line)] px-3 py-4 text-sm text-[var(--muted)]">
              Henüz sorgu yok. Yukarıdan ekleyin.
            </p>
          ) : null}
        </ul>
      </aside>

      <main className="min-w-0 flex-1 space-y-5">
        {!selected ? (
          <div className="panel empty-state">
            <div className="brand-mark mx-auto mb-4" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 12h4l2.5-6 3 12L16 9h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Bir sorgu seçin</h2>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
              Soldan bir marka veya kişi seçin; duygu, hacim ve kaynak kırılımı burada açılır.
            </p>
          </div>
        ) : (
          <>
            <section className="panel panel-hero space-y-4 p-5 lg:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {ENTITY_LABEL[selected.entityType || "company"]}
                  </p>
                  <h2 className="font-display mt-1 text-3xl leading-none text-[var(--ink)]">
                    {selected.name}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" disabled={busy} onClick={runScan} type="button">
                    {busy ? "Taranıyor (2–5 dk)…" : "Derin tarama başlat"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={brandBusy || busy}
                    onClick={generateBranding}
                  >
                    {brandBusy ? "Branding üretiliyor…" : "Branding kiti üret"}
                  </button>
                  <a
                    className="btn btn-ghost"
                    href={`/api/mentions?queryId=${selected.id}&days=${days}&platform=${platform}&sentiment=${sentiment}&limit=5000&export=csv`}
                  >
                    CSV export
                  </a>
                  <button className="btn btn-ghost" type="button" onClick={() => deleteQuery(selected.id)}>
                    Sil
                  </button>
                </div>
              </div>
              <div className="grid gap-2 border-t border-[var(--line)] pt-4">
                <label className="text-xs uppercase tracking-wide text-[var(--muted)]">Ad / unvan</label>
                <input
                  className="input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <label className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Anahtar kelimeler (virgülle)
                </label>
                <textarea
                  className="input min-h-24"
                  value={editKeywords}
                  onChange={(e) => setEditKeywords(e.target.value)}
                  placeholder="Örn: Özcan Dal, Ozcan Dal, Dal Lunapark Özcan"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy || !editName.trim()}
                    onClick={saveQueryMeta}
                  >
                    Anahtar kelimeleri kaydet
                  </button>
                  <span className="text-xs text-[var(--muted)]">
                    Kaydettikten sonra derin taramayı yeniden çalıştırın.
                  </span>
                </div>
              </div>
            </section>

            {message ? <p className="msg-banner px-4 py-3 text-sm font-medium">{message}</p> : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`btn ${mainTab === "radar" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setMainTab("radar")}
              >
                Radar
              </button>
              <button
                type="button"
                className={`btn ${mainTab === "branding" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setMainTab("branding")}
              >
                Branding {brandKit ? `· v${brandKit.version}` : ""}
              </button>
            </div>

            {mainTab === "branding" ? (
              <BrandingPanel
                kit={brandKit}
                openaiConfigured={brandKitMeta.openaiConfigured}
                busy={brandBusy}
                onGenerate={generateBranding}
                mentionCount={selected._count.mentions}
              />
            ) : (
              <>
            {(selected.entityType || "company") === "company" ? (
            <section className="panel grid gap-4 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="font-display text-lg">Google yorumları</h3>
                <p className="text-xs text-[var(--muted)]">
                  Google Maps yorumları ücretsiz otomatik çekilemez (Places API anahtarı gerekir).
                  Şimdilik yorumları yapıştırın veya CSV yükleyin.
                </p>
                <textarea
                  className="input min-h-32"
                  placeholder={"Örnek:\n5/5 Ahmet\nPark çok güzeldi, çocuklar bayıldı.\n---\n2/5 Ayşe\nKuyruk uzundu, hayal kırıklığı."}
                  value={reviewPaste}
                  onChange={(e) => setReviewPaste(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !reviewPaste.trim()}
                    onClick={() => importReviews("paste")}
                  >
                    Yorumları ekle
                  </button>
                  <label className="btn btn-ghost cursor-pointer">
                    CSV yükle
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => onReviewCsv(e.target.files?.[0] || null)}
                    />
                  </label>
                  <a
                    className="btn btn-ghost"
                    href={`/api/mentions?queryId=${selected.id}&platform=google_reviews&days=3650&limit=5000&export=csv`}
                  >
                    Yorumları CSV indir
                  </a>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  CSV kolonları: author, rating, text, date · İndirilen dosya aynı formatta olur
                </p>
              </div>
              <div className="space-y-3">
                <h3 className="font-display text-lg">Places API (opsiyonel)</h3>
                <p className="text-xs text-[var(--muted)]">
                  {placesConfigured
                    ? "API anahtarı tanımlı — Place ID ile çekebilirsiniz."
                    : "Anahtar yok. .env içine GOOGLE_PLACES_API_KEY ekleyince aktif olur (Google ücretsiz kota)."}
                </p>
                <input
                  className="input"
                  placeholder="Place ID (ChIJ…)"
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || !placeId.trim() || !placesConfigured}
                  onClick={() => importReviews("fetch_places")}
                >
                  Google’dan yorum çek
                </button>
              </div>
            </section>
            ) : (
            <section className="panel p-4 text-sm text-[var(--muted)]">
              Bu tür için Google Maps yorumları yerine haber / sosyal gündem taraması kullanılır.
              Fenomen ve oyuncu sorgularında “kimdir”, dizi/film veya platform aramaları otomatik eklenir.
            </section>
            )}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Kpi label="Bahis" value={stats?.total ?? 0} />
              <Kpi label="Pozitif %" value={stats?.positiveRate ?? 0} tone="pos" />
              <Kpi label="Negatif %" value={stats?.negativeRate ?? 0} tone="neg" />
              <Kpi label="Ort. skor" value={stats?.avgScore ?? 0} />
              <Kpi label="Kaynak" value={Object.keys(stats?.byPlatform || {}).length} />
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <div className="panel p-4 xl:col-span-2">
                <h3 className="mb-3 text-sm font-semibold text-[var(--muted)]">Hacim trendi</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats?.volume || []}>
                      <CartesianGrid stroke="rgba(18,33,43,0.08)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5a6b74" }} hide={false} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5a6b74" }} width={28} />
                      <Tooltip />
                      <Area type="monotone" dataKey="positive" stackId="1" stroke="#1b7a4a" fill="#e3f4ea" />
                      <Area type="monotone" dataKey="neutral" stackId="1" stroke="#667585" fill="#e8ecef" />
                      <Area type="monotone" dataKey="negative" stackId="1" stroke="#b43a32" fill="#f7e6e4" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="panel p-4">
                <h3 className="mb-3 text-sm font-semibold text-[var(--muted)]">Duygu dağılımı</h3>
                <div className="h-56">
                  {pieData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                          {pieData.map((d) => (
                            <Cell key={d.key} fill={PIE_COLORS[d.key as keyof typeof PIE_COLORS] || "#999"} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Veri yok</p>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="panel p-4">
                <h3 className="mb-3 text-sm font-semibold text-[var(--muted)]">Kaynak kırılımı</h3>
                <div className="h-48">
                  {platformData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={platformData}>
                        <CartesianGrid stroke="rgba(18,33,43,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5a6b74" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5a6b74" }} width={28} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#0b6e6a" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Veri yok</p>
                  )}
                </div>
              </div>

              <div className="panel p-4">
                <h3 className="mb-3 text-sm font-semibold text-[var(--muted)]">Öne çıkan temalar</h3>
                <div className="flex flex-wrap gap-2">
                  {(stats?.topThemes || []).length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">Tema yok</p>
                  ) : (
                    stats?.topThemes.map((t) => (
                      <span key={t.theme} className="chip">
                        {t.theme} <span className="text-[var(--muted)]">×{t.count}</span>
                      </span>
                    ))
                  )}
                </div>
                {scans[0] ? (
                  <p className="mt-4 text-xs text-[var(--muted)]">
                    Son tarama: {scans[0].status} · {scans[0].saved} kayıt ·{" "}
                    {(scans[0].sourcesChecked || []).join(", ") || "—"} ·{" "}
                    {new Date(scans[0].createdAt).toLocaleString("tr-TR")}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="panel space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                <select className="input max-w-[160px]" value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
                  <option value="all">Tüm duygular</option>
                  <option value="negative">Negatif</option>
                  <option value="positive">Pozitif</option>
                  <option value="neutral">Nötr</option>
                </select>
                <select className="input max-w-[160px]" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  <option value="all">Tüm kaynaklar</option>
                  <option value="news">Google News</option>
                  <option value="gdelt">GDELT (global)</option>
                  <option value="bing">Bing</option>
                  <option value="yahoo">Yahoo News</option>
                  <option value="google_reviews">Google yorum</option>
                  <option value="web">Web</option>
                  <option value="reddit">Reddit</option>
                  <option value="hackernews">Hacker News</option>
                  <option value="wikipedia">Wikipedia</option>
                </select>
                <select className="input max-w-[180px]" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="date_desc">Tarih ↓</option>
                  <option value="score_asc">Skor ↑ (negatif üstte)</option>
                  <option value="score_desc">Skor ↓</option>
                </select>
                <select className="input max-w-[140px]" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="30">30 gün</option>
                  <option value="90">90 gün</option>
                  <option value="365">1 yıl</option>
                  <option value="3650">Tümü</option>
                </select>
                <input className="input max-w-xs" placeholder="Metinde ara…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>

              <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-[10px] border border-[var(--line)] bg-white/60">
                {mentions.length === 0 ? (
                  <li className="p-6 text-sm text-[var(--muted)]">
                    Bahis yok. <strong className="text-[var(--ink)]">Derin tarama başlat</strong> ile
                    ücretsiz kaynakları tarayın.
                  </li>
                ) : (
                  mentions.map((m) => (
                    <li key={m.id} className="mention-row px-4 py-3.5">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                        <SentimentPill sentiment={m.sentiment} score={m.score} />
                        <span className="font-semibold uppercase tracking-[0.12em]">{m.platform}</span>
                        <span>{m.author}</span>
                        <span>
                          {m.publishedAt
                            ? new Date(m.publishedAt).toLocaleString("tr-TR")
                            : "—"}
                        </span>
                      </div>
                      {m.title ? <p className="font-semibold text-[var(--ink)]">{m.title}</p> : null}
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                        <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                          Özet
                        </span>
                        {formatSummary(m.title, m.text)}
                      </p>
                      {m.url ? (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-block text-xs font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          Kaynağı aç
                        </a>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function BrandingPanel({
  kit,
  openaiConfigured,
  busy,
  onGenerate,
  mentionCount,
}: {
  kit: BrandKitView | null;
  openaiConfigured: boolean;
  busy: boolean;
  onGenerate: () => void;
  mentionCount: number;
}) {
  function copyBrief() {
    if (!kit?.brief) return;
    void navigator.clipboard.writeText(kit.brief);
  }

  if (!kit) {
    return (
      <section className="panel empty-state">
        <h2 className="font-display text-2xl text-[var(--ink)]">Branding kiti yok</h2>
        <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
          Radar verisinden algı özeti, ton of voice, mesaj mimarisi ve brief üretilir.
          {mentionCount === 0 ? " Önce derin tarama yapın." : ""}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {openaiConfigured
            ? "OpenAI anahtarı tanımlı — daha zengin kit üretilir."
            : "OPENAI_API_KEY yok — radar tabanlı (ücretsiz) kit üretilir."}
        </p>
        <button className="btn btn-primary mt-5" type="button" disabled={busy || mentionCount === 0} onClick={onGenerate}>
          {busy ? "Üretiliyor…" : "Branding kiti üret"}
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="panel panel-hero flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Branding kiti · v{kit.version} · {kit.provider === "openai" ? "OpenAI" : "Radar"}
          </p>
          <h3 className="font-display mt-1 text-2xl text-[var(--ink)]">{kit.messaging?.promise}</h3>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Kaynak: {kit.sourceStats?.total ?? "—"} bahis · pozitif %
            {kit.sourceStats?.positiveRate ?? "—"} · negatif %{kit.sourceStats?.negativeRate ?? "—"}
            {kit.sourceStats?.reviews?.count
              ? ` · Google yorum: ${kit.sourceStats.reviews.count}` +
                (kit.sourceStats.reviews.avgRating != null
                  ? ` (ort. ${kit.sourceStats.reviews.avgRating}/5)`
                  : "")
              : " · Google yorum: yok"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={onGenerate}>
            {busy ? "Üretiliyor…" : "Yeniden üret"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={copyBrief}>
            Brief’i kopyala
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3 p-5">
          <h4 className="font-display text-lg">Algı özeti</h4>
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
            {(kit.perception || []).map((p) => (
              <li key={p} className="border-l-2 border-[var(--accent)] pl-3">
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="panel space-y-3 p-5">
          <h4 className="font-display text-lg">Ton of voice</h4>
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
            {(kit.toneOfVoice || []).map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="panel space-y-3 p-5 lg:col-span-2">
          <h4 className="font-display text-lg">Mesaj mimarisi</h4>
          <p className="text-sm font-semibold text-[var(--ink)]">Vaat: {kit.messaging?.promise}</p>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Direkler</p>
            <ul className="mt-1 space-y-1 text-sm text-[var(--muted)]">
              {(kit.messaging?.pillars || []).map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Kanıt</p>
            <ul className="mt-1 space-y-1 text-sm text-[var(--muted)]">
              {(kit.messaging?.proof || []).map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="panel space-y-3 p-5">
          <h4 className="font-display text-lg">Kaçınılacaklar</h4>
          <ul className="space-y-2 text-sm text-[var(--muted)]">
            {(kit.avoid || []).map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
          <h4 className="font-display mt-4 text-lg">Örnek başlıklar</h4>
          <ul className="space-y-2 text-sm text-[var(--ink)]">
            {(kit.sampleHeadlines || []).map((p) => (
              <li key={p} className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2">
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h4 className="font-display text-lg">Kampanya / içerik brief’i</h4>
        <pre className="whitespace-pre-wrap rounded-[10px] border border-[var(--line)] bg-white/70 p-4 text-sm leading-relaxed text-[var(--ink)]">
          {kit.brief}
        </pre>
      </section>
    </div>
  );
}

function formatSummary(title: string | null, text: string) {
  let t = text.trim();
  if (title && t.startsWith(title)) {
    t = t.slice(title.length).replace(/^\s*\n+/, "").trim();
  }
  if (t.length > 480) return `${t.slice(0, 480)}…`;
  return t || "Özet yok";
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos" ? "text-[var(--pos)]" : tone === "neg" ? "text-[var(--neg)]" : "text-[var(--ink)]";
  return (
    <div className="panel kpi p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className={`kpi-value mt-1.5 font-display text-3xl leading-none ${color}`}>{value}</p>
    </div>
  );
}

function SentimentPill({ sentiment, score }: { sentiment: string; score: number }) {
  const cls =
    sentiment === "positive"
      ? "bg-[var(--pos-soft)] text-[var(--pos)]"
      : sentiment === "negative"
        ? "bg-[var(--neg-soft)] text-[var(--neg)]"
        : "bg-[var(--neu-soft)] text-[var(--neu)]";
  const label =
    sentiment === "positive" ? "Pozitif" : sentiment === "negative" ? "Negatif" : "Nötr";
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label} {score.toFixed(2)}
    </span>
  );
}
