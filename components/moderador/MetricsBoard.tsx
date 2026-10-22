"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatMonto, type Moneda } from "@/lib/operaciones";
import type { Metrics } from "@/lib/metrics";
import { urlPanel, type FiltroPanel } from "@/lib/panel-filtros";

// Tablero del negocio en el módulo de carga: cuánta plata se movió (pagos
// confirmados), cuántas entradas se vendieron, la comisión ganada, y dos
// métricas operativas: exposición actual ("en juego") y ticket promedio.
// Filtrable por rango de fechas (cuándo se confirmó el pago); "en juego"
// es exposición ACTUAL y no depende del rango.

function Tile({
  label,
  value,
  detail,
  accent,
  big = false,
  className = "",
  href,
}: {
  label: string;
  value: string;
  detail?: string;
  accent: string;
  big?: boolean;
  className?: string;
  // Con href la tarjeta abre el Panel con las operaciones que suma.
  href?: string;
}) {
  const contenido = (
    <>
      <p className="text-[10px] font-medium uppercase leading-snug tracking-[0.14em] text-muted">
        {label}
      </p>
      <p
        className={`mt-0.5 font-display font-bold tabular-nums tracking-tight [overflow-wrap:anywhere] ${
          // En 320px dos tarjetas por fila: a 2xl el monto quedaba "US$ 40.…".
          big ? "text-xl min-[380px]:text-2xl" : "text-lg"
        }`}
        style={{ color: accent }}
        title={value}
      >
        {value}
      </p>
      {detail && <p className="text-[11px] leading-snug text-muted">{detail}</p>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        title={`Ver en el Panel: ${label}`}
        className={`block min-w-0 px-4 py-3.5 transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${className}`}
      >
        {contenido}
      </Link>
    );
  }
  return <div className={`min-w-0 px-4 py-3.5 ${className}`}>{contenido}</div>;
}

// Presets del filtro de período (por fecha de pago confirmado). El rango se
// calcula en la zona horaria local del navegador.
type Preset = "todo" | "mes" | "mes_pasado" | "30" | "anio" | "custom";

function rangoDePreset(p: Preset): { desde: string; hasta: string } {
  const hoy = new Date();
  const dia = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  switch (p) {
    case "mes":
      return { desde: dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: dia(hoy) };
    case "mes_pasado":
      return {
        desde: dia(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
        hasta: dia(new Date(hoy.getFullYear(), hoy.getMonth(), 0)),
      };
    case "30": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 30);
      return { desde: dia(d), hasta: dia(hoy) };
    }
    case "anio":
      return { desde: dia(new Date(hoy.getFullYear(), 0, 1)), hasta: dia(hoy) };
    default:
      return { desde: "", hasta: "" };
  }
}

export default function MetricsBoard({
  metrics: inicial,
  enlacesPanel = false,
}: {
  metrics: Metrics;
  enlacesPanel?: boolean;
}) {
  const [metricsTodas, setMetrics] = useState<Metrics>(inicial);
  // Pestaña de moneda: cada una se muestra por separado, nunca sumadas.
  const [monedaSel, setMonedaSel] = useState<string | null>(null);
  const monedas = [metricsTodas, ...(metricsTodas.otrasMonedas ?? [])];
  const metrics = monedas.find((m) => m.moneda === monedaSel) ?? metricsTodas;
  const fmt = (n: number) =>
    formatMonto(n, (metrics.moneda as Moneda) ?? "USD", { sinDecimales: true });
  const [preset, setPreset] = useState<Preset>("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [cargando, setCargando] = useState(false);
  // Descarta respuestas viejas si el usuario cambia el rango rápido.
  const pedido = useRef(0);

  async function aplicarRango(d: string, h: string) {
    const id = ++pedido.current;
    setCargando(true);
    try {
      const qs = new URLSearchParams();
      if (d) qs.set("desde", d);
      if (h) qs.set("hasta", h);
      const res = await fetch(`/api/metricas?${qs.toString()}`);
      if (!res.ok || id !== pedido.current) return;
      setMetrics((await res.json()) as Metrics);
    } catch {
      // sin red: el tablero se queda como estaba
    } finally {
      if (id === pedido.current) setCargando(false);
    }
  }

  // Cuando la página se refresca (llegó una operación o cambió un pago),
  // `inicial` trae las métricas nuevas. Sin esto el tablero se quedaba con
  // las del primer render. Con un período elegido se vuelve a pedir ese rango.
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if (preset === "todo") setMetrics(inicial);
    else if (desde || hasta) void aplicarRango(desde, hasta);
    // Solo cuando llegan datos nuevos del servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);

  function elegirPreset(p: Preset) {
    setPreset(p);
    if (p === "custom") return; // espera a que carguen las fechas
    const r = rangoDePreset(p);
    setDesde(r.desde);
    setHasta(r.hasta);
    void aplicarRango(r.desde, r.hasta);
  }

  // Link al Panel con lo que suma cada tarjeta: misma moneda y, para lo
  // cobrado, el mismo período del tablero.
  const moneda = metrics.moneda === "ARS" || metrics.moneda === "USD" ? metrics.moneda : undefined;
  const enlace = (filtro: FiltroPanel["filtro"]) =>
    enlacesPanel
      ? urlPanel({
          filtro,
          moneda,
          ...(filtro === "cobradas" ? { desde: desde || undefined, hasta: hasta || undefined } : {}),
        })
      : undefined;

  const inputCls =
    "w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15";

  return (
    <section aria-label="Resumen del negocio" className="mb-6">
      {/* Período por fecha de pago confirmado: un select con los rangos de
          siempre (robusto en desktop y móvil) y, solo si se elige
          "Personalizado", los dos campos de fecha con el estilo del panel. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted">
          Resumen{cargando ? "…" : ""}
        </h2>
        <select
          aria-label="Período de las métricas"
          value={preset}
          onChange={(e) => elegirPreset(e.target.value as Preset)}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-[#4A4E5E] shadow-sm outline-none focus:border-brand sm:w-auto"
        >
          <option value="todo">Todo el historial</option>
          <option value="mes">Este mes</option>
          <option value="mes_pasado">Mes pasado</option>
          <option value="30">Últimos 30 días</option>
          <option value="anio">Este año</option>
          <option value="custom">Personalizado…</option>
        </select>
      </div>

      {preset === "custom" && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="m-desde"
              className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted"
            >
              Pagos desde
            </label>
            <input
              id="m-desde"
              type="date"
              className={inputCls}
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                void aplicarRango(e.target.value, hasta);
              }}
            />
          </div>
          <div>
            <label
              htmlFor="m-hasta"
              className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted"
            >
              Hasta
            </label>
            <input
              id="m-hasta"
              type="date"
              className={inputCls}
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                void aplicarRango(desde, e.target.value);
              }}
            />
          </div>
        </div>
      )}
      {monedas.length > 1 && (
        <div className="mb-2 flex gap-1.5" role="tablist" aria-label="Moneda">
          {monedas.map((m) => (
            <button
              key={m.moneda}
              role="tab"
              aria-selected={m.moneda === metrics.moneda}
              onClick={() => setMonedaSel(m.moneda)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                m.moneda === metrics.moneda
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-[#4A4E5E] hover:bg-canvas"
              }`}
            >
              {m.moneda === "ARS" ? "Pesos (ARS)" : "Dólares (USD)"}
            </button>
          ))}
        </div>
      )}
      <div className="card-shadow overflow-hidden rounded-2xl bg-white">
        {/* Fila principal. En móvil la plata movida ocupa la fila entera
            (los montos en ARS no entran en tercios de 390px); comisión y
            ventas comparten la segunda. En md+ van las tres en línea. */}
        <div className="grid grid-cols-2 md:grid-cols-3">
          <Tile
            big
            label="Volumen operado"
            value={fmt(metrics.plataMovida)}
            detail="Total con pago confirmado"
            accent="#0D9377"
            href={enlace("cobradas")}
            className="col-span-2 border-b border-dashed border-line md:col-span-1 md:border-b-0 md:border-r"
          />
          <Tile
            big
            label="Comisiones acumuladas"
            value={fmt(metrics.comisionGanada)}
            detail="Sobre ventas confirmadas"
            accent="#6C5BF2"
            href={enlace("cobradas")}
            className="border-r border-dashed border-line"
          />
          <Tile
            big
            label="Entradas vendidas"
            value={String(metrics.entradasVendidas).padStart(2, "0")}
            detail="Con pago confirmado"
            accent="#B07A14"
            href={enlace("cobradas")}
          />
        </div>
        <div className="perf-line-light" />
        {/* Fila secundaria: lo operativo */}
        <div className="grid grid-cols-2">
          <Tile
            label="Capital comprometido"
            value={fmt(metrics.enJuegoMonto)}
            detail={`En ${metrics.enJuegoOps} ${
              metrics.enJuegoOps === 1
                ? "operación en curso sin cobrar"
                : "operaciones en curso sin cobrar"
            }`}
            accent="#5F6577"
            href={enlace("sin_cobrar")}
            className="border-r border-dashed border-line"
          />
          <Tile
            label="Precio promedio"
            value={fmt(metrics.ticketPromedio)}
            detail="Por entrada vendida"
            accent="#5F6577"
          />
        </div>
      </div>
    </section>
  );
}
