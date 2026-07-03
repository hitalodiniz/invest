// scripts/migrate-vencimento.js
//
// Rodar uma única vez: node scripts/migrate-vencimento.js
// Adiciona a coluna "vencimento" (formato YYYY-MM-DD) na tabela Operacao
// e popula todas as operações existentes (sem vencimento) com 2026-07-17.

const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.cwd(), "prisma/dev.db");
const db = new Database(dbPath);

function colunaExiste(tabela, coluna) {
  const colunas = db.prepare(`PRAGMA table_info("${tabela}")`).all();
  return colunas.some((c) => c.name === coluna);
}

try {
  if (!colunaExiste("Operacao", "vencimento")) {
    db.exec('ALTER TABLE "Operacao" ADD COLUMN "vencimento" TEXT');
    console.log("✅ Coluna 'vencimento' adicionada.");
  } else {
    console.log("ℹ️  Coluna 'vencimento' já existia, pulando ALTER TABLE.");
  }

  const resultado = db
    .prepare(
      'UPDATE "Operacao" SET "vencimento" = ? WHERE "vencimento" IS NULL',
    )
    .run("2026-07-17");

  console.log(
    `✅ ${resultado.changes} operações atualizadas com vencimento 2026-07-17.`,
  );
} catch (err) {
  console.error("❌ Erro na migração:", err.message);
  process.exit(1);
} finally {
  db.close();
}
