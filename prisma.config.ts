import { defineConfig } from "@prisma/config";

export default defineConfig({
  datasource: {
    // Se houver uma string do Postgres (Vercel), usa ela. Se não, usa o arquivo local.
    url: process.env.DATABASE_URL || "file:./dev.db",
  },
});
