// src/app/api/upload-nota/route.ts
//
// Reescrita: a extração de texto do PDF e o regex de parsing das linhas de
// negociação continuam idênticos. O que mudou é só a persistência — antes
// abria better-sqlite3 em prisma/dev.db, agora grava no Neon via Prisma,
// numa transação (equivalente ao db.transaction do SQLite): ou insere as
// operações + o controle de nota processada juntos, ou nada é gravado.

import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "../../lib/db";

async function extrairTextoPdf(
  pdfBuffer: Buffer,
  password: string,
): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer), { password });
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function POST(request: Request) {
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

    // Captura do Número Único da Nota (Nr. nota) para evitar duplicidade
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

    // Verificação de duplicidade direto no Neon
    const notaExistente = await prisma.notasProcessadas.findUnique({
      where: { id: numeroNota },
    });

    if (notaExistente) {
      return NextResponse.json(
        {
          error: `A Nota de Negociação nº ${numeroNota} já foi importada anteriormente no sistema.`,
        },
        { status: 409 },
      );
    }

    // Data do pregão
    let dataPregao = "";
    const dataMatch = text.match(/Data\s+preg[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (dataMatch) dataPregao = dataMatch[1];

    // Parse das linhas de negociação (regex idêntico ao original)
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

    if (operacoes.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma linha de negociação reconhecida no PDF." },
        { status: 422 },
      );
    }

    // Gravação atômica: mesma garantia da transação do SQLite, agora no Postgres.
    // Se qualquer INSERT falhar, tudo é revertido — inclusive o registro de controle.
    await prisma.$transaction([
      prisma.operacao.createMany({ data: operacoes }),
      prisma.notasProcessadas.create({
        data: { id: numeroNota, data_importacao: new Date().toISOString() },
      }),
    ]);

    return NextResponse.json({
      success: true,
      numeroNota,
      linhasInseridas: operacoes.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Erro de processamento: " + error.message },
      { status: 500 },
    );
  }
}
