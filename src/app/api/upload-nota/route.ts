// src/app/api/upload-nota/route.ts
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { extractText, getDocumentProxy } from "unpdf";

async function extrairTextoPdf(
  pdfBuffer: Buffer,
  password: string,
): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer), { password });
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function POST(request: Request) {
  let db;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const password = (formData.get("password") as string) || "684";

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let text: string;
    try {
      text = await extrairTextoPdf(buffer, password);
    } catch (err: any) {
      const nome = err?.name || "";
      const msg = String(err?.message || "");
      if (nome === "PasswordException" || /password/i.test(msg)) {
        return NextResponse.json(
          { error: "Senha incorreta do PDF." },
          { status: 401 },
        );
      }
      return NextResponse.json(
        {
          error: "Falha ao ler o PDF: " + (err?.message || "arquivo inválido."),
        },
        { status: 422 },
      );
    }

    // 3. Captura do Número Único da Nota (Nr. nota) para evitar duplicidade
    const numeroNotaMatch = text.match(/Nr\.\s*nota\s*([\d]+)/i);
    const numeroNota = numeroNotaMatch ? numeroNotaMatch[1] : null;

    if (!numeroNota) {
      return NextResponse.json(
        {
          error: "Não foi possível identificar o número da nota no documento.",
        },
        { status: 422 },
      );
    }

    // 4. Conexão com o Banco Local e Verificação Direta de Duplicidade
    const dbPath = path.join(process.cwd(), "prisma/dev.db");
    db = new Database(dbPath);

    const notaExistente = db
      .prepare('SELECT id FROM "NotasProcessadas" WHERE id = ?')
      .get(numeroNota);

    if (notaExistente) {
      db.close();
      return NextResponse.json(
        {
          error: `A Nota de Negociação nº ${numeroNota} já foi importada anteriormente no sistema.`,
        },
        { status: 409 },
      );
    }

    // 5. Tratamento do Metadado Global de Data do Pregão
    let dataPregao = "";
    const dataMatch = text.match(/Data\s+preg[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (dataMatch) dataPregao = dataMatch[1];

    // 6. Parse das linhas de negociação
    const operacoes: any[] = [];
    const linhaRegex =
      /(?<cv>[CV])\s+(?<mercado>OPCAO\s+DE\s+COMPRA|OPCAO\s+DE\s+VENDA|VISTA|EXERC\s+OPC)\s+.*?\s+(?<codigo>[A-Z]{4}[A-Z0-9]{2,5})\s+.*?\s+(?<qtde>[\d.]+)\s+(?<preco>[\d,.]+)\s+(?<total>[\d,.]+)\s+(?<dc>[DC])/gi;

    let match;
    while ((match = linhaRegex.exec(text)) !== null) {
      const { cv, mercado, codigo, qtde, preco, total } = match.groups!;

      const quantidade = parseInt(qtde.replace(/\./g, ""), 10);
      const precoUnitario = parseFloat(
        preco.replace(".", "").replace(",", "."),
      );
      const valorTotal = parseFloat(total.replace(".", "").replace(",", "."));

      const ativoBase = codigo.slice(0, 4) + "4";
      const mercadoNorm = mercado.replace(/\s+/g, " ").toUpperCase();
      const isCall = mercadoNorm === "OPCAO DE COMPRA";
      const isPut = mercadoNorm === "OPCAO DE VENDA";
      const isVista = mercadoNorm === "VISTA";

      const operacaoDesc = isCall
        ? "Venda de Call"
        : isVista
          ? "Ações"
          : "Venda de Put";

      operacoes.push({
        id: globalThis.crypto.randomUUID(),
        data: dataPregao,
        ativo: ativoBase,
        operacao: operacaoDesc,
        tipo: cv === "C" ? "Compra" : "Venda",
        codigo: codigo.trim(),
        qtde: quantidade,
        cotacaoAcao: precoUnitario,
        strike: precoUnitario,
        premioUnInicial: precoUnitario,
        premioTotalBruto: valorTotal,
        distanciaStrike: "0,00%",
        exercendo: "Não",
        cotacaoOpcao: precoUnitario,
        lucroCapturado: "0,00%",
        custoRecompraTotal: 0.0,
        resultadoBrutoReal: valorTotal,
        valorExercicioUn: 0.0,
        valorExercEfetivoTotal: isPut ? quantidade * precoUnitario : 0.0,
        darf: 0.0,
        resultadoLiquido: valorTotal,
        status: "Aberta",
      });
    }

    // 7. Persistência Atômica via Transação SQL no SQLite
    const insertOperacao = db.prepare(`
      INSERT INTO "Operacao" (
        id, data, ativo, operacao, tipo, codigo, qtde, cotacaoAcao, strike, 
        premioUnInicial, premioTotalBruto, distanciaStrike, exercendo, 
        cotacaoOpcao, lucroCapturado, custoRecompraTotal, resultadoBrutoReal, 
        valorExercicioUn, valorExercEfetivoTotal, darf, resultadoLiquido, status
      ) VALUES (
        @id, @data, @ativo, @operacao, @tipo, @codigo, @qtde, @cotacaoAcao, @strike, 
        @premioUnInicial, @premioTotalBruto, @distanciaStrike, @exercendo, 
        @cotacaoOpcao, @lucroCapturado, @custoRecompraTotal, @resultadoBrutoReal, 
        @valorExercicioUn, @valorExercEfetivoTotal, @darf, @resultadoLiquido, @status
      )
    `);

    const insertNotaControle = db.prepare(
      'INSERT INTO "NotasProcessadas" (id, data_importacao) VALUES (?, ?)',
    );

    const transacaoExecutar = db.transaction((listaOps, idNota, timestamp) => {
      for (const op of listaOps) {
        insertOperacao.run(op);
      }
      insertNotaControle.run(idNota, timestamp);
    });

    transacaoExecutar(operacoes, numeroNota, new Date().toISOString());
    db.close();

    return NextResponse.json({
      success: true,
      numeroNota,
      linhasInseridas: operacoes.length,
    });
  } catch (error: any) {
    if (db) db.close();
    return NextResponse.json(
      { error: "Erro de processamento SQL: " + error.message },
      { status: 500 },
    );
  }
}
