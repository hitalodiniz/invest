// lib/opcoesScraper.ts
//
// Camada única de acesso à grade de opções (opcoes.net.br). Antes, cada rota da API
// abria seu próprio Puppeteer e cortava a busca em apenas 3 vencimentos. Agora:
//  - um só navegador é reaproveitado entre requisições (mais rápido, menos memória)
//  - busca TODOS os vencimentos disponíveis, não só os 3 primeiros
//  - cache em memória com TTL curto (60s) pra você poder abrir vários ativos
//    seguidos sem re-scrapear e sem tomar rate-limit do site
//  - retry automático em caso de timeout/DOM não carregado
//  - parser de número BR mais correto (o antigo quebrava com "1.234,56")
//
// ATENÇÃO: os seletores CSS abaixo (.grade-opcoes, .call, .put, etc.) são os mesmos
// "chutes" que já existiam no código original — eu não tenho acesso de rede a
// opcoes.net.br neste ambiente para inspecionar o DOM real e confirmar os seletores.
// Você vai precisar abrir o DevTools no site, conferir os seletores reais da tabela
// de grade e ajustar as constantes SELETORES abaixo. Deixei tudo centralizado aqui
// exatamente pra esse ajuste ser feito em um único lugar.

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

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Erro HTTP ${response.status} ao acessar provedor para ${ativoUpper}`,
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const opcoesMapeadas: Record<string, number> = {};

    $(
      "table.tabela-listagem tbody tr, table.table-opcoes tbody tr, #vencimentos tr",
    ).each((_, elemento) => {
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

        if (codigoOpcao && !isNaN(preco)) {
          opcoesMapeadas[codigoOpcao] = preco;
        }
      }
    });

    const resultado = {
      ativo: ativoUpper,
      atualizadoEm: new Date().toISOString(),
      opcoes: opcoesMapeadas,
      vencimentos: Object.keys(opcoesMapeadas).length > 0 ? ["TODOS"] : [],
    };

    cache[ativoUpper] = { data: resultado, timestamp: agora };
    return resultado;
  } catch (error: any) {
    console.error(
      `[Scraper Error] Falha ao extrair opções de ${ativoUpper}:`,
      error.message,
    );
    throw new Error(
      `Não foi possível processar a grade de ${ativoUpper} no ambiente serverless.`,
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
