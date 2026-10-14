"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { avisarActividad } from "@/lib/actividad-cliente";

// Cambio de contraseña de la propia cuenta, con la sesión activa.
// Supabase Auth valida la sesión; no hace falta la contraseña anterior.
export default function CambiarClave({ mock }: { mock: boolean }) {
  const router = useRouter();
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const enviando = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando.current) return;
    setMsg(null);

    if (clave.length < 8) {
      setMsg({ tipo: "error", texto: "La contraseña debe tener al menos 8 caracteres" });
      return;
    }
    if (clave !== repetir) {
      setMsg({ tipo: "error", texto: "Las contraseñas no coinciden" });
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
      const { error } = await supabase.auth.updateUser({ password: clave });
      if (error) {
        setMsg({
          tipo: "error",
          texto: /weak|short|password/i.test(error.message)
            ? "Supabase rechazó la contraseña: probá una más larga o menos común"
            : error.message,
        });
        return;
      }
      void avisarActividad("cuenta.clave");
      setClave("");
      setRepetir("");
      setMsg({ tipo: "ok", texto: "Contraseña actualizada. Ya vale para el próximo ingreso." });
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
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <form onSubmit={onSubmit} className="card-shadow overflow-hidden rounded-2xl">
        <div className="surface-ink punch-b px-5 py-4 text-white">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
            Mi cuenta
          </p>
          <h1 className="mt-0.5 font-display text-lg font-bold tracking-tight">
            Cambiar contraseña
          </h1>
        </div>

        <div className="punch-t bg-white">
          <div className="perf-line-light mx-5" />
          <div className="space-y-4 p-5">
            <div>
              <label htmlFor="clave" className={labelCls}>
                Contraseña nueva
              </label>
              <input
                id="clave"
                type="password"
                className={inputCls}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="repetir" className={labelCls}>
                Repetir contraseña
              </label>
              <input
                id="repetir"
                type="password"
                className={inputCls}
                value={repetir}
                onChange={(e) => setRepetir(e.target.value)}
                autoComplete="new-password"
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
              {loading ? "Guardando…" : "Guardar contraseña"}
            </button>
            <p className="text-center text-xs text-muted">
              El cambio es solo para tu cuenta y vale desde el próximo ingreso.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
