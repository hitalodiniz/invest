// src/app/lib/db.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Verifica se está rodando no build do Next.js dentro da Vercel
const isVercelBuild = process.env.NEXT_PHASE === "phase-production-build";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    isVercelBuild
      ? {
          // Injeta um adapter mockado apenas para o construtor passar sem validar a engine
          adapter: {
            provider: "postgres",
            executeRaw: async () => ({ rows: [] }),
            queryRaw: async () => ({ rows: [] }),
          } as any,
        }
      : {
          log:
            process.env.NODE_ENV === "development"
              ? ["query", "error", "warn"]
              : ["error"],
        },
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
