"use client";
import { useEffect, useState, useRef, useMemo } from "react";

export default function DashboardMesa() {
  const [data, setData] = useState<any>(null);
  const [market, setMarket] = useState<any>({ prices: {}, fontes: {} });
  const [idExpandido, setIdExpandido] = useState<string | null>(null);

  // Filtros Globais da Carteira
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

  // Gestão de Capital e Garantia
  const [capitalInput, setCapitalInput] = useState<string>("425.000,00");
  const [tesouroSelic, setTesouroSelic] = useState<number>(425000);

  // Estados do Modal de Importação do PDF
  const [modalUploadAberto, setModalUploadAberto] = useState(false);
  const [arquivoNota, setArquivoNota] = useState<File | null>(null);
  const [senhaNota, setSenhaNota] = useState("684");
  const [statusUpload, setStatusUpload] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [mensagemErro, setMensagemErro] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estados para Edição Direta Inline
  const [idEditando, setIdEditando] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const carregarDashboard = () => {
    fetch("/api/operacoes")
      .then((res) => res.json())
      .then((operacoes) => {
        const ativos = Array.from(
          new Set(operacoes.map((op: any) => op.ativo)),
        );

        let capitalTravadoPuts = 0;
        let desembolsoObrigatorio = 0;
        let premioBruto = 0;
        let resultadoReal = 0;
        let provisaoDarfTotal = 0;
        let resultadoNaoRealizadoTotal = 0;
        let resultadoRealizadoTotal = 0;
        let qtdAbertas = 0;
        let qtdZeradasPositivas = 0;
        let qtdZeradasTotal = 0;

        operacoes.forEach((op: any) => {
          provisaoDarfTotal += op.darf || 0;

          if (op.status === "Aberta") {
            qtdAbertas += 1;
            premioBruto += op.premioTotalBruto;
            resultadoReal += op.resultadoBrutoReal;

            // P&L não-realizado: prêmio recebido menos custo de recompra ao preço manual
            if (op.cotacaoOpcao) {
              resultadoNaoRealizadoTotal +=
                op.premioTotalBruto - op.cotacaoOpcao * op.qtde;
            }

            if (op.operacao.includes("Put")) {
              capitalTravadoPuts += op.valorExercEfetivoTotal;
              if (op.exercendo === "Sim")
                desembolsoObrigatorio += op.valorExercEfetivoTotal;
            }
          } else {
            resultadoReal += op.resultadoLiquido;
            resultadoRealizadoTotal += op.resultadoLiquido;
            qtdZeradasTotal += 1;
            if (op.resultadoLiquido >= 0) qtdZeradasPositivas += 1;
          }
        });

        const taxaSucesso =
          qtdZeradasTotal > 0
            ? (qtdZeradasPositivas / qtdZeradasTotal) * 100
            : null;

        setData({
          operacoes,
          capitalTravadoPuts,
          desembolsoObrigatorio,
          premioBruto,
          resultadoReal,
          provisaoDarfTotal,
          resultadoNaoRealizadoTotal,
          resultadoRealizadoTotal,
          qtdAbertas,
          qtdTotal: operacoes.length,
          taxaSucesso,
        });

        fetch(`/api/market?ativos=${ativos.join(",")}`)
          .then((r) => r.json())
          .then(setMarket);
      });
  };

  useEffect(() => {
    carregarDashboard();
  }, []);

  // Funções de Gerenciamento de Dados (Delete & Update)
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
        estilo: "bg-slate-200 text-slate-600 border-slate-300",
      };
    if (!precoAtualAcao)
      return {
        texto: "AGUARDANDO",
        estilo: "bg-slate-100 text-slate-500 border-slate-200",
      };

    const isCall = op.operacao.includes("Call");
    if (isCall) {
      if (precoAtualAcao > op.strike)
        return {
          texto: "AVALIAR ROLAGEM",
          estilo: "bg-amber-100 text-amber-800 border-amber-300",
        };
      return {
        texto: "MANTER (CALL OTM)",
        estilo: "bg-emerald-100 text-emerald-800 border-emerald-300",
      };
    } else {
      if (precoAtualAcao < op.strike)
        return {
          texto: "DEFENDER / RECOMPRA",
          estilo: "bg-rose-100 text-rose-800 border-rose-300",
        };
      return {
        texto: "MANTER (PUT OTM)",
        estilo: "bg-emerald-100 text-emerald-800 border-emerald-300",
      };
    }
  };

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v || 0);
  const fmtPct = (v: any) =>
    v ? (typeof v === "string" && v.includes("%") ? v : `${v}%`) : "0,00%";

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

    const ordenadas = [...filtradas].sort((a: any, b: any) => {
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
        case "DATA_RECENTE":
        default:
          return b.data.localeCompare(a.data);
      }
    });

    return ordenadas;
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
    <main className="min-h-screen bg-[#f8fafc] text-slate-700 p-8 flex flex-col gap-6 w-full max-w-[100vw] overflow-x-hidden antialiased relative">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5 flex justify-between items-end">
        <div>
          <h1 className="text-xl font-medium text-slate-900 tracking-tight uppercase">
            Mesa Automatizada de Renda
          </h1>
          <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-1">
            Clique em uma posição para ver detalhes e editar
          </p>
        </div>
        <button
          onClick={() => setModalUploadAberto(true)}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-medium tracking-wide shadow-sm transition-colors"
        >
          📄 IMPORTAR NOTA CLEAR
        </button>
      </div>

      {/* Abas de Vencimento */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setAbaVencimento("TODOS")}
          className={`px-4 py-2 text-xs font-medium uppercase tracking-wide border-b-2 transition-colors ${
            abaVencimento === "TODOS"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          Todos os Vencimentos
        </button>
        {abasVencimento.map((chave) => (
          <button
            key={chave}
            onClick={() => setAbaVencimento(chave)}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide border-b-2 transition-colors ${
              abaVencimento === chave
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {formatarAbaVencimento(chave)}
          </button>
        ))}
      </div>

      {/* Grid de Alocação de Capital */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <label className="text-[10px] text-slate-400 font-medium tracking-wider uppercase block">
            Capital de Garantia
          </label>
          <div className="flex items-center mt-1 text-base font-medium text-slate-800">
            <span className="text-slate-400 mr-1 font-light">R$</span>
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
              className="bg-transparent text-slate-800 font-mono font-medium focus:outline-none w-full border-b border-transparent focus:border-slate-300"
            />
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Capital Travado Puts
          </p>
          <p className="text-base font-mono font-medium text-amber-700 mt-1">
            {fmt(data?.capitalTravadoPuts ?? 0)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Desembolso Obrigatório
          </p>
          <p className="text-base font-mono font-medium text-rose-700 mt-1">
            {fmt(data?.desembolsoObrigatorio ?? 0)}
          </p>
        </div>
        <div
          className={`border rounded-xl p-5 shadow-sm ${margemDisponivel >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}
        >
          <p className="text-[10px] font-medium tracking-wider uppercase text-emerald-700">
            Margem Disponível
          </p>
          <p className="text-base font-mono font-medium mt-1 text-emerald-700">
            {fmt(margemDisponivel)}
          </p>
        </div>
      </div>

      {/* Grid de Métricas de Performance */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Prêmio Recebido (Abertas)
          </p>
          <p className="text-sm font-mono font-medium text-sky-700 mt-1">
            {fmt(data?.premioBruto ?? 0)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            P&L Não-Realizado
          </p>
          <p
            className={`text-sm font-mono font-medium mt-1 ${(data?.resultadoNaoRealizadoTotal ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}
          >
            {fmt(data?.resultadoNaoRealizadoTotal ?? 0)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            P&L Realizado
          </p>
          <p
            className={`text-sm font-mono font-medium mt-1 ${(data?.resultadoRealizadoTotal ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}
          >
            {fmt(data?.resultadoRealizadoTotal ?? 0)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Provisão DARF
          </p>
          <p className="text-sm font-mono font-medium text-rose-700 mt-1">
            {fmt(data?.provisaoDarfTotal ?? 0)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Taxa de Sucesso
          </p>
          <p className="text-sm font-mono font-medium text-slate-700 mt-1">
            {data?.taxaSucesso !== null && data?.taxaSucesso !== undefined
              ? `${data.taxaSucesso.toFixed(1)}%`
              : "—"}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Posições Abertas
          </p>
          <p className="text-sm font-mono font-medium text-slate-700 mt-1">
            {data?.qtdAbertas ?? 0}{" "}
            <span className="text-slate-400 font-normal">
              / {data?.qtdTotal ?? 0}
            </span>
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por código ou ativo..."
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none min-w-[200px]"
        />
        <select
          value={filtroAtivo}
          onChange={(e) => setFiltroAtivo(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-medium focus:outline-none min-w-[120px]"
        >
          {listaAtivosUnicos.map((at) => (
            <option key={at} value={at}>
              {at}
            </option>
          ))}
        </select>
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-medium focus:outline-none min-w-[140px]"
        >
          <option value="TODOS">TODOS DERIVATIVOS</option>
          <option value="CALL">CALL (Venda Coberta)</option>
          <option value="PUT">PUT (Venda de Put)</option>
        </select>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-medium focus:outline-none min-w-[120px]"
        >
          <option value="TODOS">TODOS STATUS</option>
          <option value="Aberta">ABERTAS</option>
          <option value="Zerada">ZERADAS</option>
        </select>
        <select
          value={filtroDecisao}
          onChange={(e) => setFiltroDecisao(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-medium focus:outline-none min-w-[180px]"
        >
          <option value="TODOS">TODAS DECISÕES</option>
          <option value="MANTER (CALL OTM)">MANTER (CALL OTM)</option>
          <option value="MANTER (PUT OTM)">MANTER (PUT OTM)</option>
          <option value="AVALIAR ROLAGEM">AVALIAR ROLAGEM</option>
          <option value="DEFENDER / RECOMPRA">DEFENDER / RECOMPRA</option>
        </select>
        <select
          value={ordenacao}
          onChange={(e) => setOrdenacao(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-medium focus:outline-none min-w-[160px]"
        >
          <option value="DATA_RECENTE">MAIS RECENTES</option>
          <option value="DATA_ANTIGA">MAIS ANTIGAS</option>
          <option value="MAIOR_PREMIO">MAIOR PRÊMIO</option>
          <option value="MAIOR_RESULTADO">MAIOR RESULTADO</option>
          <option value="MENOR_RESULTADO">MENOR RESULTADO</option>
        </select>
        <span className="text-[11px] text-slate-400 font-mono ml-auto">
          {operacoesFiltradas.length} de {data?.operacoes?.length ?? 0}{" "}
          operações
        </span>
      </div>

      {/* Grade de Cards */}
      <div className="flex flex-col gap-3 w-full">
        {operacoesFiltradas.map((op: any) => {
          const precoAcaoReal = market.prices[op.ativo] || op.cotacaoAcao;
          const fonteOriginal = market.fontes[op.ativo] || "estatico";
          const gatilho = obterGatilhoDecisao(op, precoAcaoReal);
          const expandido = idExpandido === op.id;
          const editandoEste = idEditando === op.id;

          const resultadoNaoRealizado =
            op.status === "Aberta" && op.cotacaoOpcao
              ? op.premioTotalBruto - op.cotacaoOpcao * op.qtde
              : null;

          return (
            <div
              key={op.id}
              className={`bg-white border rounded-xl overflow-hidden transition-all duration-100 ${expandido ? "border-slate-400 shadow-md ring-1 ring-slate-200" : "border-slate-200 hover:border-slate-300"}`}
            >
              {/* Capa */}
              <div
                onClick={() => setIdExpandido(expandido ? null : op.id)}
                className="py-4 px-6 flex flex-wrap lg:flex-nowrap justify-between items-center gap-6 cursor-pointer select-none"
              >
                <div className="flex items-center gap-6">
                  <div className="w-16">
                    <span className="text-[10px] text-slate-400 block font-mono">
                      {op.data}
                    </span>
                    <span className="text-sm font-medium text-slate-900 block mt-0.5">
                      {op.ativo}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider">
                      Código
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-sm font-medium text-amber-700 font-mono">
                        {op.codigo}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({op.tipo})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-left flex-1 max-w-2xl">
                  <div>
                    <span className="text-[10px] text-slate-400 block flex items-center gap-1.5">
                      Cotação À Vista
                      <span
                        className={`w-2 h-2 rounded-full inline-block ${fonteOriginal === "api" ? "bg-emerald-500" : "bg-amber-400"}`}
                      />
                    </span>
                    <span className="text-sm font-mono font-medium text-sky-600 mt-0.5 block">
                      {fmt(precoAcaoReal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">
                      Strike / Limite
                    </span>
                    <span className="text-sm font-mono text-slate-600 mt-0.5 block">
                      {fmt(op.strike)}{" "}
                      <span className="text-xs text-slate-400 font-light">
                        ({fmtPct(op.distanciaStrike)})
                      </span>
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">
                      Prêmio Bruto
                    </span>
                    <span className="text-sm font-mono text-emerald-600 mt-0.5 block">
                      {fmt(op.premioTotalBruto)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">
                      {op.status === "Zerada"
                        ? "Resultado Líquido"
                        : "P&L Não-Realizado"}
                    </span>
                    <span
                      className={`text-sm font-mono font-medium mt-0.5 block ${
                        op.status === "Zerada"
                          ? op.resultadoLiquido >= 0
                            ? "text-emerald-600"
                            : "text-rose-600"
                          : resultadoNaoRealizado !== null
                            ? resultadoNaoRealizado >= 0
                              ? "text-emerald-600"
                              : "text-rose-600"
                            : "text-slate-400"
                      }`}
                    >
                      {op.status === "Zerada"
                        ? fmt(op.resultadoLiquido)
                        : resultadoNaoRealizado !== null
                          ? fmt(resultadoNaoRealizado)
                          : "sem preço"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span
                    className={`text-[10px] px-2.5 py-1 rounded font-medium border ${gatilho.estilo}`}
                  >
                    {gatilho.texto}
                  </span>
                  <span className="text-xs text-slate-400">
                    {expandido ? "FECHAR" : "DETALHES"}
                  </span>
                </div>
              </div>

              {/* Sub-painel Interno de Detalhes e Gerenciamento */}
              {expandido && (
                <div className="px-6 py-5 border-t border-slate-100 bg-slate-50/60 flex flex-col gap-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-y-4 gap-x-8 text-xs font-mono text-slate-600">
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Estratégia
                      </span>
                      <span className="text-slate-700 font-sans mt-0.5 block">
                        {op.operacao}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Contratos
                      </span>
                      {editandoEste ? (
                        <input
                          type="number"
                          value={editForm.qtde}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              qtde: parseInt(e.target.value),
                            })
                          }
                          className="mt-0.5 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-800 w-24"
                        />
                      ) : (
                        <span className="text-slate-700 mt-0.5 block">
                          {op.qtde.toLocaleString("pt-BR")}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Strike Unitário
                      </span>
                      {editandoEste ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.strike}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              strike: parseFloat(e.target.value),
                            })
                          }
                          className="mt-0.5 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-800 w-24"
                        />
                      ) : (
                        <span className="text-slate-700 mt-0.5 block">
                          {fmt(op.strike)}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Preço Opção (Manual)
                      </span>
                      {editandoEste ? (
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0,00"
                          value={editForm.cotacaoOpcao}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              cotacaoOpcao:
                                e.target.value === ""
                                  ? ""
                                  : parseFloat(e.target.value),
                            })
                          }
                          className="mt-0.5 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-800 w-24"
                        />
                      ) : (
                        <span className="text-purple-600 font-medium mt-0.5 block">
                          {op.cotacaoOpcao ? fmt(op.cotacaoOpcao) : "—"}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Status
                      </span>
                      {editandoEste ? (
                        <select
                          value={editForm.status}
                          onChange={(e) =>
                            setEditForm({ ...editForm, status: e.target.value })
                          }
                          className="mt-0.5 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-800 text-xs"
                        >
                          <option value="Aberta">Aberta</option>
                          <option value="Zerada">Zerada</option>
                        </select>
                      ) : (
                        <span className="text-sky-600 font-sans mt-0.5 block">
                          {op.status}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Vencimento
                      </span>
                      {editandoEste ? (
                        <input
                          type="date"
                          value={editForm.vencimento}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              vencimento: e.target.value,
                            })
                          }
                          className="mt-0.5 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-800 w-32"
                        />
                      ) : (
                        <span className="text-slate-700 mt-0.5 block">
                          {op.vencimento
                            ? new Date(
                                op.vencimento + "T00:00:00",
                              ).toLocaleDateString("pt-BR")
                            : "—"}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">
                        Provisão DARF
                      </span>
                      <span className="text-rose-600 mt-0.5 block">
                        {fmt(op.darf)}
                      </span>
                    </div>
                  </div>

                  {/* BARRA DE AÇÕES OPERACIONAIS */}
                  <div className="flex justify-end gap-3 border-t border-slate-200/60 pt-3 text-xs">
                    {editandoEste ? (
                      <>
                        <button
                          onClick={() => handleSaveEdicao(op.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-medium transition-colors"
                        >
                          SALVAR ALTERAÇÕES
                        </button>
                        <button
                          onClick={() => setIdEditando(null)}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded font-medium transition-colors"
                        >
                          CANCELAR
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => iniciarEdicao(op)}
                          className="border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded font-medium transition-all"
                        >
                          ✏️ EDITAR DADOS
                        </button>
                        <button
                          onClick={() => handleDeleteOperacao(op.id)}
                          className="border border-rose-200 bg-rose-50/50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded font-medium transition-all"
                        >
                          🗑️ DELETAR POSIÇÃO
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {operacoesFiltradas.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-400 font-mono">
            Nenhuma operação encontrada com os filtros atuais.
          </div>
        )}
      </div>

      {/* MODAL DE UPLOAD DE NOTA */}
      {modalUploadAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-5 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">
                Importação de Nota Clear
              </h3>
              <button
                onClick={() => setModalUploadAberto(false)}
                className="text-slate-400 hover:text-slate-700 text-lg"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider block mb-1.5">
                  1. Selecione o arquivo PDF
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  ref={fileInputRef}
                  onChange={(e) =>
                    setArquivoNota(e.target.files ? e.target.files[0] : null)
                  }
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider block mb-1.5">
                  2. Senha do Arquivo
                </label>
                <input
                  type="password"
                  value={senhaNota}
                  onChange={(e) => setSenhaNota(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>
              {statusUpload === "loading" && (
                <p className="text-xs text-amber-600 font-mono text-center animate-pulse mt-2">
                  Processando Nota...
                </p>
              )}
              {statusUpload === "success" && (
                <p className="text-xs text-emerald-600 font-mono text-center font-medium mt-2">
                  ✅ Estrutura de Nota Gravada!
                </p>
              )}
              {statusUpload === "error" && (
                <p className="text-xs text-rose-600 font-mono text-center font-medium mt-2">
                  ❌ {mensagemErro || "Falha na leitura."}
                </p>
              )}
              <button
                onClick={handleUploadNota}
                disabled={!arquivoNota || statusUpload === "loading"}
                className="mt-2 w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white py-2.5 rounded-lg text-xs font-semibold tracking-wider transition-colors"
              >
                LER DADOS E SALVAR NA MESA
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
