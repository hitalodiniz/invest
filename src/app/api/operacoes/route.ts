// src/app/api/operacoes/route.ts
//
// Reescrita: antes abria better-sqlite3 direto em prisma/dev.db a cada request.
// Agora fala com o Neon via Prisma Client (lib/db.ts). Mesma whitelist de campos
// editáveis e mesmo contrato de resposta que a versão antiga, pra não quebrar o
// front-end que já consome essa rota.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const operacoes = await prisma.operacao.findMany({
      orderBy: { data: "desc" },
    });
    return NextResponse.json(operacoes);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Erro ao buscar operações no Neon", details: error.message },
      { status: 500 },
    );
  }
}

// Campos que o usuário pode editar manualmente pela UI.
// cotacaoOpcao é o preço de recompra digitado manualmente (sem fonte automática).
const CAMPOS_EDITAVEIS = [
  "qtde",
  "strike",
  "status",
  "cotacaoOpcao",
  "vencimento",
] as const;

// Tipos esperados pelo schema Postgres — o SQLite antigo coagia tipo automaticamente
// no bind de parâmetros; o Postgres via Prisma é estrito, então convertemos aqui.
const TIPO_CAMPO: Record<
  (typeof CAMPOS_EDITAVEIS)[number],
  "int" | "float" | "string"
> = {
  qtde: "int",
  strike: "float",
  cotacaoOpcao: "float",
  status: "string",
  vencimento: "string",
};

function coagirValor(campo: (typeof CAMPOS_EDITAVEIS)[number], valor: any) {
  const tipo = TIPO_CAMPO[campo];
  if (tipo === "int") return parseInt(valor, 10);
  if (tipo === "float") return parseFloat(valor);
  return valor;
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "O campo 'id' é obrigatório para atualização." },
        { status: 400 },
      );
    }

    const camposParaAtualizar = CAMPOS_EDITAVEIS.filter(
      (campo) => body[campo] !== undefined,
    );

    if (camposParaAtualizar.length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo válido para atualizar foi enviado." },
        { status: 400 },
      );
    }

    const data: Record<string, any> = {};
    for (const campo of camposParaAtualizar) {
      data[campo] = coagirValor(campo, body[campo]);
    }

    const atualizada = await prisma.operacao.update({
      where: { id },
      data,
    });

    return NextResponse.json({
      success: true,
      id,
      atualizado: camposParaAtualizar,
      operacao: atualizada,
    });
  } catch (error: any) {
    // P2025 = registro não encontrado (equivalente ao "changes === 0" do SQLite)
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Operação não encontrada." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao atualizar operação.", details: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "O parâmetro 'id' é obrigatório." },
        { status: 400 },
      );
    }

    await prisma.operacao.delete({ where: { id } });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Operação não encontrada." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao deletar operação.", details: error.message },
      { status: 500 },
    );
  }
}
