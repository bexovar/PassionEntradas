"use client";

// Una consulta dentro de la lista del panel.
//
// Las consultas ya no tienen sección propia: llegan mezcladas con las
// operaciones, que es donde el admin mira. Lo que las distingue es el signo de
// pregunta: significa "hay que chequear si hay stock y cerrar precio". Cuando
// se le carga el precio deja de ser consulta y pasa a ser una operación más de
// la misma lista.

import { useState } from "react";
import ConfirmarBoton from "@/components/ConfirmarBoton";
import { formatMonto, quienDe, type Consulta, type Moneda } from "@/lib/operaciones";
import { parsePrecio } from "@/lib/precios";
import { estadoCotizacion, tiempoRestante } from "@/lib/cotizaciones";

type Props = {
  consulta: Consulta;
  // Lleva rato esperando (lib/recordatorios): va en rojo, con la edad.
  prioridad?: string | null;
  busy?: boolean;
  // Manda (o cambia) la cotización al cliente. NO crea el pedido: eso pasa
  // cuando el cliente la acepta. Devuelve el error si falló, o null.
  onCotizar: (
    c: Consulta,
    valores: { costo: number; comision: number; moneda: Moneda }
  ) => Promise<string | null>;
  // El cliente dijo que sí por WhatsApp: el staff lo registra y nace el pedido.
  onAceptarWhatsapp?: (c: Consulta) => void;
  onError: (msg: string) => void;
  // Cierra la consulta sin precio (no hay entrada). El cliente la ve como
  // "No disponible". Opcional: sin esto no se muestra el botón.
  onDescartar?: (c: Consulta) => void;
};

const inputCls =
  "h-9 w-full rounded-lg border border-line bg-white px-2.5 text-sm tabular-nums outline-none focus:border-brand";
const labelCls =
  "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted";

function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.split("-");
  const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  return `${d} ${meses[Number(m) - 1] ?? ""}`;
}

export default function ConsultaCard({
  consulta: c,
  busy = false,
  onCotizar,
  onAceptarWhatsapp,
  onError,
  onDescartar,
  prioridad = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirmandoWa, setConfirmandoWa] = useState(false);
  // Cotizada: se muestra la cotización; "Cambiar" abre el form precargado.
  const est = estadoCotizacion(c);
  const cotizada = est === "esperando" || est === "vencida";
  const [editando, setEditando] = useState(false);
  const montoCot = Number(c.cotizacion_monto ?? 0);
  const feeCot = Number(c.cotizacion_fee ?? 0);
  const [costo, setCosto] = useState(cotizada ? String(montoCot - feeCot) : "");
  const [comision, setComision] = useState(cotizada ? String(feeCot) : "");
  // Arranca en la moneda en que se cobraría esa entrada (pesos si es una
  // propia cargada en pesos). Antes arrancaba siempre en USD y había que
  // acordarse de cambiarla.
  const [moneda, setMoneda] = useState<Moneda>(c.moneda ?? "USD");

  // Cotización a medio escribir: el refresco automático espera (ver
  // components/AutoRefresh.tsx).
  const cotizando = editando || (!cotizada && (costo !== "" || comision !== ""));

  const cliente = c.comprador_alias ?? c.cliente_email ?? null;
  // Vista previa del total mientras escribe: es lo que se le va a cobrar.
  const previo = parsePrecio(costo, comision);
  const total = previo.ok ? previo.total : null;

  async function cotizar() {
    const r = parsePrecio(costo, comision);
    if (!r.ok) {
      onError(r.error);
      return;
    }
    const err = await onCotizar(c, { costo: r.costo, comision: r.comision, moneda });
    if (!err) setEditando(false);
  }

  const chip =
    est === "a_cotizar"
      ? { txt: "A cotizar", color: "#B07A14" }
      : est === "esperando"
        ? { txt: "Esperando cliente", color: "#1F33E0" }
        : { txt: "Vencida", color: "#D14D68" };
  const mostrarForm = !cotizada || editando;

  return (
    <article
      data-editando={cotizando ? "" : undefined}
      className={`card-shadow overflow-hidden rounded-2xl bg-white ${prioridad ? "ring-2" : "ring-1"}`}
      style={{ ["--tw-ring-color" as string]: prioridad ? "#D14D68" : `${chip.color}40` }}
    >
      {/* Prioridad (lib/recordatorios): lleva rato esperando. */}
      {prioridad && (
        <p className="flex items-center gap-1.5 bg-[#D14D68] px-4 py-1 text-[11px] font-bold text-white">
          <span aria-hidden>●</span>
          {prioridad}
        </p>
      )}

      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas/40"
      >
        {/* El signo de pregunta ocupa el lugar del semáforo: la consulta no
            tiene hitos que semaforear, tiene una pregunta sin responder. */}
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: chip.color }}
          title={cotizada ? "Cotización enviada al cliente" : "Consulta: chequear stock y cerrar precio"}
          aria-label={cotizada ? "Cotización enviada al cliente" : "Consulta: chequear stock y cerrar precio"}
        >
          ?
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">
            {c.evento}
          </span>
          {cliente && (
            <span className="mt-0.5 block text-[11px] font-medium text-[#4A4E5E] [overflow-wrap:anywhere]">
              {cliente}
            </span>
          )}
          <span className="mt-0.5 block font-mono text-[10px] uppercase leading-snug tracking-wider text-muted">
            <span className="whitespace-nowrap">{c.code}</span> ·{" "}
            {cotizada
              ? `${formatMonto(montoCot, (c.moneda ?? "USD") as Moneda)} · ${tiempoRestante(c.vence_at)}`
              : "Consulta — chequear stock"}
            {c.fecha_evento ? ` · ${fechaCorta(c.fecha_evento)}` : ""}
          </span>
          {/* En celular el estado va debajo: al costado le dejaba al nombre
              del evento una columna de 90px ("Elimina-torias"). */}
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:hidden"
            style={{ color: chip.color, backgroundColor: `${chip.color}1A` }}
          >
            {chip.txt}
          </span>
        </span>
        <span
          className="hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline-block"
          style={{ color: chip.color, backgroundColor: `${chip.color}1A` }}
        >
          {chip.txt}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-dashed border-[#C5C9D6] p-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6A6E7E]">
            <span>
              Sector <span className="font-medium text-body">{c.sector ?? "General"}</span>
            </span>
            {c.cantidad > 1 && (
              <span>
                Cantidad <span className="font-medium text-body">×{c.cantidad}</span>
              </span>
            )}
            {c.cliente_email && c.cliente_email !== c.comprador_alias && (
              <span className="break-all font-medium text-body">{c.cliente_email}</span>
            )}
          </div>

          {c.notas && (
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas px-3 py-2.5 text-xs text-[#4A4E5E]">
              {c.notas}
            </p>
          )}

          {cotizada && !editando && (
            <div
              className={`mt-4 rounded-xl border px-3.5 py-3 ${
                est === "vencida" ? "border-[#D14D68]/30 bg-[#D14D68]/5" : "border-[#1F33E0]/25 bg-[#1F33E0]/5"
              }`}
            >
              <p className="text-sm font-semibold text-ink">
                Cotización enviada:{" "}
                {/* El monto no se parte ("US$" / "450,00"). */}
                <span className="whitespace-nowrap font-display tabular-nums">
                  {formatMonto(montoCot, (c.moneda ?? "USD") as Moneda)}
                </span>
                <span className="ml-1 whitespace-nowrap text-xs font-normal text-muted">
                  (comisión {formatMonto(feeCot, (c.moneda ?? "USD") as Moneda)})
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {est === "vencida"
                  ? "Venció sin respuesta. Cambiala para mandarle una nueva."
                  : `El cliente la acepta desde Mis pedidos · ${tiempoRestante(c.vence_at)}`}
                {c.cotizada_por ? ` · por ${quienDe(c.cotizada_por)}` : ""}
                {(c.cotizacion_version ?? 1) > 1 ? ` · versión ${c.cotizacion_version}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {onAceptarWhatsapp && est === "esperando" && (
                  <button
                    onClick={() => {
                      // Dos toques: crea el pedido a nombre del cliente.
                      if (!confirmandoWa) {
                        setConfirmandoWa(true);
                        window.setTimeout(() => setConfirmandoWa(false), 4000);
                        return;
                      }
                      setConfirmandoWa(false);
                      onAceptarWhatsapp(c);
                    }}
                    disabled={busy}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      confirmandoWa ? "bg-[#0D9377] text-white" : "border border-[#0D9377] text-[#0D9377] hover:bg-[#0D9377]/5"
                    }`}
                    title="Registra que el cliente aceptó por WhatsApp y crea el pedido"
                  >
                    {confirmandoWa ? "¿Confirmás? Crea el pedido" : "El cliente aceptó por WhatsApp"}
                  </button>
                )}
                <button
                  onClick={() => setEditando(true)}
                  disabled={busy}
                  className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas disabled:opacity-50"
                >
                  Cambiar cotización
                </button>
              </div>
            </div>
          )}

          {mostrarForm && (<>
          {/* Precio = costo + comisión. Se cobra el total; el desglose es
              interno (la factura muestra solo el total). */}
          {/* Cada campo en su celda: la moneda pegada al importe dejaba el
              input de costo en 22px en pantalla de celular. */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls} htmlFor={`moneda-${c.id}`}>
                Moneda
              </label>
              <select
                id={`moneda-${c.id}`}
                className={inputCls}
                value={moneda}
                onChange={(e) => setMoneda(e.target.value as Moneda)}
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor={`costo-${c.id}`}>
                Costo
              </label>
              <input
                id={`costo-${c.id}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${inputCls} font-mono`}
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor={`comision-${c.id}`}>
                Comisión
              </label>
              <input
                id={`comision-${c.id}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${inputCls} font-mono`}
                value={comision}
                onChange={(e) => setComision(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Total al cliente{" "}
              <span className="font-display text-sm font-bold tabular-nums text-body">
                {total != null ? formatMonto(total, moneda) : "—"}
              </span>
            </p>
            <span className="flex flex-wrap items-center gap-2">
              {onDescartar && (
                <ConfirmarBoton
                  onConfirm={() => onDescartar(c)}
                  disabled={busy}
                  className="rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 border-estado-cancelada text-estado-cancelada hover:bg-estado-cancelada/5"
                  title="No hay entrada: se le muestra al cliente como no disponible"
                  pregunta="¿Descartar la consulta?"
                  si="Sí, no disponible"
                  siClassName="rounded-xl bg-estado-cancelada px-3 py-2 text-xs font-semibold text-white"
                  noClassName="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-[#4A4E5E] hover:bg-canvas"
                  preguntaClassName="text-xs font-semibold text-ink"
                >
                  No disponible
                </ConfirmarBoton>
              )}
              {editando && (
                <button
                  onClick={() => setEditando(false)}
                  disabled={busy}
                  className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-[#4A4E5E] hover:bg-canvas disabled:opacity-50"
                >
                  Volver
                </button>
              )}
              <button
                onClick={cotizar}
                disabled={busy || total == null}
                className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-50"
                title="El cliente la ve en Mis pedidos y la acepta o la rechaza"
              >
                {busy ? "Enviando…" : editando ? "Enviar nueva cotización" : "Enviar cotización"}
              </button>
            </span>
          </div>
          </>)}

          {/* Cotizada: "No disponible" sigue a mano aunque no se edite. */}
          {cotizada && !editando && onDescartar && (
            <div className="mt-3 flex justify-end">
              <ConfirmarBoton
                onConfirm={() => onDescartar(c)}
                disabled={busy}
                className="rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 border-estado-cancelada text-estado-cancelada hover:bg-estado-cancelada/5"
                pregunta="¿Descartar la consulta?"
                si="Sí, no disponible"
                siClassName="rounded-xl bg-estado-cancelada px-3 py-2 text-xs font-semibold text-white"
                noClassName="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-[#4A4E5E] hover:bg-canvas"
                preguntaClassName="text-xs font-semibold text-ink"
              >
                No disponible
              </ConfirmarBoton>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
