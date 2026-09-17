import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stringifyKeywords } from "@/lib/text";
import { ENTITY_TYPES, isEntityType } from "@/lib/entityTypes";
import { createQueryRecord, loadEntityTypeMap } from "@/lib/queryMeta";

export async function GET() {
  const queries = await prisma.query.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { mentions: true, scans: true } },
      scans: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const typeMap = await loadEntityTypeMap();
  return NextResponse.json({
    entityTypes: ENTITY_TYPES,
    queries: queries.map((q) => ({
      ...q,
      entityType:
        (q as { entityType?: string }).entityType || typeMap.get(q.id) || "company",
      keywords: JSON.parse(q.keywords || "[]"),
    })),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.map(String)
      : String(body.keywords || "")
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
    if (!name) return NextResponse.json({ error: "İsim gerekli" }, { status: 400 });

    const entityType = isEntityType(body.entityType) ? body.entityType : "company";
    const typeMeta = ENTITY_TYPES.find((t) => t.id === entityType)!;

    const query = await createQueryRecord({
      name,
      keywords: stringifyKeywords(keywords.length ? keywords : [name]),
      entityType,
      color: typeMeta.color,
    });
    return NextResponse.json(
      {
        query: {
          ...query,
          entityType: query.entityType || entityType,
          keywords: JSON.parse(query.keywords),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sorgu oluşturulamadı";
    console.error("POST /api/queries", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
