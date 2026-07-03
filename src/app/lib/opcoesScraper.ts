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

import puppeteer, { Browser } from "puppeteer-core";

export interface OpcaoChainItem {
  ticker: string;
  tipo: "CALL" | "PUT";
  strike: number;
  precoOpcao: number;
  vencimento: string;
}

export interface ChainResult {
  ativo: string;
  precoAcao: number | null;
  vencimentos: string[];
  chain: OpcaoChainItem[];
  atualizadoEm: string;
  fonte: "opcoes.net" | "cache";
}

// Ajuste estes seletores conforme o DOM real do site.
const SELETORES = {
  precoAtivo:
    '[data-testid="preco-ativo"], .preco-ativo, .cotacao-ativo, #cotacaoAtivo',
  selectVencimento:
    'select[name="vencimento"], #vencimento, .vencimentos select',
  linhasGrade:
    ".grade-opcoes tbody tr, #gradeDeOpcoes tbody tr, table tbody tr",
  callLink: ".call a, .CALL a, td:nth-child(2) a",
  putLink: ".put a, .PUT a, td:nth-child(6) a",
  strikeCell: ".strike, .STRIKE, td.strike, td:nth-child(4)",
  precoCallCell: ".call-preco, td:nth-child(3)",
  precoPutCell: ".put-preco, td:nth-child(7)",
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: ChainResult; expira: number }>();

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    browserPromise.catch(() => {
      browserPromise = null; // permite tentar de novo se o launch falhar
    });
  }
  return browserPromise;
}

function parseNumeroBR(txt: string | null | undefined): number {
  if (!txt) return 0;
  // remove tudo que não é dígito, vírgula, ponto ou sinal
  let limpo = txt.replace(/[^\d,.-]/g, "").trim();
  // se tem vírgula, ela é o separador decimal -> ponto é milhar e deve sumir
  if (limpo.includes(",")) {
    limpo = limpo.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(limpo);
  return isNaN(n) ? 0 : n;
}

async function scrapeChain(ativoBase: string): Promise<ChainResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    );
    await page.setViewport({ width: 1366, height: 900 });

    const url = `https://opcoes.net.br/opcoes/bovespa/${ativoBase}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    const precoAcao = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const txt = el?.textContent || "";
      const n = parseFloat(
        txt
          .replace(/[^\d,.-]/g, "")
          .replace(".", "")
          .replace(",", "."),
      );
      return isNaN(n) ? null : n;
    }, SELETORES.precoAtivo);

    const vencimentos: { value: string; text: string }[] = await page.evaluate(
      (sel) => {
        const select = document.querySelector(sel) as HTMLSelectElement | null;
        if (!select) return [];
        // TODOS os vencimentos, sem cortar em 3 — é isso que permite comparar
        // quantas datas você quiser sem precisar tirar print de cada uma
        return Array.from(select.options).map((opt) => ({
          value: opt.value,
          text: opt.text.trim(),
        }));
      },
      SELETORES.selectVencimento,
    );

    if (vencimentos.length === 0) {
      throw new Error(
        `Nenhum vencimento encontrado para ${ativoBase}. Confira se o ticker existe e se os seletores em lib/opcoesScraper.ts ainda batem com o site.`,
      );
    }

    const gradeConsolidada: OpcaoChainItem[] = [];

    for (const v of vencimentos) {
      await page.evaluate(
        (sel, val) => {
          const select = document.querySelector(
            sel,
          ) as HTMLSelectElement | null;
          if (select) {
            select.value = val;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        },
        SELETORES.selectVencimento,
        v.value,
      );

      await page
        .waitForSelector(SELETORES.linhasGrade, { timeout: 6000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 500)); // dá tempo do AJAX assentar

      const linhasMes = await page.evaluate(
        (sel, vencimentoTexto) => {
          const rows = document.querySelectorAll(sel.linhasGrade);
          const dados: any[] = [];
          rows.forEach((row) => {
            const callAnchor = row.querySelector(sel.callLink);
            const putAnchor = row.querySelector(sel.putLink);
            const strikeCell = row.querySelector(sel.strikeCell);
            const precoCallCell = row.querySelector(sel.precoCallCell);
            const precoPutCell = row.querySelector(sel.precoPutCell);

            const strikeTxt = strikeCell?.textContent?.trim() || "";
            if (callAnchor && strikeTxt) {
              dados.push({
                ticker: callAnchor.textContent?.trim(),
                tipo: "CALL",
                strikeTxt,
                precoTxt: precoCallCell?.textContent?.trim() || "",
                vencimento: vencimentoTexto,
              });
            }
            if (putAnchor && strikeTxt) {
              dados.push({
                ticker: putAnchor.textContent?.trim(),
                tipo: "PUT",
                strikeTxt,
                precoTxt: precoPutCell?.textContent?.trim() || "",
                vencimento: vencimentoTexto,
              });
            }
          });
          return dados;
        },
        SELETORES,
        v.text,
      );

      for (const item of linhasMes) {
        if (!item.ticker) continue;
        gradeConsolidada.push({
          ticker: item.ticker,
          tipo: item.tipo,
          strike: parseNumeroBR(item.strikeTxt),
          precoOpcao: parseNumeroBR(item.precoTxt),
          vencimento: item.vencimento,
        });
      }
    }

    return {
      ativo: ativoBase,
      precoAcao,
      vencimentos: vencimentos.map((v) => v.text),
      chain: gradeConsolidada,
      atualizadoEm: new Date().toISOString(),
      fonte: "opcoes.net",
    };
  } finally {
    await page.close();
  }
}

async function scrapeComRetry(
  ativo: string,
  tentativas = 2,
): Promise<ChainResult> {
  let ultimoErro: any;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await scrapeChain(ativo);
    } catch (e) {
      ultimoErro = e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw ultimoErro;
}

/** Busca a grade completa de um ativo, usando cache de 60s. */
export async function getChainCache(
  ativo: string,
  forcar = false,
): Promise<ChainResult> {
  const chave = ativo.toUpperCase();
  const cacheado = cache.get(chave);
  if (!forcar && cacheado && cacheado.expira > Date.now()) {
    return { ...cacheado.data, fonte: "cache" };
  }
  const resultado = await scrapeComRetry(chave);
  cache.set(chave, { data: resultado, expira: Date.now() + CACHE_TTL_MS });
  return resultado;
}

/** Procura o preço de um ticker de opção específico em qualquer grade já cacheada. */
export function buscarPrecoOpcaoNoCache(codigo: string): number | null {
  for (const entry of cache.values()) {
    const achado = entry.data.chain.find((o) => o.ticker === codigo);
    if (achado) return achado.precoOpcao;
  }
  return null;
}
