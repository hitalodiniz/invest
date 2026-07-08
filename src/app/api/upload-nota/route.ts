// src/app/api/upload-nota/route.ts
export const dynamic = "force-dynamic";
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

function extrairCampoInvertido(text: string, rotulo: RegExp): number {
  const combinado = new RegExp(`([\\d.,]+)\\s*(?:${rotulo.source})`, "i");
  const match = text.match(combinado);
  return match ? numeroBR(match[1]) : 0;
}

// ─── FIX 1: mapa de prefixo → ativo-base real ────────────────────────────────
// "slice(0,4) + '4'" estava errado para CPLE6, VALE3, BBAS3, FIIs etc.
const MAPA_ATIVO_BASE: Record<string, string> = {
  PETR: "PETR4",
  VALE: "VALE3",
  CPLE: "CPLE6",
  CMIG: "CMIG4",
  BBDC: "BBDC4",
  GGBR: "GGBR4",
  ITUB: "ITUB4",
  BBAS: "BBAS3",
  ABEV: "ABEV3",
  WEGE: "WEGE3",
  RENT: "RENT3",
  MGLU: "MGLU3",
  VBBR: "VBBR3",
  PRIO: "PRIO3",
  HCTR: "HCTR11",
  TAEE: "TAEE11",
  TRPL: "TRPL4",
  EGIE: "EGIE3",
  VIVT: "VIVT3",
  SUZB: "SUZB3",
  LREN: "LREN3",
  EQTL: "EQTL3",
  BRAP: "BRAP4",
  USIM: "USIM5",
  CSNA: "CSNA3",
};

function resolverAtivoBase(codigoOpcao: string): string {
  const prefixo = codigoOpcao.slice(0, 4).toUpperCase();
  return MAPA_ATIVO_BASE[prefixo] ?? prefixo + "3"; // fallback seguro
}

// ─── FIX 2: parseLinhas — separar ações de opções corretamente ───────────────
// O problema: a regex anterior capturava linhas de ação à vista sem código de
// opção (ex: "PETROBRAS PN N2") e o campo `codigo` saía errado, fazendo o
// parser buscar o ticker no texto do cabeçalho e retornar "Avenida".
// Solução: duas regex distintas — uma para opções (código tem 6-8 chars com
// letra de série + strike), outra para ações à vista (4 letras + número).

interface LinhaNegociacao {
  cv: "C" | "V";
  tipoMercado: string;
  codigo: string;
  quantidade: number;
  precoUnitario: number;
  valorTotal: number;
}

function parseLinhas(text: string): LinhaNegociacao[] {
  const linhas: LinhaNegociacao[] = [];

  // Regex para OPÇÕES: código tem padrão XXXXL999 (4 letras + letra-série + até 4 dígitos)
  const regexOpcao =
    /(?<cv>[CV])\s+OPCAO\s*DE\s*(?<tipo>COMPRA|VENDA)\s+\S+\s+(?<codigo>[A-Z]{4}[A-Z]\d{2,4})\s+\S+\s+(?<qtde>[\d.]+)\s+(?<preco>[\d,.]+)\s+(?<total>[\d,.]+)\s+[DC]/gi;

  // Regex para AÇÕES À VISTA: código tem padrão XXXX3/XXXX4/XXXX11 etc.
  // A especificação do título é texto livre (PETROBRAS PN N2), mas o código
  // do papel aparece no campo seguinte como ticker puro.
  const regexVista =
    /(?<cv>[CV])\s+VISTA\s+\S+\s+(?<especificacao>.+?)\s+(?<cv2>[CV])\s*#?\s+(?<qtde>[\d.]+)\s+(?<preco>[\d,.]+)\s+(?<total>[\d,.]+)\s+[DC]/gi;

  // Regex para EXERCÍCIO DE OPÇÃO
  const regexExerc =
    /(?<cv>[CV])\s+EXERC\s*OPC\s+\S+\s+(?<codigo>[A-Z]{4}[A-Z]\d{2,4})\s+.*?\s+(?<qtde>[\d.]+)\s+(?<preco>[\d,.]+)\s+(?<total>[\d,.]+)\s+[DC]/gi;

  let m;

  // Opções
  while ((m = regexOpcao.exec(text)) !== null) {
    const { cv, tipo, codigo, qtde, preco, total } = m.groups!;
    linhas.push({
      cv: cv.toUpperCase() as "C" | "V",
      tipoMercado: `OPCAO DE ${tipo.toUpperCase()}`,
      codigo: codigo.trim(),
      quantidade: parseInt(qtde.replace(/\./g, ""), 10),
      precoUnitario: numeroBR(preco),
      valorTotal: numeroBR(total),
    });
  }

  // Ações à vista — usa a linha com C/V + VISTA + quantidade + preço + total
  // Regex mais direta: captura o ticker que vem depois do campo Prazo (vazio)
  // e antes de Obs/Qtde, reconhecendo o padrão de 4 letras + sufixo numérico.
  const regexVistaSimples =
    /([CV])\s+VISTA\s+\s*([A-Z]{4}\d{1,2})\s+.*?\s+([\d.]+)\s+([\d,.]+)\s+([\d,.]+)\s+[DC]/gi;

  // Reset e tenta regex mais simples para ações
  // A nota Clear lineariza assim: "C VISTA  PETR4 PN N2 @ 500 39,16 19.580,00 D"
  // Estratégia: procurar padrão robusto da linha de ação
  const regexAcao =
    /([CV])\s+VISTA\b.*?\b([A-Z]{4}[0-9]{1,2})\b.*?(\d[\d.]*)\s+([\d,.]+)\s+([\d,.]+)\s+[DC]/gi;

  while ((m = regexAcao.exec(text)) !== null) {
    const [, cv, codigo, qtde, preco, total] = m;
    // Evita duplicar com o que já foi capturado (não deve acontecer pois
    // regexOpcao não captura VISTA, mas garantia extra)
    const jaExiste = linhas.some(
      (l) =>
        l.codigo === codigo &&
        l.quantidade === parseInt(qtde.replace(/\./g, ""), 10),
    );
    if (!jaExiste) {
      linhas.push({
        cv: cv.toUpperCase() as "C" | "V",
        tipoMercado: "VISTA",
        codigo: codigo.trim(),
        quantidade: parseInt(qtde.replace(/\./g, ""), 10),
        precoUnitario: numeroBR(preco),
        valorTotal: numeroBR(total),
      });
    }
  }

  // Exercício de opção
  while ((m = regexExerc.exec(text)) !== null) {
    const { cv, codigo, qtde, preco, total } = m.groups!;
    linhas.push({
      cv: cv.toUpperCase() as "C" | "V",
      tipoMercado: "EXERC OPC",
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

// ─── FIX 3: extrair múltiplas notas do mesmo PDF ─────────────────────────────
// A Clear às vezes entrega ação + opção no mesmo PDF com números de nota
// distintos. Precisamos processar cada nota separadamente.
interface BlocoNota {
  numeroNota: string;
  dataPregao: string;
  texto: string; // fatia do texto pertencente a esta nota
}

function separarBlocos(text: string): BlocoNota[] {
  // Cada nota começa com "Nr. nota XXXXXXXXX"
  const regex = /Nr\.\s*nota\s+([\d]+)/gi;
  const matches = [...text.matchAll(regex)];

  if (matches.length === 0) return [];

  const blocos: BlocoNota[] = [];
  for (let i = 0; i < matches.length; i++) {
    const inicio = matches[i].index!;
    const fim = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const trecho = text.slice(inicio, fim);

    const dataMatch = trecho.match(/Data\s+preg[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);

    blocos.push({
      numeroNota: matches[i][1],
      dataPregao: dataMatch ? dataMatch[1] : "",
      texto: trecho,
    });
  }
  return blocos;
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

    const blocos = separarBlocos(text);
    if (blocos.length === 0) {
      return NextResponse.json(
        {
          error: "Não foi possível identificar o número da nota no documento.",
        },
        { status: 422 },
      );
    }

    // Verifica duplicidade de qualquer nota do PDF antes de processar
    for (const bloco of blocos) {
      const existente = await prisma.notasProcessadas.findUnique({
        where: { id: bloco.numeroNota },
      });
      if (existente) {
        return NextResponse.json(
          {
            error: `Nota nº ${bloco.numeroNota} já foi importada anteriormente.`,
          },
          { status: 409 },
        );
      }
    }

    const resultados: any[] = [];
    const semCorrespondenciaTotal: any[] = [];

    for (const bloco of blocos) {
      const { numeroNota, dataPregao, texto } = bloco;

      const linhas = parseLinhas(texto);
      if (linhas.length === 0) continue;

      const resumo = extrairResumoFinanceiro(texto);

      // FIX 3: rateio de custos apenas sobre as linhas de OPÇÕES desta nota
      // (não mistura o valor da ação na base de rateio dos custos de opções)
      const linhasOpcao = linhas.filter((l) => l.tipoMercado !== "VISTA");
      const valorBaseRateio =
        (linhasOpcao.length > 0 ? linhasOpcao : linhas).reduce(
          (soma, l) => soma + l.valorTotal,
          0,
        ) || 1;

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

      const aberturas: any[] = [];
      const atualizacoesFechamento: { id: string; data: any }[] = [];
      const fechamentosParciaisNovos: any[] = [];
      const semCorrespondencia: any[] = [];

      for (const linha of linhas) {
        const isCall = linha.tipoMercado === "OPCAO DE COMPRA";
        const isPut = linha.tipoMercado === "OPCAO DE VENDA";
        const isVista = linha.tipoMercado === "VISTA";
        const custosDaLinha =
          custoOperacionalTotal * (linha.valorTotal / valorBaseRateio);

        // ── Ação à vista ──────────────────────────────────────────────────
        if (isVista) {
          aberturas.push({
            id: globalThis.crypto.randomUUID(),
            data: dataPregao,
            ativo: linha.codigo,
            operacao: linha.cv === "C" ? "Compra de Ação" : "Venda de Ação",
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

        // ── Venda de opção → abre posição ────────────────────────────────
        if (linha.cv === "V" && (isCall || isPut)) {
          const ativoBase = resolverAtivoBase(linha.codigo); // FIX 1
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

        // ── Compra de opção → fecha posição (FIFO) ───────────────────────
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
              premioProporcional > 0
                ? (resultado / premioProporcional) * 100
                : 0;

            if (qtdeFechar === posicao.qtde) {
              atualizacoesFechamento.push({
                id: posicao.id,
                data: {
                  status: "Zerada",
                  cotacaoOpcao: precoRecompraUnit,
                  custoRecompraTotal: custoRecompraProporcional,
                  resultadoBrutoReal: resultado,
                  resultadoLiquido:
                    resultado - custosDaLinha * proporcaoRecompra,
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
                  premioTotalBruto:
                    posicao.premioTotalBruto - premioProporcional,
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
            const ativoBase = resolverAtivoBase(linha.codigo); // FIX 1
            semCorrespondencia.push({ ...linha, quantidade: restante });
            aberturas.push({
              id: globalThis.crypto.randomUUID(),
              data: dataPregao,
              ativo: ativoBase,
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

      // Grava tudo em uma transação por nota
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
            corretora: "Clear CTVM",
            ...resumo,
          },
        }),
      ]);

      resultados.push({
        numeroNota,
        linhasProcessadas: linhas.length,
        posicoesAbertas: aberturas.length,
        posicoesFechadas: atualizacoesFechamento.filter(
          (a) => a.data.status === "Zerada",
        ).length,
        fechamentosParciais: fechamentosParciaisNovos.length,
      });

      semCorrespondenciaTotal.push(...semCorrespondencia);
    }

    return NextResponse.json({
      success: true,
      notas: resultados,
      avisoSemCorrespondencia:
        semCorrespondenciaTotal.length > 0
          ? `${semCorrespondenciaTotal.length} linha(s) de recompra sem posição aberta — marcadas com precisaRevisao.`
          : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Erro de processamento: " + error.message },
      { status: 500 },
    );
  }
}
