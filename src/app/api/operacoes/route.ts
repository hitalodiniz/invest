// src/app/api/operacoes/route.ts
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

function getDb() {
  const dbPath = path.join(process.cwd(), "prisma/dev.db");
  return new Database(dbPath);
}

export async function GET() {
  try {
    const db = getDb();
    const operacoes = db
      .prepare("SELECT * FROM Operacao ORDER BY data DESC")
      .all();
    db.close();

    return NextResponse.json(operacoes);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Erro ao buscar operações do banco local",
        details: error.message,
      },
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

export async function PUT(request: Request) {
  let db;
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

    const setClause = camposParaAtualizar
      .map((campo) => `"${campo}" = @${campo}`)
      .join(", ");

    db = getDb();
    const stmt = db.prepare(
      `UPDATE "Operacao" SET ${setClause} WHERE id = @id`,
    );

    const params: Record<string, any> = { id };
    for (const campo of camposParaAtualizar) {
      params[campo] = body[campo];
    }

    const resultado = stmt.run(params);
    db.close();

    if (resultado.changes === 0) {
      return NextResponse.json(
        { error: `Nenhuma operação encontrada com id ${id}.` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      id,
      atualizado: camposParaAtualizar,
    });
  } catch (error: any) {
    if (db) db.close();
    return NextResponse.json(
      { error: "Erro ao atualizar operação.", details: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "O parâmetro 'id' é obrigatório." },
        { status: 400 },
      );
    }

    db = getDb();
    const resultado = db.prepare('DELETE FROM "Operacao" WHERE id = ?').run(id);
    db.close();

    if (resultado.changes === 0) {
      return NextResponse.json(
        { error: `Nenhuma operação encontrada com id ${id}.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    if (db) db.close();
    return NextResponse.json(
      { error: "Erro ao deletar operação.", details: error.message },
      { status: 500 },
    );
  }
}
