// app/api/chain/route.ts
//
// Antes: abria um Puppeteer novo a cada chamada e cortava em 3 vencimentos
// (`.slice(0, 3)`), e o preço da opção vinha de um atributo `data-preco` que
// provavelmente nunca existiu de verdade no DOM (por isso o fallback fixo de 0.15
// aparecia sempre — esse era o bug raiz da cotação "furada").
//
// Agora: delega tudo pra lib/opcoesScraper.ts, que já cuida de cache, retry e
// parsing correto de número BR, e devolve TODOS os vencimentos disponíveis.

import { NextResponse } from "next/server";
import { getChainCache } from "@/lib/opcoesScraper";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ativoBase = searchParams.get("ativo")?.toUpperCase();
  const forcar = searchParams.get("forcar") === "1"; // pula o cache de 60s

  if (!ativoBase) {
    return NextResponse.json(
      { error: "Ativo base é obrigatório" },
      { status: 400 },
    );
  }

  try {
    const resultado = await getChainCache(ativoBase, forcar);
    return NextResponse.json(resultado);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Falha ao consultar a grade de opções" },
      { status: 500 },
    );
  }
}
