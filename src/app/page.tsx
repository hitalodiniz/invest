"use client";
import { useEffect, useState, useRef, useMemo } from "react";

export default function DashboardMesa() {
  const [data, setData] = useState<any>(null);
  const [market, setMarket] = useState<any>({ prices: {}, fontes: {} });
  const [idExpandido, setIdExpandido] = useState<string | null>(null);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  const [filtroAtivo, setFiltroAtivo] = useState<string>("TODOS");
  const [filtroTipo, setFiltroTipo] = useState<string>("TODOS");
  const [filtroDecisao, setFiltroDecisao] = useState<string>("TODOS");
  const [filtroStatus, setFiltroStatus] = useState<string>("TODOS");
  const [busca, setBusca] = useState<string>("");
  const [ordenacao, setOrdenacao] = useState<string>("DATA_RECENTE");
  const [abaVencimento, setAbaVencimento] = useState<string>("TODOS");

  const MESES_PT = [
    "JAN",
    "FEV",
    "MAR",
    "ABR",
    "MAI",
    "JUN",
    "JUL",
    "AGO",
    "SET",
    "OUT",
    "NOV",
    "DEZ",
  ];

  const formatarAbaVencimento = (chaveAnoMes: string) => {
    const [ano, mes] = chaveAnoMes.split("-");
    return `${MESES_PT[parseInt(mes, 10) - 1]}/${ano.slice(2)}`;
  };

  const [capitalInput, setCapitalInput] = useState<string>("425.000,00");
  const [tesouroSelic, setTesouroSelic] = useState<number>(425000);
  // Taxa Selic atual (% a.a.) — usada para comparar o rendimento do TD Selic
  // (onde o capital de garantia fica aplicado) com o yield gerado pelos
  // prêmios das opções. Editável pois muda a cada reunião do Copom (~45 dias).
  // Valor padrão: 14,25% a.a., definido em 17/06/2026.
  const [taxaSelicAnual, setTaxaSelicAnual] = useState<number>(14.25);

  const [modalUploadAberto, setModalUploadAberto] = useState(false);
  const [arquivoNota, setArquivoNota] = useState<File | null>(null);
  const [senhaNota, setSenhaNota] = useState("684");
  const [statusUpload, setStatusUpload] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [mensagemErro, setMensagemErro] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [idEditando, setIdEditando] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  // Modal de Notas Processadas
  const [modalNotasAberto, setModalNotasAberto] = useState(false);
  const [notas, setNotas] = useState<any[]>([]);
  const [notaSelecionada, setNotaSelecionada] = useState<any | null>(null);

  const carregarNotas = () => {
    fetch("/api/notas")
      .then((r) => r.json())
      .then((lista) => setNotas(lista))
      .catch((e) => console.error("Erro ao carregar notas", e));
  };

  // ── Helpers de parsing seguros ──────────────────────────────────────────
  // distanciaStrike pode vir da API como número (ex: 5.23) OU como string
  // (ex: "5,23%"). Chamar .replace() direto quebra quando vem número — foi
  // essa quebra que fazia o dashboard inteiro ficar sem nenhum card (o erro
  // acontecia dentro do .then do fetch, antes de setData ser chamado).
  const parseDistanciaStrike = (v: any): number => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).replace("%", "").replace(",", ".").trim());
    return isNaN(n) ? 0 : n;
  };

  // Data de abertura da operação, com parsing seguro (op.data vem no
  // formato DD/MM/YYYY). Retorna null se o formato for inesperado, em vez
  // de propagar um Invalid Date silenciosamente.
  const parseDataAbertura = (op: any): Date | null => {
    if (typeof op.data !== "string") return null;
    const p = op.data.split("/");
    if (p.length !== 3) return null;
    const d = new Date(`${p[2]}-${p[1]}-${p[0]}`);
    return isNaN(d.getTime()) ? null : d;
  };

  // Dias corridos desde a abertura até hoje (0 se não for possível calcular).
  const diasDesdeAbertura = (op: any): number => {
    const abertura = parseDataAbertura(op);
    if (!abertura) return 0;
    const dias = (new Date().getTime() - abertura.getTime()) / 86400000;
    return dias > 0 ? dias : 0;
  };

  // Replica a fórmula da planilha: decaimento temporal quando a cotação não
  // foi atualizada manualmente (ainda igual ao prêmio unitário inicial).
  // =SE(exercendo="Sim"; premioUn*1,5;
  //    MÁXIMO(0,01; premioUn * EXP(-3*(hoje-abertura)/(venc-abertura))
  //                          * MÁXIMO(0,1; 1-ABS(distancia)/15%)))
  const estimarCotacaoOpcao = (op: any): number => {
    const premioUn: number =
      op.premioUnitario ?? op.premioTotalBruto / Math.max(1, op.qtde);
    if (op.exercendo === "Sim") return premioUn * 1.5;
    const abertura = parseDataAbertura(op);
    let fatorTempo = 1;
    if (op.vencimento && abertura) {
      const venc = new Date(op.vencimento);
      const total = (venc.getTime() - abertura.getTime()) / 86400000;
      const passados = diasDesdeAbertura(op);
      if (total > 0) {
        const ft = Math.exp((-3 * passados) / total);
        if (isFinite(ft) && !isNaN(ft)) fatorTempo = ft;
      }
    }
    const dist = parseDistanciaStrike(op.distanciaStrike) / 100;
    const moneyness = Math.max(0.1, 1 - Math.abs(dist) / 0.15);
    return Math.max(0.01, premioUn * fatorTempo * moneyness);
  };

  // Cotação efetiva: manual se foi editada, estimada (decaimento) caso contrário
  const cotacaoEfetiva = (
    op: any,
  ): { valor: number; origem: "manual" | "estimada" } | null => {
    if (!op.premioTotalBruto || op.status !== "Aberta") return null;
    const editada =
      op.cotacaoOpcao != null &&
      Math.abs(op.cotacaoOpcao - (op.premioUnitario ?? 0)) > 0.001;
    return {
      valor: editada ? op.cotacaoOpcao : estimarCotacaoOpcao(op),
      origem: editada ? "manual" : "estimada",
    };
  };

  const carregarDashboard = () => {
    setErroCarregamento(null);
    fetch("/api/operacoes")
      .then((res) => res.json())
      .then((operacoes) => {
        const ativos = Array.from(
          new Set(operacoes.map((op: any) => op.ativo)),
        );

        let capitalTravadoPuts = 0;
        let desembolsoObrigatorio = 0;
        let premioBruto = 0;
        let provisaoDarfTotal = 0;
        let resultadoNaoRealizadoTotal = 0;
        let resultadoRealizadoTotal = 0;
        let qtdAbertas = 0;
        let qtdZeradasPositivas = 0;
        let qtdZeradasTotal = 0;

        // Média PONDERADA pelo prêmio (não média simples dos percentuais),
        // para não dar o mesmo peso a uma operação de R$ 50 e uma de R$ 5.000.
        let premioBrutoComCotacao = 0;

        operacoes.forEach((op: any) => {
          provisaoDarfTotal += op.darf || 0;

          if (op.status === "Aberta") {
            qtdAbertas += 1;
            premioBruto += op.premioTotalBruto;

            const cot = cotacaoEfetiva(op);
            if (cot && op.premioTotalBruto > 0) {
              const naoRealizado = op.premioTotalBruto - cot.valor * op.qtde;
              resultadoNaoRealizadoTotal += naoRealizado;
              premioBrutoComCotacao += op.premioTotalBruto;
            }

            if (op.operacao.includes("Put")) {
              capitalTravadoPuts += op.valorExercEfetivoTotal;
              if (op.exercendo === "Sim")
                desembolsoObrigatorio += op.valorExercEfetivoTotal;
            }
          } else {
            resultadoRealizadoTotal += op.resultadoLiquido;
            qtdZeradasTotal += 1;
            if (op.resultadoLiquido >= 0) qtdZeradasPositivas += 1;
          }
        });

        setData({
          operacoes,
          capitalTravadoPuts,
          desembolsoObrigatorio,
          premioBruto,
          provisaoDarfTotal,
          resultadoNaoRealizadoTotal,
          resultadoRealizadoTotal,
          qtdAbertas,
          qtdTotal: operacoes.length,
          taxaSucesso:
            qtdZeradasTotal > 0
              ? (qtdZeradasPositivas / qtdZeradasTotal) * 100
              : null,
          lucroCapturadoMedio:
            premioBrutoComCotacao > 0
              ? (resultadoNaoRealizadoTotal / premioBrutoComCotacao) * 100
              : null,
        });

        fetch(`/api/market?ativos=${ativos.join(",")}`)
          .then((r) => r.json())
          .then(setMarket)
          .catch((e) =>
            console.error("Erro ao carregar cotações de mercado", e),
          );
      })
      .catch((e) => {
        console.error("Erro ao carregar operações", e);
        setErroCarregamento(
          "Não foi possível carregar as operações. Verifique o console para detalhes e tente novamente.",
        );
      });
  };

  useEffect(() => {
    carregarDashboard();
    carregarNotas();
  }, []);

  const handleDeleteOperacao = async (id: string) => {
    if (!confirm("Confirmar exclusão definitiva desta operação?")) return;
    try {
      const res = await fetch(`/api/operacoes?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setIdExpandido(null);
        carregarDashboard();
      }
    } catch (e) {
      console.error("Erro ao deletar", e);
    }
  };

  const iniciarEdicao = (op: any) => {
    setIdEditando(op.id);
    setEditForm({
      qtde: op.qtde,
      strike: op.strike,
      status: op.status,
      cotacaoOpcao: op.cotacaoOpcao ?? "",
      vencimento: op.vencimento ?? "",
    });
  };

  const handleSaveEdicao = async (id: string) => {
    try {
      const res = await fetch(`/api/operacoes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editForm }),
      });
      if (res.ok) {
        setIdEditando(null);
        carregarDashboard();
      }
    } catch (e) {
      console.error("Erro ao salvar", e);
    }
  };

  const handleUploadNota = async () => {
    if (!arquivoNota) return;
    setStatusUpload("loading");
    setMensagemErro("");
    const formData = new FormData();
    formData.append("file", arquivoNota);
    formData.append("password", senhaNota);
    try {
      const res = await fetch("/api/upload-nota", {
        method: "POST",
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatusUpload("success");
        setTimeout(() => {
          setModalUploadAberto(false);
          setStatusUpload("idle");
          setArquivoNota(null);
          carregarDashboard();
        }, 2000);
      } else {
        setMensagemErro(json.error || `Erro ${res.status} desconhecido.`);
        setStatusUpload("error");
      }
    } catch (e: any) {
      setMensagemErro(e?.message || "Falha de rede.");
      setStatusUpload("error");
    }
  };

  const obterGatilhoDecisao = (op: any, precoAtualAcao: number) => {
    if (op.status === "Zerada")
      return {
        texto: "ENCERRADA",
        estilo: "bg-slate-100 text-slate-500 border-slate-200",
      };
    if (!precoAtualAcao)
      return {
        texto: "AGUARDANDO",
        estilo: "bg-slate-100 text-slate-400 border-slate-200",
      };
    const isCall = op.operacao.includes("Call");
    if (isCall) {
      if (precoAtualAcao > op.strike)
        return {
          texto: "AVALIAR ROLAGEM",
          estilo: "bg-amber-50 text-amber-700 border-amber-200",
        };
      return {
        texto: "MANTER (CALL OTM)",
        estilo: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    } else {
      if (precoAtualAcao < op.strike)
        return {
          texto: "DEFENDER / RECOMPRA",
          estilo: "bg-red-50 text-red-700 border-red-200",
        };
      return {
        texto: "MANTER (PUT OTM)",
        estilo: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    }
  };

  const calcLucroCapturado = (op: any): number | null => {
    const cot = cotacaoEfetiva(op);
    if (!cot || !op.premioTotalBruto) return null;
    return (
      ((op.premioTotalBruto - cot.valor * op.qtde) / op.premioTotalBruto) * 100
    );
  };

  const calcLucroCapturadoReais = (op: any): number | null => {
    const cot = cotacaoEfetiva(op);
    if (!cot || !op.premioTotalBruto) return null;
    return op.premioTotalBruto - cot.valor * op.qtde;
  };

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v || 0);
  const fmtPct = (v: any) =>
    v ? (typeof v === "string" && v.includes("%") ? v : `${v}%`) : "—";

  const listaAtivosUnicos = [
    "TODOS",
    ...(Array.from(
      new Set(data?.operacoes?.map((op: any) => op.ativo)),
    ) as string[]),
  ];

  const operacoesFiltradas = useMemo(() => {
    const buscaNormalizada = busca.trim().toUpperCase();
    const filtradas = (data?.operacoes || []).filter((op: any) => {
      const precoAcaoReal = market.prices[op.ativo] || op.cotacaoAcao;
      const infoDecisao = obterGatilhoDecisao(op, precoAcaoReal);
      const bateBusca =
        !buscaNormalizada ||
        op.codigo.toUpperCase().includes(buscaNormalizada) ||
        op.ativo.toUpperCase().includes(buscaNormalizada);
      const bateVencimento =
        abaVencimento === "TODOS" ||
        (op.vencimento && op.vencimento.slice(0, 7) === abaVencimento);
      return (
        (filtroAtivo === "TODOS" || op.ativo === filtroAtivo) &&
        (filtroTipo === "TODOS" ||
          (filtroTipo === "CALL" && op.operacao.includes("Call")) ||
          (filtroTipo === "PUT" && op.operacao.includes("Put"))) &&
        (filtroDecisao === "TODOS" || infoDecisao.texto === filtroDecisao) &&
        (filtroStatus === "TODOS" || op.status === filtroStatus) &&
        bateVencimento &&
        bateBusca
      );
    });

    return [...filtradas].sort((a: any, b: any) => {
      switch (ordenacao) {
        case "DATA_ANTIGA":
          return a.data.localeCompare(b.data);
        case "MAIOR_PREMIO":
          return b.premioTotalBruto - a.premioTotalBruto;
        case "MAIOR_RESULTADO":
          return (
            (b.status === "Zerada"
              ? b.resultadoLiquido
              : b.resultadoBrutoReal) -
            (a.status === "Zerada" ? a.resultadoLiquido : a.resultadoBrutoReal)
          );
        case "MENOR_RESULTADO":
          return (
            (a.status === "Zerada"
              ? a.resultadoLiquido
              : a.resultadoBrutoReal) -
            (b.status === "Zerada" ? b.resultadoLiquido : b.resultadoBrutoReal)
          );
        default:
          return b.data.localeCompare(a.data);
      }
    });
  }, [
    data,
    market,
    filtroAtivo,
    filtroTipo,
    filtroDecisao,
    filtroStatus,
    abaVencimento,
    busca,
    ordenacao,
  ]);

  const abasVencimento = useMemo(() => {
    const chaves = new Set<string>();
    (data?.operacoes || []).forEach((op: any) => {
      if (op.vencimento) chaves.add(op.vencimento.slice(0, 7));
    });
    return Array.from(chaves).sort();
  }, [data]);

  const margemDisponivel = tesouroSelic - (data?.capitalTravadoPuts ?? 0);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-700 px-4 py-6 md:px-8 flex flex-col gap-5 w-full max-w-[100vw] overflow-x-hidden antialiased">
      {/* ── Header ── */}
      <div className="flex justify-between items-start gap-3 flex-wrap border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900 tracking-tight uppercase">
            Mesa Automatizada de Renda
          </h1>
          <p className="text-[11px] text-slate-400 uppercase tracking-widest mt-1">
            Toque em uma posição para ver todos os detalhes
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              carregarNotas();
              setModalNotasAberto(true);
            }}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide shadow-sm transition-colors shrink-0"
          >
            🧾 Notas processadas
          </button>
          <button
            onClick={() => setModalUploadAberto(true)}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-semibold tracking-wide shadow-sm transition-colors shrink-0"
          >
            📄 Importar nota Clear
          </button>
        </div>
      </div>

      {erroCarregamento && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <span>⚠️ {erroCarregamento}</span>
          <button
            onClick={carregarDashboard}
            className="shrink-0 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md text-[11px] font-semibold"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── HERO: % Lucro Capturado ── */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-widest">
            % Lucro capturado — posições abertas (média ponderada pelo prêmio)
          </p>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-4xl font-semibold font-mono text-emerald-700 leading-none">
              {data?.lucroCapturadoMedio != null
                ? `${(data.lucroCapturadoMedio as number).toFixed(1)}%`
                : "—"}
            </span>
            <span className="text-sm text-emerald-600">
              do prêmio inicial já garantido
            </span>
          </div>
          <p className="text-xs text-emerald-600 mt-1.5 opacity-80">
            Quanto de cada prêmio recebido já não precisa ser devolvido ao
            mercado
          </p>
          <p className="text-xs font-mono font-semibold text-emerald-700 mt-1">
            {fmt(data?.resultadoNaoRealizadoTotal ?? 0)} em lucro não realizado
            (bruto, antes de custos de recompra e IR)
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
          <span className="bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
            P&L realizado {fmt(data?.resultadoRealizadoTotal ?? 0)}
          </span>
          <span className="text-xs text-emerald-700">
            {data?.qtdAbertas ?? 0} abertas ·{" "}
            {(data?.qtdTotal ?? 0) - (data?.qtdAbertas ?? 0)} zeradas
          </span>
        </div>
      </div>

      {/* ── Abas de vencimento ── */}
      <div className="flex gap-0.5 border-b border-slate-200 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        {["TODOS", ...abasVencimento].map((chave) => (
          <button
            key={chave}
            onClick={() => setAbaVencimento(chave)}
            className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              abaVencimento === chave
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {chave === "TODOS" ? "Todos" : formatarAbaVencimento(chave)}
          </button>
        ))}
      </div>

      {/* ── Capital ── */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
          Alocação de capital
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
              Capital de garantia
            </p>
            <div className="flex items-center mt-1.5">
              <span className="text-slate-400 text-xs mr-1">R$</span>
              <input
                type="text"
                value={capitalInput}
                onChange={(e) => {
                  setCapitalInput(e.target.value);
                  const n = Number(
                    e.target.value.replace(/\./g, "").replace(",", "."),
                  );
                  if (!isNaN(n)) setTesouroSelic(n);
                }}
                className="bg-transparent text-slate-800 font-mono font-semibold text-sm focus:outline-none w-full"
              />
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
              Capital travado puts
            </p>
            <p className="text-sm font-mono font-semibold text-amber-700 mt-1.5">
              {fmt(data?.capitalTravadoPuts ?? 0)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
              Desembolso obrigatório
            </p>
            <p className="text-sm font-mono font-semibold text-red-700 mt-1.5">
              {fmt(data?.desembolsoObrigatorio ?? 0)}
            </p>
          </div>
          <div
            className={`rounded-xl p-4 border ${margemDisponivel >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}
          >
            <p
              className={`text-[11px] font-semibold uppercase tracking-wider ${margemDisponivel >= 0 ? "text-emerald-700" : "text-red-700"}`}
            >
              Margem disponível
            </p>
            <p
              className={`text-sm font-mono font-semibold mt-1.5 ${margemDisponivel >= 0 ? "text-emerald-700" : "text-red-700"}`}
            >
              {fmt(margemDisponivel)}
            </p>
          </div>
        </div>
      </div>

      {/* ── KPIs de performance ── */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
          Performance
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            {
              label: "Prêmio recebido (abertas)",
              val: fmt(data?.premioBruto ?? 0),
              cor: "text-sky-700",
            },
            {
              label: "P&L não-realizado",
              val: fmt(data?.resultadoNaoRealizadoTotal ?? 0),
              cor:
                (data?.resultadoNaoRealizadoTotal ?? 0) >= 0
                  ? "text-emerald-700"
                  : "text-red-700",
            },
            {
              label: "P&L realizado",
              val: fmt(data?.resultadoRealizadoTotal ?? 0),
              cor:
                (data?.resultadoRealizadoTotal ?? 0) >= 0
                  ? "text-emerald-700"
                  : "text-red-700",
            },
            {
              label: "Provisão DARF",
              val: fmt(data?.provisaoDarfTotal ?? 0),
              cor: "text-red-700",
            },
            {
              label: "Taxa de sucesso",
              val:
                data?.taxaSucesso != null
                  ? `${(data.taxaSucesso as number).toFixed(1)}%`
                  : "—",
              cor: "text-slate-800",
            },
            {
              label: "Posições abertas",
              val: `${data?.qtdAbertas ?? 0} / ${data?.qtdTotal ?? 0}`,
              cor: "text-slate-800",
            },
          ].map((k) => (
            <div
              key={k.label}
              className="bg-white border border-slate-200 rounded-xl p-4"
            >
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider leading-tight">
                {k.label}
              </p>
              <p className={`text-sm font-mono font-semibold mt-1.5 ${k.cor}`}>
                {k.val}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código ou ativo…"
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none min-w-[180px] flex-1"
          />
          <select
            value={filtroAtivo}
            onChange={(e) => setFiltroAtivo(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-semibold focus:outline-none"
          >
            {listaAtivosUnicos.map((at) => (
              <option key={at} value={at}>
                {at === "TODOS" ? "Todos os ativos" : at}
              </option>
            ))}
          </select>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-semibold focus:outline-none"
          >
            <option value="TODOS">Todos derivativos</option>
            <option value="CALL">Call (venda coberta)</option>
            <option value="PUT">Put (venda de put)</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-semibold focus:outline-none"
          >
            <option value="TODOS">Todos status</option>
            <option value="Aberta">Abertas</option>
            <option value="Zerada">Zeradas</option>
          </select>
          <select
            value={filtroDecisao}
            onChange={(e) => setFiltroDecisao(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-semibold focus:outline-none"
          >
            <option value="TODOS">Todas decisões</option>
            <option value="MANTER (CALL OTM)">Manter (Call OTM)</option>
            <option value="MANTER (PUT OTM)">Manter (Put OTM)</option>
            <option value="AVALIAR ROLAGEM">Avaliar rolagem</option>
            <option value="DEFENDER / RECOMPRA">Defender / recompra</option>
          </select>
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-semibold focus:outline-none"
          >
            <option value="DATA_RECENTE">Mais recentes</option>
            <option value="DATA_ANTIGA">Mais antigas</option>
            <option value="MAIOR_PREMIO">Maior prêmio</option>
            <option value="MAIOR_RESULTADO">Maior resultado</option>
            <option value="MENOR_RESULTADO">Menor resultado</option>
          </select>
          <span className="text-[11px] text-slate-400 font-mono ml-auto">
            {operacoesFiltradas.length} de {data?.operacoes?.length ?? 0}{" "}
            operações
          </span>
        </div>
      </div>

      {/* ── Cards de operações ── */}
      <div className="flex flex-col gap-3">
        {operacoesFiltradas.map((op: any) => {
          const precoAcaoReal = market.prices[op.ativo] || op.cotacaoAcao;
          const fonteOriginal = market.fontes[op.ativo] || "estatico";
          const emTempoReal = fonteOriginal === "api";
          const gatilho = obterGatilhoDecisao(op, precoAcaoReal);
          const expandido = idExpandido === op.id;
          const editandoEste = idEditando === op.id;
          const pctLucro = calcLucroCapturado(op);
          const resultadoNaoRealizado = calcLucroCapturadoReais(op);
          const cotEfet = cotacaoEfetiva(op);
          const custoRecompraTotal = cotEfet ? cotEfet.valor * op.qtde : null;
          const diasParaVenc = op.vencimento
            ? Math.ceil(
                (new Date(op.vencimento).getTime() - new Date().getTime()) /
                  86400000,
              )
            : null;
          const distNum = parseDistanciaStrike(op.distanciaStrike);

          return (
            <div
              key={op.id}
              className={`bg-white border rounded-xl overflow-hidden transition-all duration-100 ${
                expandido
                  ? "border-slate-400 shadow-md"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              {/* Capa */}
              <div
                onClick={() => setIdExpandido(expandido ? null : op.id)}
                className="p-4 md:py-4 md:px-6 flex flex-col gap-3 cursor-pointer select-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        {op.data}
                      </span>
                      <span className="text-base font-semibold text-slate-900 block">
                        {op.ativo}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                        Código
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-sm font-semibold text-amber-700 font-mono">
                          {op.codigo}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          ({op.tipo})
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {op.precisaRevisao && (
                      <span className="text-[10px] px-2.5 py-1 rounded font-semibold border bg-orange-50 text-orange-700 border-orange-300">
                        ⚠️ REVISAR
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded font-semibold border ${gatilho.estilo}`}
                    >
                      {gatilho.texto}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {expandido ? "▲ fechar" : "▼ detalhes"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2.5">
                  {/* Ação — com indicação explícita de tempo real x estática */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      Cotação ação
                      <span
                        title={
                          emTempoReal
                            ? "Cotação obtida em tempo real"
                            : "Cotação estática (última nota / sem API disponível)"
                        }
                        className={`w-1.5 h-1.5 rounded-full inline-block ${emTempoReal ? "bg-emerald-500" : "bg-amber-400"}`}
                      />
                    </span>
                    <span className="text-sm font-mono font-semibold text-sky-600 mt-0.5 block">
                      {fmt(precoAcaoReal)}
                    </span>
                    <span
                      className={`text-[9px] font-semibold uppercase tracking-wider ${emTempoReal ? "text-emerald-600" : "text-amber-600"}`}
                    >
                      {emTempoReal ? "tempo real" : "estática · última nota"}
                    </span>
                  </div>
                  {/* Qtde de contratos */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Qtde (contratos)
                    </span>
                    <span className="text-sm font-mono font-semibold text-slate-700 mt-0.5 block">
                      {op.qtde?.toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {/* Strike */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Strike
                    </span>
                    <span className="text-sm font-mono text-slate-700 mt-0.5 block">
                      {fmt(op.strike)}
                      <span
                        className={`text-xs ml-1 font-semibold ${distNum < 0 ? "text-emerald-600" : "text-red-600"}`}
                      >
                        ({fmtPct(op.distanciaStrike)})
                      </span>
                    </span>
                  </div>
                  {/* Prêmio */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Prêmio recebido
                    </span>
                    <span className="text-sm font-mono font-semibold text-emerald-600 mt-0.5 block">
                      {fmt(op.premioTotalBruto)}
                    </span>
                  </div>
                  {/* % Lucro capturado — coluna-chave */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      % Lucro capturado
                    </span>
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      {op.status === "Aberta" ? (
                        pctLucro != null ? (
                          <>
                            <span
                              className={`inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${
                                pctLucro >= 0
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-red-50 text-red-700 border-red-200"
                              }`}
                            >
                              {pctLucro >= 0 ? "↑" : "↓"}{" "}
                              {Math.abs(pctLucro).toFixed(1)}%
                            </span>
                            <span
                              className={`text-[10px] font-mono font-semibold ${(resultadoNaoRealizado ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}
                            >
                              {fmt(resultadoNaoRealizado ?? 0)}
                            </span>
                            {cotEfet?.origem === "estimada" && (
                              <span className="text-[9px] text-slate-400 italic">
                                estimado · decaimento
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">
                            sem prêmio informado
                          </span>
                        )
                      ) : (
                        <span
                          className={`text-sm font-mono font-semibold ${op.resultadoLiquido >= 0 ? "text-emerald-600" : "text-red-600"}`}
                        >
                          {fmt(op.resultadoLiquido)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Custo recompra */}
                  {op.status === "Aberta" && (
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                        Custo recompra
                      </span>
                      <span className="text-sm font-mono font-semibold text-red-600 mt-0.5 block">
                        {custoRecompraTotal != null
                          ? fmt(custoRecompraTotal)
                          : "—"}
                      </span>
                      {cotEfet && (
                        <span className="text-[9px] text-slate-400">
                          @ {cotEfet.valor.toFixed(2)}/un{" "}
                          {cotEfet.origem === "manual"
                            ? "· manual"
                            : "· estimado"}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Vencimento + dias */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Vencimento
                    </span>
                    {op.vencimento ? (
                      <>
                        <span className="text-sm font-mono text-slate-700 mt-0.5 block">
                          {new Date(
                            op.vencimento + "T00:00:00",
                          ).toLocaleDateString("pt-BR")}
                        </span>
                        {diasParaVenc != null && op.status === "Aberta" && (
                          <span
                            className={`text-[10px] font-semibold ${
                              diasParaVenc <= 5
                                ? "text-red-600"
                                : diasParaVenc <= 14
                                  ? "text-amber-600"
                                  : "text-slate-400"
                            }`}
                          >
                            {diasParaVenc > 0
                              ? `${diasParaVenc}d restantes`
                              : diasParaVenc === 0
                                ? "vence hoje"
                                : "vencido"}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Painel expandido */}
              {expandido && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 md:px-6 py-5 flex flex-col gap-4">
                  {/* Hero % lucro capturado */}
                  {op.status === "Aberta" && pctLucro != null && (
                    <div
                      className={`rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap border ${
                        pctLucro >= 0
                          ? "bg-emerald-50 border-emerald-200"
                          : "bg-red-50 border-red-200"
                      }`}
                    >
                      <div>
                        <p
                          className={`text-[11px] font-semibold uppercase tracking-widest ${pctLucro >= 0 ? "text-emerald-700" : "text-red-700"}`}
                        >
                          % Lucro capturado
                        </p>
                        <p
                          className={`text-2xl font-mono font-semibold mt-0.5 ${pctLucro >= 0 ? "text-emerald-700" : "text-red-700"}`}
                        >
                          {pctLucro.toFixed(1)}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xs ${pctLucro >= 0 ? "text-emerald-600" : "text-red-600"}`}
                        >
                          {fmt(resultadoNaoRealizado ?? 0)} de{" "}
                          {fmt(op.premioTotalBruto)} garantidos
                        </p>
                        {custoRecompraTotal != null && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            Custo de recompra atual: {fmt(custoRecompraTotal)}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1">
                          Valor bruto — não desconta emolumentos/corretagem de
                          recompra nem eventual DARF
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Todas as 21 colunas */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-4">
                    {[
                      { label: "Data", val: op.data, cor: "" },
                      { label: "Ativo", val: op.ativo, cor: "font-semibold" },
                      { label: "Operação", val: op.operacao, cor: "" },
                      { label: "Tipo", val: op.tipo, cor: "" },
                      {
                        label: "Código",
                        val: op.codigo,
                        cor: "text-amber-700 font-semibold",
                      },
                      {
                        label: "Qtde (contratos)",
                        val: op.qtde?.toLocaleString("pt-BR"),
                        cor: "",
                      },
                      {
                        label: "Cotação ação",
                        val: `${fmt(precoAcaoReal)} · ${emTempoReal ? "tempo real" : "última nota"}`,
                        cor: "text-sky-600",
                      },
                      { label: "Strike", val: fmt(op.strike), cor: "" },
                      {
                        label: "Prêmio un. inicial",
                        val: fmt(op.premioUnitario),
                        cor: "",
                      },
                      {
                        label: "Prêmio total bruto",
                        val: fmt(op.premioTotalBruto),
                        cor: "text-emerald-600 font-semibold",
                      },
                      {
                        label: "Distância do strike",
                        val: fmtPct(op.distanciaStrike),
                        cor: "",
                      },
                      {
                        label: "Exercendo?",
                        val: op.exercendo ?? "Não",
                        cor:
                          op.exercendo === "Sim"
                            ? "text-red-600 font-semibold"
                            : "",
                      },
                      {
                        label: "Cotação opção (manual)",
                        val: op.cotacaoOpcao ? fmt(op.cotacaoOpcao) : "—",
                        cor: "text-violet-600",
                      },
                      {
                        label: "% Lucro capturado",
                        val: pctLucro != null ? `${pctLucro.toFixed(1)}%` : "—",
                        cor:
                          pctLucro != null
                            ? pctLucro >= 0
                              ? "text-emerald-600 font-semibold"
                              : "text-red-600 font-semibold"
                            : "",
                      },
                      {
                        label: "Lucro capturado (R$, bruto)",
                        val:
                          resultadoNaoRealizado != null
                            ? fmt(resultadoNaoRealizado)
                            : "—",
                        cor:
                          resultadoNaoRealizado != null
                            ? resultadoNaoRealizado >= 0
                              ? "text-emerald-600 font-semibold"
                              : "text-red-600 font-semibold"
                            : "",
                      },
                      {
                        label: "Custo recompra total",
                        val:
                          custoRecompraTotal != null
                            ? fmt(custoRecompraTotal)
                            : "—",
                        cor: "text-red-600",
                      },
                      {
                        label: "Resultado bruto real",
                        val: fmt(op.resultadoBrutoReal),
                        cor:
                          (op.resultadoBrutoReal ?? 0) >= 0
                            ? "text-emerald-600"
                            : "text-red-600",
                      },
                      {
                        label: "Valor exercício un.",
                        val: fmt(op.strike),
                        cor: "",
                      },
                      {
                        label: "Valor exerc. efetivo total",
                        val: fmt(op.valorExercEfetivoTotal),
                        cor: "",
                      },
                      { label: "DARF", val: fmt(op.darf), cor: "text-red-600" },
                      {
                        label: "Resultado líquido",
                        val:
                          op.status === "Zerada"
                            ? fmt(op.resultadoLiquido)
                            : "—",
                        cor:
                          (op.resultadoLiquido ?? 0) >= 0
                            ? "text-emerald-600 font-semibold"
                            : "text-red-600 font-semibold",
                      },
                    ].map(({ label, val, cor }) => (
                      <div key={label}>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block leading-tight">
                          {label}
                        </span>
                        <span
                          className={`text-xs font-mono mt-1 block ${cor || "text-slate-700"}`}
                        >
                          {val ?? "—"}
                        </span>
                      </div>
                    ))}
                    <div className="col-span-2 sm:col-span-3 md:col-span-4">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                        Decisão operacional
                      </span>
                      <span
                        className={`inline-block mt-1 text-[11px] px-3 py-1 rounded font-semibold border ${gatilho.estilo}`}
                      >
                        {gatilho.texto}
                      </span>
                    </div>
                  </div>

                  {/* Custos rateados e rastreabilidade */}
                  <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                      Custos e rastreabilidade
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                          Custos rateados
                        </span>
                        <span className="text-xs font-mono mt-1 block text-red-600">
                          {op.custosRateados != null
                            ? fmt(op.custosRateados)
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                          Nota de abertura
                        </span>
                        <span className="text-xs font-mono mt-1 block text-slate-700">
                          {op.numeroNotaAbertura ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                          Nota de fechamento
                        </span>
                        <span className="text-xs font-mono mt-1 block text-slate-700">
                          {op.numeroNotaFechamento ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                          Situação
                        </span>
                        {op.precisaRevisao ? (
                          <span className="inline-block mt-1 text-[11px] px-2.5 py-0.5 rounded font-semibold border bg-orange-50 text-orange-700 border-orange-300">
                            ⚠️ Recompra sem posição — revisar
                          </span>
                        ) : (
                          <span className="inline-block mt-1 text-[11px] px-2.5 py-0.5 rounded font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                            ✓ OK
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex flex-col gap-3 border-t border-slate-200 pt-3">
                    {editandoEste && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[
                          {
                            label: "Qtde",
                            key: "qtde",
                            type: "number",
                            step: "1",
                          },
                          {
                            label: "Strike",
                            key: "strike",
                            type: "number",
                            step: "0.01",
                          },
                          {
                            label: "Cotação opção",
                            key: "cotacaoOpcao",
                            type: "number",
                            step: "0.01",
                          },
                        ].map(({ label, key, type, step }) => (
                          <div key={key}>
                            <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                              {label}
                            </label>
                            <input
                              type={type}
                              step={step}
                              value={editForm[key]}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  [key]:
                                    e.target.value !== ""
                                      ? parseFloat(e.target.value)
                                      : "",
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none"
                            />
                          </div>
                        ))}
                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                            Status
                          </label>
                          <select
                            value={editForm.status}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                status: e.target.value,
                              })
                            }
                            className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none"
                          >
                            <option value="Aberta">Aberta</option>
                            <option value="Zerada">Zerada</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                            Vencimento
                          </label>
                          <input
                            type="date"
                            value={editForm.vencimento}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                vencimento: e.target.value,
                              })
                            }
                            className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      {editandoEste ? (
                        <>
                          <button
                            onClick={() => handleSaveEdicao(op.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                          >
                            Salvar alterações
                          </button>
                          <button
                            onClick={() => setIdEditando(null)}
                            className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => iniciarEdicao(op)}
                            className="border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          >
                            ✏️ Editar dados
                          </button>
                          <button
                            onClick={() => handleDeleteOperacao(op.id)}
                            className="border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          >
                            🗑️ Deletar posição
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {operacoesFiltradas.length === 0 && !erroCarregamento && (
          <div className="text-center py-16 text-sm text-slate-400 font-mono">
            Nenhuma operação encontrada com os filtros atuais.
          </div>
        )}
      </div>

      {/* ── Modal de Notas Processadas ── */}
      {modalNotasAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 shrink-0">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">
                🧾 Notas processadas ({notas.length})
              </h3>
              <button
                onClick={() => {
                  setModalNotasAberto(false);
                  setNotaSelecionada(null);
                }}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">
              {/* Lista de notas */}
              <div className="sm:w-56 border-b sm:border-b-0 sm:border-r border-slate-100 overflow-y-auto shrink-0">
                {notas.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    Nenhuma nota importada.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {notas.map((nota: any) => (
                      <li key={nota.id}>
                        <button
                          onClick={() => setNotaSelecionada(nota)}
                          className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${notaSelecionada?.id === nota.id ? "bg-slate-100" : ""}`}
                        >
                          <span className="block text-xs font-semibold text-slate-900 font-mono">
                            #{nota.id}
                          </span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {nota.dataPregao ?? nota.data_importacao}
                          </span>
                          <span className="block text-[10px] text-slate-500 mt-0.5">
                            {nota.corretora ?? "—"}
                          </span>
                          <span
                            className={`block text-xs font-mono font-semibold mt-1 ${(nota.liquidoNota ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {fmt(nota.liquidoNota ?? 0)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Detalhe da nota selecionada */}
              <div className="flex-1 overflow-y-auto p-5">
                {!notaSelecionada ? (
                  <p className="text-xs text-slate-400 text-center mt-8">
                    Selecione uma nota para ver o detalhamento de taxas.
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                        Identificação
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {
                            label: "Número da nota",
                            val: `#${notaSelecionada.id}`,
                          },
                          {
                            label: "Pregão",
                            val: notaSelecionada.dataPregao ?? "—",
                          },
                          {
                            label: "Corretora",
                            val: notaSelecionada.corretora ?? "—",
                          },
                          {
                            label: "Importada em",
                            val: notaSelecionada.data_importacao,
                          },
                        ].map(({ label, val }) => (
                          <div key={label}>
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                              {label}
                            </span>
                            <span className="text-xs font-mono mt-0.5 block text-slate-700">
                              {val}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                        Resumo operacional
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                            Valor líq. operações
                          </span>
                          <span className="text-xs font-mono mt-0.5 block text-slate-800 font-semibold">
                            {fmt(notaSelecionada.valorLiquidoOperacoes ?? 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                            Líquido da nota
                          </span>
                          <span
                            className={`text-xs font-mono mt-0.5 block font-semibold ${(notaSelecionada.liquidoNota ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {fmt(notaSelecionada.liquidoNota ?? 0)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                        Taxas CBLC
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {
                            label: "Taxa de liquidação",
                            val: notaSelecionada.taxaLiquidacao,
                          },
                          {
                            label: "Taxa de registro",
                            val: notaSelecionada.taxaRegistro,
                          },
                          {
                            label: "Total CBLC",
                            val: notaSelecionada.totalCBLC,
                            destaque: true,
                          },
                        ].map(({ label, val, destaque }) => (
                          <div key={label}>
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                              {label}
                            </span>
                            <span
                              className={`text-xs font-mono mt-0.5 block ${destaque ? "font-semibold text-red-600" : "text-slate-700"}`}
                            >
                              {fmt(val ?? 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                        Taxas B3 / Bovespa
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {
                            label: "Taxa Termo/Opções",
                            val: notaSelecionada.taxaTermoOpcoes,
                          },
                          { label: "Taxa ANA", val: notaSelecionada.taxaANA },
                          {
                            label: "Emolumentos",
                            val: notaSelecionada.emolumentos,
                          },
                          {
                            label: "Taxa transf. ativos",
                            val: notaSelecionada.taxaTransfAtivos,
                          },
                          {
                            label: "Total B3 (soma)",
                            val: notaSelecionada.totalBovespaSoma,
                            destaque: true,
                          },
                        ].map(({ label, val, destaque }: any) => (
                          <div key={label}>
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                              {label}
                            </span>
                            <span
                              className={`text-xs font-mono mt-0.5 block ${destaque ? "font-semibold text-red-600" : "text-slate-700"}`}
                            >
                              {fmt(val ?? 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                        Custos operacionais e IR
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {
                            label: "Taxa operacional",
                            val: notaSelecionada.taxaOperacional,
                          },
                          { label: "Execução", val: notaSelecionada.execucao },
                          {
                            label: "Taxa de custódia",
                            val: notaSelecionada.taxaCustodia,
                          },
                          { label: "Impostos", val: notaSelecionada.impostos },
                          {
                            label: "IRRF retido",
                            val: notaSelecionada.irrf,
                            cor: "text-amber-700 font-semibold",
                          },
                          { label: "Outros", val: notaSelecionada.outros },
                          {
                            label: "Total custos e despesas",
                            val: notaSelecionada.totalCustosDespesas,
                            destaque: true,
                          },
                        ].map(({ label, val, destaque, cor }: any) => (
                          <div key={label}>
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                              {label}
                            </span>
                            <span
                              className={`text-xs font-mono mt-0.5 block ${cor ?? (destaque ? "font-semibold text-red-600" : "text-slate-700")}`}
                            >
                              {fmt(val ?? 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de upload ── */}
      {modalUploadAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-5 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">
                Importação de nota Clear
              </h3>
              <button
                onClick={() => setModalUploadAberto(false)}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">
                  1. Selecione o arquivo PDF
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  ref={fileInputRef}
                  onChange={(e) =>
                    setArquivoNota(e.target.files ? e.target.files[0] : null)
                  }
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">
                  2. Senha do arquivo
                </label>
                <input
                  type="password"
                  value={senhaNota}
                  onChange={(e) => setSenhaNota(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>
              {statusUpload === "loading" && (
                <p className="text-xs text-amber-600 font-mono text-center animate-pulse">
                  Processando nota…
                </p>
              )}
              {statusUpload === "success" && (
                <p className="text-xs text-emerald-600 font-mono text-center font-semibold">
                  ✅ Nota gravada com sucesso!
                </p>
              )}
              {statusUpload === "error" && (
                <p className="text-xs text-red-600 font-mono text-center font-semibold">
                  ❌ {mensagemErro || "Falha na leitura."}
                </p>
              )}
              <button
                onClick={handleUploadNota}
                disabled={!arquivoNota || statusUpload === "loading"}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white py-2.5 rounded-lg text-xs font-semibold tracking-wider transition-colors"
              >
                Ler dados e salvar na mesa
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
