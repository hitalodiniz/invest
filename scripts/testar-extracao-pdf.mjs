// scripts/testar-extracao-pdf.mjs
//
// Roda local, fora do Next.js, só pra ver exatamente o texto que o unpdf
// extrai de uma nota real — é isso que preciso pra ajustar os regexes de
// taxas em src/app/api/upload-nota/route.ts.
//
// Uso:
//   node scripts/testar-extracao-pdf.mjs caminho/para/nota.pdf 684
//
// (o segundo argumento é a senha do PDF; "684" é o valor default que vocês usam)

import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const caminhoPdf = process.argv[2];
const senha = process.argv[3] || "684";

if (!caminhoPdf) {
  console.error("Uso: node scripts/testar-extracao-pdf.mjs caminho/para/nota.pdf [senha]");
  process.exit(1);
}

const buffer = readFileSync(caminhoPdf);

try {
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { password: senha });
  const { text } = await extractText(pdf, { mergePages: true });

  console.log("=== TEXTO EXTRAÍDO (bruto) ===");
  console.log(text);
  console.log("=== FIM ===");
  console.log(`\nTotal de caracteres: ${text.length}`);
} catch (err) {
  console.error("Erro ao extrair o PDF:", err.message);
  if (err.name === "PasswordException") {
    console.error("A senha informada está incorreta.");
  }
  process.exit(1);
}
