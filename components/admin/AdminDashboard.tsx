"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fusionarRefresco, parcheOptimista, previoDe } from "@/lib/estado-local";
import { useRouter } from "next/navigation";
import { estadoCotizacion } from "@/lib/cotizaciones";
import {
  consultaCoincide,
  etiquetaFiltro,
  EVENTO_IR_AL_PANEL,
  filtroDeLink,
  opCoincide,
  PESTANAS,
  type Filtro,
  type FiltroPanel,
} from "@/lib/panel-filtros";
import { etiquetaPrioridad, pendienteDeConsulta, pendienteDeOp } from "@/lib/recordatorios";
import {
  diasHastaEvento,
  estadoDe,
  necesitaConfirmar,
  SEMAFORO_COLOR,
  SEMAFORO_LABEL,
  SEMAFORO_LEYENDA,
  type Consulta,
  type Moneda,
  type Operacion,
  type StatusAction,
  type OperacionItem,
} from "@/lib/operaciones";
import { ETAPAS_PANEL, etapaDe, type EtapaPanel } from "@/lib/etapas";
import OperacionCard from "./OperacionCard";
import ConsultaCard from "./ConsultaCard";
import { ToastViewport, useToast } from "./Toast";

type Props = {
  initial: Operacion[];
  // Líneas de TODAS las operaciones en pantalla: se agrupan acá una vez en
  // vez de filtrar el array entero en cada card.
  items?: OperacionItem[];
  // Consultas PENDIENTES. Van en la misma lista que las operaciones (con el
  // signo de pregunta) en vez de en una sección aparte: el admin mira un solo
  // lugar, y una consulta es trabajo pendiente igual que una operación.
  consultas?: Consulta[];
  baseUrl: string;
  // Filtro con el que abre (?filtro=… desde las tarjetas de Métricas).
  filtroInicial?: FiltroPanel;
  // Búsqueda con la que abre (?q=… desde "Ver sus pedidos" en Clientes).
  busquedaInicial?: string;
};

// Fila de la lista: o una operación, o una consulta sin cotizar.
type Fila =
  | { kind: "op"; id: string; created_at: string; op: Operacion }
  | { kind: "consulta"; id: string; created_at: string; consulta: Consulta };

// Módulo del administrador: chequea la lista y actualiza estados.
// La carga de operaciones nuevas vive en el módulo /moderador.
export default function AdminDashboard({
  initial,
  items = [],
  consultas: consultasIniciales = [],
  baseUrl,
  filtroInicial = { filtro: "todas" },
  busquedaInicial = "",
}: Props) {
  // Índice operación -> líneas, armado una vez por render en vez de filtrar
  // el array completo dentro de cada tarjeta.
  const itemsPorOp = useMemo(() => {
    const m = new Map<string, OperacionItem[]>();
    for (const i of items) {
      const arr = m.get(i.operacion_id);
      if (arr) arr.push(i);
      else m.set(i.operacion_id, [i]);
    }
    return m;
  }, [items]);

  const [ops, setOps] = useState<Operacion[]>(initial);
  const [consultas, setConsultas] = useState<Consulta[]>(consultasIniciales);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroPanel>(filtroInicial);
  const filter = filtro.filtro;
  // Cambiar de pestaña o de tarjeta conserva el cliente elegido (si hay).
  const setFilter = (f: Filtro) => setFiltro((prev) => ({ filtro: f, ...(prev.cliente ? { cliente: prev.cliente } : {}) }));
  const listaRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(busquedaInicial);
  const [sort, setSort] = useState<"recientes" | "urgentes">("recientes");
  const [page, setPage] = useState(1);
  const { toasts, push } = useToast();
  const router = useRouter();

  // Reloj del Panel: la prioridad (lleva rato esperando) cambia sola con el
  // tiempo, sin que cambien los datos.
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Cambiar filtro, búsqueda u orden vuelve a la primera página.
  useEffect(() => {
    setPage(1);
  }, [filtro, query, sort]);

  // Clicks de estado (ver lib/estado-local.ts): fila por operación, cuántos
  // hay en vuelo, y el updated_at de la última respuesta de cada una.
  const colas = useRef(new Map<string, Promise<void>>());
  const enVuelo = useRef(new Map<string, number>());
  const ultimaRespuesta = useRef(new Map<string, string>());
  const [guardando, setGuardando] = useState<Set<string>>(new Set());

  // Lista viva: cuando AutoRefresh refresca el server component, `initial`
  // llega con datos nuevos (operaciones cargadas por el moderador, cambios
  // de otro admin). Se MEZCLA con lo local: un refresco que salió antes de un
  // click no puede destildar lo que se acaba de marcar.
  useEffect(() => {
    setOps((prev) =>
      fusionarRefresco(
        prev,
        initial,
        (id) => enVuelo.current.get(id) ?? 0,
        (id) => ultimaRespuesta.current.get(id)
      )
    );
  }, [initial]);

  // Operaciones tocadas en este filtro: se quedan a la vista aunque el click
  // las saque del filtro (marcar el 3er hito en "En curso" la mandaba a "Para
  // entregar" y la tarjeta desaparecía bajo el dedo, sin poder corregir un
  // toque equivocado). `fijasArriba`: las que eran "Nuevo" al tocarlas siguen
  // arriba en vez de saltar de lugar al confirmarlas. Se limpian al cambiar de
  // filtro.
  const [fijas, setFijas] = useState<Set<string>>(new Set());
  const [fijasArriba, setFijasArriba] = useState<Set<string>>(new Set());
  // Y las que eran prioridad al tocarlas siguen primeras: confirmar una la
  // sacaba de la prioridad y saltaba al fondo (o a otra página).
  const [fijasPrioridad, setFijasPrioridad] = useState<Set<string>>(new Set());
  useEffect(() => {
    setFijas(new Set());
    setFijasArriba(new Set());
    setFijasPrioridad(new Set());
  }, [filtro]);

  useEffect(() => {
    setConsultas(consultasIniciales);
  }, [consultasIniciales]);

  // Las ocho etapas del tablero (TKT-21): cuántas hay en cada una. "A
  // cotizar" son consultas; en "Esperando pago" y "Vencidos" también cuentan
  // las cotizaciones que el cliente todavía no aceptó.
  const stats = useMemo(() => {
    const porEtapa = Object.fromEntries(ETAPAS_PANEL.map((e) => [e.key, 0])) as Record<EtapaPanel, number>;
    for (const o of ops) {
      const e = etapaDe(o, ahora);
      if (e in porEtapa) porEtapa[e as EtapaPanel]++;
    }
    for (const c of consultas) {
      const e = estadoCotizacion(c, ahora);
      if (e === "a_cotizar") porEtapa.a_cotizar++;
      else if (e === "esperando") porEtapa.esperando_pago++;
      else if (e === "vencida") porEtapa.vencido++;
    }
    return porEtapa;
  }, [ops, consultas, ahora]);

  // id -> texto del badge rojo ("Sin confirmar hace 3 h").
  const prioridades = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of ops) {
      const p = pendienteDeOp(o, ahora);
      if (p) m.set(o.id, etiquetaPrioridad(p, ahora));
    }
    for (const c of consultas) {
      const p = pendienteDeConsulta(c, ahora);
      if (p) m.set(c.id, etiquetaPrioridad(p, ahora));
    }
    return m;
  }, [ops, consultas, ahora]);

  const visible = useMemo<Fila[]>(() => {
    const q = query.trim().toLowerCase();
    const coincide = (...campos: (string | null | undefined)[]) =>
      !q || campos.some((c) => (c ?? "").toLowerCase().includes(q));

    let filas: Fila[] = ops
      .filter(
        (o) =>
          (opCoincide(o, filtro, ahora) || fijas.has(o.id)) &&
          coincide(o.evento, o.code, o.comprador_alias, o.vendedor_alias, o.cliente_email)
      )
      .map((op) => ({ kind: "op" as const, id: op.id, created_at: op.created_at, op }));

    if (sort === "urgentes") {
      // Fecha de evento más próxima primero; sin fecha al final.
      filas = [...filas].sort((a, b) => {
        const fa = a.kind === "op" ? a.op.fecha_evento : a.consulta.fecha_evento;
        const fb = b.kind === "op" ? b.op.fecha_evento : b.consulta.fecha_evento;
        const da = diasHastaEvento(fa);
        const db = diasHastaEvento(fb);
        if (da == null && db == null) return b.created_at.localeCompare(a.created_at);
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      });
    }

    // Las consultas van SIEMPRE arriba: son las únicas filas que esperan algo
    // del admin (chequear stock y cerrar precio). Con el paginado, dejarlas
    // ordenadas por fecha las mandaba a la página 3 y no las veía nadie.
    // Solo aparecen en los filtros donde "trabajo pendiente" tiene sentido,
    // y en los de consultas (A cotizar / Esperando pago / Vencidos).
    const pendientes: Fila[] = consultas
      .filter(
        (c) =>
          consultaCoincide(c, filtro, ahora) &&
          coincide(c.evento, c.code, c.comprador_alias, c.cliente_email)
      )
      .map((c) => ({ kind: "consulta" as const, id: c.id, created_at: c.created_at, consulta: c }));

    // Los pedidos nuevos (sin confirmar) también esperan al admin: van arriba,
    // justo después de las consultas.
    const arriba = (f: Fila) => f.kind === "op" && (necesitaConfirmar(f.op) || fijasArriba.has(f.id));
    const nuevos = filas.filter(arriba);
    const resto = filas.filter((f) => !arriba(f));

    // Lo que lleva rato esperando va primero de todo (decisión 7).
    const todas = [...pendientes, ...nuevos, ...resto];
    const prio = (f: Fila) => prioridades.has(f.id) || fijasPrioridad.has(f.id);
    return [...todas.filter(prio), ...todas.filter((f) => !prio(f))];
  }, [ops, consultas, filtro, query, sort, fijas, fijasArriba, fijasPrioridad, ahora, prioridades]);

  // El aviso rojo cuenta lo que va a mostrar al tocarlo: con el cliente y la
  // búsqueda de ahora (si no, decía "4 llevan rato" y abría una lista vacía).
  const nPrioridad = useMemo(() => {
    const q = query.trim().toLowerCase();
    const coincide = (...campos: (string | null | undefined)[]) =>
      !q || campos.some((c) => (c ?? "").toLowerCase().includes(q));
    const f: FiltroPanel = { filtro: "prioridad", ...(filtro.cliente ? { cliente: filtro.cliente } : {}) };
    return (
      ops.filter(
        (o) =>
          prioridades.has(o.id) &&
          opCoincide(o, f, ahora) &&
          coincide(o.evento, o.code, o.comprador_alias, o.vendedor_alias, o.cliente_email)
      ).length +
      consultas.filter(
        (c) =>
          prioridades.has(c.id) &&
          consultaCoincide(c, f, ahora) &&
          coincide(c.evento, c.code, c.comprador_alias, c.cliente_email)
      ).length
    );
  }, [ops, consultas, filtro.cliente, query, ahora, prioridades]);

  // Paginado en el cliente: con historial grande, renderizar cientos de
  // cards de una sola vez es lo que pesa (el fetch ya viene topado en 1000).
  const PAGE_SIZE = 15;
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pagina = Math.min(page, totalPages);
  const enPagina = visible.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  // Tarjeta del resumen: filtra la lista y la trae a la vista. Tocar la
  // activa la saca.
  function tocarTarjeta(f: Filtro) {
    setFilter(filter === f ? "todas" : f);
    if (filter !== f) listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Al abrir con un filtro de la URL, la lista ya arranca a la vista.
  useEffect(() => {
    if (filtroInicial.filtro !== "todas" || filtroInicial.cliente || busquedaInicial)
      listaRef.current?.scrollIntoView({ block: "start" });
    // Solo al montar: después manda el estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si la URL cambia estando ya en el Panel (un aviso de la campana, un link de
  // Clientes), la página no se vuelve a montar: el filtro y la búsqueda se
  // aplican acá. Un refresco con la misma URL no pisa lo que se eligió a mano.
  const firmaUrl = JSON.stringify([filtroInicial, busquedaInicial]);
  const primeraFirma = useRef(firmaUrl);
  useEffect(() => {
    if (firmaUrl === primeraFirma.current) return;
    primeraFirma.current = firmaUrl;
    setFiltro(filtroInicial);
    setQuery(busquedaInicial);
    listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaUrl]);
  // Un link de la campana a la MISMA URL en la que ya está el Panel (ver
  // EVENTO_IR_AL_PANEL): se aplica igual.
  useEffect(() => {
    const ir = (e: Event) => {
      const link = filtroDeLink(String((e as CustomEvent).detail ?? ""));
      if (!link) return;
      setFiltro(link.filtro);
      setQuery(link.q);
      listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(EVENTO_IR_AL_PANEL, ir);
    return () => window.removeEventListener(EVENTO_IR_AL_PANEL, ir);
  }, []);
  const chip = etiquetaFiltro(filtro);

  function irAPagina(n: number) {
    setPage(Math.min(Math.max(1, n), totalPages));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Un click de estado. El cambio se ve al instante y la petición entra en
  // la fila de esa operación (una por vez). Si el server la rechaza, se
  // revierte solo ese cambio. Cancelar y reabrir no son optimistas: esperan.
  function applyAction(op: Operacion, action: StatusAction, okMsg: string) {
    const id = op.id;
    const parche = parcheOptimista(op, action, new Date().toISOString());
    const previo = parche ? previoDe(op, parche) : null;

    setFijas((s) => (s.has(id) ? s : new Set(s).add(id)));
    if (necesitaConfirmar(op)) setFijasArriba((s) => (s.has(id) ? s : new Set(s).add(id)));
    if (prioridades.has(id)) setFijasPrioridad((s) => (s.has(id) ? s : new Set(s).add(id)));
    if (parche) setOps((prev) => prev.map((o) => (o.id === id ? { ...o, ...parche } : o)));
    else setBusyId(id);

    enVuelo.current.set(id, (enVuelo.current.get(id) ?? 0) + 1);
    setGuardando((s) => new Set(s).add(id));

    const correr = async () => {
      try {
        const res = await fetch(`/api/operaciones/${id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (previo) setOps((prev) => prev.map((o) => (o.id === id ? { ...o, ...previo } : o)));
          push("error", data.error ?? "No se pudo actualizar el estado");
          return;
        }
        if (data.updated_at) ultimaRespuesta.current.set(id, data.updated_at);
        // La respuesta es la verdad del server, pero si quedan clicks en la
        // fila de esta operación, sus cambios todavía no están en ella: se
        // aplica recién con la última, para no destildar lo que viene atrás.
        if ((enVuelo.current.get(id) ?? 1) <= 1) {
          setOps((prev) =>
            prev.map((o) =>
              o.id === id
                ? {
                    ...o,
                    status: data.status,
                    entrada_recibida_at: data.entrada_recibida_at,
                    pago_confirmado_at: data.pago_confirmado_at,
                    pago_proveedor_at: data.pago_proveedor_at ?? null,
                    pago_proveedor_por: data.pago_proveedor_por ?? null,
                    cerrada_at: data.cerrada_at,
                    entrada_recibida_por: data.entrada_recibida_por ?? null,
                    pago_confirmado_por: data.pago_confirmado_por ?? null,
                    cerrada_por: data.cerrada_por ?? null,
                    confirmada_at: data.confirmada_at ?? null,
                    confirmada_por: data.confirmada_por ?? null,
                    cancelada_at: data.cancelada_at ?? null,
                    cancelada_por: data.cancelada_por ?? null,
                    pago_pedido_at: data.pago_pedido_at ?? null,
                    pago_informado_at: data.pago_informado_at ?? null,
                    pago_informado_por: data.pago_informado_por ?? null,
                    reembolso_at: data.reembolso_at ?? null,
                    reembolso_por: data.reembolso_por ?? null,
                    reembolsado_at: data.reembolsado_at ?? null,
                    reembolsado_por: data.reembolsado_por ?? null,
                    updated_at: data.updated_at ?? o.updated_at,
                  }
                : o
            )
          );
        }
        push("success", okMsg);
        // Sobreventa o falla al mover el stock: la acción salió, pero hay que
        // revisar la disponibilidad.
        if (data.aviso) push("error", data.aviso);
      } catch {
        if (previo) setOps((prev) => prev.map((o) => (o.id === id ? { ...o, ...previo } : o)));
        push("error", "Error de red al actualizar");
      } finally {
        const n = (enVuelo.current.get(id) ?? 1) - 1;
        if (n <= 0) {
          enVuelo.current.delete(id);
          setGuardando((s) => {
            const t = new Set(s);
            t.delete(id);
            return t;
          });
        } else {
          enVuelo.current.set(id, n);
        }
        if (!parche) setBusyId((b) => (b === id ? null : b));
      }
    };

    const cola = (colas.current.get(id) ?? Promise.resolve()).then(correr);
    colas.current.set(id, cola);
    void cola.finally(() => {
      if (colas.current.get(id) === cola) colas.current.delete(id);
    });
  }

  // Edición de datos internos (notas / fecha) vía PATCH /api/operaciones/[id].
  async function updateOp(
    op: Operacion,
    patch: Partial<Pick<Operacion, "notas" | "fecha_evento">>,
    okMsg: string
  ) {
    setBusyId(op.id);
    try {
      const res = await fetch(`/api/operaciones/${op.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        push("error", data.error ?? "No se pudo guardar");
        return;
      }
      setOps((prev) =>
        prev.map((o) =>
          o.id === op.id
            ? { ...o, notas: data.notas, fecha_evento: data.fecha_evento }
            : o
        )
      );
      push("success", okMsg);
    } catch {
      push("error", "Error de red al guardar");
    } finally {
      setBusyId(null);
    }
  }

  // Cotizar NO crea la operación: le manda el precio al cliente, que la
  // acepta (o no) desde Mis pedidos. La consulta queda en la lista como
  // "Esperando pago" hasta que responda.
  async function cotizarConsulta(
    c: Consulta,
    valores: { costo: number; comision: number; moneda: Moneda }
  ): Promise<string | null> {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/consultas/${c.id}/cotizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valores),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error ?? "No se pudo enviar la cotización";
        push("error", msg);
        return msg;
      }
      setConsultas((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...data.consulta } : x)));
      push("success", `Cotización enviada a ${c.comprador_alias ?? c.cliente_email ?? "el cliente"}`);
      return null;
    } catch {
      const msg = "Error de red. Reintentá.";
      push("error", msg);
      return msg;
    } finally {
      setBusyId(null);
    }
  }

  // El cliente aceptó por WhatsApp: se registra (con quién lo marcó) y nace
  // el pedido, por la misma función atómica que usa el cliente en la web.
  async function aceptarPorWhatsapp(c: Consulta) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/consultas/${c.id}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: c.cotizacion_version, via: "whatsapp" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push("error", data.error ?? "No se pudo registrar la aceptación");
        return;
      }
      setConsultas((prev) => prev.filter((x) => x.id !== c.id));
      push("success", `Pedido ${data.operacion?.code ?? ""} creado`);
      // La operación nueva la trae el server (con su estado real).
      router.refresh();
    } catch {
      push("error", "Error de red. Reintentá.");
    } finally {
      setBusyId(null);
    }
  }

  // Consulta sin entrada: se cierra y el cliente la ve como "No disponible".
  async function descartarConsulta(c: Consulta) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/consultas/${c.id}/descartar`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push("error", data.error ?? "No se pudo descartar la consulta");
        return;
      }
      setConsultas((prev) => prev.filter((x) => x.id !== c.id));
      push("success", `Consulta ${c.code} marcada como no disponible`);
    } catch {
      push("error", "Error de red. Reintentá.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      {/* Las ocho etapas de la operación (TKT-21), en orden: cada una es una
          acción del admin o una espera a un tercero. Tocar una filtra la
          lista; tocarla de nuevo la limpia. */}
      <section className="card-shadow mb-5 overflow-hidden rounded-2xl bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-dashed divide-line sm:grid-cols-4">
          {ETAPAS_PANEL.map((e) => (
            <Stat
              key={e.key}
              label={e.label}
              value={stats[e.key]}
              accent={e.color}
              activa={filter === e.key}
              onClick={() => tocarTarjeta(e.key)}
            />
          ))}
        </div>
      </section>

      {/* Búsqueda + orden. En celular el buscador va SOLO en su renglón: en
          una fila de tres quedaba en 60px de ancho, inservible. */}
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por evento, code o alias…"
          aria-label="Buscar operaciones"
          className="w-full min-w-0 rounded-xl border border-line bg-white px-3.5 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15 sm:w-auto sm:flex-1"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "recientes" | "urgentes")}
          aria-label="Ordenar operaciones"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand sm:flex-none"
        >
          <option value="recientes">Más recientes</option>
          <option value="urgentes">Evento más próximo</option>
        </select>
        {/* CSV con TODO el historial (server-side, sin el tope de 1000 del
            panel) para contabilidad. Descarga directa. */}
        <a
          href="/api/operaciones/export"
          download
          className="flex shrink-0 items-center rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-[#4A4E5E] shadow-sm transition-colors hover:bg-canvas"
          title="Descargar todas las operaciones en CSV"
        >
          Exportar CSV
        </a>
      </div>

      {/* Filtros por estado. En celular, 2 filas de 3: seis tabs en una fila
          de 375px quedaban cortados ("Nuev…", "En cu…"). En desktop, la barra ocupa el ancho completo y los 6 tabs
          lo reparten en partes iguales — nada de barra corta ni scroll
          horizontal con tabs cortados. */}
      <div
        ref={listaRef}
        role="tablist"
        aria-label="Filtrar operaciones"
        className="mb-5 scroll-mt-28 lg:scroll-mt-20 grid w-full grid-cols-3 gap-1 rounded-xl border border-line bg-white p-1 shadow-sm sm:flex"
      >
        {PESTANAS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.key)}
              className={`min-w-0 flex-1 truncate rounded-lg px-1 py-1.5 text-center text-xs font-semibold transition-colors sm:px-3 ${
                active
                  ? "bg-ink text-white"
                  : "text-[#4A4E5E] hover:bg-canvas"
              }`}
              title={f.label}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Hay cosas esperando de más: a un toque de verlas solas. */}
      {nPrioridad > 0 && filter !== "prioridad" && (
        <button
          type="button"
          onClick={() => tocarTarjeta("prioridad")}
          className="-mt-3 mb-4 flex w-full items-center gap-2 rounded-xl bg-[#D14D68] px-3.5 py-2 text-left text-xs font-semibold text-white shadow-sm hover:bg-[#bf3f59]"
        >
          <span aria-hidden>●</span>
          {nPrioridad} {nPrioridad === 1 ? "lleva" : "llevan"} rato esperando
          <span className="ml-auto underline">Ver</span>
        </button>
      )}

      {/* Filtro que vino de una tarjeta y no es pestaña: se ve y se saca. */}
      {(chip || filtro.cliente) && (
        <div className="-mt-3 mb-4 flex flex-wrap gap-2">
          {filtro.cliente && (
            <button
              type="button"
              onClick={() => setFiltro((prev) => ({ ...prev, cliente: undefined }))}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-cobalt px-3 py-1 text-left text-xs font-semibold text-white"
              aria-label={`Quitar filtro de cliente: ${filtro.cliente.nombre ?? filtro.cliente.email}`}
            >
              <span className="[overflow-wrap:anywhere]">Cliente: {filtro.cliente.nombre ?? filtro.cliente.email}</span>
              <span aria-hidden>✕</span>
            </button>
          )}
          {chip && (
            <button
              type="button"
              onClick={() => setFilter("todas")}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white"
              aria-label={`Quitar filtro: ${chip}`}
            >
              {chip}
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
      )}

      {/* Leyenda del semáforo: los tres estados que se accionan. El gris no
          está porque no es un estado, es "todavía no pasó nada". */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 px-1 text-[11px] text-muted">
        {SEMAFORO_LEYENDA.map((sem) => (
          <span key={sem} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: SEMAFORO_COLOR[sem] }}
              aria-hidden
            />
            {SEMAFORO_LABEL[sem]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: "#B07A14" }}
            aria-hidden
          >
            ?
          </span>
          Consulta — chequear stock
        </span>
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#C5C9D6] bg-white/50 px-4 py-10 text-center text-sm text-muted">
            {ops.length === 0 && consultas.length === 0
              ? "Todavía no hay operaciones. Se cargan desde el módulo de carga."
              : chip
                ? "Nada con este filtro por ahora."
                : "No hay operaciones con este filtro."}
          </div>
        ) : (
          enPagina.map((fila) =>
            fila.kind === "consulta" ? (
              <ConsultaCard
                key={fila.id}
                consulta={fila.consulta}
                prioridad={prioridades.get(fila.id) ?? null}
                busy={busyId === fila.id}
                onCotizar={cotizarConsulta}
                onAceptarWhatsapp={aceptarPorWhatsapp}
                onDescartar={descartarConsulta}
                onError={(m) => push("error", m)}
              />
            ) : (
              <OperacionCard
                key={fila.id}
                op={fila.op}
                prioridad={prioridades.get(fila.id) ?? null}
                items={itemsPorOp.get(fila.id) ?? []}
                baseUrl={baseUrl}
                busy={busyId === fila.id}
                guardando={guardando.has(fila.id)}
                onAction={applyAction}
                onUpdate={updateOp}
                onCopied={(m) => push("success", m)}
              />
            )
          )
        )}
      </div>

      {totalPages > 1 && (
        <nav
          aria-label="Paginación de operaciones"
          className="mt-5 flex items-center justify-center gap-3"
        >
          <button
            onClick={() => irAPagina(pagina - 1)}
            disabled={pagina <= 1}
            className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-[#4A4E5E] shadow-sm transition-colors hover:bg-canvas disabled:opacity-40"
          >
            ← Anteriores
          </button>
          <span className="text-xs font-medium tabular-nums text-muted">
            Página {pagina} de {totalPages} · {visible.length} operaciones
          </span>
          <button
            onClick={() => irAPagina(pagina + 1)}
            disabled={pagina >= totalPages}
            className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-[#4A4E5E] shadow-sm transition-colors hover:bg-canvas disabled:opacity-40"
          >
            Siguientes →
          </button>
        </nav>
      )}

      <ToastViewport toasts={toasts} />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  activa,
  onClick,
}: {
  label: string;
  value: number;
  accent: string;
  activa: boolean;
  onClick: () => void;
}) {
  return (
    // Estilo del mock aprobado: label en mono chiquito y número gordo a la
    // izquierda. flex-col + justify-between mantiene los números alineados
    // aunque un label envuelva a dos líneas en móvil.
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      title={activa ? "Quitar filtro" : `Ver solo: ${label}`}
      className={`flex h-full w-full flex-col justify-between gap-1 px-4 py-3.5 text-left transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
        activa ? "bg-canvas shadow-[inset_0_-3px_0_currentColor]" : ""
      }`}
      style={activa ? { color: accent } : undefined}
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p
        className="font-body text-[28px] font-extrabold leading-none tabular-nums tracking-tight"
        style={{ color: accent }}
      >
        {String(value).padStart(2, "0")}
      </p>
    </button>
  );
}
