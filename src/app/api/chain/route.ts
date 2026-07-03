import { NextResponse } from "next/server";
import { getChainCache } from "@/lib/opcoesScraper";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ativoBase = searchParams.get("ativo")?.toUpperCase();
  const forcar = searchParams.get("forcar") === "1";

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
