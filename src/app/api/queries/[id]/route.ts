import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stringifyKeywords } from "@/lib/text";
import { ENTITY_TYPES, isEntityType } from "@/lib/entityTypes";
import { getEntityTypeForQuery, setEntityTypeForQuery } from "@/lib/queryMeta";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await prisma.query.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json();
  const entityType = isEntityType(body.entityType) ? body.entityType : undefined;
  const color = entityType
    ? ENTITY_TYPES.find((t) => t.id === entityType)?.color
    : undefined;
  const keywords =
    body.keywords === undefined
      ? undefined
      : Array.isArray(body.keywords)
        ? stringifyKeywords(body.keywords.map(String))
        : stringifyKeywords(
            String(body.keywords)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          );

  let query;
  try {
    query = await prisma.query.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name || "").trim() || undefined : undefined,
        keywords,
        active: typeof body.active === "boolean" ? body.active : undefined,
        entityType,
        color,
        googlePlaceId:
          body.googlePlaceId !== undefined
            ? String(body.googlePlaceId || "").trim() || null
            : undefined,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!entityType || !msg.includes("entityType")) throw err;
    query = await prisma.query.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name || "").trim() || undefined : undefined,
        keywords,
        active: typeof body.active === "boolean" ? body.active : undefined,
        googlePlaceId:
          body.googlePlaceId !== undefined
            ? String(body.googlePlaceId || "").trim() || null
            : undefined,
      },
    });
    await setEntityTypeForQuery(id, entityType, color);
  }

  const resolvedType =
    (query as { entityType?: string }).entityType ||
    entityType ||
    (await getEntityTypeForQuery(id));

  return NextResponse.json({
    query: {
      ...query,
      entityType: resolvedType,
      keywords: JSON.parse(query.keywords || "[]"),
    },
  });
}
