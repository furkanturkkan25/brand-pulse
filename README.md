# Brand Pulse

Türkçe | English

---

## Türkçe

Brandwatch tarzı **sosyal dinleme demosu** — ücretsiz kamu kaynaklarıyla marka bahsi taraması. Müşteri paneli yok; ajans içi tek ekran.

### Ücretsiz kaynaklar
- Google News RSS (+ makale içeriği)
- Bing News RSS
- DuckDuckGo web arama
- Reddit RSS
- Hacker News (Algolia public API)
- Wikipedia (MediaWiki API)
- Yerel Türkçe/İngilizce duygu analizi
- Tema çıkarma, hacim/duygu/kaynak grafikleri, CSV export

### Kurulum

```bash
cd brand-pulse
cp .env.example .env   # yoksa kendiniz oluşturun
npm install
npm run db:setup
npm run dev
```

Tarayıcıda açın: http://localhost:3000

1. Soldan marka/sorgu ekleyin  
2. **Derin tarama başlat** (1–3 dk sürebilir)  
3. Grafikler ve bahis akışını inceleyin  

### Ortam değişkenleri (`.env`)

```env
DATABASE_URL="file:./dev.db"
# İsteğe bağlı
GOOGLE_PLACES_API_KEY=
OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4o-mini
```

### Limit (dürüst)
X / Instagram / TikTok genel “mention” taraması ücretsiz mümkün değil. Bu demo kamu web/haber/forum kaynaklarıyla Brandwatch deneyiminin ücretsiz iskeletini verir.

### Gereksinimler
- Node.js 18+
- npm

---

## English

A Brandwatch-style **social listening demo** that scans brand mentions from free public sources. No client portal — a single internal agency screen.

### Free sources
- Google News RSS (+ article content)
- Bing News RSS
- DuckDuckGo web search
- Reddit RSS
- Hacker News (Algolia public API)
- Wikipedia (MediaWiki API)
- Local Turkish/English sentiment analysis
- Theme extraction, volume/sentiment/source charts, CSV export

### Setup

```bash
cd brand-pulse
cp .env.example .env   # or create it yourself
npm install
npm run db:setup
npm run dev
```

Open: http://localhost:3000

1. Add a brand/query on the left  
2. Start a **deep scan** (may take 1–3 minutes)  
3. Review charts and mention feed  

### Environment variables (`.env`)

```env
DATABASE_URL="file:./dev.db"
# Optional
GOOGLE_PLACES_API_KEY=
OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4o-mini
```

### Honest limitation
Free general “mention” scanning for X / Instagram / TikTok is not available. This demo gives a free Brandwatch-like skeleton using public web, news, and forum sources.

### Requirements
- Node.js 18+
- npm
