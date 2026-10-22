"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compararAZ } from "@/lib/orden";
import Link from "next/link";
import { eventoPasado, type SyncRun, type TicketFull } from "@/lib/tickets";
import { ToastViewport, useToast } from "./Toast";
import { parsePrecio } from "@/lib/precios";
import { formatMonto, type Moneda } from "@/lib/operaciones";

// Autocompletado propio para la competición: las sugerencias se ven ADENTRO
// de la página (un desplegable bajo el input), no en la barra del teclado
// como hacía <datalist> en móvil. A nivel módulo para que React no lo
// remonte en cada render.
function CompeticionCombo({
  value,
  onChange,
  opciones,
  inputCls,
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: string[];
  inputCls: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const sugerencias = useMemo(() => {
    const q = value.trim().toLowerCase();
    const todas = [...opciones].sort(compararAZ);
    const base = q ? todas.filter((c) => c.toLowerCase().includes(q)) : todas;
    // Si ya escribió una igual, no la sugerimos de nuevo.
    return base.filter((c) => c.toLowerCase() !== q).slice(0, 8);
  }, [value, opciones]);

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value}
        autoComplete="off"
        aria-label="Categoría o competición"
        placeholder="Elegí o escribí una nueva"
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
      />
      {abierto && sugerencias.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {sugerencias.map((c) => (
            <li key={c}>
              <button
                type="button"
                // onMouseDown (no onClick): dispara ANTES del blur del input,
                // que si no cerraría la lista sin aplicar la selección.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c);
                  setAbierto(false);
                }}
                className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-canvas"
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  initial: TicketFull[];
  syncRuns: SyncRun[];
  // Entradas del portal con evento vigente (las de eventos pasados no cuentan).
  portalCount: number;
  // De esas, las reservables ahora (con stock y en estado book).
  portalComprables: number;
  // Interruptor: si las entradas de Passion se muestran en la tienda.
  portalActivo: boolean;
  // Competiciones existentes (portal + propias) para el dropdown del form.
  competiciones: string[];
};

// Datos del evento (compartidos) + una fila por sector: un evento puede
// publicarse con varios sectores, cada uno con su precio y stock (igual que
// las entradas del portal: una fila de catálogo por sector).
const empty = {
  evento: "",
  competicion: "",
  fecha: "",
  ciudad: "",
  // A quién le compramos. Va por evento: las entradas de un mismo partido
  // salen del mismo proveedor, repetirlo por sector sería carga al pedo.
  proveedor: "",
};

// El precio de la entrada se carga en dos partes: lo que nos costó y lo que
// ganamos. El precio de venta es la suma y no se escribe a mano — antes había
// un campo "precio de venta" aparte del costo, y cargar solo el costo (que es
// lo natural) reventaba con "El precio debe ser mayor a 0".
type SectorForm = {
  categoria: string;
  // Moneda de esta entrada: se muestra en la suya, sin convertir.
  moneda: string;
  // Lo que nos costó conseguirla.
  costo: string;
  // Lo que le sumamos encima.
  comision: string;
  stock: string;
};
// Un dato de la entrada con su etiqueta. Antes la tarjeta juntaba todo en una
// línea sin etiquetas ("Platea Alta · US$ 150 · Stock 2") y con la tarjeta
// angosta quedaba ilegible.
function Dato({
  k,
  v,
  fuerte = false,
  ancho = false,
}: {
  k: string;
  v: string;
  fuerte?: boolean;
  // Para los valores largos (la sede): ocupa dos columnas.
  ancho?: boolean;
}) {
  return (
    <div className={`min-w-0 ${ancho ? "col-span-2" : ""}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
      {/* Envuelve en vez de cortar: el punto de la tarjeta es ver TODO lo que
          se cargó, y un "Estadio Monumental, Buenos…" no sirve. */}
      <dd className={`break-words ${fuerte ? "font-semibold text-body" : "text-[#4A4E5E]"}`}>
        {v}
      </dd>
    </div>
  );
}

function fmtFechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// La moneda guardada es texto libre en la base; se acota a las dos que maneja
// la app (una propia vieja en euros se vende en dólares: se edita como USD).
function monedaDe(v: string | null | undefined): Moneda {
  return String(v ?? "USD").toUpperCase() === "ARS" ? "ARS" : "USD";
}

const sectorVacio = (): SectorForm => ({
  categoria: "",
  moneda: "USD",
  costo: "",
  comision: "",
  stock: "1",
});
const MAX_SECTORES = 20;
// Una entrada con fecha pasada no se ve en la tienda ni en la lista: sin este
// aviso, al publicarla parecía que no se había guardado.
const AVISO_PASADA = 'La fecha ya pasó: no se ve en la tienda y queda en "Ver pasadas".';

// Panel de catálogo: carga de entradas propias (source=manual) junto a las
// sincronizadas del portal, y salud de las últimas corridas del worker.
export default function TicketsPanel({
  initial,
  syncRuns,
  portalCount,
  portalComprables,
  portalActivo,
  competiciones,
}: Props) {
  const [tickets, setTickets] = useState<TicketFull[]>(initial);
  // Lista viva: AutoRefresh vuelve a pedir la página cada tanto y `initial`
  // llega con los datos nuevos (entradas cargadas por otro admin). El
  // formulario de edición tiene su propio estado, así que no se pisa. Sin
  // esto la lista quedaba congelada en lo que había al abrir la página.
  useEffect(() => {
    setTickets(initial);
  }, [initial]);
  // Sugerencias del dropdown de competición. Una nueva se suma al publicar,
  // así aparece en la próxima carga sin recargar la página.
  const [comps, setComps] = useState<string[]>(competiciones);
  const [form, setForm] = useState(empty);
  // Mapa del estadio (opcional). `undefined` al editar = no se tocó.
  const [mapa, setMapa] = useState<string | null | undefined>(undefined);
  const [subiendoMapa, setSubiendoMapa] = useState(false);
  const [sectores, setSectores] = useState<SectorForm[]>([sectorVacio()]);
  // Edición de una entrada existente: el mismo form pasa a modo "Guardar
  // cambios" (una entrada = un sector; el id y el link no cambian).
  const [editando, setEditando] = useState<TicketFull | null>(null);
  // Carga o edición sin guardar: el refresco automático de la página espera
  // (ver components/AutoRefresh.tsx).
  const vacio = sectorVacio();
  const conDatos =
    editando !== null ||
    mapa !== undefined ||
    (Object.keys(empty) as (keyof typeof empty)[]).some((k) => form[k] !== empty[k]) ||
    sectores.length !== 1 ||
    (Object.keys(vacio) as (keyof SectorForm)[]).some((k) => sectores[0]?.[k] !== vacio[k]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Las de eventos que ya pasaron no se venden más (la tienda ya no las
  // muestra): fuera de la lista, salvo que se pidan con "Ver pasadas".
  const [verPasadas, setVerPasadas] = useState(false);
  const [passionOn, setPassionOn] = useState(portalActivo);
  // Lo que trae un refresco de la página (otro admin tocó el interruptor o
  // el catálogo sumó competiciones) se refleja; mientras se cambia acá, no.
  useEffect(() => {
    if (!passionBusy) setPassionOn(portalActivo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalActivo]);
  useEffect(() => {
    setComps((prev) => Array.from(new Set([...prev, ...competiciones])).sort());
  }, [competiciones]);
  const [passionBusy, setPassionBusy] = useState(false);
  const { toasts, push } = useToast();

  // Paginado como en el panel: renderizar miles de filas juntas era el
  // cuello confirmado por el stress test (p50 3,5s con 2500 entradas).
  const PAGE_SIZE = 20;
  const pasadas = tickets.filter((t) => eventoPasado(t.fecha));
  const vigentes = tickets.filter((t) => !eventoPasado(t.fecha));
  // Si se borró la última pasada, se vuelve solo a las vigentes.
  const mostrandoPasadas = verPasadas && pasadas.length > 0;
  const lista = mostrandoPasadas ? pasadas : vigentes;
  const totalPages = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
  const pagina = Math.min(page, totalPages);
  const enPagina = lista.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);
  // Mismo guard que en NewOperacionForm: dos taps en el mismo tick
  // dispararían dos POST antes de que el disabled llegue a pintarse.
  const enviando = useRef(false);

  function set<K extends keyof typeof empty>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setSector(i: number, key: keyof SectorForm, value: string) {
    setSectores((prev) => prev.map((s, j) => (j === i ? { ...s, [key]: value } : s)));
  }

  // Cargar una entrada existente en el form para editarla.
  function empezarEdicion(t: TicketFull) {
    setEditando(t);
    setForm({
      evento: t.evento,
      competicion: t.competicion ?? "",
      fecha: t.fecha ? t.fecha.slice(0, 10) : "",
      ciudad: t.ciudad ?? "",
      proveedor: t.proveedor ?? "",
    });
    setMapa(t.imagen_url ?? null);
    // En la base vive el precio de VENTA (precio_final) y el costo. La
    // comisión es la diferencia: se deriva para editar, no se guarda aparte.
    const costo = t.precio_costo != null ? Number(t.precio_costo) : 0;
    const venta = t.precio_final != null ? Number(t.precio_final) : 0;
    const comision = Math.round((venta - costo) * 100) / 100;
    setSectores([
      {
        categoria: t.categoria ?? "",
        moneda: t.moneda_final ?? "USD",
        costo: t.precio_costo != null ? String(t.precio_costo) : "",
        comision: comision > 0 ? String(comision) : "",
        stock: String(t.stock ?? 0),
      },
    ]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelarEdicion() {
    setEditando(null);
    setForm(empty);
    setMapa(undefined);
    setSectores([sectorVacio()]);
  }

  // Sube el mapa apenas se elige: así el formulario manda solo la URL.
  async function subirMapa(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      push("error", "La imagen pesa más de 5 MB");
      return;
    }
    setSubiendoMapa(true);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      const res = await fetch("/api/tickets/mapa", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push("error", data.error ?? "No se pudo subir el mapa");
        return;
      }
      setMapa(data.url);
    } catch {
      push("error", "Error de red al subir el mapa");
    } finally {
      setSubiendoMapa(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando.current) return;
    // Todos los campos son obligatorios: sin esto se creaban entradas a
    // medias (mismo problema que hubo con las operaciones vacías).
    if (!form.evento.trim()) {
      push("error", "El evento es obligatorio");
      return;
    }
    if (!form.competicion.trim()) {
      push("error", "La categoría / competición es obligatoria");
      return;
    }
    if (!form.ciudad.trim()) {
      push("error", "El lugar (ciudad o país) es obligatorio");
      return;
    }
    if (!form.fecha) {
      push("error", "La fecha del evento es obligatoria");
      return;
    }
    const vistos = new Set<string>();
    for (let i = 0; i < sectores.length; i++) {
      const s = sectores[i];
      const n = sectores.length > 1 ? ` (sector ${i + 1})` : "";
      if (!s.categoria.trim()) {
        push("error", `El sector es obligatorio${n}`);
        return;
      }
      const precio = parsePrecio(s.costo, s.comision, n);
      if (!precio.ok) {
        push("error", precio.error);
        return;
      }
      const stockNum = Math.trunc(Number(s.stock));
      // Editando se permite stock 0 (agotada pero visible "sin cupo"); en el
      // alta tiene que haber al menos 1.
      const minStock = editando ? 0 : 1;
      if (!s.stock.trim() || !Number.isFinite(stockNum) || stockNum < minStock) {
        push("error", editando ? `Stock inválido${n}` : `El stock debe ser al menos 1${n}`);
        return;
      }
      const clave = s.categoria.trim().toLowerCase();
      if (vistos.has(clave)) {
        push("error", `El sector "${s.categoria.trim()}" está repetido`);
        return;
      }
      vistos.add(clave);
    }
    enviando.current = true;
    setLoading(true);
    try {
      if (editando) {
        // Edición: una entrada, mismo id (y mismo link en la tienda).
        const s = sectores[0];
        const res = await fetch(`/api/tickets/${encodeURIComponent(editando.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticket: {
              ...form,
              categoria: s.categoria,
              costo: s.costo,
              comision: s.comision,
              moneda: s.moneda,
              stock: s.stock,
              // undefined no viaja en el JSON: el mapa no se toca.
              ...(mapa !== undefined ? { imagen_url: mapa } : {}),
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          push("error", data.error ?? "No se pudo guardar la entrada");
          return;
        }
        setTickets((prev) =>
          prev.map((t) => (t.id === editando.id ? (data.row as TicketFull) : t))
        );
        const pasada = eventoPasado(form.fecha);
        cancelarEdicion();
        push("success", pasada ? `Entrada actualizada. ${AVISO_PASADA}` : "Entrada actualizada en la tienda");
        return;
      }

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: { ...form, sectores, imagen_url: mapa ?? null } }),
      });
      const data = await res.json();
      if (!res.ok) {
        push("error", data.error ?? "No se pudo publicar la entrada");
        return;
      }
      setTickets((prev) => [...(data.rows as TicketFull[]), ...prev]);
      const nuevaComp = form.competicion.trim();
      if (nuevaComp && !comps.includes(nuevaComp)) {
        setComps((prev) => [...prev, nuevaComp].sort());
      }
      const pasada = eventoPasado(form.fecha);
      setForm(empty);
      setMapa(undefined);
      setSectores([sectorVacio()]);
      push(
        "success",
        pasada
          ? `Entrada guardada. ${AVISO_PASADA}`
          : sectores.length > 1
            ? `Entrada publicada con ${sectores.length} sectores`
            : "Entrada publicada en la tienda"
      );
    } catch {
      push("error", "Error de red al publicar");
    } finally {
      enviando.current = false;
      setLoading(false);
    }
  }

  // Prende/apaga las entradas de Passion en la tienda. Sin optimismo: el
  // estado recién cambia cuando el server confirmó (y ya revalidó la tienda).
  async function togglePassion() {
    if (passionBusy) return;
    setPassionBusy(true);
    try {
      const res = await fetch("/api/portal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !passionOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        push("error", data.error ?? "No se pudo cambiar la tienda");
        return;
      }
      setPassionOn(data.activo);
      push(
        "success",
        data.activo
          ? "Entradas de Passion visibles en la tienda"
          : "Entradas de Passion ocultas: la tienda muestra solo las propias"
      );
    } catch {
      push("error", "Error de red al cambiar la tienda");
    } finally {
      setPassionBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        push("error", data.error ?? "No se pudo borrar");
        return;
      }
      setTickets((prev) => prev.filter((t) => t.id !== id));
      if (editando?.id === id) cancelarEdicion();
      push("success", "Entrada borrada");
    } catch {
      push("error", "Error de red al borrar");
    } finally {
      setBusyId(null);
    }
  }

  // Sin ancho: el ancho lo pone cada campo. Agregarle "w-20" a una clase que
  // ya dice "w-full" NO hace nada —gana la que Tailwind emite última, que es
  // w-full— y así el select de moneda se comía la celda entera y el input de
  // al lado quedaba en 26px, pisando al vecino.
  const fieldCls =
    "rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15";
  const inputCls = `w-full ${fieldCls}`;
  const labelCls =
    "mb-1 block text-xs font-medium uppercase tracking-wide text-[#6A6E7E]";

  const lastSync = syncRuns[0];

  return (
    // max-w-5xl y no 3xl: es una página de DOS columnas (el formulario fijo en
    // 380px y la lista al lado). Con 768px de ancho total a la lista le
    // quedaban 330px y la ficha de cada entrada entraba a los tropezones.
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      {/* Salud del catálogo / worker */}
      <section className="card-shadow mb-5 overflow-hidden rounded-2xl bg-white">
        <div className="grid grid-cols-3 divide-x divide-dashed divide-line">
          <Stat
            label="De Passion"
            value={String(portalCount)}
            accent={passionOn ? "#6C5BF2" : "#9AA0B2"}
            sub={passionOn ? `${portalComprables} comprables` : "Ocultas de la tienda"}
          />
          <Stat
            label="Propias"
            value={String(vigentes.length)}
            accent="#0D9377"
            sub={pasadas.length > 0 ? `+ ${pasadas.length} ${pasadas.length === 1 ? "pasada" : "pasadas"}` : undefined}
          />
          <Stat
            label="Última sync"
            value={
              lastSync
                ? new Date(lastSync.created_at).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: "America/Argentina/Buenos_Aires",
                  })
                : "—"
            }
            accent={lastSync?.status === "ok" ? "#0D9377" : "#D14D68"}
            sub={lastSync ? lastSync.status.toUpperCase() : "Sin corridas"}
          />
        </div>
      </section>

      {/* Interruptor: entradas de Passion visibles u ocultas en la tienda.
          El botón es el área táctil (el global de móvil le pone min-height
          40px, y eso deformaba la pastilla); el dibujo del switch vive en un
          span interno de tamaño fijo, centrado, que no se estira. */}
      <section className="card-shadow mb-5 flex flex-nowrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Entradas de Passion en la tienda</p>
          <p className="text-xs text-muted">
            {passionOn
              ? "Visibles junto a las propias"
              : "Ocultas: la tienda muestra solo las entradas propias"}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={passionOn}
          aria-label="Mostrar entradas de Passion en la tienda"
          onClick={togglePassion}
          disabled={passionBusy}
          className="flex shrink-0 items-center justify-center disabled:opacity-60"
        >
          <span
            aria-hidden
            className={`relative block h-7 w-12 rounded-full transition-colors ${
              passionOn ? "bg-estado-confirmada" : "bg-[#C5C9D6]"
            }`}
          >
            <span
              className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white shadow transition-[left] ${
                passionOn ? "left-[calc(100%-1.625rem)]" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </section>

      {/* minmax(0,1fr) también en móvil: sin eso, el form impone su ancho
          mínimo intrínseco (inputs con size por defecto) y desborda. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,380px)_1fr]">
        {/* Formulario de carga manual */}
        <form
          onSubmit={onSubmit}
          className="card-shadow min-w-0 overflow-hidden rounded-2xl md:sticky md:top-6 md:self-start"
          data-editando={conDatos ? "" : undefined}
        >
          <div className="surface-ink punch-b px-5 py-4 text-white">
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
              Catálogo de la tienda
            </p>
            <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">
              {editando ? "Editar entrada propia" : "Cargar entrada propia"}
            </h2>
            {editando && (
              <p className="mt-1 text-xs text-white/60">
                {editando.evento} — el link en la tienda no cambia
              </p>
            )}
          </div>
          <div className="punch-t bg-white">
            <div className="perf-line-light mx-5" />
            <div className="space-y-3 p-5">
              <div>
                <label className={labelCls}>Evento *</label>
                <input
                  className={inputCls}
                  value={form.evento}
                  onChange={(e) => set("evento", e.target.value)}
                  placeholder="River vs Boca — Superclásico"
                />
              </div>
              {/* En desktop comparten fila. flex-col + justify-between: si un
                  label envuelve a dos líneas, los inputs quedan igual anclados
                  abajo y alineados entre sí. */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col justify-between">
                  <label className={labelCls}>Categoría / competición *</label>
                  {/* Autocompletado propio: sugerencias en un desplegable
                      dentro de la página (en móvil, datalist las mandaba a
                      la barra del teclado). Nueva => se agrega al publicar. */}
                  <CompeticionCombo
                    value={form.competicion}
                    onChange={(v) => set("competicion", v)}
                    opciones={comps}
                    inputCls={inputCls}
                  />
                </div>
                <div className="flex flex-col justify-between">
                  <label className={labelCls}>Lugar *</label>
                  <input
                    className={inputCls}
                    value={form.ciudad}
                    onChange={(e) => set("ciudad", e.target.value)}
                    placeholder="Ciudad o país"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Proveedor</label>
                <input
                  className={inputCls}
                  value={form.proveedor}
                  onChange={(e) => set("proveedor", e.target.value)}
                  placeholder="A quién le compramos"
                />
              </div>
              <div>
                <label className={labelCls}>Mapa del estadio</label>
                {mapa ? (
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mapa} alt="Mapa del estadio" className="h-14 w-20 rounded object-cover" />
                    <span className="min-w-0 flex-1 text-xs text-muted">
                      Se muestra en la tienda con zoom
                    </span>
                    <button
                      type="button"
                      onClick={() => setMapa(null)}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-[#4A4E5E] hover:bg-canvas"
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-line bg-white px-3 py-2.5 text-sm text-muted hover:border-brand">
                    <span>{subiendoMapa ? "Subiendo…" : "Subir imagen (PNG, JPG o WEBP, hasta 5 MB)"}</span>
                    <span className="shrink-0 rounded-lg bg-canvas px-2.5 py-1 text-xs font-semibold text-[#4A4E5E]">
                      Elegir
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={subiendoMapa}
                      onChange={(e) => {
                        void subirMapa(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <div>
                <label className={labelCls}>Fecha *</label>
                <input
                  type="date"
                  className={inputCls}
                  value={form.fecha}
                  onChange={(e) => set("fecha", e.target.value)}
                />
              </div>

              {/* Sectores: uno por defecto; se pueden sumar más (cada uno se
                  publica como su propia fila del catálogo, como el portal). */}
              {sectores.map((s, i) => (
                <div
                  key={i}
                  className="space-y-3 rounded-xl border border-dashed border-line bg-canvas/60 p-3"
                >
                  <div className="flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <label className={labelCls}>
                        Sector {sectores.length > 1 ? i + 1 : ""} *
                      </label>
                      <input
                        className={inputCls}
                        value={s.categoria}
                        onChange={(e) => setSector(i, "categoria", e.target.value)}
                        placeholder="Platea Alta"
                      />
                    </div>
                    {sectores.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Quitar sector ${i + 1}`}
                        onClick={() =>
                          setSectores((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  {/* Cada campo en su celda. El select de moneda metido al
                      lado del importe dejaba el input de costo en 63px en esta
                      columna, que es angosta. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Moneda</label>
                      {/* La entrada se muestra en SU moneda: no se convierte. */}
                      <select
                        className={inputCls}
                        value={s.moneda}
                        onChange={(e) => setSector(i, "moneda", e.target.value)}
                      >
                        <option value="USD">USD</option>
                        <option value="ARS">ARS</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Stock *</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className={`${inputCls} font-mono`}
                        value={s.stock}
                        onChange={(e) => setSector(i, "stock", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Precio de costo</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        className={`${inputCls} font-mono`}
                        value={s.costo}
                        onChange={(e) => setSector(i, "costo", e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Comisión</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        className={`${inputCls} font-mono`}
                        value={s.comision}
                        onChange={(e) => setSector(i, "comision", e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    {/* El precio que ve el cliente es la suma: se muestra acá
                        para no tener que hacer la cuenta de cabeza. */}
                    <div className="col-span-2 flex items-center justify-between rounded-xl bg-canvas px-3 py-2">
                      <span className={`${labelCls} mb-0`}>Precio de venta</span>
                      <span className="font-display text-sm font-bold tabular-nums">
                        {(() => {
                          const r = parsePrecio(s.costo, s.comision);
                          return r.ok ? formatMonto(r.total, s.moneda as Moneda) : "—";
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Editando, la entrada es UNA (un sector): sin agregar más. */}
              {!editando && sectores.length < MAX_SECTORES && (
                <button
                  type="button"
                  onClick={() => setSectores((prev) => [...prev, sectorVacio()])}
                  className="w-full rounded-xl border border-dashed border-brand/40 px-3 py-2 text-xs font-semibold text-brand transition-colors hover:bg-brand/5"
                >
                  + Agregar otro sector
                </button>
              )}
            </div>
            <div className="space-y-2 px-5 pb-5">
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
              >
                {loading
                  ? "Guardando…"
                  : editando
                    ? "Guardar cambios"
                    : "Publicar en la tienda"}
              </button>
              {editando && (
                <button
                  type="button"
                  onClick={cancelarEdicion}
                  className="w-full rounded-xl border border-line bg-white px-4 py-2 text-xs font-medium text-[#4A4E5E] transition-colors hover:bg-canvas"
                >
                  Cancelar edición
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Lista de entradas propias */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-widest text-muted">
              {mostrandoPasadas ? "Entradas propias de eventos pasados" : "Entradas propias publicadas"}
            </h2>
            {pasadas.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setVerPasadas(!mostrandoPasadas);
                  setPage(1);
                }}
                aria-pressed={mostrandoPasadas}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas"
              >
                {mostrandoPasadas ? "← Volver a las vigentes" : `Ver pasadas (${pasadas.length})`}
              </button>
            )}
          </div>
          {lista.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#C5C9D6] bg-white/50 px-4 py-10 text-center text-sm text-muted">
              {tickets.length === 0
                ? "Todavía no cargaste entradas propias. Se publican junto a las del portal y la sincronización no las toca."
                : "No hay entradas propias de eventos por venir. Las de eventos que ya pasaron están en \"Ver pasadas\"."}
            </div>
          ) : (
            // La tarjeta mostraba el evento truncado a tres letras y el resto
            // apretado en una columna de 70px: los botones eran shrink-0 y se
            // quedaban con todo el ancho. Ahora el encabezado y los botones
            // van arriba (los botones bajan de línea si no entran) y los datos
            // de la entrada ocupan el ancho completo abajo.
            enPagina.map((t) => {
              const moneda = monedaDe(t.moneda_final);
              const venta = t.precio_final != null ? Number(t.precio_final) : null;
              const costo = t.precio_costo != null ? Number(t.precio_costo) : null;
              const comision = venta != null && costo != null ? venta - costo : null;
              return (
                <div
                  key={t.id}
                  className={`card-shadow rounded-2xl px-4 py-3 ${mostrandoPasadas ? "bg-white/70" : "bg-white"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-[12rem] flex-1">
                      {/* Sin truncate: el nombre del evento es el dato para
                          reconocerla, si no entra que envuelva. */}
                      <p className="font-display font-semibold leading-snug">
                        {t.evento}
                        {mostrandoPasadas && (
                          <span className="ml-2 inline-block rounded-full bg-canvas px-2 py-0.5 align-middle font-mono text-[10px] font-bold uppercase tracking-wide text-muted">
                            Ya pasó
                          </span>
                        )}
                      </p>
                      {t.competicion && (
                        <p className="text-xs text-muted">{t.competicion}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/moderador?evento=${encodeURIComponent(t.evento)}&ticket=${encodeURIComponent(t.id)}`}
                        className="inline-flex min-h-[38px] items-center rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/5"
                      >
                        Crear operación
                      </Link>
                      <button
                        onClick={() => empezarEdicion(t)}
                        disabled={busyId === t.id}
                        className="inline-flex min-h-[38px] items-center rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas disabled:opacity-60"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => onDelete(t.id)}
                        disabled={busyId === t.id}
                        className="inline-flex min-h-[38px] items-center rounded-lg border border-estado-cancelada px-3 py-1.5 text-xs font-semibold text-estado-cancelada transition-colors hover:bg-estado-cancelada/5 disabled:opacity-60"
                      >
                        {busyId === t.id ? "Borrando…" : "Borrar"}
                      </button>
                    </div>
                  </div>

                  {/* Todo lo que se cargó de la entrada, cada dato con su
                      etiqueta. El precio va en SU moneda: antes decía "US$"
                      para todas, incluso para las cargadas en pesos. */}
                  {/* Cuatro columnas recién en lg: `sm` mira el viewport, no
                      el ancho de esta columna, y en una pantalla grande con la
                      lista angosta partía todo en cuatro tiras de 75px. */}
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-dashed border-line pt-2.5 text-xs lg:grid-cols-4">
                    <Dato k="Sector" v={t.categoria ?? "General"} />
                    <Dato k="Fecha" v={fmtFechaCorta(t.fecha)} />
                    <Dato k="Lugar" v={t.ciudad ?? "—"} ancho />
                    <Dato k="Stock" v={String(t.stock ?? 0)} />
                    <Dato
                      k="Precio de venta"
                      v={venta != null ? formatMonto(venta, moneda) : "A consultar"}
                      fuerte
                    />
                    <Dato k="Costo" v={costo != null ? formatMonto(costo, moneda) : "—"} />
                    <Dato
                      k="Comisión"
                      v={comision != null ? formatMonto(comision, moneda) : "—"}
                    />
                    <Dato k="Proveedor" v={t.proveedor || "—"} />
                  </dl>
                </div>
              );
            })
          )}

          {totalPages > 1 && (
            <nav
              aria-label="Paginación de entradas"
              className="flex items-center justify-center gap-3 pt-1"
            >
              <button
                onClick={() => setPage(Math.max(1, pagina - 1))}
                disabled={pagina <= 1}
                className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-[#4A4E5E] shadow-sm transition-colors hover:bg-canvas disabled:opacity-40"
              >
                ← Anteriores
              </button>
              <span className="text-xs font-medium tabular-nums text-muted">
                Página {pagina} de {totalPages} · {lista.length} entradas
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, pagina + 1))}
                disabled={pagina >= totalPages}
                className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-[#4A4E5E] shadow-sm transition-colors hover:bg-canvas disabled:opacity-40"
              >
                Siguientes →
              </button>
            </nav>
          )}

          {/* Últimas corridas del worker */}
          <h2 className="pt-4 text-xs font-medium uppercase tracking-widest text-muted">
            Últimas sincronizaciones del portal
          </h2>
          {syncRuns.length === 0 ? (
            <p className="text-sm text-muted">
              Sin corridas registradas. El worker escribe acá en cada ciclo.
            </p>
          ) : (
            <div className="card-shadow overflow-hidden rounded-2xl bg-white text-sm">
              {syncRuns.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b border-dashed border-line px-4 py-2.5 last:border-b-0"
                >
                  <span
                    className="font-mono text-xs font-bold"
                    style={{ color: r.status === "ok" ? "#0D9377" : "#D14D68" }}
                  >
                    {r.status.toUpperCase()}
                  </span>
                  <span className="text-xs text-muted">
                    {r.upserted ?? 0} actualizadas
                    {r.reason ? ` · ${r.reason}` : ""}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {new Date(r.created_at).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: "America/Argentina/Buenos_Aires",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ToastViewport toasts={toasts} />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent: string;
  sub?: string;
}) {
  return (
    <div className="px-4 py-4 text-center sm:text-left">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted">{label}</p>
      <p
        className="mt-0.5 font-display text-2xl font-bold tabular-nums tracking-tight"
        style={{ color: accent }}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
