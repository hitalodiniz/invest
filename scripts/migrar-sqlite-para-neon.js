// scripts/migrar-sqlite-para-neon.js
//
// Rodar UMA VEZ, LOCALMENTE (nunca na Vercel):
//
//   DATABASE_URL="postgresql://...sua-connection-string-do-neon..." \
//   node scripts/migrar-sqlite-para-neon.js
//
// Lê tudo que existe no prisma/dev.db (SQLite local) e regrava no Neon via
// Prisma Client. Depois disso, o dev.db pode ser descartado — a fonte de
// verdade passa a ser o Neon.

const Database = require("better-sqlite3");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

if (!process.env.DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL não definida. Rode assim:\n" +
      '   DATABASE_URL="postgresql://..." node scripts/migrar-sqlite-para-neon.js',
  );
  process.exit(1);
}
if (process.env.DATABASE_URL.includes("localhost")) {
  console.error(
    "❌ DATABASE_URL aponta pra localhost — isso não é o Neon. Abortando.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const dbPath = path.join(process.cwd(), "prisma/dev.db");
  const sqlite = new Database(dbPath, { readonly: true });

  const operacoes = sqlite.prepare('SELECT * FROM "Operacao"').all();
  console.log(`Encontradas ${operacoes.length} operações no SQLite local.`);

  let migradas = 0;
  for (const op of operacoes) {
    try {
      await prisma.operacao.upsert({
        where: { id: op.id },
        create: op,
        update: op,
      });
      migradas++;
    } catch (e) {
      console.error(`  ⚠️  Falha ao migrar operação ${op.id}:`, e.message);
    }
  }
  console.log(
    `✅ ${migradas}/${operacoes.length} operações migradas para o Neon.`,
  );

  const notas = sqlite.prepare('SELECT * FROM "NotasProcessadas"').all();
  let notasMigradas = 0;
  for (const n of notas) {
    try {
      await prisma.notasProcessadas.upsert({
        where: { id: n.id },
        create: n,
        update: n,
      });
      notasMigradas++;
    } catch (e) {
      console.error(`  ⚠️  Falha ao migrar nota ${n.id}:`, e.message);
    }
  }
  console.log(
    `✅ ${notasMigradas}/${notas.length} notas migradas para o Neon.`,
  );

  sqlite.close();
}

main()
  .catch((e) => {
    console.error("❌ Erro na migração:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
