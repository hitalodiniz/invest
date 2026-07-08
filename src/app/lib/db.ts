// lib/db.ts
//
// Em serverless (Vercel), cada invocação pode recriar o módulo. Sem esse padrão de
// singleton, cada request abriria uma nova conexão Postgres e o Neon rapidamente
// bate no limite de conexões simultâneas. Isso reaproveita a mesma instância do
// Prisma Client entre invocações "quentes".

import { PrismaClient } from "@prisma/client/extension";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
