"use client";

// En la tarjeta de la operación: su historial (registro de actividad). Quién
// marcó o desmarcó cada paso y cuándo, incluidos los intentos que el server
// rechazó. Cerrado por defecto; se carga al abrirlo y se refresca si la
// operación cambia mientras está abierto.

import { useEffect, useState } from "react";

type Linea = { id: string; created_at: string; quien: string; accion: string; resumen: string };

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function HistorialOperacion({ opId, version }: { opId: string; version: string }) {
  const [abierto, setAbierto] = useState(false);
  const [lineas, setLineas] = useState<Linea[] | null>(null);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    fetch(`/api/operaciones/${opId}/actividad`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { actividad: [] }))
      .then((d) => vivo && setLineas(Array.isArray(d.actividad) ? d.actividad : []))
      .catch(() => vivo && setLineas([]));
    return () => {
      vivo = false;
    };
  }, [abierto, opId, version]);

  return (
    <div className="mt-3 rounded-xl border border-line text-xs">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between px-3 py-2 font-semibold uppercase tracking-wide text-muted"
      >
        Historial
        <span aria-hidden className={`transition-transform ${abierto ? "rotate-180" : ""}`}>▾</span>
      </button>
      {abierto && (
        <div className="border-t border-line px-3 py-2.5">
          {lineas == null ? (
            <p className="text-muted">Cargando…</p>
          ) : lineas.length === 0 ? (
            <p className="text-muted">Sin cambios registrados todavía.</p>
          ) : (
            <ol className="space-y-1.5">
              {lineas.map((l) => (
                <li key={l.id} className="grid gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <time className="font-mono text-[10px] text-muted" dateTime={l.created_at}>
                      {cuando(l.created_at)}
                    </time>
                    <span className="font-medium text-body [overflow-wrap:anywhere]">{l.quien}</span>
                  </span>
                  <span
                    className={`leading-snug [overflow-wrap:anywhere] ${
                      l.accion.endsWith(".rechazado") ? "text-[#B5304B]" : "text-[#4A4E5E]"
                    }`}
                  >
                    {l.resumen}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
