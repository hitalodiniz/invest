// app/api/market/route.ts
//
// ANTES: não sabemos como essa rota buscava preço (arquivo original não foi enviado),
// mas pelo uso no dashboard (market.fontes[ativo] === "estatico" | "api") ela já tinha
// noção de fonte real vs. fallback. Aqui deixo isso mais robusto e explícito:
//
//  - Preço da AÇÃO: busca real via brapi.dev (API pública de cotações B3). Defina a
//    variável de ambiente BRAPI_TOKEN (grátis em https://brapi.dev) — sem token o
//    plano free ainda funciona pra poucos tickers, mas com rate limit baixo.
//  - Preço da OPÇÃO: não existe API B3 gratuita e confiável para grade de opções,
//    então a fonte continua sendo o scraping — mas agora reaproveitando o cache de
//    lib/opcoesScraper.ts (60s de TTL), então N posições do mesmo ativo não disparam
//    N scrapes, só 1.
//
// IMPORTANTE: o front-end agora manda um parâmetro `mapa` (codigo:ativo,codigo:ativo)
// pra essa rota saber a qual ativo cada opção pertence, em vez de "adivinhar" pelas
// 4 primeiras letras do ticker (isso quebrava em tickers com prefixo maior/menor).

import { NextResponse } from "next/server";
import { getChainCache, buscarPrecoOpcaoNoCache } from "@/lib/opcoesScraper";

const BRAPI_BASE = "https://brapi.dev/api/quote";

async function buscarPrecosAcoes(
  tickers: string[],
): Promise<Record<string, number>> {
  // 1. Filtra removendo espaços extras e eliminando itens vazios ou nulos
  const tickersValidos = tickers
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);

  // 2. Se não sobrar nenhum ativo válido, aborta antes de chamar a API
  if (tickersValidos.length === 0) return {};

  const token = process.env.BRAPI_TOKEN;

  // 3. Monta a URL estritamente com os tickers limpos
  const url = `${BRAPI_BASE}/${tickersValidos.join(",")}${token ? `?token=${token}` : ""}`;

  const res = await fetch(url, { next: { revalidate: 15 } });

  if (!res.ok) {
    // Adiciona log para sabermos exatamente qual URL falhou se o erro persistir
    console.error(`Falha na Brapi. URL chamada: ${url}`);
    throw new Error(`brapi.dev respondeu ${res.status}`);
  }

  const json = await res.json();

  const precos: Record<string, number> = {};
  for (const item of json.results || []) {
    if (item.symbol && typeof item.regularMarketPrice === "number") {
      precos[item.symbol] = item.regularMarketPrice;
    }
  }
  return precos;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ativos = (searchParams.get("ativos") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const opcoes = (searchParams.get("opcoes") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mapaParam = searchParams.get("mapa") || ""; // "CODIGO:ATIVO,CODIGO:ATIVO"

  const codigoParaAtivo = new Map<string, string>();
  mapaParam
    .split(",")
    .map((par) => par.split(":"))
    .forEach(([codigo, ativo]) => {
      if (codigo && ativo)
        codigoParaAtivo.set(codigo.trim(), ativo.trim().toUpperCase());
    });

  const prices: Record<string, number> = {};
  const fontes: Record<string, "api" | "estatico" | "scraping"> = {};

  // 1. Ações via brapi.dev
  try {
    const precosAcoes = await buscarPrecosAcoes(ativos);
    for (const at of ativos) {
      if (precosAcoes[at] != null) {
        prices[at] = precosAcoes[at];
        fontes[at] = "api";
      } else {
        fontes[at] = "estatico";
      }
    }
  } catch (e) {
    console.error("Erro ao buscar cotações na brapi.dev:", e);
    ativos.forEach((at) => (fontes[at] = "estatico"));
  }

  // 2. Opções: garante que a grade de cada ativo envolvido esteja no cache
  const ativosEnvolvidos = new Set<string>();
  opcoes.forEach((codigo) => {
    const ativo = codigoParaAtivo.get(codigo);
    if (ativo) ativosEnvolvidos.add(ativo);
  });

  await Promise.all(
    Array.from(ativosEnvolvidos).map(async (ativo) => {
      try {
        await getChainCache(ativo);
      } catch (e) {
        console.error(
          `Erro ao atualizar grade de ${ativo} para cotação de opções:`,
          e,
        );
      }
    }),
  );

  for (const codigo of opcoes) {
    const preco = buscarPrecoOpcaoNoCache(codigo);
    if (preco != null) {
      prices[codigo] = preco;
      fontes[codigo] = "scraping";
    } else {
      fontes[codigo] = "estatico";
    }
  }

  return NextResponse.json({
    prices,
    fontes,
    atualizadoEm: new Date().toISOString(),
  });
}
