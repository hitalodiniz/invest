// app/lib/db.ts
import { PrismaClient } from "@prisma/client";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let prismaInstance: PrismaClient;

if (process.env.DATABASE_URL) {
  // Evita o import do 'ws' atribuindo diretamente o WebSocket global se disponível
  if (typeof globalThis.WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaNeon(pool as any);

  prismaInstance = new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
} else {
  prismaInstance = new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? prismaInstance;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
