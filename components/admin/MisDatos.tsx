"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { avisarActividad } from "@/lib/actividad-cliente";

type Datos = { nombre: string; apellido: string; telefono: string };

// Datos personales de la propia cuenta (nombre, apellido, teléfono).
// Viven en user_metadata de Supabase Auth: cada usuario edita SOLO los
// suyos, sin tabla ni policies extra. El nombre se usa en la auditoría de
// hitos ("por Kiru") en lugar del email, así se trackea mejor quién tocó qué.
export default function MisDatos({ inicial, mock }: { inicial: Datos; mock: boolean }) {
  const router = useRouter();
  const [datos, setDatos] = useState<Datos>(inicial);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const enviando = useRef(false);
  // Lo último guardado, para registrar solo los campos que cambiaron.
  const guardado = useRef<Datos>(inicial);

  function set<K extends keyof Datos>(key: K, value: string) {
    setDatos((d) => ({ ...d, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando.current) return;
    setMsg(null);

    const nombre = datos.nombre.trim().slice(0, 80);
    const apellido = datos.apellido.trim().slice(0, 80);
    const telefono = datos.telefono.trim().slice(0, 40);
    if (!nombre || !apellido) {
      setMsg({ tipo: "error", texto: "Nombre y apellido son obligatorios" });
      return;
    }
    if (telefono && !/^[+\d][\d\s\-().]{5,}$/.test(telefono)) {
      setMsg({ tipo: "error", texto: "Teléfono inválido (con código de país, ej: +54 9 11 2233 4455)" });
      return;
    }
    if (mock) {
      setMsg({ tipo: "error", texto: "En el modo demo no hay cuentas reales" });
      return;
    }

    enviando.current = true;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: { nombre, apellido, telefono },
      });
      if (error) {
        setMsg({ tipo: "error", texto: error.message });
        return;
      }
      const nuevos: Datos = { nombre, apellido, telefono };
      const campos = (Object.keys(nuevos) as (keyof Datos)[]).filter(
        (k) => nuevos[k] !== (guardado.current[k] ?? "").trim()
      );
      guardado.current = nuevos;
      if (campos.length) void avisarActividad("cuenta.datos", { campos });
      setDatos({ nombre, apellido, telefono });
      setMsg({
        tipo: "ok",
        texto: "Datos guardados. Tus próximas acciones quedan a tu nombre.",
      });
      router.refresh();
    } catch {
      setMsg({ tipo: "error", texto: "Error de red, probá de nuevo" });
    } finally {
      enviando.current = false;
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15";
  const labelCls =
    "mb-1 block text-xs font-medium uppercase tracking-wide text-[#6A6E7E]";

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-8">
      <form onSubmit={onSubmit} className="card-shadow overflow-hidden rounded-2xl">
        <div className="surface-ink punch-b px-5 py-4 text-white">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
            Mi cuenta
          </p>
          <h1 className="mt-0.5 font-display text-lg font-bold tracking-tight">
            Mis datos
          </h1>
        </div>

        <div className="punch-t bg-white">
          <div className="perf-line-light mx-5" />
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col justify-between">
                <label htmlFor="nombre" className={labelCls}>
                  Nombre *
                </label>
                <input
                  id="nombre"
                  className={inputCls}
                  value={datos.nombre}
                  onChange={(e) => set("nombre", e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="flex flex-col justify-between">
                <label htmlFor="apellido" className={labelCls}>
                  Apellido *
                </label>
                <input
                  id="apellido"
                  className={inputCls}
                  value={datos.apellido}
                  onChange={(e) => set("apellido", e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div>
              <label htmlFor="telefono" className={labelCls}>
                Teléfono
              </label>
              <input
                id="telefono"
                type="tel"
                className={inputCls}
                value={datos.telefono}
                onChange={(e) => set("telefono", e.target.value)}
                placeholder="+54 9 11 2233 4455"
                autoComplete="tel"
              />
            </div>

            {msg && (
              <p
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  msg.tipo === "ok"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-red-50 text-red-700"
                }`}
                role="status"
              >
                {msg.texto}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
            >
              {loading ? "Guardando…" : "Guardar mis datos"}
            </button>
            <p className="text-center text-xs text-muted">
              Con tu nombre cargado, cada paso que marques en una operación
              queda registrado a tu nombre.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
