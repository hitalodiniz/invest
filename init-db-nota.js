const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "prisma/dev.db"));

db.exec(`
  DROP TABLE IF EXISTS "NotasProcessadas";
  CREATE TABLE "NotasProcessadas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data_importacao" TEXT NOT NULL
  );
`);

console.log("✅ Tabelas Operacao e NotasProcessadas recriadas com sucesso!");
db.close();
