"use client";

// "Mis pedidos" del cliente: la vista de seguimiento de los pedidos y consultas
// que hizo desde la tienda. Cada uno es una operación que el staff acciona
// desde el panel; acá el cliente ve en qué estado va. Estética de la tienda,
// bilingüe EN/ES (idioma recordado en localStorage, igual que el resto).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import ConfirmarBoton from "@/components/ConfirmarBoton";
import Campana from "@/components/tienda/Campana";
import { LANGS, LOCALE, TX, type Lang } from "@/lib/tienda-i18n";
import { formatMonto, pasosCliente, type EstadoPublico, type Moneda } from "@/lib/operaciones";
import { waLink } from "@/lib/tickets";
import { tiempoRestante } from "@/lib/cotizaciones";
import { fechaDia, fechaHora } from "@/lib/fechas";
import { useContextoWhatsApp } from "@/components/WhatsAppFlotante";
import { mensajeWa } from "@/lib/whatsapp-flotante";

export type PedidoView = {
  id: string;
  code: string;
  tipo: "pedido" | "consulta";
  evento: string;
  sector: string | null;
  cantidad: number;
  fecha_evento: string | null;
  created_at: string;
  // `consulta_descartada`: la consulta se cerró sin precio (no conseguimos la
  // entrada). Es solo de esta vista: en una operación no existe.
  estado:
    | EstadoPublico
    | "consulta_descartada"
    | "consulta_cotizada"
    | "consulta_vencida"
    | "consulta_rechazada";
  // Total del pedido en su moneda (null en consultas sin precio).
  monto: number | null;
  moneda: Moneda | null;
  // Puede cancelarlo él mismo: pedido en pasos 1–2 o consulta pendiente.
  puedeCancelar: boolean;
  // Pasado el pago procesado ya no cancela solo: pide la cancelación por
  // WhatsApp y la resuelve el equipo (TKT-19).
  puedePedirCancelacion: boolean;
  canceladaPorCliente: boolean;
  // Instrucciones de pago de su moneda, solo en "listo para pagar".
  textoPago: string | null;
  // Cotización esperando su respuesta: la versión que está viendo (si el
  // staff la cambia, aceptar la vieja falla) y hasta cuándo vale.
  cotizacion: { version: number; venceAt: string | null } | null;
  // Factura emitida para este pedido (si el staff ya la generó).
  facturaId: string | null;
  // Una consulta sin precio todavía no es una operación: no hay link público
  // de seguimiento que mostrar hasta que el staff la cargue.
  seguible: boolean;
};

// Color del chip de estado, alineado con el agrupado del panel.
const ESTADO_CLASS: Record<PedidoView["estado"], string> = {
  consulta_recibida: "mp-e-abierta",
  consulta_descartada: "mp-e-cancelada",
  consulta_cotizada: "mp-e-pagar",
  consulta_vencida: "mp-e-cancelada",
  consulta_rechazada: "mp-e-cancelada",
  pedido_recibido: "mp-e-abierta",
  pedido_confirmado: "mp-e-curso",
  listo_para_pagar: "mp-e-pagar",
  pago_recibido: "mp-e-curso",
  entregada: "mp-e-cerrada",
  cancelada: "mp-e-cancelada",
};

// Línea de tiempo del pedido: los 3 pasos del cliente (ver pasosCliente).
function Pasos({ estado, lang }: { estado: EstadoPublico; lang: Lang }) {
  const pasos = pasosCliente(estado, lang);
  if (!pasos) return null;
  return (
    <ol className="mp-pasos" aria-label="Progreso">
      {pasos.map((p, i) => (
        <li
          key={p.key}
          className={`mp-paso${p.estado === "hecho" ? " is-done" : ""}${p.estado === "actual" ? " is-actual" : ""}`}
          aria-current={p.estado === "actual" ? "step" : undefined}
        >
          <span className="mp-paso-dot" aria-hidden>
            {p.estado === "hecho" ? "✓" : i + 1}
          </span>
          <span className="mp-paso-label">{p.label}</span>
        </li>
      ))}
    </ol>
  );
}

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => {
    const saved = localStorage.getItem("tm_lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);
  function change(l: Lang) {
    setLang(l);
    localStorage.setItem("tm_lang", l);
  }
  return [lang, change];
}

function fmtDate(value: string | null, lang: Lang, withTime = false): string {
  if (!value) return "—";
  // fecha_evento viene como YYYY-MM-DD (sin hora) y se muestra como ese día,
  // sin corrimientos. created_at es un timestamp y va en hora de Argentina:
  // sin zona explícita el servidor escribía una hora y el navegador otra, y
  // React tiraba todo el HTML del servidor para rehacerlo en el cliente.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE[lang], {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return withTime ? fechaHora(value, LOCALE[lang]) : fechaDia(value, LOCALE[lang]);
}

export function MisPedidos({ pedidos }: { pedidos: PedidoView[] }) {
  const [lang, setLang] = useLang();
  const t = TX[lang];
  const mp = t.misPedidos;
  const router = useRouter();
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Con un solo pedido, el WhatsApp flotante ya sale con su número; con
  // varios no sabemos por cuál pregunta y va el mensaje general.
  useContextoWhatsApp(pedidos.length === 1 ? { tipo: "pedido", codigo: pedidos[0].code } : null);

  // Aceptar o rechazar la cotización. Aceptar crea el pedido: se confirma
  // en el mismo botón, igual que cancelar.
  async function responder(p: PedidoView, accion: "aceptar" | "rechazar") {
    setCancelando(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/consultas/${p.id}/${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // El idioma de la tienda: si acepta, sus avisos por email van en ese.
        body: JSON.stringify({ version: p.cotizacion?.version, lang }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(res.status === 409 ? data.error || mp.cotizacionNoDisponible : data.error || mp.errorCancelar);
      }
      router.refresh();
    } catch {
      setError(mp.errorCancelar);
    } finally {
      setCancelando(null);
    }
  }

  async function cancelar(p: PedidoView) {
    setCancelando(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/mis-pedidos/${p.id}/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Una consulta sin precio vive en otra tabla: el server tiene que saber cuál.
        body: JSON.stringify({ tipo: p.seguible ? "pedido" : "consulta" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(res.status === 409 ? mp.noSePuedeCancelar : data.error || mp.errorCancelar);
      }
      router.refresh();
    } catch {
      setError(mp.errorCancelar);
    } finally {
      setCancelando(null);
    }
  }

  return (
    <>
      {/* La página se actualiza sola: cuando el staff avanza la operación, el
          estado acá se refresca sin recargar. */}
      <AutoRefresh intervalMs={20000} versionUrl="/api/mis-pedidos/version" />
      <header className="masthead masthead--cat">
        <div className="toprow">
          <Link className="wm" href="/entradas">
            <span className="ticketmark">▚</span> TICKET<em>MIRROR</em>
          </Link>
          <div className="mast-right">
            <div className="lang" role="group" aria-label="Language / Idioma">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`lang-btn ${l === lang ? "active" : ""}`}
                  onClick={() => setLang(l)}
                  aria-pressed={l === lang}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <Campana lang={lang} />
            <Link className="lp-nav-login" href="/cuenta">
              {t.lp.navCuenta}
            </Link>
            <Link className="back" href="/entradas">
              {mp.volver}
            </Link>
          </div>
        </div>
      </header>

      <main className="mp-wrap">
        <div className="section-h">
          <span className="sh-eyebrow">{t.lp.navPedidos}</span>
          <h2>{mp.title}</h2>
          <p>{mp.sub}</p>
        </div>

        {error && (
          <p className="mp-error" role="alert">
            {error}
          </p>
        )}

        {pedidos.length === 0 ? (
          <div className="mp-empty">
            <h3>{mp.vacioTitle}</h3>
            <p>{mp.vacioP}</p>
            <Link className="btn-primary" href="/buscar">
              {mp.vacioCta}
            </Link>
          </div>
        ) : (
          <ul className="mp-list">
            {pedidos.map((p) => (
              <li className="mp-item" key={p.id}>
                <div className="mp-item-head">
                  <span className={`mp-tipo mp-tipo--${p.tipo}`}>
                    {p.tipo === "pedido" ? mp.pedidoLabel : mp.consultaLabel}
                  </span>
                  <span className={`mp-estado ${ESTADO_CLASS[p.estado]}`}>
                    {mp.estados[p.estado] ?? p.estado}
                  </span>
                </div>
                <h3 className="mp-evento">{p.evento}</h3>
                {p.monto != null && p.moneda && (
                  <p className="mp-monto">{formatMonto(p.monto, p.moneda, { sinDecimales: true })}</p>
                )}
                {p.seguible && p.estado !== "cancelada" && p.estado !== "consulta_descartada" && (
                  <Pasos estado={p.estado as EstadoPublico} lang={lang} />
                )}
                {p.estado === "listo_para_pagar" && (
                  <div className="mp-pago">
                    <strong>{mp.comoPagar}</strong>
                    {p.textoPago ? (
                      <p className="mp-pago-texto">{p.textoPago}</p>
                    ) : (
                      <p className="mp-pago-texto">{mp.pagoSinTexto}</p>
                    )}
                    <a
                      className="mp-link"
                      href={waLink(`${mp.waPagar} ${p.code}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {mp.escribinos}
                    </a>
                  </div>
                )}
                {p.estado === "consulta_cotizada" && p.cotizacion && (
                  <div className="mp-cotizacion">
                    <strong>{mp.cotizacionTitulo}</strong>
                    <p className="mp-pago-texto">
                      {mp.cotizacionTexto} · {tiempoRestante(p.cotizacion.venceAt, new Date(), lang)}
                    </p>
                    <span className="mp-cot-acciones">
                      <ConfirmarBoton
                        className="mp-link mp-link--aceptar"
                        onConfirm={() => responder(p, "aceptar")}
                        disabled={cancelando === p.id}
                        pregunta={mp.confirmarAceptar}
                        si={mp.siAceptar}
                        no={mp.no}
                        armadoClassName="mp-confirma"
                        preguntaClassName="mp-confirma-pregunta"
                        siClassName="mp-link mp-link--aceptar"
                        noClassName="mp-link mp-link--no"
                      >
                        {cancelando === p.id ? mp.enviando : mp.aceptar}
                      </ConfirmarBoton>
                      <ConfirmarBoton
                        className="mp-link mp-link--cancelar"
                        onConfirm={() => responder(p, "rechazar")}
                        disabled={cancelando === p.id}
                        pregunta={mp.confirmarRechazar}
                        si={mp.siRechazar}
                        no={mp.no}
                        armadoClassName="mp-confirma"
                        preguntaClassName="mp-confirma-pregunta"
                        siClassName="mp-link mp-link--cancelar-si"
                        noClassName="mp-link mp-link--no"
                      >
                        {mp.rechazar}
                      </ConfirmarBoton>
                    </span>
                  </div>
                )}
                {p.estado === "consulta_vencida" && (
                  <div className="mp-cotizacion mp-cotizacion--vencida">
                    <p className="mp-pago-texto">{mp.cotizacionVencida}</p>
                    <a
                      className="mp-link"
                      href={waLink(`${mp.waNuevaCotizacion} ${p.code}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {mp.escribinos}
                    </a>
                  </div>
                )}
                {p.estado === "consulta_rechazada" && <p className="mp-nota">{mp.rechazadaPorVos}</p>}
                {p.estado === "cancelada" && p.canceladaPorCliente && (
                  <p className="mp-nota">{p.seguible ? mp.canceladoPorVos : mp.canceladaConsultaPorVos}</p>
                )}
                <dl className="mp-meta">
                  {p.sector && (
                    <div>
                      <dt>{mp.sectorLabel}</dt>
                      <dd>
                        {p.sector}
                        {p.cantidad > 1 ? ` ×${p.cantidad}` : ""}
                      </dd>
                    </div>
                  )}
                  {p.fecha_evento && (
                    <div>
                      <dt>{mp.fechaLabel}</dt>
                      <dd>{fmtDate(p.fecha_evento, lang)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{mp.creado}</dt>
                    <dd>{fmtDate(p.created_at, lang, true)}</dd>
                  </div>
                </dl>
                <div className="mp-foot">
                  <span className="mp-code">N.º {p.code}</span>
                  <span className="mp-links">
                    {/* Link público de seguimiento (mismo que comparte el
                        staff). La consulta sin precio todavía no tiene
                        operación detrás, así que no hay nada que seguir. */}
                    {p.seguible && (
                      <a
                        className="mp-link"
                        href={`/op/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {mp.verSeguimiento}
                      </a>
                    )}
                    {p.puedeCancelar && (
                      <ConfirmarBoton
                        className="mp-link mp-link--cancelar"
                        onConfirm={() => cancelar(p)}
                        disabled={cancelando === p.id}
                        pregunta={
                          p.tipo === "pedido" && p.seguible ? mp.confirmarCancelarPedido : mp.confirmarCancelarConsulta
                        }
                        si={mp.siCancelar}
                        no={mp.no}
                        armadoClassName="mp-confirma"
                        preguntaClassName="mp-confirma-pregunta"
                        siClassName="mp-link mp-link--cancelar-si"
                        noClassName="mp-link mp-link--no"
                      >
                        {cancelando === p.id
                          ? mp.cancelando
                          : p.tipo === "pedido" && p.seguible
                            ? mp.cancelarPedido
                            : mp.cancelarConsulta}
                      </ConfirmarBoton>
                    )}
                    {p.puedePedirCancelacion && (
                      <a
                        className="mp-link mp-link--cancelar"
                        href={waLink(mp.waPedirCancelacion(p.code))}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {mp.pedirCancelacion}
                      </a>
                    )}
                    {/* Consulta por ESTE pedido: con varios pedidos, el
                        flotante no sabe cuál; acá sale con su número. */}
                    <a
                      className="mp-link"
                      href={waLink(mensajeWa("pedidos", { tipo: "pedido", codigo: p.code }, lang))}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {mp.consultarWa}
                    </a>
                    {/* Factura: solo si el staff ya la emitió. */}
                    {p.facturaId && (
                      <a
                        className="mp-link mp-link--factura"
                        href={`/factura/${p.facturaId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {mp.verFactura}
                      </a>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
