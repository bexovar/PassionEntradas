"use client";

import { useEffect, useMemo, useState } from "react";
import Combo from "@/components/admin/Combo";
import type { OpcionCombo } from "@/lib/combo";
import { claveEvento, MAX_DESTACADOS, type Destacado, type EventoDestacable } from "@/lib/destacados";

// Destacados de la tienda (TKT-14): el bloque del medio de /entradas, entre
// el buscador y los más próximos. Curado a mano: se elige del catálogo y se
// ordena acá. Sin ninguno, la tienda muestra los que tienen stock.

// Mismo campo que el panel del carrusel.
const campo = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-brand focus:outline-none";

// "11 nov 2026" (el día del evento viene como día UTC).
function diaCorto(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .replace(/\./g, "");
}

export default function DestacadosTiendaPanel({ eventos = [] }: { eventos?: EventoDestacable[] }) {
  const [destacados, setDestacados] = useState<Destacado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  const [texto, setTexto] = useState("");
  const [elegido, setElegido] = useState<EventoDestacable | null>(null);

  useEffect(() => {
    fetch("/api/destacados")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        setDestacados(d.destacados ?? []);
      })
      .catch(() => setAviso({ tipo: "error", msg: "No se pudieron cargar los destacados" }))
      .finally(() => setCargando(false));
  }, []);

  const porClave = useMemo(
    () => new Map(eventos.map((e) => [claveEvento(e.competicion, e.evento), e])),
    [eventos]
  );
  const yaDestacados = useMemo(
    () => new Set(destacados.map((d) => claveEvento(d.competicion, d.evento))),
    [destacados]
  );
  const opciones = useMemo<OpcionCombo<EventoDestacable>[]>(
    () =>
      eventos
        .filter((e) => !yaDestacados.has(claveEvento(e.competicion, e.evento)))
        .map((e) => ({
          clave: claveEvento(e.competicion, e.evento),
          texto: e.evento,
          detalle: [e.competicion, e.fecha ? diaCorto(e.fecha) : "sin fecha", e.conStock ? "con stock" : "a consultar"].join(
            " · "
          ),
          valor: e,
        })),
    [eventos, yaDestacados]
  );

  const ordenados = [...destacados].sort((a, b) => a.orden - b.orden);
  const lleno = destacados.length >= MAX_DESTACADOS;

  async function pedir(metodo: string, body: unknown): Promise<any | null> {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/destacados", {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: d.error || "No se pudo guardar" });
        return null;
      }
      return d;
    } catch {
      setAviso({ tipo: "error", msg: "Sin conexión: probá de nuevo" });
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!elegido) {
      setAviso({ tipo: "error", msg: "Elegí un evento de la lista" });
      return;
    }
    const d = await pedir("POST", { competicion: elegido.competicion, evento: elegido.evento });
    if (!d) return;
    setDestacados((prev) => [...prev, d.destacado]);
    setTexto("");
    setElegido(null);
    setAviso({ tipo: "ok", msg: `«${d.destacado.evento}» ya se ve en la tienda` });
  }

  async function mover(id: string, dir: 1 | -1) {
    const d = await pedir("PATCH", { id, dir });
    if (d?.destacados) setDestacados(d.destacados);
  }

  async function sacar(x: Destacado) {
    const d = await pedir("DELETE", { id: x.id });
    if (!d) return;
    setDestacados((prev) => prev.filter((y) => y.id !== x.id));
    setAviso({ tipo: "ok", msg: `Sacaste «${x.evento}» de los destacados` });
  }

  return (
    <section className="card-shadow mt-6 overflow-hidden rounded-2xl">
      <div className="surface-ink punch-b px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">Tienda</p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">Destacados de la tienda</h2>
      </div>
      <div className="punch-t bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-[#4A4E5E]">
            Los eventos que elijas acá van en el medio de la tienda, debajo del buscador, en este orden (hasta{" "}
            {MAX_DESTACADOS}). Los que tienen stock se muestran primero. Si no elegís ninguno, la tienda muestra los
            que tienen stock más próximos. Los cambios se ven sin desplegar.
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
            <p className="text-sm text-muted">Cargando…</p>
          ) : ordenados.length === 0 ? (
            <p className="text-sm text-muted">
              Todavía no hay destacados: la tienda muestra los que tienen stock más próximos.
            </p>
          ) : (
            <ol className="divide-y divide-line rounded-xl border border-line">
              {ordenados.map((x, i) => {
                const enCatalogo = porClave.get(claveEvento(x.competicion, x.evento));
                return (
                  <li key={x.id} className="flex items-start gap-3 px-3 py-3">
                    <span className="w-5 pt-1 text-center font-mono text-xs text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-brand">
                        {x.competicion}
                      </p>
                      <p className="font-semibold leading-tight">{x.evento}</p>
                      <span
                        className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          !enCatalogo
                            ? "bg-canvas text-[#4A4E5E]"
                            : enCatalogo.conStock
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {!enCatalogo
                          ? "No está en el catálogo, no se muestra"
                          : enCatalogo.conStock
                            ? "Con stock"
                            : "A consultar"}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => mover(x.id, -1)}
                        disabled={ocupado || i === 0}
                        aria-label="Subir"
                        className="h-8 w-8 rounded border border-line text-xs hover:bg-canvas disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => mover(x.id, 1)}
                        disabled={ocupado || i === ordenados.length - 1}
                        aria-label="Bajar"
                        className="h-8 w-8 rounded border border-line text-xs hover:bg-canvas disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => sacar(x)}
                        disabled={ocupado}
                        aria-label="Sacar de los destacados"
                        className="h-8 w-8 rounded border border-line text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {!cargando &&
            (lleno ? (
              <p className="text-xs text-muted">Ya hay {MAX_DESTACADOS} destacados: sacá uno para sumar otro.</p>
            ) : (
              <form className="space-y-3 rounded-xl border border-dashed border-line p-4" onSubmit={agregar}>
                <label className="grid gap-1 text-xs font-medium text-[#4A4E5E]">
                  Destacar un evento del catálogo
                  <Combo
                    value={texto}
                    onChange={(v) => {
                      setTexto(v);
                      setElegido(null);
                    }}
                    onElegir={(o) => {
                      setTexto(o.valor.evento);
                      setElegido(o.valor);
                    }}
                    opciones={opciones}
                    inputCls={campo}
                    placeholder={eventos.length ? "Buscá por nombre, ej. Boca" : "No hay eventos en el catálogo"}
                  />
                </label>
                <button
                  type="submit"
                  disabled={ocupado || !elegido}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Destacar
                </button>
              </form>
            ))}
        </div>
      </div>
    </section>
  );
}
