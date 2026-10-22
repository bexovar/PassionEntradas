"use client";

import { useEffect, useRef, useState } from "react";
import { formatMonto, type Moneda, type Operacion } from "@/lib/operaciones";
import { parseTitle } from "@/lib/tickets";
import { parsePrecio, totalPrecio } from "@/lib/precios";

type Props = {
  onCreated: (op: Operacion) => void;
  onError: (msg: string) => void;
  // Prefill al llegar desde el catálogo de la tienda ("Crear operación").
  prefill?: { evento?: string; ticketId?: string };
};

// Resultado del buscador de entradas (/api/tickets/buscar).
type TicketMatch = {
  id: string;
  evento: string;
  competicion: string | null;
  fecha: string | null;
  categoria: string | null;
  precio_final: number | null;
  precio_costo: number | null;
  stock: number | null;
  source: "portal" | "manual";
  // Ya en su moneda de venta, la misma que vio el cliente en la tienda:
  // pesos para una propia cargada en pesos, dólares para todo lo demás.
  moneda_venta: "ARS" | "USD";
  costo_venta: number | null;
  precio_venta: number | null;
};

// Autocompletado del evento contra el catálogo: elegir un resultado vincula
// la operación a esa entrada (ticket_id) — con eso funcionan el descuento de
// stock al cerrar (propias) y la factura con sede/sector. Escribir libre
// sigue valiendo para eventos que no están en el catálogo.
// A nivel módulo para que React no lo remonte en cada render.
function EventoCombo({
  value,
  onTexto,
  onElegir,
  inputCls,
}: {
  value: string;
  onTexto: (v: string) => void;
  onElegir: (t: TicketMatch) => void;
  inputCls: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState<TicketMatch[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedido = useRef(0);

  function buscar(q: string) {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const id = ++pedido.current;
      try {
        const res = await fetch(`/api/tickets/buscar?q=${encodeURIComponent(q)}`);
        if (!res.ok || id !== pedido.current) return;
        setResultados((await res.json()) as TicketMatch[]);
      } catch {
        // sin red: el desplegable simplemente no sugiere
      }
    }, 250);
  }

  return (
    <div className="relative">
      <input
        id="evento"
        className={inputCls}
        value={value}
        autoComplete="off"
        placeholder="Buscá o escribí el evento"
        onChange={(e) => {
          onTexto(e.target.value);
          setAbierto(true);
          buscar(e.target.value);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
      />
      {abierto && resultados.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {resultados.map((t) => {
            // Mismo truco que la tienda: "Match 101, World Cup - Semi Final
            // - France vs Spain" => título "France vs Spain" + su contexto.
            const { title, context } = parseTitle(t.evento, t.competicion);
            const contexto = context || t.competicion || "";
            return (
              <li key={t.id}>
                <button
                  type="button"
                  // onMouseDown: dispara ANTES del blur del input.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onElegir(t);
                    setAbierto(false);
                  }}
                  className="w-full border-b border-dashed border-line px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-canvas"
                >
                  {contexto && (
                    <span className="block font-mono text-[9px] font-bold uppercase tracking-wider text-muted">
                      {contexto}
                    </span>
                  )}
                  <span className="flex items-baseline justify-between gap-2">
                    {/* El nombre envuelve completo, nunca se corta. */}
                    <span className="min-w-0 whitespace-normal break-words text-sm font-semibold leading-snug">
                      {title}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                        t.source === "manual"
                          ? "bg-estado-confirmada/10 text-estado-confirmada"
                          : "bg-canvas text-muted"
                      }`}
                    >
                      {t.source === "manual" ? "Propia" : "Passion"}
                    </span>
                  </span>
                  {/* El sector, protagonista y en su propia línea. */}
                  <span className="mt-0.5 block whitespace-normal text-xs font-medium text-body">
                    {t.categoria ?? "Entrada general"}
                    <span className="font-normal text-muted">
                      {t.fecha ? ` · ${t.fecha.slice(0, 10)}` : ""}
                      {t.stock != null ? ` · stock ${t.stock}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Quién vende, por defecto. Hoy carga siempre el mismo; se puede cambiar en el
// campo, y el día que sean varios esto sale de la sesión.
const VENDEDOR_POR_DEFECTO = "Nacho";

// Valor centinela del desplegable de comprador para cargar a alguien que no
// está en la lista.
const OTRO = "__otro__";

type ClienteOpcion = { id: string; nombre: string; email: string; operaciones: number };

const empty = {
  evento: "",
  comprador_alias: "",
  vendedor_alias: VENDEDOR_POR_DEFECTO,
  cantidad: "1",
  costo: "",
  moneda: "USD",
  fee: "",
  fecha_evento: "",
  notas: "",
};

// Costo y comisión se cargan POR ENTRADA (como vienen del catálogo); la
// operación guarda el total: (costo + comisión) × cantidad, y la comisión
// total. Null si la cantidad no es un entero de 1 a 100.
function precioDeOperacion(form: typeof empty) {
  const cantidad = Number(form.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
    return { ok: false as const, error: "La cantidad tiene que ser de 1 a 100 entradas" };
  }
  const unit = parsePrecio(form.costo, form.fee);
  if (!unit.ok) return unit;
  return {
    ok: true as const,
    cantidad,
    unitario: unit.total,
    total: totalPrecio(unit.total * cantidad, 0),
    comision: totalPrecio(unit.comision * cantidad, 0),
  };
}

// Formulario "Nueva operación".
export default function NewOperacionForm({ onCreated, onError, prefill }: Props) {
  const [form, setForm] = useState({ ...empty, evento: prefill?.evento ?? "" });
  const [ticketId, setTicketId] = useState<string | null>(prefill?.ticketId ?? null);
  // Detalle de la entrada vinculada para el chip (desde el buscador; el
  // prefill de "Crear operación" no lo trae y muestra un texto genérico).
  const [vinculo, setVinculo] = useState<{ categoria: string | null; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  // Clientes para el desplegable de comprador, ya rankeados por la API.
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [escribiendoComprador, setEscribiendoComprador] = useState(false);
  // Cuenta del cliente elegido de la lista: la operación queda a su nombre y
  // la ve en Mis pedidos. Escrito a mano ("Otro") no tiene cuenta.
  const [clienteId, setClienteId] = useState<string | null>(null);
  // El disabled de React llega tarde si dos taps caen en el mismo tick:
  // el ref corta el segundo submit antes de que dispare otro POST.
  const enviando = useRef(false);

  function set<K extends keyof typeof empty>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ¿La persona tocó algo? Lo que precarga "Crear operación" desde el catálogo
  // no cuenta: si la página se recarga, la URL lo vuelve a precargar igual.
  const [tocado, setTocado] = useState(false);

  function vaciar() {
    setForm(empty);
    setTicketId(null);
    setVinculo(null);
    setClienteId(null);
    setTocado(false);
  }

  // Llegando desde "Crear operación" de una entrada del catálogo, se traen
  // sus datos igual que si se hubiera elegido del buscador. Antes solo venía
  // el nombre del evento y había que cargar fecha, costo y comisión a mano,
  // teniendo el sistema los tres.
  useEffect(() => {
    const id = prefill?.ticketId;
    const nombre = prefill?.evento;
    if (!id || !nombre) return;
    let vivo = true;
    fetch(`/api/tickets/buscar?q=${encodeURIComponent(nombre.slice(0, 60))}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TicketMatch[]) => {
        if (!vivo) return;
        const t = rows.find((x) => x.id === id);
        if (t) elegirTicket(t);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // Solo al montar: después manda lo que el usuario elija en el buscador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si la lista no carga (red, permisos), el form no se traba: se cae al
  // campo de texto y la operación se puede cargar igual.
  useEffect(() => {
    let vivo = true;
    fetch("/api/clientes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo) return;
        const lista = (d?.clientes ?? []) as ClienteOpcion[];
        if (lista.length === 0) setEscribiendoComprador(true);
        setClientes(lista);
      })
      .catch(() => {
        if (vivo) setEscribiendoComprador(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Elegir una entrada del buscador trae TODO lo que ya sabemos de ella:
  // fecha, moneda, costo y comisión. La API los devuelve en la moneda en que se
  // cobra esa entrada (pesos para una propia en pesos, dólares para el resto),
  // así que la operación queda con los mismos números que vio el cliente.
  // Se pisa lo que haya: elegir una entrada es decir "cargá ESTA".
  function elegirTicket(t: TicketMatch) {
    setTicketId(t.id);
    setVinculo({ categoria: t.categoria, source: t.source });
    const costo = t.costo_venta;
    const precio = t.precio_venta;
    const comision = costo != null && precio != null ? Math.round((precio - costo) * 100) / 100 : null;
    setForm((f) => ({
      ...f,
      evento: t.evento,
      fecha_evento: t.fecha ? t.fecha.slice(0, 10) : f.fecha_evento,
      moneda: t.moneda_venta,
      costo: costo != null ? String(costo) : f.costo,
      // Solo si da positiva: una entrada sin costo cargado no tiene comisión
      // conocida, y poner 0 sería afirmar que no ganamos nada.
      fee: comision != null && comision > 0 ? String(comision) : f.fee,
    }));
  }

  // Editar el texto a mano rompe el vínculo (el nombre ya no es el del
  // catálogo); se puede volver a elegir del desplegable.
  function editarEvento(v: string) {
    set("evento", v);
    if (ticketId) {
      setTicketId(null);
      setVinculo(null);
    }
  }

  function desvincular() {
    setTicketId(null);
    setVinculo(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando.current) return;
    // Datos mínimos de una operación de custodia: qué se opera, entre quiénes
    // y por cuánto. Sin esto no se crea (antes solo se validaba el evento y
    // quedaban operaciones con comprador/vendedor/monto vacíos).
    if (!form.evento.trim()) {
      onError("El evento es obligatorio");
      return;
    }
    if (!form.comprador_alias.trim()) {
      onError("El comprador es obligatorio");
      return;
    }
    if (!form.vendedor_alias.trim()) {
      onError("El vendedor es obligatorio");
      return;
    }
    // Costo + comisión: al cliente se le cobra la suma, y eso es lo único
    // que va a ver en la factura.
    const precio = precioDeOperacion(form);
    if (!precio.ok) {
      onError(precio.error);
      return;
    }
    enviando.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/operaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evento: form.evento,
          comprador_alias: form.comprador_alias || null,
          cliente_id: escribiendoComprador ? null : clienteId,
          vendedor_alias: form.vendedor_alias || null,
          cantidad: precio.cantidad,
          monto: precio.total,
          fee: precio.comision,
          moneda: form.moneda,
          ticket_id: ticketId,
          fecha_evento: form.fecha_evento || null,
          notas: form.notas || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "No se pudo crear la operación");
        return;
      }

      // Construimos el objeto local para pintar la card al instante.
      const now = new Date().toISOString();
      onCreated({
        id: data.id,
        code: data.code,
        evento: form.evento.trim(),
        comprador_alias: form.comprador_alias.trim() || null,
        vendedor_alias: form.vendedor_alias.trim() || null,
        cuenta_debitar: null,
        monto: precio.total,
        moneda: form.moneda as Moneda,
        cantidad: precio.cantidad,
        fee: precio.comision,
        status: "esperando_entrada",
        entrada_recibida_at: null,
        pago_confirmado_at: null,
        pago_proveedor_at: null,
        cerrada_at: null,
        entrada_recibida_por: null,
        pago_confirmado_por: null,
        pago_proveedor_por: null,
        cerrada_por: null,
        fecha_evento: form.fecha_evento || null,
        notas: form.notas.trim() || null,
        ticket_id: ticketId,
        tipo: "operacion",
        cliente_id: data.cliente_id ?? null,
        cliente_email: data.cliente_email ?? null,
        sector: null,
        created_at: now,
        updated_at: now,
      });
      setForm(empty);
      setTicketId(null);
      setClienteId(null);
      setTocado(false);
    } catch {
      onError("Error de red al crear la operación");
    } finally {
      enviando.current = false;
      setLoading(false);
    }
  }

  // Sin ancho: el ancho lo pone cada campo. Agregarle "w-20" a una clase que
  // ya dice "w-full" NO hace nada —gana la que Tailwind emite última, que es
  // w-full— y así el select de moneda se comía la celda entera y el input de
  // al lado quedaba en 26px, pisando al vecino.
  const fieldCls =
    "rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15";
  const inputCls = `w-full ${fieldCls}`;
  // Con algo cargado y sin guardar, el refresco automático de la página espera
  // (ver components/AutoRefresh.tsx): un refresco fallido recarga la página
  // entera y se perdía lo escrito.
  const conDatos =
    tocado &&
    ((Object.keys(empty) as (keyof typeof empty)[]).some((k) => form[k] !== empty[k]) ||
      clienteId !== null ||
      ticketId !== null);
  const labelCls =
    "mb-1 block text-xs font-medium uppercase tracking-wide text-[#6A6E7E]";

  return (
    <form
      onSubmit={onSubmit}
      className="card-shadow overflow-hidden rounded-2xl"
      data-editando={conDatos ? "" : undefined}
      // Cualquier campo que cambie la persona marca el form como tocado (elegir
      // del buscador de eventos requiere escribir antes).
      onChange={() => setTocado(true)}
    >
      {/* Cabecera oscura estilo talón, con troquel real hacia el cuerpo */}
      <div className="surface-ink punch-b px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
          Módulo de carga
        </p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">
          Nueva operación
        </h2>
      </div>

      <div className="punch-t bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-3 p-5">
          <div>
            <label htmlFor="evento" className={labelCls}>
              Evento *
            </label>
            <EventoCombo
              value={form.evento}
              onTexto={editarEvento}
              onElegir={elegirTicket}
              inputCls={inputCls}
            />
            {ticketId && (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-canvas px-2.5 py-1.5">
                <span className="min-w-0 text-[11px] text-muted">
                  Vinculada al catálogo
                  {vinculo
                    ? `: ${vinculo.categoria ?? "Entrada general"} · ${
                        vinculo.source === "manual" ? "Propia" : "Passion"
                      }`
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={desvincular}
                  title="Desvincular de la entrada del catálogo"
                  className="shrink-0 rounded-md px-1.5 text-xs font-semibold text-muted transition-colors hover:bg-white hover:text-body"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* flex-col + justify-between: si un label envuelve a dos líneas,
              los inputs quedan anclados abajo y alineados entre sí. En
              celular uno debajo del otro: a media pantalla el desplegable
              mostraba "Elegí un cli…". */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col justify-between">
              <label htmlFor="comprador" className={labelCls}>
                Comprador *
              </label>
              {/* Lista cerrada de clientes, los que más compraron arriba. Antes
                  se escribía a mano y el mismo cliente terminaba cargado como
                  "Juan Perez", "juan perez" y "Juan P.". Queda la opción de
                  escribirlo para los que todavía no tienen cuenta. */}
              {escribiendoComprador ? (
                <div className="flex gap-2">
                  <input
                    id="comprador"
                    autoFocus
                    className={`${inputCls} min-w-0`}
                    value={form.comprador_alias}
                    onChange={(e) => set("comprador_alias", e.target.value)}
                    placeholder="Nombre o alias"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setEscribiendoComprador(false);
                      set("comprador_alias", "");
                      setClienteId(null);
                    }}
                    className="shrink-0 rounded-lg border border-line px-2.5 text-xs font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas"
                    title="Volver a la lista de clientes"
                  >
                    Lista
                  </button>
                </div>
              ) : (
                <select
                  id="comprador"
                  className={inputCls}
                  value={clienteId ?? ""}
                  onChange={(e) => {
                    if (e.target.value === OTRO) {
                      setEscribiendoComprador(true);
                      set("comprador_alias", "");
                      setClienteId(null);
                      return;
                    }
                    const c = clientes.find((x) => x.id === e.target.value);
                    setClienteId(c?.id ?? null);
                    set("comprador_alias", c?.nombre ?? "");
                  }}
                >
                  <option value="">
                    {clientes.length ? "Elegí un cliente…" : "Cargando clientes…"}
                  </option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                      {c.operaciones > 0 ? ` · ${c.operaciones} ${c.operaciones === 1 ? "op." : "ops."}` : ""}
                    </option>
                  ))}
                  <option value={OTRO}>Otro (escribir)…</option>
                </select>
              )}
            </div>
            <div className="flex flex-col justify-between">
              <label htmlFor="vendedor" className={labelCls}>
                Vendedor *
              </label>
              <input
                id="vendedor"
                className={inputCls}
                value={form.vendedor_alias}
                onChange={(e) => set("vendedor_alias", e.target.value)}
                placeholder="Nombre o alias"
              />
            </div>
          </div>

          <div>
            <label htmlFor="fecha_evento" className={labelCls}>
              Fecha del evento
            </label>
            <input
              id="fecha_evento"
              type="date"
              className={inputCls}
              value={form.fecha_evento}
              onChange={(e) => set("fecha_evento", e.target.value)}
            />
          </div>

          {/* Cada campo en su celda, ninguno compartiendo ancho con otro: el
              select de moneda metido al lado del importe se encimaba con la
              comisión y dejaba el costo en 26px. En celular, de a dos. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="moneda" className={labelCls}>
                Moneda
              </label>
              {/* La moneda es de la operación: no se convierte, se guarda. */}
              <select
                id="moneda"
                className={inputCls}
                value={form.moneda}
                onChange={(e) => set("moneda", e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </div>
            <div>
              <label htmlFor="cantidad" className={labelCls}>
                Cantidad
              </label>
              <input
                id="cantidad"
                type="number"
                min={1}
                max={100}
                step={1}
                inputMode="numeric"
                className={`${inputCls} font-mono`}
                value={form.cantidad}
                onChange={(e) => set("cantidad", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="monto" className={labelCls}>
                Costo por entrada
              </label>
              <input
                id="monto"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${inputCls} font-mono`}
                value={form.costo}
                onChange={(e) => set("costo", e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="fee" className={labelCls}>
                Comisión por entrada
              </label>
              <input
                id="fee"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${inputCls} font-mono`}
                value={form.fee}
                onChange={(e) => set("fee", e.target.value)}
                placeholder="0"
              />
            </div>
            {/* Lo que se le cobra al cliente. Se muestra armado para no tener
                que sumarlo de cabeza: es el total que va a la factura. */}
            <div className="col-span-2 flex items-center justify-between gap-3 rounded-xl bg-canvas px-3 py-2 sm:col-span-4">
              <span className={`${labelCls} mb-0`}>Total al cliente</span>
              <span className="text-right font-display text-sm font-bold tabular-nums">
                {(() => {
                  const r = precioDeOperacion(form);
                  if (!r.ok) return "—";
                  const moneda = form.moneda as Moneda;
                  return (
                    <>
                      {r.cantidad > 1 && (
                        <span className="mr-1.5 font-body text-xs font-normal text-muted">
                          {r.cantidad} × {formatMonto(r.unitario, moneda)} =
                        </span>
                      )}
                      {formatMonto(r.total, moneda)}
                    </>
                  );
                })()}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="notas" className={labelCls}>
              Notas internas (no se ven en el link)
            </label>
            <textarea
              id="notas"
              rows={2}
              maxLength={2000}
              className={`${inputCls} resize-y`}
              value={form.notas}
              onChange={(e) => set("notas", e.target.value)}
              placeholder="Vendedor manda el QR el jueves…"
            />
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
          >
            {loading ? "Creando…" : "Crear operación"}
          </button>
          {/* Descartar lo cargado: además libera el refresco automático de la
              página, que espera mientras el form tiene datos. */}
          {conDatos && !loading && (
            <button
              type="button"
              onClick={vaciar}
              className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-medium text-[#4A4E5E] transition-colors hover:bg-canvas"
            >
              Vaciar
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
