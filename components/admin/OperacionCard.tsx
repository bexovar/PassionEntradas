"use client";

import { useState } from "react";
import ConfirmarBoton from "@/components/ConfirmarBoton";
import {
  HITO_COLOR,
  diasHastaEvento,
  estadoDe,
  formatMonto,
  formatFecha,
  necesitaConfirmar,
  quienDe,
  whatsappMessage,
  TIPO_LABEL,
  SEMAFORO_COLOR,
  SEMAFORO_LABEL,
  semaforoDe,
  sePuedeFacturar,
  totalItem,
  type OperacionItem,
  type Operacion,
  type StatusAction,
} from "@/lib/operaciones";
import FacturaModal from "./FacturaModal";
import { fechaDia } from "@/lib/fechas";
import AvisosAlCliente from "./AvisosAlCliente";

type Props = {
  op: Operacion;
  // Lleva rato esperando (lib/recordatorios): va en rojo, con la edad.
  prioridad?: string | null;
  // Líneas de la operación. Un pedido del carrito puede traer varias entradas
  // de sectores o eventos distintos; la cabecera solo muestra el resumen.
  items?: OperacionItem[];
  baseUrl: string;
  busy?: boolean;
  // Hay clicks de estado guardándose (se ven ya marcados; esto solo avisa).
  guardando?: boolean;
  // readOnly: modo moderador — sin botones de cambio de estado.
  readOnly?: boolean;
  // Arranca desplegada (ej: recién creada en el módulo de carga).
  defaultOpen?: boolean;
  onAction?: (op: Operacion, action: StatusAction, okMsg: string) => void;
  onUpdate?: (
    op: Operacion,
    patch: Partial<Pick<Operacion, "notas" | "fecha_evento">>,
    okMsg: string
  ) => void;
  onCopied: (text: string) => void;
};

// Aviso de urgencia según la fecha del evento (solo operaciones en curso).
function UrgenciaChip({ dias }: { dias: number }) {
  const label =
    dias < 0
      ? "El evento ya pasó"
      : dias === 0
        ? "¡El evento es HOY!"
        : dias === 1
          ? "El evento es mañana"
          : `Evento en ${dias} días`;
  const color = dias <= 1 ? "#D14D68" : dias <= 7 ? "#B07A14" : "#5F6577";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, backgroundColor: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      {label}
    </span>
  );
}

// Fecha corta para la línea colapsada ("18 JUL").
function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.split("-");
  const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const mes = meses[Number(m) - 1] ?? "";
  return `${d} ${mes}`;
}

// Operación como fila compacta que se expande al tocar (como las entradas
// de la tienda): colapsada muestra estado, evento, code y monto; desplegada
// trae los hitos, las notas y las acciones.
export default function OperacionCard({
  op,
  items = [],
  baseUrl,
  busy = false,
  guardando = false,
  readOnly = false,
  defaultOpen = false,
  onAction,
  onUpdate,
  onCopied,
  prioridad = null,
}: Props) {
  const link = `${baseUrl}/op/${op.id}`;
  const estado = estadoDe(op);
  const cancelada = estado === "cancelada";
  const cerrada = estado === "cerrada";
  const semaforo = semaforoDe(op);
  // Quién pidió la entrada. El alias es lo que se muestra; el email queda
  // para el detalle, cuando aporta algo distinto.
  const cliente = op.comprador_alias ?? op.cliente_email ?? null;
  const entrada = !!op.entrada_recibida_at;
  const pago = !!op.pago_confirmado_at;
  const proveedor = !!op.pago_proveedor_at;
  // La entrega es un hito más, no el fin de la operación: la tarjeta sigue
  // editable hasta que los cuatro estén tildados.
  const entregada = !!op.cerrada_at;
  const dias = diasHastaEvento(op.fecha_evento);
  const enCurso = !cerrada && !cancelada;
  // Pedido de la tienda que todavía no confirmó un admin.
  const nuevo = necesitaConfirmar(op);

  const [open, setOpen] = useState(defaultOpen);
  const [editingNotas, setEditingNotas] = useState(false);
  const [notasDraft, setNotasDraft] = useState(op.notas ?? "");
  const [facturaAbierta, setFacturaAbierta] = useState(false);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onCopied(label);
    } catch {
      onCopied("No se pudo copiar");
    }
  }

  const secondaryBtn =
    "rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-[#4A4E5E] transition-colors hover:border-[#C5C9D6] hover:bg-canvas";

  return (
    <article className={`card-shadow overflow-hidden rounded-2xl bg-white ${prioridad ? "ring-2 ring-[#D14D68]" : ""}`}>
      {/* Prioridad (lib/recordatorios): lleva rato esperando. */}
      {prioridad && (
        <p className="flex items-center gap-1.5 bg-[#D14D68] px-4 py-1 text-[11px] font-bold text-white">
          <span aria-hidden>●</span>
          {prioridad}
        </p>
      )}
      {/* Fila colapsada: toda la fila es el toggle */}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas/40"
      >
        {/* UN solo indicador de estado por fila: el semáforo. Antes había
            además un punto por grupo de estado y las dos cosas juntas
            confundían más de lo que explicaban. */}
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: SEMAFORO_COLOR[semaforo] }}
          title={SEMAFORO_LABEL[semaforo]}
          aria-label={SEMAFORO_LABEL[semaforo]}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">
            {op.evento}
          </span>
          {/* El cliente va en la fila cerrada: saber con quién se está
              trabajando no tiene que costar un click. */}
          {cliente && (
            <span className="mt-0.5 block text-[11px] font-medium text-[#4A4E5E] [overflow-wrap:anywhere]">
              {cliente}
            </span>
          )}
          <span className="mt-0.5 block font-mono text-[10px] uppercase leading-snug tracking-wider text-muted">
            {/* En celular el chip "Nuevo" le comía el nombre del evento: va acá. */}
            {nuevo && <span className="font-bold text-[#D14D68] sm:hidden">● Nuevo · </span>}
            {/* El code no se parte en el guion ("BX-" / "8H5U…"). */}
            <span className="whitespace-nowrap">{op.code}</span> · {SEMAFORO_LABEL[semaforo]}
            {op.fecha_evento ? ` · ${fechaCorta(op.fecha_evento)}` : ""}
          </span>
          {/* En celular el monto va abajo: en la columna de la derecha le
              dejaba al nombre del evento 90px y partía las palabras. */}
          <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 sm:hidden">
            <span className="whitespace-nowrap font-display text-sm font-bold tabular-nums">
              {formatMonto(op.monto, op.moneda)}
            </span>
            {op.cantidad > 1 && (
              <span className="font-mono text-[10px] text-muted">
                ×{op.cantidad} ·{" "}
                <span className="whitespace-nowrap">{formatMonto(op.monto / op.cantidad, op.moneda)} c/u</span>
              </span>
            )}
          </span>
        </span>
        {nuevo && (
          // En desktop como chip; en celular va en la línea del código.
          <span className="hidden shrink-0 rounded-full bg-[#D14D68] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white sm:inline-block">
            Nuevo
          </span>
        )}
        {!nuevo && op.tipo !== "operacion" && (
          // Origen: pedido/consulta del cliente desde la tienda. Se esconde en
          // celular: entre el chip y el monto le comían 90px al nombre del
          // evento, que es lo que sirve para reconocer la fila ("Match 12, …").
          <span
            className="hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline-block"
            style={
              op.tipo === "pedido"
                ? { color: "#1F33E0", backgroundColor: "#1F33E014" }
                : { color: "#B07A14", backgroundColor: "#B07A1414" }
            }
          >
            {TIPO_LABEL[op.tipo]}
          </span>
        )}
        <span className="hidden flex-col items-end leading-none sm:flex">
          <span className="whitespace-nowrap font-display text-sm font-bold tabular-nums">
            {formatMonto(op.monto, op.moneda)}
          </span>
          {op.cantidad > 1 && (
            <span className="mt-0.5 whitespace-nowrap font-mono text-[10px] text-muted">
              ×{op.cantidad} · {formatMonto(op.monto / op.cantidad, op.moneda)} c/u
            </span>
          )}
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
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

      {/* Cuerpo desplegado, separado por el troquel punteado de siempre */}
      {open && (
        <div className="border-t border-dashed border-[#C5C9D6]">
          <div className="p-4">
            {/* Pedido nuevo: el cliente lo ve como "Pedido recibido" hasta que
                un admin lo confirma. Marcar un hito también lo confirma. */}
            {nuevo && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D14D68]/30 bg-[#D14D68]/5 px-3.5 py-2.5">
                <span className="text-sm font-medium text-ink">
                  Pedido nuevo de la tienda
                  <span className="block text-[11px] font-normal text-muted">
                    {readOnly
                      ? "Espera la confirmación de un administrador."
                      : "Revisalo y confirmalo: el cliente ve que su pedido fue confirmado."}
                  </span>
                </span>
                {!readOnly && (
                  <button
                    onClick={() => onAction?.(op, { action: "confirmar" }, "Pedido confirmado")}
                    disabled={busy}
                    className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-60"
                  >
                    Confirmar pedido
                  </button>
                )}
              </div>
            )}
            {cancelada && (op.cancelada_por || op.cancelada_at) && (
              <p className="mb-3 text-xs font-medium text-estado-cancelada">
                {op.cancelada_por === "cliente"
                  ? "Cancelado por el cliente"
                  : `Cancelada${quienDe(op.cancelada_por) ? ` por ${quienDe(op.cancelada_por)}` : ""}`}
                {op.cancelada_at ? ` · ${fechaDia(op.cancelada_at)}` : ""}
              </p>
            )}
            {/* Sin chip de estado: el semáforo de la fila ya lo dice y los
                cuatro hitos de abajo muestran el detalle. Lo que sí aporta
                acá es la urgencia por fecha. */}
            {enCurso && dias != null && dias <= 14 && (
              <div className="flex flex-wrap items-center gap-2">
                <UrgenciaChip dias={dias} />
              </div>
            )}

            {/* Entradas del pedido. Con una sola línea la cabecera ya lo dice
                todo, así que el detalle aparece recién desde dos. */}
            {items.length > 1 && (
              <div className="mt-3 overflow-hidden rounded-xl border border-line">
                <p className="border-b border-line bg-canvas px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {items.length} entradas en este pedido
                </p>
                <ul className="divide-y divide-line">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-xs font-medium [overflow-wrap:anywhere]">{i.evento}</span>
                        <span className="block text-[11px] text-muted">
                          {i.sector ?? "General"}
                          {i.fecha_evento ? ` · ${formatFecha(i.fecha_evento)}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block whitespace-nowrap text-xs font-semibold tabular-nums">
                          {formatMonto(totalItem(i), op.moneda)}
                        </span>
                        {i.cantidad > 1 && (
                          <span className="block font-mono text-[10px] text-muted">
                            ×{i.cantidad} · {formatMonto(i.precio_unitario, op.moneda)} c/u
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6A6E7E]">
              {op.fecha_evento && <span>📅 {formatFecha(op.fecha_evento)}</span>}
              <span>
                Comisión{" "}
                <span className="font-semibold text-body">{formatMonto(op.fee, op.moneda)}</span>
              </span>
              {op.comprador_alias && (
                <span>
                  {op.tipo === "operacion" ? "Comprador" : "Cliente"}{" "}
                  <span className="font-medium text-body">{op.comprador_alias}</span>
                </span>
              )}
              {op.cliente_email && op.cliente_email !== op.comprador_alias && (
                <span>
                  <span className="font-medium text-body">{op.cliente_email}</span>
                </span>
              )}
              {op.sector && (
                <span>
                  Sector <span className="font-medium text-body">{op.sector}</span>
                </span>
              )}
              {op.vendedor_alias && (
                <span>
                  Vendedor <span className="font-medium text-body">{op.vendedor_alias}</span>
                </span>
              )}
              {op.cuenta_debitar && (
                <span>
                  Debita de{" "}
                  <span className="font-mono font-medium text-body">{op.cuenta_debitar}</span>
                </span>
              )}
            </div>

            {/* Lo que se le avisó al cliente y si el email salió. */}
            {(op.cliente_id || op.cliente_email) && <AvisosAlCliente opId={op.id} version={op.updated_at} />}

            {/* Notas internas (solo panel; nunca van al link público) */}
            {(op.notas || (!readOnly && onUpdate)) && (
              <div className="mt-3 rounded-xl bg-canvas px-3 py-2.5 text-xs">
                {editingNotas ? (
                  <div className="space-y-2">
                    <textarea
                      rows={3}
                      maxLength={2000}
                      autoFocus
                      value={notasDraft}
                      onChange={(e) => setNotasDraft(e.target.value)}
                      className="w-full resize-y rounded-lg border border-line bg-white px-2.5 py-2 text-xs outline-none focus:border-brand"
                      placeholder="Notas internas de la operación…"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          onUpdate?.(
                            op,
                            { notas: notasDraft.trim() || null },
                            "Notas guardadas"
                          );
                          setEditingNotas(false);
                        }}
                        disabled={busy}
                        className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                      >
                        Guardar notas
                      </button>
                      <button
                        onClick={() => {
                          setNotasDraft(op.notas ?? "");
                          setEditingNotas(false);
                        }}
                        className="rounded-lg px-3 py-1.5 font-medium text-[#6A6E7E] hover:bg-white"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <p className="whitespace-pre-wrap text-[#4A4E5E]">
                      {op.notas ? (
                        <>
                          <span className="mr-1 font-semibold uppercase tracking-wide text-muted">
                            Nota:
                          </span>
                          {op.notas}
                        </>
                      ) : (
                        <span className="text-muted">Sin notas internas.</span>
                      )}
                    </p>
                    {!readOnly && onUpdate && (
                      <button
                        onClick={() => {
                          setNotasDraft(op.notas ?? "");
                          setEditingNotas(true);
                        }}
                        className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1 font-medium text-[#4A4E5E] transition-colors hover:bg-white/60"
                      >
                        {op.notas ? "Editar" : "Agregar nota"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Los cuatro hitos internos, SIN orden: en la práctica la
                secuencia varía (a veces se le paga al proveedor antes de
                tener la entrada). Ninguno bloquea a otro.
                La grilla los ordena por con QUIÉN es cada uno: columna
                izquierda el proveedor (le pagamos / nos manda la entrada),
                columna derecha el cliente (nos paga / le entregamos). */}
            {!readOnly && !cancelada && !cerrada && (
              <>
              <p className="mt-4 h-4 text-right text-[10px] font-medium text-muted" aria-live="polite">
                {guardando ? "Guardando…" : ""}
              </p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <HitoButton
                  label="Pago a proveedor"
                  done={proveedor}
                  por={quienDe(op.pago_proveedor_por)}
                  color={HITO_COLOR.pago}
                  busy={busy}
                  onClick={() =>
                    onAction?.(
                      op,
                      { action: "proveedor", done: !proveedor },
                      !proveedor ? "Pago al proveedor marcado" : "Pago al proveedor desmarcado"
                    )
                  }
                />
                <HitoButton
                  label="Pago recibido"
                  done={pago}
                  por={quienDe(op.pago_confirmado_por)}
                  color={HITO_COLOR.pago}
                  busy={busy}
                  onClick={() =>
                    onAction?.(
                      op,
                      { action: "pago", done: !pago },
                      !pago ? "Pago marcado como recibido" : "Pago desmarcado"
                    )
                  }
                />
                <HitoButton
                  label="Entrada del proveedor"
                  done={entrada}
                  por={quienDe(op.entrada_recibida_por)}
                  color={HITO_COLOR.entrada}
                  busy={busy}
                  onClick={() =>
                    onAction?.(
                      op,
                      { action: "entrada", done: !entrada },
                      !entrada ? "Entrada marcada como recibida" : "Entrada desmarcada"
                    )
                  }
                />
                <HitoButton
                  label="Entrada entregada"
                  done={entregada}
                  por={quienDe(op.cerrada_por)}
                  color={HITO_COLOR.listo}
                  busy={busy}
                  onClick={() =>
                    onAction?.(
                      op,
                      { action: "cerrar", done: !entregada },
                      !entregada ? "Entrega registrada" : "Entrega desmarcada"
                    )
                  }
                />
              </div>
              </>
            )}

            {/* Completa (los cuatro hitos): resumen con opción de reabrir.
                Con los botones ocultos, el "quién hizo qué" vive acá. */}
            {!readOnly && cerrada && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-white">
                <span className="min-w-0 flex-1 basis-40 text-sm font-semibold">
                  ✓ Operación completa
                  {op.cerrada_at && (
                    <span className="ml-2 font-normal text-white/60">
                      {fechaDia(op.cerrada_at)}
                    </span>
                  )}
                  {quienDe(op.cerrada_por) && (
                    <span className="ml-2 font-normal text-white/60">
                      por {quienDe(op.cerrada_por)}
                    </span>
                  )}
                  {(op.entrada_recibida_por || op.pago_confirmado_por) && (
                    <span className="mt-0.5 block text-[11px] font-normal text-white/50">
                      {op.entrada_recibida_por &&
                        `Entrada por ${quienDe(op.entrada_recibida_por)}`}
                      {op.entrada_recibida_por && op.pago_confirmado_por && " · "}
                      {op.pago_confirmado_por &&
                        `Pago por ${quienDe(op.pago_confirmado_por)}`}
                    </span>
                  )}
                </span>
                {/* Con confirmación: un toque suelto (o el de alguien que
                    solo quería mirarla) no puede reabrir una operación
                    entregada. */}
                <ConfirmarBoton
                  onConfirm={() =>
                    onAction?.(op, { action: "cerrar", done: false }, "Operación reabierta")
                  }
                  disabled={busy}
                  pregunta="¿Reabrir?"
                  si="Sí, reabrir"
                  className="shrink-0 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 disabled:opacity-60"
                  armadoClassName="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2"
                  preguntaClassName="text-xs font-semibold text-white"
                  siClassName="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                  noClassName="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-medium text-white/85"
                >
                  Reabrir
                </ConfirmarBoton>
              </div>
            )}
          </div>

          {/* Acciones, separadas por la línea troquelada */}
          <div className="perf-line-light mx-4" />
          <div className="flex flex-wrap gap-2 p-3 px-4">
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryBtn}
            >
              Ver
            </a>
            <button onClick={() => copy(link, "Link copiado")} className={secondaryBtn}>
              Copiar link
            </button>
            <button
              onClick={() =>
                copy(whatsappMessage(op.evento, link), "Mensaje de WhatsApp copiado")
              }
              className={secondaryBtn}
            >
              Copiar WhatsApp
            </button>
            {/* Recibo/factura: la habilita el pago del CLIENTE. No espera a que
                la operación esté completa — los hitos con el proveedor son
                asunto nuestro y no pueden trabar el comprobante. */}
            {!readOnly && sePuedeFacturar(op) && (
              <button onClick={() => setFacturaAbierta(true)} className={secondaryBtn}>
                Factura
              </button>
            )}

            {!readOnly &&
              (cancelada ? (
                <ConfirmarBoton
                  onConfirm={() => onAction?.(op, { action: "reabrir" }, "Operación reabierta")}
                  disabled={busy}
                  pregunta="¿Reabrir?"
                  si="Sí, reabrir"
                  className="ml-auto rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/5 disabled:opacity-60"
                  armadoClassName="ml-auto flex flex-wrap items-center gap-2"
                  preguntaClassName="text-xs font-semibold text-ink"
                  siClassName="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                  noClassName="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[#4A4E5E]"
                >
                  Reabrir
                </ConfirmarBoton>
              ) : (
                !cerrada && (
                  // Confirmación en el lugar: un toque accidental en el
                  // celular no puede cancelar (el link público mostraría
                  // "Cancelada" al cliente).
                  <ConfirmarBoton
                    onConfirm={() => onAction?.(op, { action: "cancelar" }, "Operación cancelada")}
                    disabled={busy}
                    className="ml-auto rounded-lg border border-estado-cancelada px-3 py-1.5 text-xs font-semibold text-estado-cancelada transition-colors hover:bg-estado-cancelada/5 disabled:opacity-60"
                    armadoClassName="ml-auto inline-flex flex-wrap items-center justify-end gap-2"
                    preguntaClassName="text-xs font-semibold text-ink"
                    pregunta="¿Cancelar la operación?"
                    si="Sí, cancelar"
                    siClassName="rounded-lg bg-estado-cancelada px-3 py-1.5 text-xs font-semibold text-white"
                    noClassName="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-[#4A4E5E] hover:bg-canvas"
                  >
                    Cancelar
                  </ConfirmarBoton>
                )
              ))}
          </div>
        </div>
      )}

      {facturaAbierta && (
        <FacturaModal
          op={op}
          baseUrl={baseUrl}
          onClose={() => setFacturaAbierta(false)}
          onToast={(kind, msg) => onCopied(kind === "error" ? msg : msg)}
        />
      )}
    </article>
  );
}

// Botón de hito con dos estados: pendiente (delineado) y hecho (relleno con
// ✓). Marcar es un toque; desmarcar pide "¿Desmarcar? Sí · No" en el mismo
// lugar, porque deshace trabajo de otro y un toque suelto (p.ej. el que cae
// sobre los botones que aparecen al reabrir) no debe bastar.
// Completado, muestra además QUIÉN lo marcó ("por kiru"), para saber a quién
// preguntarle por ese paso.
function HitoButton({
  label,
  done,
  por,
  color,
  busy,
  locked,
  lockedHint,
  onClick,
}: {
  label: string;
  done: boolean;
  por?: string | null;
  color: string;
  busy: boolean;
  locked?: boolean;
  lockedHint?: string;
  onClick: () => void;
}) {
  const clases =
    "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-60";
  const contenido = (
    <>
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]"
        style={{
          borderColor: done ? "rgba(255,255,255,0.7)" : `${color}88`,
          backgroundColor: done ? "rgba(255,255,255,0.2)" : "transparent",
        }}
        aria-hidden
      >
        {done ? "✓" : ""}
      </span>
      <span className="min-w-0">
        {label}
        {done && por && (
          <span className="block text-[10px] font-normal leading-tight text-white/75 [overflow-wrap:anywhere]">
            Por {por}
          </span>
        )}
      </span>
    </>
  );

  if (done) {
    return (
      <ConfirmarBoton
        onConfirm={onClick}
        disabled={busy || locked}
        title={locked ? lockedHint : "Tocá para desmarcar"}
        pregunta="¿Desmarcar?"
        si="Sí"
        className={clases}
        style={{ backgroundColor: color, borderColor: color, color: "#fff" }}
        armadoClassName="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border-2 px-2 py-1.5"
        armadoStyle={{ borderColor: color, color }}
        preguntaClassName="w-full text-center text-xs font-semibold"
        siClassName="rounded-lg px-2.5 py-1 text-xs font-semibold text-white"
        siStyle={{ backgroundColor: color }}
        noClassName="rounded-lg px-2.5 py-1 text-xs font-medium text-[#4A4E5E]"
      >
        {contenido}
      </ConfirmarBoton>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={busy || locked}
      aria-pressed={false}
      title={locked ? lockedHint : undefined}
      className={clases}
      style={{ borderColor: `${color}66`, color }}
    >
      {contenido}
    </button>
  );
}
