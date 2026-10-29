"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EncuadreFoto from "@/components/admin/EncuadreFoto";
import { MIN_RECORTE } from "@/lib/encuadre";
import { fmtDate } from "@/lib/tickets";
import {
  MAX_CARRUSEL,
  MAX_FOTOS_POR_GRUPO,
  panelCarrusel,
  type EstadoFotoEvento,
  type EventoCatalogo,
  type FotoCarrusel,
} from "@/lib/carrusel";

// Fotos del carrusel de eventos de la home. Los eventos salen solos del
// catálogo; acá solo se suben fotos, a una competición entera (los partidos sin
// foto propia las van alternando) o a un evento puntual. Cada foto se encuadra
// a 4:3 antes de subir (EncuadreFoto). Las de eventos que ya pasaron quedan
// abajo para borrarlas.

type Grupo = { competicion: string; evento: string | null };
type Pendiente = Grupo & { archivo: File };

const ESTADO: Record<EstadoFotoEvento, { texto: string; clase: string }> = {
  propias: { texto: "Fotos propias", clase: "bg-emerald-50 text-emerald-800" },
  competicion: { texto: "Usa las de la competición", clase: "bg-canvas text-[#4A4E5E]" },
  sin_foto: { texto: "Sin foto, no aparece", clase: "bg-amber-50 text-amber-800" },
};

export default function FotosCarruselPanel() {
  const [fotos, setFotos] = useState<FotoCarrusel[]>([]);
  const [eventos, setEventos] = useState<EventoCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  // Fotos elegidas que faltan encuadrar y subir, de a una.
  const [cola, setCola] = useState<Pendiente[]>([]);
  const [hechas, setHechas] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const destino = useRef<Grupo | null>(null);

  useEffect(() => {
    fetch("/api/carrusel/fotos")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        setFotos(d.fotos ?? []);
        setEventos(d.eventos ?? []);
      })
      .catch(() => setAviso({ tipo: "error", msg: "No se pudieron cargar las fotos del carrusel" }))
      .finally(() => setCargando(false));
  }, []);

  const panel = useMemo(() => panelCarrusel(eventos, fotos), [eventos, fotos]);

  function cuantas(g: Grupo): number {
    return fotos.filter((f) => f.competicion === g.competicion && f.evento === g.evento).length;
  }

  function elegir(g: Grupo) {
    destino.current = g;
    input.current?.click();
  }

  function onArchivos(e: React.ChangeEvent<HTMLInputElement>) {
    const g = destino.current;
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!g || archivos.length === 0) return;
    const lugar = MAX_FOTOS_POR_GRUPO - cuantas(g);
    const entran = archivos.slice(0, Math.max(0, lugar));
    setAviso(
      entran.length < archivos.length
        ? { tipo: "error", msg: `Entran ${MAX_FOTOS_POR_GRUPO} fotos por grupo: se toman ${entran.length} de ${archivos.length}.` }
        : null
    );
    if (entran.length) {
      setHechas(0);
      setCola(entran.map((archivo) => ({ ...g, archivo })));
    }
  }

  async function subir(foto: Blob) {
    const p = cola[0];
    if (!p) return;
    setOcupado(true);
    try {
      const form = new FormData();
      const ext = foto.type === "image/webp" ? "webp" : "jpg";
      form.append("archivo", new File([foto], `carrusel.${ext}`, { type: foto.type }));
      form.append("competicion", p.competicion);
      form.append("evento", p.evento ?? "");
      const res = await fetch("/api/carrusel/fotos", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo subir la foto" });
        setCola([]);
        return;
      }
      setFotos((prev) => [...prev, data.foto]);
      setAviso({ tipo: "ok", msg: "Foto subida. La home se actualiza en unos segundos." });
      setHechas((n) => n + 1);
      setCola((prev) => prev.slice(1));
    } catch {
      setAviso({ tipo: "error", msg: "Error de red al subir la foto" });
      setCola([]);
    } finally {
      setOcupado(false);
    }
  }

  async function moverFoto(id: string, dir: 1 | -1) {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/carrusel/fotos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dir }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo mover la foto" });
        return;
      }
      setFotos(data.fotos);
    } catch {
      setAviso({ tipo: "error", msg: "Error de red al mover la foto" });
    } finally {
      setOcupado(false);
    }
  }

  async function borrar(ids: string[], pregunta: string) {
    if (!window.confirm(pregunta)) return;
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/carrusel/fotos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo borrar" });
        return;
      }
      setFotos((prev) => prev.filter((f) => !ids.includes(f.id)));
      setAviso({ tipo: "ok", msg: data.borradas === 1 ? "Foto borrada" : `${data.borradas} fotos borradas` });
    } catch {
      setAviso({ tipo: "error", msg: "Error de red al borrar" });
    } finally {
      setOcupado(false);
    }
  }

  // Función de render (no componente): así las miniaturas no se remontan en cada render.
  function tira({ g, lista, principal }: { g: Grupo; lista: FotoCarrusel[]; principal: boolean }) {
    const lleno = lista.length >= MAX_FOTOS_POR_GRUPO;
    return (
      <div className="flex flex-wrap items-start gap-2">
        {lista.map((f, i) => (
          <figure key={f.id} className="w-28">
            <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.imagen_url} alt="" className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 font-mono text-[10px] text-white">
                {principal && i === 0 ? "Principal" : i + 1}
              </span>
            </div>
            <figcaption className="mt-1 flex justify-between gap-1">
              <button
                onClick={() => moverFoto(f.id, -1)}
                disabled={ocupado || i === 0}
                aria-label="Mover antes"
                className="h-7 flex-1 rounded border border-line text-xs hover:bg-canvas disabled:opacity-30"
              >
                ←
              </button>
              <button
                onClick={() => moverFoto(f.id, 1)}
                disabled={ocupado || i === lista.length - 1}
                aria-label="Mover después"
                className="h-7 flex-1 rounded border border-line text-xs hover:bg-canvas disabled:opacity-30"
              >
                →
              </button>
              <button
                onClick={() => borrar([f.id], "¿Sacar esta foto del carrusel?")}
                disabled={ocupado}
                aria-label="Sacar foto"
                className="h-7 flex-1 rounded border border-line text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
              >
                ✕
              </button>
            </figcaption>
          </figure>
        ))}
        <button
          onClick={() => elegir(g)}
          disabled={ocupado || lleno}
          title={lleno ? `Máximo ${MAX_FOTOS_POR_GRUPO} fotos` : undefined}
          className="flex aspect-[4/3] w-28 items-center justify-center rounded-md border-2 border-dashed border-line text-xs font-semibold text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
        >
          + Agregar
        </button>
      </div>
    );
  }

  const enCurso = cola[0];
  const totalCola = cola.length + hechas;

  return (
    <section className="card-shadow mt-6 overflow-hidden rounded-2xl" data-editando={cola.length ? "" : undefined}>
      <div className="surface-ink punch-b px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">Home pública</p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">Fotos del carrusel</h2>
      </div>
      <div className="punch-t bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-[#4A4E5E]">
            Los eventos del carrusel salen solos del catálogo: los {MAX_CARRUSEL} más próximos que tengan foto, sin
            precios. Un evento sin fotos propias usa las de su competición, alternándolas. <b>Sin ninguna foto, no
            aparece en la home.</b> Hasta {MAX_FOTOS_POR_GRUPO} fotos por competición o evento; en un evento se
            muestra la principal.
          </p>
          <p className="text-xs text-muted">
            Sirve cualquier foto JPG, PNG o WEBP de al menos {MIN_RECORTE.w}×{MIN_RECORTE.h} px, horizontal o
            vertical: al subirla elegís qué parte se ve.
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

          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={onArchivos}
          />

          {cargando ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : panel.competiciones.length === 0 ? (
            <p className="text-sm text-muted">No hay eventos en el catálogo.</p>
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line">
              {panel.competiciones.map((c) => {
                const sinFoto = c.eventos.filter((e) => e.estado === "sin_foto").length;
                return (
                  <details key={c.competicion} className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-canvas/60">
                      <span className="min-w-0">
                        <span className="font-semibold">{c.competicion}</span>
                        <span className="ml-2 text-xs text-muted">
                          {c.eventos.length} {c.eventos.length === 1 ? "evento" : "eventos"}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-muted">
                          {c.fotos.length} {c.fotos.length === 1 ? "foto" : "fotos"} de competición
                        </span>
                        {sinFoto > 0 && (
                          <span className={`rounded px-1.5 py-0.5 font-medium ${ESTADO.sin_foto.clase}`}>
                            {sinFoto} sin foto
                          </span>
                        )}
                        <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
                          ▸
                        </span>
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-line bg-canvas/30 px-4 py-4">
                      <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Fotos de la competición (se alternan entre sus partidos)
                        </p>
                        {tira({ g: { competicion: c.competicion, evento: null }, lista: c.fotos, principal: false })}
                      </div>
                      {c.eventos.length > 0 && (
                        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                          {c.eventos.map((e) => (
                            <li key={e.evento} className="space-y-2 px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0">
                                  <span className="text-sm font-medium">{e.evento}</span>
                                  <span className="ml-2 font-mono text-[11px] text-muted">
                                    {fmtDate(e.fecha, "es").full}
                                  </span>
                                </span>
                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTADO[e.estado].clase}`}>
                                  {ESTADO[e.estado].texto}
                                </span>
                              </div>
                              {e.fotos.length > 0 ? (
                                tira({ g: { competicion: c.competicion, evento: e.evento }, lista: e.fotos, principal: true })
                              ) : (
                                <button
                                  onClick={() => elegir({ competicion: c.competicion, evento: e.evento })}
                                  disabled={ocupado}
                                  className="text-xs font-semibold text-brand hover:underline disabled:opacity-40"
                                >
                                  + Fotos propias
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}

          {panel.vencidas.length > 0 && (
            <details className="rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
                <span className="font-semibold">Eventos que ya pasaron ({panel.vencidas.length})</span>
                <button
                  onClick={(ev) => {
                    ev.preventDefault();
                    borrar(
                      panel.vencidas.map((f) => f.id),
                      panel.vencidas.length === 1
                        ? "¿Borrar la foto del evento que ya pasó?"
                        : `¿Borrar las ${panel.vencidas.length} fotos de eventos que ya pasaron?`
                    );
                  }}
                  disabled={ocupado}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Borrar fotos
                </button>
              </summary>
              <div className="border-t border-line px-4 py-3">
                <p className="mb-3 text-xs text-muted">
                  Son de eventos que pasaron o salieron del catálogo: ya no se muestran.
                </p>
                <ul className="flex flex-wrap gap-3">
                  {panel.vencidas.map((f) => (
                    <li key={f.id} className="w-28">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.imagen_url}
                        alt=""
                        className="aspect-[4/3] w-full rounded-md border border-line object-cover"
                        loading="lazy"
                      />
                      <p className="mt-1 text-[11px] leading-tight">{f.evento}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
        </div>
      </div>

      {enCurso && (
        <EncuadreFoto
          key={`${hechas}-${enCurso.archivo.name}`}
          archivo={enCurso.archivo}
          competicion={enCurso.competicion}
          evento={enCurso.evento}
          progreso={totalCola > 1 ? `${hechas + 1} de ${totalCola}` : undefined}
          onListo={subir}
          onCancelar={() => setCola((prev) => prev.slice(1))}
        />
      )}
    </section>
  );
}
