import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateBrandKit, serializeBrandKit } from "@/lib/brandKit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const kits = await prisma.brandKit.findMany({
    where: { queryId: id },
    orderBy: { version: "desc" },
    take: 10,
  });
  return NextResponse.json({
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    kits: kits.map(serializeBrandKit),
    latest: kits[0] ? serializeBrandKit(kits[0]) : null,
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const kit = await generateBrandKit(id);
    return NextResponse.json({ ok: true, kit }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Branding üretilemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
