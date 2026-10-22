"use client";

import { useEffect, useState } from "react";
import { claveTextoPago, TEXTO_PAGO_MAX } from "@/lib/textos";
import type { Moneda } from "@/lib/operaciones";

// Instrucciones de pago por moneda. Es lo que ve el cliente en Mis pedidos
// cuando su pedido pasa a "Listo para pagar" (ya tenemos la entrada): alias,
// CBU, link de pago, lo que haga falta. Un texto por moneda porque los pesos y
// los dólares se cobran distinto. Vacío = se le pide que escriba por WhatsApp.
const MONEDAS: { m: Moneda; label: string; ejemplo: string }[] = [
  { m: "ARS", label: "Pesos", ejemplo: "Transferencia al alias MI.ALIAS (Banco X, a nombre de …). Mandanos el comprobante por WhatsApp." },
  { m: "USD", label: "Dólares", ejemplo: "Transferencia en USD o efectivo. Escribinos y te pasamos los datos." },
];

export default function TextosPagoPanel() {
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<Moneda | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  // Plazo para aceptar una cotización (horas).
  const [horas, setHoras] = useState<number | null>(null);
  const [horasDraft, setHorasDraft] = useState("");

  useEffect(() => {
    fetch("/api/textos-pago")
      .then((r) => r.json())
      .then((d) => {
        const t = (d?.textos ?? {}) as Record<string, string>;
        setTextos(t);
        setDrafts(t);
      })
      .catch(() => setAviso({ tipo: "error", msg: "No se pudieron cargar los textos de pago" }))
      .finally(() => setCargando(false));
    fetch("/api/ajustes-cotizacion")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.horas === "number") {
          setHoras(d.horas);
          setHorasDraft(String(d.horas));
        }
      })
      .catch(() => {});
  }, []);

  async function guardarHoras() {
    setAviso(null);
    try {
      const res = await fetch("/api/ajustes-cotizacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horas: horasDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo guardar" });
        return;
      }
      setHoras(data.horas);
      setHorasDraft(String(data.horas));
      setAviso({ tipo: "ok", msg: `Las cotizaciones nuevas vencen a las ${data.horas} h` });
    } catch {
      setAviso({ tipo: "error", msg: "Error de red al guardar" });
    }
  }

  async function guardar(m: Moneda) {
    const key = claveTextoPago(m);
    setGuardando(m);
    setAviso(null);
    try {
      const res = await fetch("/api/textos-pago", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moneda: m, texto: drafts[key] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo guardar" });
        return;
      }
      setTextos((prev) => ({ ...prev, [key]: data.texto }));
      setDrafts((prev) => ({ ...prev, [key]: data.texto }));
      setAviso({ tipo: "ok", msg: data.texto ? "Texto de pago guardado" : "Texto de pago borrado" });
    } catch {
      setAviso({ tipo: "error", msg: "Error de red al guardar" });
    } finally {
      setGuardando(null);
    }
  }

  // Textos o plazo sin guardar: el refresco automático de la página espera.
  const conCambios =
    Object.keys(drafts).some((k) => drafts[k] !== (textos[k] ?? "")) ||
    (horas !== null && horasDraft !== String(horas));

  return (
    <section
      className="card-shadow mt-6 overflow-hidden rounded-2xl"
      data-editando={conCambios ? "" : undefined}
    >
      <div className="surface-ink punch-b px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
          Pedidos de la tienda
        </p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">Cotizaciones y pagos</h2>
      </div>
      <div className="punch-t bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-[#4A4E5E]">
            Cuando marcás <b>Entrada del proveedor</b> en un pedido, el cliente lo ve como{" "}
            <b>Listo para pagar</b> y le aparece este texto, según la moneda del pedido. Si lo
            dejás vacío, se le pide que escriba por WhatsApp.
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

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-canvas px-3.5 py-3">
            <div className="min-w-0">
              <label htmlFor="vence-horas" className="block text-sm font-semibold">
                Vencimiento de las cotizaciones
              </label>
              <p className="text-xs text-muted">
                Horas que tiene el cliente para aceptar. Aplica a las que mandes desde ahora.
              </p>
            </div>
            <span className="flex items-center gap-2">
              <input
                id="vence-horas"
                inputMode="numeric"
                value={horasDraft}
                onChange={(e) => setHorasDraft(e.target.value)}
                className="h-10 w-20 rounded-lg border border-line bg-white px-2.5 text-right font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <span className="text-sm text-muted">h</span>
              <button
                onClick={guardarHoras}
                disabled={horas == null || horasDraft.trim() === String(horas)}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
              >
                Guardar
              </button>
            </span>
          </div>

          {cargando ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : (
            MONEDAS.map(({ m, label, ejemplo }) => {
              const key = claveTextoPago(m);
              const draft = drafts[key] ?? "";
              const cambiado = draft.trim() !== (textos[key] ?? "");
              return (
                <div key={m}>
                  <label htmlFor={`pago-${m}`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {label} ({m})
                  </label>
                  <textarea
                    id={`pago-${m}`}
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                    maxLength={TEXTO_PAGO_MAX}
                    rows={3}
                    placeholder={ejemplo}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted">
                      {draft.length}/{TEXTO_PAGO_MAX}
                    </span>
                    <button
                      onClick={() => guardar(m)}
                      disabled={!cambiado || guardando !== null}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
                    >
                      {guardando === m ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
