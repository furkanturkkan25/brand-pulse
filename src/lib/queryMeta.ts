import { prisma } from "./db";

type QueryRow = {
  id: string;
  name: string;
  keywords: string;
  entityType?: string;
  color: string;
  googlePlaceId?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Create query; falls back if running Prisma Client predates entityType. */
export async function createQueryRecord(data: {
  name: string;
  keywords: string;
  entityType: string;
  color: string;
}): Promise<QueryRow> {
  try {
    return (await prisma.query.create({
      data: {
        name: data.name,
        keywords: data.keywords,
        entityType: data.entityType,
        color: data.color,
      },
    })) as QueryRow;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("entityType")) throw err;

    const created = await prisma.query.create({
      data: {
        name: data.name,
        keywords: data.keywords,
        color: data.color,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "Query" SET entityType = ? WHERE id = ?`,
      data.entityType,
      created.id
    );
    return { ...created, entityType: data.entityType };
  }
}

export async function loadEntityTypeMap(): Promise<Map<string, string>> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, entityType FROM "Query"`
    )) as Array<{ id: string; entityType: string | null }>;
    return new Map(rows.map((r) => [r.id, r.entityType || "company"]));
  } catch {
    return new Map();
  }
}

export async function getEntityTypeForQuery(id: string): Promise<string> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT entityType FROM "Query" WHERE id = ? LIMIT 1`,
      id
    )) as Array<{ entityType: string | null }>;
    return rows[0]?.entityType || "company";
  } catch {
    return "company";
  }
}

export async function setEntityTypeForQuery(id: string, entityType: string, color?: string) {
  if (color) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Query" SET entityType = ?, color = ? WHERE id = ?`,
      entityType,
      color,
      id
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "Query" SET entityType = ? WHERE id = ?`,
      entityType,
      id
    );
  }
}
