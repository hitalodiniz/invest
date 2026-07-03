const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'prisma/dev.db'));

db.exec(`
  DROP TABLE IF EXISTS "Operacao";
  CREATE TABLE "Operacao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "ativo" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "qtde" INTEGER NOT NULL,
    "cotacaoAcao" REAL NOT NULL,
    "strike" REAL NOT NULL,
    "premioUnInicial" REAL NOT NULL,
    "premioTotalBruto" REAL NOT NULL,
    "distanciaStrike" TEXT NOT NULL,
    "exercendo" TEXT NOT NULL,
    "cotacaoOpcao" REAL NOT NULL,
    "lucroCapturado" TEXT NOT NULL,
    "custoRecompraTotal" REAL NOT NULL,
    "resultadoBrutoReal" REAL NOT NULL,
    "valorExercicioUn" REAL NOT NULL,
    "valorExercEfetivoTotal" REAL NOT NULL,
    "darf" REAL DEFAULT 0.0,
    "resultadoLiquido" REAL DEFAULT 0.0,
    "dataEncerramento" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Aberta'
  );
`);

console.log("✅ Tabelas recriadas com sucesso!");
db.close();