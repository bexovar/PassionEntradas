"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compararAZ } from "@/lib/orden";

type Margen = {
  id: string;
  source: string;
  competicion: string | null;
  porcentaje: number;
};

// Márgenes de precio del portal: el % que se le suma al precio de origen.
// Las reglas van por EVENTO/COMPETICIÓN (ej: el Mundial entero); el margen
// general cubre lo que no tenga regla. Al guardar se recalculan los precios
// ya publicados y el worker usa las reglas en cada corrida.
// También vive acá la cotización EUR->USD: el portal cotiza en euros y la
// tienda muestra todo en dólares.
export default function MargenesPanel() {
  const [margenes, setMargenes] = useState<Margen[]>([]);
  const [competiciones, setCompeticiones] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [nuevaCat, setNuevaCat] = useState("");
  const [nuevoPct, setNuevoPct] = useState("");
  const [eurUsd, setEurUsd] = useState<number | null>(null);
  const [eurUsdDraft, setEurUsdDraft] = useState<string | null>(null);
  const [arsPorUsd, setArsPorUsd] = useState<number | null>(null);
  const [arsDraft, setArsDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  const enviando = useRef(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch("/api/margenes").then((r) => r.json()),
      fetch("/api/cotizacion").then((r) => r.json()),
    ])
      .then(([data, cot]) => {
        if (!vivo) return;
        setMargenes(data.margenes ?? []);
        setCompeticiones(data.competiciones ?? []);
        if (typeof cot.eurUsd === "number") setEurUsd(cot.eurUsd);
        if (typeof cot.arsPorUsd === "number") setArsPorUsd(cot.arsPorUsd);
      })
      .catch(() => vivo && setAviso({ tipo: "error", msg: "No se pudieron cargar los precios" }))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  function avisar(tipo: "ok" | "error", msg: string) {
    setAviso({ tipo, msg });
    setTimeout(() => setAviso(null), 4500);
  }

  async function guardar(competicion: string | null, valor: string) {
    if (enviando.current) return;
    const pct = Number(valor);
    if (!Number.isFinite(pct) || pct < 0 || pct > 500) {
      avisar("error", "Porcentaje inválido (0 a 500)");
      return;
    }
    enviando.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/margenes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competicion, porcentaje: pct }),
      });
      const data = await res.json();
      if (!res.ok) {
        avisar("error", data.error ?? "No se pudo guardar");
        return;
      }
      setMargenes((prev) => {
        const sin = prev.filter((m) => m.competicion !== competicion);
        return [...sin, data.margen];
      });
      setDrafts((d) => {
        const { [keyDe(competicion)]: _, ...resto } = d;
        return resto;
      });
      setNuevaCat("");
      setNuevoPct("");
      avisar("ok", `Margen guardado — ${data.recalculadas} precios recalculados`);
    } catch {
      avisar("error", "Error de red al guardar");
    } finally {
      enviando.current = false;
      setBusy(false);
    }
  }

  async function borrar(competicion: string) {
    if (enviando.current) return;
    enviando.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/margenes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competicion }),
      });
      const data = await res.json();
      if (!res.ok) {
        avisar("error", data.error ?? "No se pudo borrar");
        return;
      }
      setMargenes((prev) => prev.filter((m) => m.competicion !== competicion));
      avisar("ok", `Regla borrada — ${data.recalculadas} precios recalculados con el margen general`);
    } catch {
      avisar("error", "Error de red al borrar");
    } finally {
      enviando.current = false;
      setBusy(false);
    }
  }

  async function guardarCotizacion() {
    if (enviando.current) return;
    const v = Number(eurUsdDraft);
    if (!Number.isFinite(v) || v < 0.5 || v > 3) {
      avisar("error", "Cotización inválida: cuántos dólares vale 1 euro (entre 0.5 y 3)");
      return;
    }
    enviando.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/cotizacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eurUsd: v }),
      });
      const data = await res.json();
      if (!res.ok) {
        avisar("error", data.error ?? "No se pudo guardar la cotización");
        return;
      }
      setEurUsd(data.eurUsd);
      setEurUsdDraft(null);
      avisar("ok", `Cotización guardada: 1 € = ${data.eurUsd} US$`);
    } catch {
      avisar("error", "Error de red al guardar");
    } finally {
      enviando.current = false;
      setBusy(false);
    }
  }

  // Pesos por dólar: NO se usa para cobrar (las entradas en pesos se cobran en
  // pesos). Solo compara precios en pesos con precios en dólares para elegir
  // el "desde" de un evento y ordenar sus sectores.
  async function guardarArs() {
    if (enviando.current || arsDraft === null) return;
    enviando.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/cotizacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arsPorUsd: arsDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        avisar("error", data.error ?? "No se pudo guardar la cotización");
        return;
      }
      setArsPorUsd(data.arsPorUsd);
      setArsDraft(null);
      avisar("ok", `Cotización guardada: 1 US$ = ${data.arsPorUsd} pesos`);
    } catch {
      avisar("error", "Error de red al guardar");
    } finally {
      enviando.current = false;
      setBusy(false);
    }
  }

  const keyDe = (competicion: string | null) => competicion ?? "__general__";
  const general = margenes.find((m) => m.competicion === null);
  const reglas = useMemo(
    () =>
      margenes
        .filter((m) => m.competicion !== null)
        .sort((a, b) => compararAZ(a.competicion as string, b.competicion as string)),
    [margenes]
  );
  const sinRegla = useMemo(
    () =>
      competiciones
        .filter((c) => !margenes.some((m) => m.competicion === c))
        .sort(compararAZ),
    [competiciones, margenes]
  );

  const inputPctCls =
    "h-10 w-20 rounded-lg border border-line bg-white px-2.5 text-right font-mono text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15";
  const btnCls =
    "rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-50";

  // Márgenes o cotizaciones sin guardar: el refresco automático espera.
  const conCambios =
    Object.keys(drafts).length > 0 || nuevaCat !== "" || nuevoPct !== "" || eurUsdDraft !== null || arsDraft !== null;

  return (
    <section
      className="card-shadow overflow-hidden rounded-2xl"
      data-editando={conCambios ? "" : undefined}
    >
      <div className="surface-ink punch-b px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
          Entradas de Passion
        </p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">
          Cotización y margen
        </h2>
      </div>

      <div className="punch-t bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-[#4A4E5E]">
            Esto aplica <b>solo a las entradas que vienen de Passion</b> (las
            propias se publican con el precio que cargás, tal cual). Passion
            cotiza en euros: acá definís a cuántos dólares se convierte y qué
            porcentaje de ganancia se le suma a cada entrada, por evento o
            competición (una regla para el Mundial cubre todos sus partidos).
            Al guardar se actualizan al instante los precios de la tienda, y
            cada sincronización usa estas reglas.
          </p>

          {aviso && (
            <p
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
              }`}
              role="status"
            >
              {aviso.msg}
            </p>
          )}

          {cargando ? (
            <p className="py-4 text-center text-sm text-muted">Cargando…</p>
          ) : (
            <>
              {/* Cotización EUR -> USD */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Cotización dólar-euro</p>
                  <p className="text-xs text-muted">
                    Cuántos dólares vale 1 euro
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">1 € =</span>
                  <input
                    aria-label="Cotización EUR a USD"
                    className={inputPctCls}
                    inputMode="decimal"
                    value={eurUsdDraft ?? String(eurUsd ?? "")}
                    onChange={(e) => setEurUsdDraft(e.target.value)}
                  />
                  <span className="text-sm text-muted">US$</span>
                  <button
                    onClick={guardarCotizacion}
                    disabled={busy || eurUsdDraft === null}
                    className={btnCls}
                  >
                    Guardar
                  </button>
                </div>
              </div>

              {/* Cotización USD -> ARS (entradas propias en pesos) */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Cotización dólar-peso</p>
                  <p className="text-xs text-muted">
                    Solo para comparar precios en pesos con precios en dólares (el &quot;desde&quot; de un evento). Las entradas en pesos se cobran en pesos
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">1 US$ =</span>
                  <input
                    aria-label="Cotización USD a ARS"
                    className={inputPctCls.replace("w-20", "w-28")}
                    inputMode="decimal"
                    placeholder="1465,50"
                    value={arsDraft ?? (arsPorUsd != null ? String(arsPorUsd) : "")}
                    onChange={(e) => setArsDraft(e.target.value)}
                  />
                  <span className="text-sm text-muted">$</span>
                  <button onClick={guardarArs} disabled={busy || arsDraft === null} className={btnCls}>
                    Guardar
                  </button>
                </div>
              </div>

              {/* Margen general */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Margen general</p>
                  <p className="text-xs text-muted">
                    Toda entrada de Passion sin regla propia
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Porcentaje del margen general"
                    className={inputPctCls}
                    inputMode="decimal"
                    value={drafts.__general__ ?? String(general?.porcentaje ?? 20)}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, __general__: e.target.value }))
                    }
                  />
                  <span className="text-sm text-muted">%</span>
                  <button
                    onClick={() =>
                      guardar(null, drafts.__general__ ?? String(general?.porcentaje ?? 20))
                    }
                    disabled={busy || drafts.__general__ === undefined}
                    className={btnCls}
                  >
                    Guardar
                  </button>
                </div>
              </div>

              {/* Reglas por evento/competición */}
              {reglas.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5"
                >
                  {/* En móvil el nombre del torneo ocupa su línea completa;
                      los controles bajan. En sm+ comparten fila. */}
                  <p className="w-full min-w-0 break-words text-sm font-medium sm:w-auto sm:flex-1 sm:truncate">
                    {m.competicion}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`Porcentaje de ${m.competicion}`}
                      className={inputPctCls}
                      inputMode="decimal"
                      value={drafts[keyDe(m.competicion)] ?? String(m.porcentaje)}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [keyDe(m.competicion)]: e.target.value }))
                      }
                    />
                    <span className="text-sm text-muted">%</span>
                    <button
                      onClick={() =>
                        guardar(m.competicion, drafts[keyDe(m.competicion)] ?? String(m.porcentaje))
                      }
                      disabled={busy || drafts[keyDe(m.competicion)] === undefined}
                      className={btnCls}
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => borrar(m.competicion as string)}
                      disabled={busy}
                      className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))}

              {/* Agregar regla */}
              <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-4">
                <select
                  aria-label="Evento para la nueva regla"
                  value={nuevaCat}
                  onChange={(e) => setNuevaCat(e.target.value)}
                  // En celular, a lo ancho en su propio renglón: al lado del %
                  // y del botón quedaba "Elegir eve…".
                  className="h-10 w-full min-w-0 rounded-lg border border-line bg-white px-2.5 text-sm outline-none focus:border-brand sm:w-auto sm:flex-1"
                >
                  <option value="">Elegir evento…</option>
                  {sinRegla.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Porcentaje de la nueva regla"
                  className={inputPctCls}
                  inputMode="decimal"
                  placeholder="25"
                  value={nuevoPct}
                  onChange={(e) => setNuevoPct(e.target.value)}
                />
                <span className="text-sm text-muted">%</span>
                <button
                  onClick={() => guardar(nuevaCat, nuevoPct)}
                  disabled={busy || !nuevaCat || !nuevoPct}
                  className={btnCls}
                >
                  Agregar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
