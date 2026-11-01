"use client";

import { useEffect, useRef, useState } from "react";
import EncuadreFoto from "@/components/admin/EncuadreFoto";
import { MIN_RECORTE } from "@/lib/encuadre";
import {
  estadoTarjeta,
  MAX_CARRUSEL,
  MAX_CATEGORIA,
  MAX_NOMBRE,
  mesLegible,
  MIN_CARRUSEL,
  type EstadoTarjeta,
  type TarjetaCarrusel,
} from "@/lib/carrusel";

// Carrusel de eventos de la home pública (TKT-12). Curado a mano: lo que se
// carga acá es lo que se ve al final de la home, en este orden. No sale del
// inventario. Cada foto se encuadra a 4:3 antes de subir (EncuadreFoto). Los
// cambios se ven en la home sin desplegar.

const ESTADO: Record<EstadoTarjeta, { texto: string; clase: string }> = {
  visible: { texto: "Se muestra", clase: "bg-emerald-50 text-emerald-800" },
  sin_foto: { texto: "Sin foto, no se muestra", clase: "bg-amber-50 text-amber-800" },
  vencida: { texto: "Ya pasó, no se muestra", clase: "bg-canvas text-[#4A4E5E]" },
};

// Sugerencias para el campo de categoría (se puede escribir cualquiera).
const CATEGORIAS = ["Fútbol europeo", "Fórmula 1", "Champions League", "Mundial 2026", "Copa Libertadores", "Shows"];

type Datos = { nombre: string; categoria: string; mes: string };
const VACIO: Datos = { nombre: "", categoria: "", mes: "" };

// Foto elegida que falta encuadrar: para una tarjeta existente (id) o para
// la nueva (id null).
type Encuadrando = { id: string | null; archivo: File; nombre: string; categoria: string };

export default function CarruselHomePanel() {
  const [tarjetas, setTarjetas] = useState<TarjetaCarrusel[]>([]);
  const [cargando, setCargando] = useState(true);
  // Las fotos de muestra de la demo viven fuera del bucket: en la demo el
  // panel las cuenta como válidas, igual que la home.
  const [demo, setDemo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nueva, setNueva] = useState<Datos>(VACIO);
  const [fotoNueva, setFotoNueva] = useState<{ blob: Blob; url: string } | null>(null);
  const [editando, setEditando] = useState<{ id: string; datos: Datos } | null>(null);
  const [encuadrando, setEncuadrando] = useState<Encuadrando | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const destino = useRef<{ id: string | null; nombre: string; categoria: string } | null>(null);

  useEffect(() => {
    fetch("/api/carrusel")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        setTarjetas(d.tarjetas ?? []);
        setDemo(d.demo === true);
      })
      .catch(() => setAviso({ tipo: "error", msg: "No se pudo cargar el carrusel" }))
      .finally(() => setCargando(false));
  }, []);

  // La vista previa de la foto nueva vive hasta que se usa o se cambia.
  useEffect(
    () => () => {
      if (fotoNueva) URL.revokeObjectURL(fotoNueva.url);
    },
    [fotoNueva]
  );

  const ordenadas = [...tarjetas].sort((a, b) => a.orden - b.orden);
  const estados = new Map(ordenadas.map((t) => [t.id, estadoTarjeta(t, undefined, demo)]));
  const visibles = Math.min(MAX_CARRUSEL, ordenadas.filter((t) => estados.get(t.id) === "visible").length);
  const lleno = tarjetas.length >= MAX_CARRUSEL;

  function elegirFoto(d: { id: string | null; nombre: string; categoria: string }) {
    destino.current = d;
    input.current?.click();
  }

  function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    const d = destino.current;
    if (archivo && d) setEncuadrando({ ...d, archivo });
  }

  async function pedir(metodo: string, body: BodyInit, json = true): Promise<any | null> {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/carrusel", {
        method: metodo,
        headers: json ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo guardar" });
        return null;
      }
      return data;
    } catch {
      setAviso({ tipo: "error", msg: "Error de red. Probá de nuevo." });
      return null;
    } finally {
      setOcupado(false);
    }
  }

  function archivoDe(blob: Blob): File {
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `carrusel.${ext}`, { type: blob.type });
  }

  async function onEncuadrada(blob: Blob) {
    const e = encuadrando;
    setEncuadrando(null);
    if (!e) return;
    if (e.id == null) {
      setFotoNueva({ blob, url: URL.createObjectURL(blob) });
      return;
    }
    const form = new FormData();
    form.append("id", e.id);
    form.append("archivo", archivoDe(blob));
    const data = await pedir("PUT", form, false);
    if (data?.tarjeta) {
      setTarjetas((prev) => prev.map((t) => (t.id === data.tarjeta.id ? data.tarjeta : t)));
      setAviso({ tipo: "ok", msg: "Foto actualizada. La home se actualiza en unos segundos." });
    }
  }

  async function agregar(ev: React.FormEvent) {
    ev.preventDefault();
    const form = new FormData();
    form.append("nombre", nueva.nombre);
    form.append("categoria", nueva.categoria);
    form.append("mes", nueva.mes);
    if (fotoNueva) form.append("archivo", archivoDe(fotoNueva.blob));
    const data = await pedir("POST", form, false);
    if (data?.tarjeta) {
      setTarjetas((prev) => [...prev, data.tarjeta]);
      setNueva(VACIO);
      setFotoNueva(null);
      setAviso({
        tipo: "ok",
        msg: fotoNueva
          ? "Evento sumado. La home se actualiza en unos segundos."
          : "Evento sumado. Falta la foto: sin foto no se muestra.",
      });
    }
  }

  async function guardarEdicion(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editando) return;
    const data = await pedir("PATCH", JSON.stringify({ id: editando.id, ...editando.datos }));
    if (data?.tarjeta) {
      setTarjetas((prev) => prev.map((t) => (t.id === data.tarjeta.id ? data.tarjeta : t)));
      setEditando(null);
      setAviso({ tipo: "ok", msg: "Cambios guardados." });
    }
  }

  async function mover(id: string, dir: 1 | -1) {
    const data = await pedir("PATCH", JSON.stringify({ id, dir }));
    if (data?.tarjetas) setTarjetas(data.tarjetas);
  }

  async function sacar(t: TarjetaCarrusel) {
    if (!window.confirm(`¿Sacar «${t.nombre}» del carrusel?`)) return;
    const data = await pedir("DELETE", JSON.stringify({ ids: [t.id] }));
    if (data) {
      setTarjetas((prev) => prev.filter((x) => x.id !== t.id));
      setAviso({ tipo: "ok", msg: "Evento sacado del carrusel." });
    }
  }

  const campo = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-brand focus:outline-none";

  // Función de render (no componente): así los inputs no se remontan al tipear.
  function camposDe(d: Datos, set: (d: Datos) => void) {
    return (
      <div className="grid gap-3 sm:grid-cols-[2fr_1.4fr_1fr]">
        <label className="grid gap-1 text-xs font-medium text-[#4A4E5E]">
          Evento
          <input
            className={campo}
            value={d.nombre}
            maxLength={MAX_NOMBRE}
            required
            placeholder="Ej. Final de la Champions"
            onChange={(e) => set({ ...d, nombre: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-[#4A4E5E]">
          Competencia o categoría
          <input
            className={campo}
            value={d.categoria}
            maxLength={MAX_CATEGORIA}
            required
            list="carrusel-categorias"
            placeholder="Ej. Fórmula 1"
            onChange={(e) => set({ ...d, categoria: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-[#4A4E5E]">
          Mes y año
          <input
            className={campo}
            type="month"
            value={d.mes.slice(0, 7)}
            required
            onChange={(e) => set({ ...d, mes: e.target.value })}
          />
        </label>
      </div>
    );
  }

  return (
    <section className="card-shadow mt-6 overflow-hidden rounded-2xl" data-editando={encuadrando || editando ? "" : undefined}>
      <div className="surface-ink punch-b px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">Home pública</p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">Carrusel de eventos</h2>
      </div>
      <div className="punch-t bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-[#4A4E5E]">
            Lo que cargues acá es lo que se ve al final de la home, en este orden: entre {MIN_CARRUSEL} y{" "}
            {MAX_CARRUSEL} eventos con foto, nombre, competencia y mes. No sale del inventario y no lleva precios.{" "}
            <b>Sin foto no se muestra</b>, y el de un mes que ya pasó tampoco. Los cambios se ven en la home sin
            desplegar.
          </p>
          <p className="text-xs text-muted">
            Conviene foto genérica (un estadio lleno, una largada, un escenario) antes que escudos o jugadores: esas
            tienen derechos. JPG, PNG o WEBP de al menos {MIN_RECORTE.w}×{MIN_RECORTE.h} px; al subirla elegís qué
            parte se ve.
          </p>

          {!cargando && (
            <p
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                visibles >= MIN_CARRUSEL ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
              }`}
            >
              {visibles} de {MAX_CARRUSEL} se muestran en la home
              {visibles < MIN_CARRUSEL && ` — conviene tener al menos ${MIN_CARRUSEL}`}.
            </p>
          )}

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

          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onArchivo} />
          <datalist id="carrusel-categorias">
            {CATEGORIAS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {cargando ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : ordenadas.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay eventos en el carrusel: la home no lo muestra.</p>
          ) : (
            <ol className="divide-y divide-line rounded-xl border border-line">
              {ordenadas.map((t, i) => {
                const estado = estados.get(t.id) ?? "sin_foto";
                const enEdicion = editando?.id === t.id;
                return (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 px-3 py-3 sm:flex-nowrap">
                    <span className="w-5 pt-1 text-center font-mono text-xs text-muted">{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => elegirFoto({ id: t.id, nombre: t.nombre, categoria: t.categoria })}
                      disabled={ocupado}
                      title={t.imagen_url ? "Cambiar la foto" : "Agregar foto"}
                      className="relative flex aspect-[4/3] w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-canvas text-xs font-semibold text-muted hover:border-brand hover:text-brand disabled:opacity-50"
                    >
                      {t.imagen_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.imagen_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        "+ Foto"
                      )}
                    </button>
                    {enEdicion ? (
                      <form className="min-w-0 flex-1 space-y-2" onSubmit={guardarEdicion}>
                        {camposDe(editando.datos, (datos) => setEditando({ id: t.id, datos }))}
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={ocupado}
                            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditando(null)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-brand">
                          {t.categoria}
                        </p>
                        <p className="font-semibold leading-tight">{t.nombre}</p>
                        <p className="mt-0.5 text-xs text-muted">{mesLegible(t.mes).completo}</p>
                        <span
                          className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTADO[estado].clase}`}
                        >
                          {ESTADO[estado].texto}
                        </span>
                      </div>
                    )}
                    {!enEdicion && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => mover(t.id, -1)}
                          disabled={ocupado || i === 0}
                          aria-label="Subir"
                          className="h-8 w-8 rounded border border-line text-xs hover:bg-canvas disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => mover(t.id, 1)}
                          disabled={ocupado || i === ordenadas.length - 1}
                          aria-label="Bajar"
                          className="h-8 w-8 rounded border border-line text-xs hover:bg-canvas disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() =>
                            setEditando({ id: t.id, datos: { nombre: t.nombre, categoria: t.categoria, mes: t.mes } })
                          }
                          disabled={ocupado}
                          className="h-8 rounded border border-line px-2 text-xs hover:bg-canvas disabled:opacity-30"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => sacar(t)}
                          disabled={ocupado}
                          aria-label="Sacar del carrusel"
                          className="h-8 w-8 rounded border border-line text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {!cargando &&
            (lleno ? (
              <p className="text-xs text-muted">Ya hay {MAX_CARRUSEL} eventos: sacá uno para sumar otro.</p>
            ) : (
              <form className="space-y-3 rounded-xl border border-dashed border-line p-4" onSubmit={agregar}>
                <p className="text-sm font-semibold">Sumar un evento</p>
                {camposDe(nueva, setNueva)}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => elegirFoto({ id: null, nombre: nueva.nombre, categoria: nueva.categoria })}
                    disabled={ocupado}
                    className="relative flex aspect-[4/3] w-28 items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-line text-xs font-semibold text-muted hover:border-brand hover:text-brand disabled:opacity-40"
                  >
                    {fotoNueva ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fotoNueva.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      "+ Foto"
                    )}
                  </button>
                  <button
                    type="submit"
                    disabled={ocupado}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Sumar al carrusel
                  </button>
                </div>
              </form>
            ))}
        </div>
      </div>

      {encuadrando && (
        <EncuadreFoto
          archivo={encuadrando.archivo}
          competicion={encuadrando.categoria || "Competencia"}
          evento={encuadrando.nombre || "Nombre del evento"}
          onListo={onEncuadrada}
          onCancelar={() => setEncuadrando(null)}
        />
      )}
    </section>
  );
}
