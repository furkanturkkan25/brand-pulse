import { NextResponse } from "next/server";
import { runQueryScan } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const result = await runQueryScan(id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tarama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
