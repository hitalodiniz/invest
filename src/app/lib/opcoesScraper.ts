import * as cheerio from "cheerio";

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 60 * 1000;

export async function getChainCache(
  ativo: string,
  forcar = false,
): Promise<any> {
  const agora = Date.now();
  const ativoUpper = ativo.trim().toUpperCase();

  if (
    !forcar &&
    cache[ativoUpper] &&
    agora - cache[ativoUpper].timestamp < CACHE_TTL
  ) {
    return cache[ativoUpper].data;
  }

  try {
    const url = `https://www.opcoes.net.br/opcoes/bovespa/${ativoUpper}`;

    console.log(`[Scraper] Iniciando requisição para: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

    console.log(
      `[Scraper Log] HTTP Status: ${response.status} ${response.statusText}`,
    );
    console.log(
      `[Scraper Log] Content-Type: ${response.headers.get("content-type")}`,
    );

    const html = await response.text();

    // LOG DO CONTEÚDO RECEBIDO: Printa os primeiros 500 caracteres para checar se é HTML real ou WAF/Block
    console.log(
      `[Scraper Log] Início do HTML retornado (Primeiros 500 chars):\n`,
      html.substring(0, 500),
    );

    const $ = cheerio.load(html);
    const opcoesMapeadas: Record<string, number> = {};

    // Conta quantos elementos das tabelas existem na página para validar os seletores
    console.log(`[Scraper Log] Qtd tabelas encontradas:`, $("table").length);
    console.log(
      `[Scraper Log] Qtd linhas em tabela.tabela-listagem:`,
      $("table.tabela-listagem tbody tr").length,
    );

    $(
      "table.tabela-listagem tbody tr, table.table-opcoes tbody tr, #vencimentos tr, table[id^='tbl'] tbody tr",
    ).each((i, elemento) => {
      const colunas = $(elemento).find("td");
      if (colunas.length >= 3) {
        const codigoOpcao = $(colunas[0]).text().trim().toUpperCase();
        const precoTexto = $(colunas[2])
          .text()
          .trim()
          .replace("R$", "")
          .replace(/\s/g, "")
          .replace(/\./g, "")
          .replace(",", ".");

        const preco = parseFloat(precoTexto);

        if (
          codigoOpcao &&
          codigoOpcao.length >= 6 &&
          !isNaN(preco) &&
          preco > 0
        ) {
          opcoesMapeadas[codigoOpcao] = preco;
        }
      }
    });

    console.log(
      `[Scraper Log] Total de opções parseadas com sucesso:`,
      Object.keys(opcoesMapeadas).length,
    );

    const resultado = {
      ativo: ativoUpper,
      atualizadoEm: new Date().toISOString(),
      opcoes: opcoesMapeadas,
      vencimentos: Object.keys(opcoesMapeadas).length > 0 ? ["TODOS"] : [],
    };

    cache[ativoUpper] = { data: resultado, timestamp: agora };
    return resultado;
  } catch (error: any) {
    console.error(`[Scraper Fatal Error]:`, error.message);
    throw new Error(
      `Falha no processamento do HTML do provedor: ${error.message}`,
    );
  }
}

export function buscarPrecoOpcaoNoCache(codigoOpcao: string): number | null {
  const codigoUpper = codigoOpcao.trim().toUpperCase();
  for (const ativo in cache) {
    const dadosGrade = cache[ativo].data;
    if (
      dadosGrade &&
      dadosGrade.opcoes &&
      dadosGrade.opcoes[codigoUpper] !== undefined
    ) {
      return dadosGrade.opcoes[codigoUpper];
    }
  }
  return null;
}
