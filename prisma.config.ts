import { config as loadEnv } from "dotenv";
import { defineConfig } from "@prisma/config";

// Carrega na ordem: .env primeiro, depois .env.local (que sobrescreve o .env,
// igual o Next.js faz). Não usa "dotenv/config" puro porque esse só lê ".env".
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não está definida. Confira se existe um arquivo .env na raiz do projeto " +
      "com DATABASE_URL=postgresql://... (a connection string do Neon).",
  );
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
