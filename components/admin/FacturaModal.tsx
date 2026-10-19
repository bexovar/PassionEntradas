"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Operacion } from "@/lib/operaciones";
import {
  METODOS_PAGO,
  metodoValido,
  numeroFactura,
  parseCotizacion,
  type CuentaFactura,
  type Factura,
  type FacturarA,
} from "@/lib/factura";

// Emite (o re-emite) la factura de una operación cobrada. Lo que la
// operación no tiene (a quién se factura, contacto, método de pago, dólar del
// día) se completa acá; el resto sale del snapshot que arma la API.
export default function FacturaModal({
  op,
  baseUrl,
  onClose,
  onToast,
}: {
  op: Operacion;
  baseUrl: string;
  onClose: () => void;
  onToast: (kind: "success" | "error", msg: string) => void;
}) {
  // Con cuenta, por defecto se le factura a ella (nombre, email y CUIT los
  // pone el servidor desde la cuenta). "Otro" es otra persona o una empresa:
  // nombre o razón social y CUIT tipeados. Sin cuenta, siempre es lo tipeado.
  const [facturarA, setFacturarA] = useState<FacturarA>(op.cliente_id ? "cuenta" : "otro");
  const [cuenta, setCuenta] = useState<CuentaFactura | null>(null);
  // Con cuenta, "otro" arranca vacío: es justamente alguien que no es ella.
  const [nombre, setNombre] = useState(op.cliente_id ? "" : op.comprador_alias ?? "");
  const [legajo, setLegajo] = useState("");
  const [contacto, setContacto] = useState(op.cliente_email ?? "");
  // La cantidad es la de la operación: no se tipea acá, así el unitario de la
  // factura siempre cierra con el total.
  const cantidad = Math.max(1, op.cantidad || 1);
  // Solo los métodos de la moneda de la operación (ver METODOS_PAGO).
  const metodos = METODOS_PAGO[op.moneda ?? "USD"];
  const [metodo, setMetodo] = useState(metodos[0]);
  const [idioma, setIdioma] = useState<"en" | "es">("en");
  // Dólar del día, tipeado por el admin. Al re-emitir se precarga el que ya
  // tenía la factura; si cambió, se corrige acá.
  const [cotizacion, setCotizacion] = useState("");
  // El dólar del día solo tiene sentido en una factura en dólares.
  const esUsd = (op.moneda ?? "USD") === "USD";
  const [existente, setExistente] = useState<Factura | null>(null);
  const [cargando, setCargando] = useState(true);
  const [emitiendo, setEmitiendo] = useState(false);
  const enviando = useRef(false);

  // ¿Ya se emitió? Mostramos el link y dejamos re-emitir.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/operaciones/${op.id}/factura`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { factura: Factura | null; cuenta: CuentaFactura | null } | null) => {
        if (!vivo || !r) return;
        setCuenta(r.cuenta);
        const f = r.factura;
        if (!f) return;
        setExistente(f);
        const d = f.datos;
        // Las facturas viejas no guardaban la elección: eran a la cuenta si
        // la había.
        const a: FacturarA = op.cliente_id ? d.comprador.facturar_a ?? "cuenta" : "otro";
        setFacturarA(a);
        if (a === "otro") {
          setNombre(d.comprador.nombre);
          setLegajo(d.comprador.legajo ?? "");
        }
        setContacto(d.comprador.contacto ?? "");
        // Una factura vieja puede tener un método de otra moneda (la de Boca
        // salió con "Bank transfer (USD)"): al re-emitir arranca del primero
        // de la moneda correcta en vez de arrastrar el error.
        if (metodoValido(d.metodo_pago, op.moneda ?? "USD")) setMetodo(d.metodo_pago);
        setIdioma(d.idioma);
        if (d.cotizacion) setCotizacion(String(d.cotizacion.ars_por_usd).replace(".", ","));
      })
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [op.id, op.cliente_id, op.moneda]);

  async function emitir() {
    if (enviando.current) return;
    if (pideNombre && !nombre.trim()) {
      onToast("error", "El nombre del comprador es obligatorio");
      return;
    }
    if (esUsd && parseCotizacion(cotizacion) == null) {
      onToast("error", "Cargá el dólar del día (pesos por dólar), por ejemplo 1465,50");
      return;
    }
    enviando.current = true;
    setEmitiendo(true);
    try {
      const res = await fetch(`/api/operaciones/${op.id}/factura`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facturar_a: facturarA,
          comprador_nombre: nombre,
          comprador_legajo: legajo,
          comprador_contacto: contacto,
          metodo_pago: metodo,
          idioma,
          cotizacion,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error ?? "No se pudo emitir la factura");
        return;
      }
      setExistente(data as Factura);
      onToast(
        "success",
        `Factura ${numeroFactura(data.numero, data.created_at)} ${existente ? "re-emitida" : "emitida"}`
      );
    } catch {
      onToast("error", "Error de red al emitir");
    } finally {
      enviando.current = false;
      setEmitiendo(false);
    }
  }

  async function copiarLink() {
    if (!existente) return;
    try {
      await navigator.clipboard.writeText(`${baseUrl}/factura/${existente.id}`);
      onToast("success", "Link de la factura copiado");
    } catch {
      onToast("error", "No se pudo copiar");
    }
  }

  // El nombre se tipea cuando no es la cuenta, o cuando la cuenta no lo tiene.
  const pideNombre = facturarA === "otro" || (cuenta != null && !cuenta.nombre);

  const inputCls =
    "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15";
  const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-[#6A6E7E]";

  // Portal al <body>: renderizado adentro de la card de la operación, el
  // overflow/animaciones del árbol lo recortaban. Así flota arriba de TODA
  // la página, siempre. (Solo se monta con el modal abierto: document existe.)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-label="Factura de la operación"
    >
      <div
        // max-h + scroll interno: con la operación completa (bloque de
        // factura emitida + formulario) el contenido supera el alto de la
        // pantalla y quedaba cortado sin forma de llegar a los botones.
        className="card-shadow flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="surface-ink px-5 py-4 text-white">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
            {op.code}
          </p>
          <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">
            {existente ? "Factura emitida" : "Emitir factura"}
          </h2>
          <p className="mt-1 text-xs text-white/60">{op.evento}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {cargando ? (
            <p className="py-4 text-center text-sm text-muted">Cargando…</p>
          ) : (
            <>
              {existente && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold">
                      {numeroFactura(existente.numero, existente.created_at)}
                    </p>
                    <p className="text-[11px] text-muted">
                      Re-emitir actualiza los datos; el número y el link no cambian.
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={`/factura/${existente.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas"
                    >
                      Ver
                    </a>
                    <button
                      onClick={copiarLink}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-deep"
                    >
                      Copiar link
                    </button>
                  </div>
                </div>
              )}

              {op.cliente_id && (
                <fieldset>
                  <legend className={labelCls}>Facturar a</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1">
                    {(
                      [
                        ["cuenta", "Cuenta del cliente"],
                        ["otro", "Otro nombre o empresa"],
                      ] as const
                    ).map(([v, texto]) => (
                      <label
                        key={v}
                        className={`cursor-pointer rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40 ${
                          facturarA === v ? "bg-white text-body shadow-sm" : "text-muted hover:text-body"
                        }`}
                      >
                        <input
                          type="radio"
                          name="f-facturar-a"
                          value={v}
                          checked={facturarA === v}
                          onChange={() => setFacturarA(v)}
                          className="sr-only"
                        />
                        {texto}
                      </label>
                    ))}
                  </div>
                  {facturarA === "cuenta" && (
                    <div className="mt-2 rounded-lg border border-line px-3 py-2 text-xs">
                      {cuenta ? (
                        <>
                          <p className="font-semibold text-body">{cuenta.nombre || "Sin nombre en la cuenta"}</p>
                          {cuenta.email && <p className="text-muted">{cuenta.email}</p>}
                          <p className="text-muted">
                            {cuenta.legajo ? `Legajo/CUIT: ${cuenta.legajo}` : "Sin legajo/CUIT en la cuenta"}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted">
                          Nombre, email y legajo/CUIT salen de la cuenta de {op.cliente_email ?? "el cliente"}.
                        </p>
                      )}
                    </div>
                  )}
                </fieldset>
              )}

              {pideNombre && (
                <div>
                  <label htmlFor="f-nombre" className={labelCls}>
                    {facturarA === "otro" ? "Nombre o razón social *" : "Nombre del comprador *"}
                  </label>
                  <input
                    id="f-nombre"
                    className={inputCls}
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder={facturarA === "otro" ? "Nombre y apellido, o empresa" : "Nombre y apellido"}
                  />
                </div>
              )}
              {facturarA === "otro" && (
                <div>
                  <label htmlFor="f-legajo" className={labelCls}>
                    CUIT / Tax ID
                  </label>
                  <input
                    id="f-legajo"
                    className={`${inputCls} font-mono`}
                    value={legajo}
                    onChange={(e) => setLegajo(e.target.value)}
                    placeholder="30-71234567-9"
                  />
                </div>
              )}
              <div>
                <label htmlFor="f-contacto" className={labelCls}>
                  Contacto (tel / email)
                </label>
                <input
                  id="f-contacto"
                  className={inputCls}
                  value={contacto}
                  onChange={(e) => setContacto(e.target.value)}
                  placeholder="+54 9 11 … · nombre@mail.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className={labelCls}>Cantidad</p>
                  <p className="rounded-lg bg-canvas px-3 py-2 font-mono text-sm" title="Sale de la operación">
                    {cantidad} {cantidad === 1 ? "entrada" : "entradas"}
                  </p>
                </div>
                <div>
                  <label htmlFor="f-idioma" className={labelCls}>
                    Idioma
                  </label>
                  <select
                    id="f-idioma"
                    className={inputCls}
                    value={idioma}
                    onChange={(e) => setIdioma(e.target.value as "en" | "es")}
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="f-metodo" className={labelCls}>
                  Método de pago *
                </label>
                <select
                  id="f-metodo"
                  className={inputCls}
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                >
                  {metodos.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>

              {esUsd && (
              <div>
                <label htmlFor="f-cotizacion" className={labelCls}>
                  Dólar del día (pesos por dólar) *
                </label>
                <input
                  id="f-cotizacion"
                  inputMode="decimal"
                  className={`${inputCls} font-mono`}
                  value={cotizacion}
                  onChange={(e) => setCotizacion(e.target.value)}
                  placeholder="1465,50"
                />
                <p className="mt-1 text-[11px] text-muted">
                  Queda fijo en la factura con la fecha de hoy. Se muestra el total en pesos al lado del total en dólares.
                </p>
              </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={emitir}
                  disabled={emitiendo}
                  className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
                >
                  {emitiendo ? "Emitiendo…" : existente ? "Re-emitir con estos datos" : "Emitir factura"}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-medium text-[#4A4E5E] transition-colors hover:bg-canvas"
                >
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
