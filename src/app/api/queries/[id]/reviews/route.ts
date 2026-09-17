import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchGooglePlaceReviews,
  importReviews,
  parseCsvReviews,
  parsePastedReviews,
  placesConfigured,
} from "@/lib/reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const query = await prisma.query.findUnique({ where: { id } });
  if (!query) return NextResponse.json({ error: "Sorgu yok" }, { status: 404 });
  return NextResponse.json({
    googlePlaceId: query.googlePlaceId,
    placesConfigured: placesConfigured(),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const query = await prisma.query.findUnique({ where: { id } });
    if (!query) return NextResponse.json({ error: "Sorgu yok" }, { status: 404 });

    const body = await req.json();
    const mode = body.mode || "paste";

    if (mode === "save_place") {
      const placeId = String(body.googlePlaceId || "").trim() || null;
      await prisma.query.update({
        where: { id },
        data: { googlePlaceId: placeId },
      });
      return NextResponse.json({ ok: true, googlePlaceId: placeId });
    }

    if (mode === "fetch_places") {
      const placeId = String(body.googlePlaceId || query.googlePlaceId || "").trim();
      if (!placeId) {
        return NextResponse.json(
          { error: "Google Place ID gerekli (Maps URL’deki ChIJ… kodu)" },
          { status: 400 }
        );
      }
      if (!placesConfigured()) {
        return NextResponse.json(
          {
            error:
              "GOOGLE_PLACES_API_KEY yok. Ücretsiz kota için Google Cloud’da Places API açıp .env’e ekleyin — veya yorumları yapıştırın/CSV yükleyin.",
            placesConfigured: false,
          },
          { status: 400 }
        );
      }
      await prisma.query.update({
        where: { id },
        data: { googlePlaceId: placeId },
      });
      const result = await fetchGooglePlaceReviews(placeId);
      if (!result) {
        return NextResponse.json({ error: "Places API yanıt vermedi" }, { status: 502 });
      }
      const saved = await importReviews(id, result.reviews);
      return NextResponse.json({
        ok: true,
        saved,
        placeName: result.placeName,
        rating: result.rating,
        count: result.count,
      });
    }

    if (mode === "csv") {
      const csv = String(body.csv || "");
      const reviews = parseCsvReviews(csv);
      const saved = await importReviews(id, reviews);
      return NextResponse.json({ ok: true, saved, parsed: reviews.length });
    }

    // paste
    const text = String(body.text || "");
    const reviews = Array.isArray(body.reviews)
      ? body.reviews
      : parsePastedReviews(text);
    const saved = await importReviews(id, reviews);
    return NextResponse.json({ ok: true, saved, parsed: reviews.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yorum aktarımı başarısız";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
