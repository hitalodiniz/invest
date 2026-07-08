// src/app/api/upload-nota/route.ts
//
// Mudança principal em relação à versão anterior: antes, toda linha de opção
// virava uma posição nova (ignorando a coluna C/V). Agora:
//   - V (venda) em opção = ABRE posição nova (Venda de Call ou Venda de Put)
//   - C (compra) em opção = FECHA (recompra) uma posição vendida existente do
//     mesmo ticker, casando por FIFO (posição mais antiga primeiro), com
//     suporte a fechamento parcial (compra menor que a posição aberta)
//
// Também grava o resumo financeiro da nota (taxas, IRRF, líquido) e rateia o
// custo operacional (liquidação + registro + emolumentos) proporcionalmente
// entre as operações da nota, gravando em `custosRateados`.
//
// Regexes de taxas validados contra uma nota real (139711018, 07/07/2026):
// o unpdf lineariza essa nota com o VALOR colado ANTES do rótulo, sem espaço
// (ex.: "0,08Taxa de liquidação D"), diferente do que a ordem visual sugere.

import { prisma } from "@/app/lib/db";
import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

async function extrairTextoPdf(
  pdfBuffer: Buffer,
  password: string,
): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer), { password });
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function numeroBR(txt: string | undefined | null): number {
  if (!txt) return 0;
  const n = parseFloat(txt.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function extrairCampo(text: string, rotulo: RegExp): number {
  const match = text.match(rotulo);
  return match ? numeroBR(match[1]) : 0;
}

// Extrai um valor monetário que vem ANTES do rótulo, colado sem espaço
// (ex.: "0,08Taxa de liquidação D") — confirmado com uma nota real: o unpdf
// lineariza essa nota assim, na ordem "valor" + "rótulo" + "D/C opcional".
function extrairCampoInvertido(text: string, rotulo: RegExp): number {
  const combinado = new RegExp(`([\\d.,]+)\\s*(?:${rotulo.source})`, "i");
  const match = text.match(combinado);
  return match ? numeroBR(match[1]) : 0;
}

interface LinhaNegociacao {
  cv: "C" | "V";
  tipoMercado: string;
  codigo: string;
  quantidade: number;
  precoUnitario: number;
  valorTotal: number;
}

function parseLinhas(text: string): LinhaNegociacao[] {
  // OPCAO e DE às vezes saem colados na extração ("OPCAODE VENDA"), então
  // \s* (zero ou mais espaços) em vez de \s+ entre essas palavras.
  const linhaRegex =
    /(?<cv>[CV])\s+(?<mercado>OPCAO\s*DE\s*COMPRA|OPCAO\s*DE\s*VENDA|VISTA|EXERC\s*OPC)\s+.*?\s+(?<codigo>[A-Z]{4}[A-Z0-9]{2,5})\s+.*?\s+(?<qtde>[\d.]+)\s+(?<preco>[\d,.]+)\s+(?<total>[\d,.]+)\s+(?<dc>[DC])/gi;

  const linhas: LinhaNegociacao[] = [];
  let match;
  while ((match = linhaRegex.exec(text)) !== null) {
    const { cv, mercado, codigo, qtde, preco, total } = match.groups!;
    linhas.push({
      cv: cv.toUpperCase() as "C" | "V",
      tipoMercado: mercado.replace(/\s+/g, " ").toUpperCase(),
      codigo: codigo.trim(),
      quantidade: parseInt(qtde.replace(/\./g, ""), 10),
      precoUnitario: numeroBR(preco),
      valorTotal: numeroBR(total),
    });
  }
  return linhas;
}

function extrairResumoFinanceiro(text: string) {
  return {
    valorLiquidoOperacoes: extrairCampoInvertido(
      text,
      /Valor\s*l[íi]quido\s*das\s*opera[çc][õo]es/i,
    ),
    taxaLiquidacao: extrairCampoInvertido(
      text,
      /Taxa\s*de\s*liquida[çc][ãa]o/i,
    ),
    taxaRegistro: extrairCampoInvertido(text, /Taxa\s*de\s*Registro/i),
    totalCBLC: extrairCampoInvertido(text, /Total\s*CBLC/i),
    taxaTermoOpcoes: extrairCampoInvertido(
      text,
      /Taxa\s*de\s*termo\/?\s*op[çc][õo]es/i,
    ),
    taxaANA: extrairCampoInvertido(text, /Taxa\s*A\.?N\.?A\.?/i),
    emolumentos: extrairCampoInvertido(text, /Emolumentos/i),
    taxaTransfAtivos: extrairCampoInvertido(
      text,
      /Taxa\s*de\s*Transf\.?\s*de\s*Ativos/i,
    ),
    totalBovespaSoma: extrairCampoInvertido(
      text,
      /Total\s*Bovespa\s*\/?\s*Soma/i,
    ),
    taxaOperacional: extrairCampoInvertido(text, /Taxa\s*Operacional/i),
    execucao: extrairCampoInvertido(text, /Execu[çc][ãa]o/i),
    taxaCustodia: extrairCampoInvertido(text, /Taxa\s*de\s*Cust[óo]dia/i),
    impostos: extrairCampoInvertido(text, /Impostos/i),
    // IRRF: o rótulo real vem seguido de "s/ operações, base R$X" — não
    // confundir com esse valor de base, que fica DEPOIS do rótulo.
    irrf: extrairCampoInvertido(text, /I\.?R\.?R\.?F\.?/i),
    outros: extrairCampoInvertido(text, /Outros/i),
    totalCustosDespesas: extrairCampoInvertido(
      text,
      /Total\s*Custos?\s*\/?\s*Despesas/i,
    ),
    liquidoNota: extrairCampoInvertido(
      text,
      /L[íi]quido\s*para\s*\d{2}\/\d{2}\/\d{4}/i,
    ),
  };
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

    const notaExistente = await prisma.notasProcessadas.findUnique({
      where: { id: numeroNota },
    });
    if (notaExistente) {
      return NextResponse.json(
        {
          error: `A Nota de Negociação nº ${numeroNota} já foi importada anteriormente.`,
        },
        { status: 409 },
      );
    }

    let dataPregao = "";
    const dataMatch = text.match(/Data\s+preg[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (dataMatch) dataPregao = dataMatch[1];

    const linhas = parseLinhas(text);
    if (linhas.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma linha de negociação reconhecida no PDF." },
        { status: 422 },
      );
    }
    const resumo = extrairResumoFinanceiro(text);

    const custoOperacionalTotal =
      resumo.taxaLiquidacao +
      resumo.taxaRegistro +
      resumo.emolumentos +
      resumo.taxaTermoOpcoes +
      resumo.taxaANA +
      resumo.taxaTransfAtivos +
      resumo.taxaOperacional +
      resumo.execucao +
      resumo.taxaCustodia;
    const valorTotalNota =
      linhas.reduce((soma, l) => soma + l.valorTotal, 0) || 1;

    const aberturas: any[] = [];
    const atualizacoesFechamento: { id: string; data: any }[] = [];
    const fechamentosParciaisNovos: any[] = [];
    const semCorrespondencia: LinhaNegociacao[] = [];

    for (const linha of linhas) {
      const isCall = linha.tipoMercado === "OPCAO DE COMPRA";
      const isPut = linha.tipoMercado === "OPCAO DE VENDA";
      const isVista = linha.tipoMercado === "VISTA";
      const custosDaLinha =
        custoOperacionalTotal * (linha.valorTotal / valorTotalNota);

      if (isVista) {
        aberturas.push({
          id: globalThis.crypto.randomUUID(),
          data: dataPregao,
          ativo: linha.codigo,
          operacao: "Ações",
          tipo: linha.cv === "C" ? "Compra" : "Venda",
          codigo: linha.codigo,
          qtde: linha.quantidade,
          cotacaoAcao: linha.precoUnitario,
          strike: linha.precoUnitario,
          premioUnInicial: linha.precoUnitario,
          premioTotalBruto: linha.valorTotal,
          distanciaStrike: "0,00%",
          exercendo: "Não",
          cotacaoOpcao: linha.precoUnitario,
          lucroCapturado: "0,00%",
          custoRecompraTotal: 0.0,
          resultadoBrutoReal: linha.valorTotal,
          valorExercicioUn: 0.0,
          valorExercEfetivoTotal: 0.0,
          darf: 0.0,
          resultadoLiquido: linha.valorTotal,
          status: "Aberta",
          numeroNotaAbertura: numeroNota,
          custosRateados: custosDaLinha,
        });
        continue;
      }

      if (linha.cv === "V" && (isCall || isPut)) {
        const ativoBase = linha.codigo.slice(0, 4) + "4";
        aberturas.push({
          id: globalThis.crypto.randomUUID(),
          data: dataPregao,
          ativo: ativoBase,
          operacao: isCall ? "Venda de Call" : "Venda de Put",
          tipo: "Venda",
          codigo: linha.codigo,
          qtde: linha.quantidade,
          cotacaoAcao: linha.precoUnitario,
          strike: linha.precoUnitario,
          premioUnInicial: linha.precoUnitario,
          premioTotalBruto: linha.valorTotal,
          distanciaStrike: "0,00%",
          exercendo: "Não",
          cotacaoOpcao: linha.precoUnitario,
          lucroCapturado: "0,00%",
          custoRecompraTotal: 0.0,
          resultadoBrutoReal: linha.valorTotal,
          valorExercicioUn: 0.0,
          valorExercEfetivoTotal: isPut
            ? linha.quantidade * linha.precoUnitario
            : 0.0,
          darf: 0.0,
          resultadoLiquido: linha.valorTotal,
          status: "Aberta",
          numeroNotaAbertura: numeroNota,
          custosRateados: custosDaLinha,
        });
        continue;
      }

      if (linha.cv === "C" && (isCall || isPut)) {
        const posicoesAbertas = await prisma.operacao.findMany({
          where: { codigo: linha.codigo, status: "Aberta" },
          orderBy: { data: "asc" },
        });

        let restante = linha.quantidade;
        const precoRecompraUnit = linha.precoUnitario;

        for (const posicao of posicoesAbertas) {
          if (restante <= 0) break;
          const qtdeFechar = Math.min(posicao.qtde, restante);
          const proporcaoAbertura = qtdeFechar / posicao.qtde;
          const proporcaoRecompra = qtdeFechar / linha.quantidade;

          const premioProporcional =
            posicao.premioTotalBruto * proporcaoAbertura;
          const custoRecompraProporcional =
            linha.valorTotal * proporcaoRecompra;
          const resultado = premioProporcional - custoRecompraProporcional;
          const lucroCapturadoPct =
            premioProporcional > 0 ? (resultado / premioProporcional) * 100 : 0;

          if (qtdeFechar === posicao.qtde) {
            atualizacoesFechamento.push({
              id: posicao.id,
              data: {
                status: "Zerada",
                cotacaoOpcao: precoRecompraUnit,
                custoRecompraTotal: custoRecompraProporcional,
                resultadoBrutoReal: resultado,
                resultadoLiquido: resultado - custosDaLinha * proporcaoRecompra,
                lucroCapturado: `${lucroCapturadoPct.toFixed(2)}%`,
                dataEncerramento: dataPregao,
                numeroNotaFechamento: numeroNota,
              },
            });
          } else {
            atualizacoesFechamento.push({
              id: posicao.id,
              data: {
                qtde: posicao.qtde - qtdeFechar,
                premioTotalBruto: posicao.premioTotalBruto - premioProporcional,
              },
            });
            fechamentosParciaisNovos.push({
              id: globalThis.crypto.randomUUID(),
              data: posicao.data,
              ativo: posicao.ativo,
              operacao: posicao.operacao,
              tipo: "Venda",
              codigo: posicao.codigo,
              qtde: qtdeFechar,
              cotacaoAcao: posicao.cotacaoAcao,
              strike: posicao.strike,
              premioUnInicial: posicao.premioUnInicial,
              premioTotalBruto: premioProporcional,
              distanciaStrike: posicao.distanciaStrike,
              exercendo: "Não",
              cotacaoOpcao: precoRecompraUnit,
              lucroCapturado: `${lucroCapturadoPct.toFixed(2)}%`,
              custoRecompraTotal: custoRecompraProporcional,
              resultadoBrutoReal: resultado,
              valorExercicioUn: posicao.valorExercicioUn,
              valorExercEfetivoTotal: 0.0,
              darf: 0.0,
              resultadoLiquido: resultado - custosDaLinha * proporcaoRecompra,
              status: "Zerada",
              dataEncerramento: dataPregao,
              numeroNotaAbertura: posicao.numeroNotaAbertura,
              numeroNotaFechamento: numeroNota,
              custosRateados: custosDaLinha * proporcaoRecompra,
            });
          }
          restante -= qtdeFechar;
        }

        if (restante > 0) {
          semCorrespondencia.push({
            ...linha,
            quantidade: restante,
          } as LinhaNegociacao);
          aberturas.push({
            id: globalThis.crypto.randomUUID(),
            data: dataPregao,
            ativo: linha.codigo.slice(0, 4) + "4",
            operacao: isCall
              ? "Compra de Call (sem par)"
              : "Compra de Put (sem par)",
            tipo: "Compra",
            codigo: linha.codigo,
            qtde: restante,
            cotacaoAcao: precoRecompraUnit,
            strike: precoRecompraUnit,
            premioUnInicial: precoRecompraUnit,
            premioTotalBruto: 0.0,
            distanciaStrike: "0,00%",
            exercendo: "Não",
            cotacaoOpcao: precoRecompraUnit,
            lucroCapturado: "0,00%",
            custoRecompraTotal:
              linha.valorTotal * (restante / linha.quantidade),
            resultadoBrutoReal: 0.0,
            valorExercicioUn: 0.0,
            valorExercEfetivoTotal: 0.0,
            darf: 0.0,
            resultadoLiquido: 0.0,
            status: "Aberta",
            numeroNotaAbertura: numeroNota,
            custosRateados: custosDaLinha * (restante / linha.quantidade),
            precisaRevisao: true,
          });
        }
      }
    }

    await prisma.$transaction([
      ...(aberturas.length
        ? [prisma.operacao.createMany({ data: aberturas })]
        : []),
      ...(fechamentosParciaisNovos.length
        ? [prisma.operacao.createMany({ data: fechamentosParciaisNovos })]
        : []),
      ...atualizacoesFechamento.map((a) =>
        prisma.operacao.update({ where: { id: a.id }, data: a.data }),
      ),
      prisma.notasProcessadas.create({
        data: {
          id: numeroNota,
          data_importacao: new Date().toISOString(),
          dataPregao,
          ...resumo,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      numeroNota,
      linhasProcessadas: linhas.length,
      posicoesAbertas: aberturas.length,
      posicoesFechadas: atualizacoesFechamento.filter(
        (a) => a.data.status === "Zerada",
      ).length,
      fechamentosParciais: fechamentosParciaisNovos.length,
      avisoSemCorrespondencia:
        semCorrespondencia.length > 0
          ? `${semCorrespondencia.length} linha(s) de recompra sem posição aberta correspondente — revise manualmente (marcadas com precisaRevisao).`
          : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Erro de processamento: " + error.message },
      { status: 500 },
    );
  }
}
