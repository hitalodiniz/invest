// app/api/market/route.ts
//
// Preço da AÇÃO: busca real via brapi.dev (API pública de cotações B3). Defina a
// variável de ambiente BRAPI_TOKEN (grátis em https://brapi.dev) — sem token o
// plano free ainda funciona pra poucos tickers, mas com rate limit baixo.
//
// Preço da OPÇÃO: removido. Não existe fonte gratuita e confiável pra isso (o
// scraping do opcoes.net.br violava o robots.txt do site, e a brapi só libera
// opções no plano Pro pago). O preço da opção agora é digitado manualmente pelo
// usuário direto na UI e fica salvo no campo `cotacaoOpcao` de cada operação.

import { NextResponse } from "next/server";

const BRAPI_BASE = "https://brapi.dev/api/quote";

async function buscarPrecosAcoes(
  tickers: string[],
): Promise<Record<string, number>> {
  const tickersValidos = tickers
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);

  if (tickersValidos.length === 0) return {};

  const token = process.env.BRAPI_TOKEN;
  const precos: Record<string, number> = {};

  // Dispara as requisições em paralelo, respeitando o limite de 1 ativo por chamada do plano free
  await Promise.all(
    tickersValidos.map(async (ticker) => {
      try {
        const url = `${BRAPI_BASE}/${ticker}${token ? `?token=${token}` : ""}`;
        const res = await fetch(url, { next: { revalidate: 15 } });

        if (!res.ok) return; // Se um ativo falhar, apenas ignora e continua os outros

        const json = await res.json();
        const item = json.results?.[0];

        if (
          item &&
          item.symbol &&
          typeof item.regularMarketPrice === "number"
        ) {
          precos[item.symbol] = item.regularMarketPrice;
        }
      } catch (err) {
        console.error(`Erro ao buscar ativo individual ${ticker}:`, err);
      }
    }),
  );

  return precos;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ativos = (searchParams.get("ativos") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const prices: Record<string, number> = {};
  const fontes: Record<string, "api" | "estatico"> = {};

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

  return NextResponse.json({
    prices,
    fontes,
    atualizadoEm: new Date().toISOString(),
  });
}
