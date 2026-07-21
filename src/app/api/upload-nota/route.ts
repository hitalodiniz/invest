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

// ─── Mapa prefixo de opção → ativo-base ──────────────────────────────────────
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
  return MAPA_ATIVO_BASE[prefixo] ?? prefixo + "3";
}

// ─── Mapa nome da empresa → ticker (usado em linhas VISTA) ───────────────────
// A nota Clear não imprime o ticker na linha de ação — imprime o nome completo
// colado em VISTA (ex: "VISTAPETROBRAS PN N2"). Esse mapa resolve o ticker.
const MAPA_NOME_TICKER: Array<[string, string]> = [
  ["PETROBRAS", "PETR4"],
  ["VALE", "VALE3"],
  ["COPEL", "CPLE6"],
  ["CEMIG", "CMIG4"],
  ["BRADESCO", "BBDC4"],
  ["GERDAU METALURGICA", "GOAU4"],
  ["GERDAU", "GGBR4"],
  ["ITAUUNIBANCO", "ITUB4"],
  ["ITAU", "ITUB4"],
  ["BANCO DO BRASIL", "BBAS3"],
  ["AMBEV", "ABEV3"],
  ["WEG", "WEGE3"],
  ["LOCALIZA", "RENT3"],
  ["MAGAZINE LUIZA", "MGLU3"],
  ["VIBRA", "VBBR3"],
  ["PETRORIO", "PRIO3"],
  ["TOTVS", "TOTS3"],
  ["SUZANO", "SUZB3"],
  ["LOJAS RENNER", "LREN3"],
  ["EQUATORIAL", "EQTL3"],
  ["USIMINAS", "USIM5"],
  ["CSN", "CSNA3"],
  ["BRADESPAR", "BRAP4"],
];

function resolverTickerAcao(nomeRaw: string): string {
  const nome = nomeRaw.toUpperCase().trim();
  for (const [chave, ticker] of MAPA_NOME_TICKER) {
    if (nome.includes(chave)) return ticker;
  }
  // Fallback: se por acaso já vier com formato de ticker (4 letras + número)
  const tickerMatch = nome.match(/^([A-Z]{4}[0-9]{1,2})\b/);
  if (tickerMatch) return tickerMatch[1];
  return nome.slice(0, 4) + "3";
}

interface LinhaNegociacao {
  cv: "C" | "V";
  tipoMercado: string;
  codigo: string;
  quantidade: number;
  precoUnitario: number; // prêmio da opção
  strikeReal: number; // strike extraído da especificação do título
  vencimento: string | null; // YYYY-MM-DD — terceira segunda do mês do prazo
  valorTotal: number;
}

// Retorna a terceira segunda-feira do mês (padrão B3 para vencimento de opções)
function terceiraSegundaFeira(ano: number, mes: number): string {
  const d = new Date(ano, mes - 1, 1);
  let cont = 0;
  while (cont < 3) {
    if (d.getDay() === 1) cont++;
    if (cont < 3) d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function parseLinhas(text: string): LinhaNegociacao[] {
  const linhas: LinhaNegociacao[] = [];

  // Opções: OPCAO DE COMPRA / VENDA — código tem padrão XXXXL99(99)
  // Captura prazo (MM/YY), código, strike, qtde, prêmio, total
  // "V OPCAO DE COMPRA 07/26 PETRG412 PN 40,11 PETRE 1200 1,10 1.320,00 C"
  // Fix: após o código abreviado (ex: GGBRE, PETRE) pode aparecer sufixo "FM",
  // "FM/EJ" ou outros marcadores antes da quantidade. O .*? lazy pula tudo isso.
  const regexOpcao =
    /([CV])\s+OPCAO\s*DE\s*(COMPRA|VENDA)\s+(\d{2})\/(\d{2})\s+([A-Z]{4}[A-Z]\d{2,4})\s+(?:PN|ON|UNT|PNB|DRN|CI)?\s*(?:N[12])?\s*([\d,]+)\s+.*?#?\s*([\d.]+)\s+([\d,.]+)\s+([\d,.]+)\s+[DC]/gi;

  // Ações à vista: "C VISTAPETROBRAS PN N2 @ 500 39,16 19.580,00 D"
  // VISTA pode estar colado ao nome da empresa — capturamos o nome e mapeamos.
  const regexAcao =
    /([CV])\s+VISTA([A-Z][A-Z\s]+?)\s+(?:PN|ON|UNT|N1|N2|PNB|DRN|CI)?\s*(?:N[12])?\s*(?:@\s*)?([\d.]+)\s+([\d,.]+)\s+([\d,.]+)\s+[DC]/gi;

  // Exercício de opção
  const regexExerc =
    /([CV])\s+EXERC\s*OPC\s+.*?\s+([A-Z]{4}[A-Z]\d{2,4})\s+.*?\s+([\d.]+)\s+([\d,.]+)\s+([\d,.]+)\s+[DC]/gi;

  let m;

  while ((m = regexOpcao.exec(text)) !== null) {
    const [
      ,
      cv,
      tipo,
      prazoMes,
      prazoAno,
      codigo,
      strikeStr,
      qtde,
      preco,
      total,
    ] = m;
    const vencimento = terceiraSegundaFeira(
      2000 + parseInt(prazoAno, 10),
      parseInt(prazoMes, 10),
    );
    linhas.push({
      cv: cv.toUpperCase() as "C" | "V",
      tipoMercado: `OPCAO DE ${tipo.toUpperCase()}`,
      codigo: codigo.trim(),
      quantidade: parseInt(qtde.replace(/\./g, ""), 10),
      precoUnitario: numeroBR(preco),
      strikeReal: numeroBR(strikeStr),
      vencimento,
      valorTotal: numeroBR(total),
    });
  }

  while ((m = regexAcao.exec(text)) !== null) {
    const [, cv, nomeEmpresa, qtde, preco, total] = m;
    const ticker = resolverTickerAcao(nomeEmpresa);
    const qtdeNum = parseInt(qtde.replace(/\./g, ""), 10);
    const jaExiste = linhas.some(
      (l) => l.codigo === ticker && l.quantidade === qtdeNum,
    );
    if (!jaExiste) {
      linhas.push({
        cv: cv.toUpperCase() as "C" | "V",
        tipoMercado: "VISTA",
        codigo: ticker,
        quantidade: qtdeNum,
        precoUnitario: numeroBR(preco),
        strikeReal: numeroBR(preco),
        vencimento: null,
        valorTotal: numeroBR(total),
      });
    }
  }

  while ((m = regexExerc.exec(text)) !== null) {
    const [, cv, codigo, qtde, preco, total] = m;
    linhas.push({
      cv: cv.toUpperCase() as "C" | "V",
      tipoMercado: "EXERC OPC",
      codigo: codigo.trim(),
      quantidade: parseInt(qtde.replace(/\./g, ""), 10),
      precoUnitario: numeroBR(preco),
      strikeReal: numeroBR(preco),
      vencimento: null,
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

interface BlocoNota {
  numeroNota: string;
  dataPregao: string;
  texto: string;
}

// ─── FIX PRINCIPAL: separador correto ────────────────────────────────────────
// O unpdf lineariza a nota Clear na ordem:
//   [linhas de negociação] → [Nr. nota / cabeçalho] → [resumo financeiro]
// Usar "Nr. nota" como separador faz a linha de negociação cair FORA do bloco
// (ela aparece antes do cabeçalho). O separador correto é o cabeçalho da tabela
// de negociações: "Negociações Negócios realizados".
function separarBlocos(text: string): BlocoNota[] {
  const sepRegex = /Negociações\s+Negócios\s+realizados/gi;
  const matches = [...text.matchAll(sepRegex)];
  if (matches.length === 0) return [];

  const blocos: BlocoNota[] = [];
  for (let i = 0; i < matches.length; i++) {
    const inicio = matches[i].index!;
    const fim = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const trecho = text.slice(inicio, fim);

    const notaMatch = trecho.match(/Nr\.\s*nota\s+([\d]+)/i);
    const dataMatch = trecho.match(/Data\s+preg[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);

    if (!notaMatch) {
      console.warn(
        "[upload-nota] Bloco sem Nr. nota — ignorado. Trecho:",
        trecho.slice(0, 200),
      );
      continue;
    }

    blocos.push({
      numeroNota: notaMatch[1],
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
          error:
            "Não foi possível identificar blocos de negociação no documento.",
        },
        { status: 422 },
      );
    }

    // Verifica duplicidade antes de processar qualquer bloco
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
    const blocosSemLinhas: string[] = [];

    for (const bloco of blocos) {
      const { numeroNota, dataPregao, texto } = bloco;

      const linhas = parseLinhas(texto);
      if (linhas.length === 0) {
        console.warn(
          `[upload-nota] Nota ${numeroNota}: 0 linhas reconhecidas. Texto (500 chars): ` +
            texto.slice(0, 500),
        );
        blocosSemLinhas.push(numeroNota);
        continue;
      }

      const resumo = extrairResumoFinanceiro(texto);

      // Rateio de custos apenas sobre linhas de opção (não dilui custo de ação
      // entre as opções nem vice-versa — cada nota tem seus próprios custos).
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

        // ── Ação à vista ────────────────────────────────────────────────
        if (isVista) {
          aberturas.push({
            id: globalThis.crypto.randomUUID(),
            data: dataPregao,
            vencimento: null,
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
            valorExercicioUn: linha.precoUnitario,
            valorExercEfetivoTotal: 0.0,
            darf: 0.0,
            resultadoLiquido: linha.valorTotal,
            status: "Aberta",
            numeroNotaAbertura: numeroNota,
            custosRateados: custosDaLinha,
          });
          continue;
        }

        // ── Venda de opção → abre posição ───────────────────────────────
        if (linha.cv === "V" && (isCall || isPut)) {
          const strikeOpcao = linha.strikeReal ?? linha.precoUnitario;
          const ativoBase = resolverAtivoBase(linha.codigo);
          aberturas.push({
            id: globalThis.crypto.randomUUID(),
            data: dataPregao,
            vencimento: linha.vencimento ?? null,
            ativo: ativoBase,
            operacao: isCall ? "Venda de Call" : "Venda de Put",
            tipo: "Venda",
            codigo: linha.codigo,
            qtde: linha.quantidade,
            cotacaoAcao: 0.0, // desconhecida na nota; preenchida pela API de mercado
            strike: strikeOpcao,
            premioUnInicial: linha.precoUnitario,
            premioTotalBruto: linha.valorTotal,
            distanciaStrike: "0,00%", // recalculada pela API de mercado
            exercendo: "Não",
            cotacaoOpcao: linha.precoUnitario, // igual ao prêmio inicial até edição manual
            lucroCapturado: "0,00%",
            custoRecompraTotal: 0.0,
            resultadoBrutoReal: linha.valorTotal,
            valorExercicioUn: strikeOpcao,
            valorExercEfetivoTotal: isPut
              ? linha.quantidade * strikeOpcao
              : 0.0,
            darf: 0.0,
            resultadoLiquido: linha.valorTotal,
            status: "Aberta",
            numeroNotaAbertura: numeroNota,
            custosRateados: custosDaLinha,
          });
          continue;
        }

        // ── Compra de opção → fecha posição (FIFO) ──────────────────────
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
            semCorrespondencia.push({ ...linha, quantidade: restante });
            aberturas.push({
              id: globalThis.crypto.randomUUID(),
              data: dataPregao,
              vencimento: linha.vencimento ?? null,
              ativo: resolverAtivoBase(linha.codigo),
              operacao: isCall
                ? "Compra de Call (sem par)"
                : "Compra de Put (sem par)",
              tipo: "Compra",
              codigo: linha.codigo,
              qtde: restante,
              cotacaoAcao: precoRecompraUnit,
              strike: linha.strikeReal ?? precoRecompraUnit,
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

    if (resultados.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhuma linha de negociação foi reconhecida em nenhuma nota do PDF. " +
            "Confira os logs do servidor para o texto extraído.",
          notasComFalha: blocosSemLinhas,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      notas: resultados,
      notasSemLinhasReconhecidas:
        blocosSemLinhas.length > 0 ? blocosSemLinhas : null,
      avisoSemCorrespondencia:
        semCorrespondenciaTotal.length > 0
          ? `${semCorrespondenciaTotal.length} linha(s) de recompra sem posição aberta — marcadas com precisaRevisao.`
          : null,
    });
  } catch (error: any) {
    console.error("[upload-nota] Erro inesperado:", error);
    return NextResponse.json(
      { error: "Erro de processamento: " + error.message },
      { status: 500 },
    );
  }
}
