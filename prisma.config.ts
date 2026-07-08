import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@prisma/config";

function carregarEnv(caminho: string) {
  if (!existsSync(caminho)) return;
  const conteudo = readFileSync(caminho, "utf-8");
  for (const linha of conteudo.split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;
    const idx = l.indexOf("=");
    if (idx === -1) continue;
    const chave = l.slice(0, idx).trim();
    let valor = l.slice(idx + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
}

carregarEnv(resolve(process.cwd(), ".env"));
carregarEnv(resolve(process.cwd(), ".env.local"));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não está definida. Confira se existe um arquivo .env na raiz do projeto " +
      "com DATABASE_URL=postgresql://... (a connection string do Neon).",
  );
}

// Altere apenas o final do arquivo prisma.config.ts:

const baseDbUrl = process.env.DATABASE_URL;
// Se a URL já não contiver parâmetros, adiciona com '?'; se já contiver, adiciona com '&'
const dbUrlWithTimeout = baseDbUrl.includes("?")
  ? `${baseDbUrl}&connect_timeout=30`
  : `${baseDbUrl}?connect_timeout=30`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: dbUrlWithTimeout,
  },
});
