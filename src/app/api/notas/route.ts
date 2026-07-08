// app/api/notas/route.ts
import { prisma } from "@/app/lib/db";
import { NextResponse } from "next/server";

// Impede que o Next.js tente conectar ao Neon no momento do deploy/build
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const notas = await prisma.notasProcessadas.findMany({
      orderBy: { dataPregao: "desc" },
    });
    return NextResponse.json(notas);
  } catch (error) {
    console.error("[GET /api/notas]", error);
    return NextResponse.json(
      { error: "Erro ao buscar notas." },
      { status: 500 },
    );
  }
}
