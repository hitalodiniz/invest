// src/app/api/operacoes/route.ts
import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export async function GET() {
  try {
    const dbPath = path.join(process.cwd(), 'prisma/dev.db');
    const db = new Database(dbPath);

    // Busca todas as operações ordenadas pela data mais recente
    const operacoes = db.prepare('SELECT * FROM Operacao ORDER BY data DESC').all();
    db.close();

    return NextResponse.json(operacoes);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Erro ao buscar operações do banco local', details: error.message },
      { status: 500 }
    );
  }
}