import { PrismaClient } from "@prisma/client";

/** Global key versioned so schema changes (e.g. entityType) pick up a fresh client after generate. */
const globalForPrisma = globalThis as unknown as { prismaV2?: PrismaClient };

export const prisma =
  globalForPrisma.prismaV2 ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaV2 = prisma;
