import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { createPublicSupabase } from "@/lib/supabase/public";
import {
  FACTURA_TX,
  fmtMontoFactura,
  fmtArsFactura,
  fmtMontoMoneda,
  monedaFactura,
  numeroFactura,
  type Factura,
} from "@/lib/factura";
import { isMock, mockFacturaPorId } from "@/lib/mock-db";
import BotonImprimir from "./BotonImprimir";
import "./factura.css";

// Factura/recibo público: se accede solo con el uuid exacto (impredecible),
// mismo modelo que el link de seguimiento /op/[id]. Renderiza el snapshot
// emitido — nunca datos vivos de la operación.
export const dynamic = "force-dynamic";
// La lectura va por el cliente público (sin cookies), y Next guarda esos fetch
// en su caché de datos — que en Vercel SOBREVIVE a los deploys. Con solo
// force-dynamic, una factura re-emitida (o corregida en la base) se seguía
// mostrando con la foto vieja: la de Boca salía en US$ con los datos ya en ARS.
// Una factura tiene que leerse siempre fresca.
export const fetchCache = "force-no-store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fechaLarga(iso: string | null, idioma: "en" | "es", tbc: string): string {
  if (!iso) return tbc;
  const label = new Date(iso).toLocaleDateString(idioma === "en" ? "en-US" : "es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fechaCorta(iso: string, idioma: "en" | "es"): string {
  return new Date(iso).toLocaleDateString(idioma === "en" ? "en-US" : "es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function FacturaPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();

  noStore();
  let factura: Factura | null = null;
  if (isMock()) {
    factura = mockFacturaPorId(params.id);
  } else {
    const supabase = createPublicSupabase();
    const { data, error } = await supabase
      .rpc("factura_publica", { f_id: params.id })
      .maybeSingle();
    if (!error && data) {
      factura = { id: params.id, ...(data as Omit<Factura, "id">) };
    }
  }
  if (!factura) notFound();

  const d = factura.datos;
  const t = FACTURA_TX[d.idioma] ?? FACTURA_TX.en;
  const num = numeroFactura(factura.numero, factura.created_at);
  // Todo en la moneda de la operación. `usd` conserva el nombre por historia:
  // en una factura en pesos formatea pesos.
  const moneda = monedaFactura(d);
  const usd = (n: number) => fmtMontoMoneda(n, moneda, d.idioma);
  const notaMoneda =
    moneda === "ARS" ? t.arsOnlyNote : t.usdNote;
  // Facturas emitidas antes del modelo multi-línea no traen `items`: se arma
  // una línea con el resumen para que se sigan viendo igual.
  const lineas =
    d.items && d.items.length > 0
      ? d.items
      : [
          {
            evento: d.evento.titulo,
            sector: d.evento.sector,
            fecha: d.evento.fecha,
            cantidad: d.cantidad,
            precio_unitario: d.precio_unitario,
            subtotal: d.subtotal,
          },
        ];
  const opUrl = `/op/${d.operacion.id}`;

  return (
    <main className="fac-body">
      <div className="fac-sheet">
        <header className="fac-head">
          <div className="fac-wm">
            <span className="fac-mark">▚</span> TICKET<em>MIRROR</em>
          </div>
          <div className="fac-head-right">
            <div className="fac-doc-kind">{t.docKind}</div>
            <div className="fac-doc-num">{num}</div>
            <span className="fac-chip">
              <i /> {t.paid}
            </span>
          </div>
        </header>

        <section className="fac-parties">
          <div className="fac-party">
            <p className="fac-label">{t.billedTo}</p>
            <p className="fac-name">{d.comprador.nombre}</p>
            {/* Email y legajo vienen de la cuenta que hizo el pedido; el
                contacto es el campo libre que carga el admin. */}
            {d.comprador.email && <p className="fac-dato">{d.comprador.email}</p>}
            {d.comprador.legajo && (
              <p className="fac-dato">{t.legajo}: {d.comprador.legajo}</p>
            )}
            {/* El contacto arranca con el email del cliente: si quedó igual
                no se repite la misma línea dos veces. */}
            {d.comprador.contacto &&
              d.comprador.contacto.trim().toLowerCase() !== (d.comprador.email ?? "").trim().toLowerCase() && (
                <p className="fac-dato">{d.comprador.contacto}</p>
              )}
          </div>
          <div className="fac-party">
            <p className="fac-label">{t.issued}</p>
            <p className="fac-name">{fechaCorta(factura.created_at, d.idioma)}</p>
            {d.agente && (
              <p className="fac-dato">
                {t.handledBy} <strong>{d.agente}</strong> · {t.team}
              </p>
            )}
            <p className="fac-dato">
              {t.operacion} <span className="fac-mono">{d.operacion.code}</span>
            </p>
          </div>
        </section>

        <section className="fac-item-wrap">
          <p className="fac-label">
            {lineas.length === 1 ? t.ticketPurchased : t.ticketsPurchased}
          </p>
          {lineas.length === 1 ? (
            <div className="fac-ticket">
              <div className="fac-t-body">
                {d.evento.competicion && (
                  <p className="fac-t-eyebrow">{d.evento.competicion}</p>
                )}
                <h1 className="fac-t-title">{lineas[0].evento}</h1>
                <div className="fac-t-meta">
                  <div>
                    <span className="k">{t.date}</span>
                    <span className="v">
                      {fechaLarga(lineas[0].fecha ?? d.evento.fecha, d.idioma, t.dateTBC)}
                    </span>
                  </div>
                  <div>
                    <span className="k">{t.venue}</span>
                    <span className="v">{d.evento.sede ?? t.venueTBC}</span>
                  </div>
                  {lineas[0].sector && (
                    <div>
                      <span className="k">{t.section}</span>
                      <span className="v">{lineas[0].sector}</span>
                    </div>
                  )}
                </div>
              </div>
              <aside className="fac-t-stub">
                <span className="fac-stub-k">{t.qty}</span>
                <span className="fac-stub-qty">×{lineas[0].cantidad}</span>
                <span className="fac-stub-k">{t.unitPrice}</span>
                <span className="fac-stub-price">{usd(lineas[0].precio_unitario)}</span>
                <div className="fac-barcode" aria-hidden />
                <span className="fac-stub-code">{d.operacion.code}</span>
              </aside>
            </div>
          ) : (
            /* Varias entradas: tabla clásica. El talón con código de barras
               no tiene sentido repetido una vez por línea. */
            <table className="fac-lineas">
              <thead>
                <tr>
                  <th>{t.lineCol}</th>
                  <th className="num">{t.qty}</th>
                  <th className="num">{t.unitPrice}</th>
                  <th className="num">{t.total}</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <span className="fac-l-ev">{l.evento}</span>
                      <span className="fac-l-meta">
                        {l.sector ?? "—"}
                        {l.fecha ? ` · ${fechaLarga(l.fecha, d.idioma, t.dateTBC)}` : ""}
                      </span>
                    </td>
                    <td className="num">×{l.cantidad}</td>
                    <td className="num">{usd(l.precio_unitario)}</td>
                    <td className="num">{usd(l.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <div className="fac-totals">
            <table>
              <tbody>
                <tr>
                  <td className="t-label">
                    {/* Con varias líneas no hay UN precio unitario que
                        mostrar: el subtotal va sin él. */}
                    {lineas.length === 1
                      ? t.subtotal(d.cantidad, usd(d.precio_unitario))
                      : t.subtotal(d.cantidad, "")}
                  </td>
                  <td>{usd(d.subtotal)}</td>
                </tr>
                {/* Solo las facturas VIEJAS desglosan el fee: se emitieron con
                    el total = subtotal + fee y hay que seguir mostrándolas tal
                    como se entregaron. Las nuevas cobran el precio de la
                    entrada, que ya incluye la comisión. */}
                {d.total > d.subtotal && (
                  <tr>
                    <td className="t-label">{t.fee}</td>
                    <td>{usd(d.fee)}</td>
                  </tr>
                )}
                <tr className="total-row">
                  <td>{t.total}</td>
                  <td>{usd(d.total)}</td>
                </tr>
                {/* Dólar del día que cargó el admin al emitir. Las facturas
                    anteriores no lo tienen y se ven como siempre. */}
                {d.cotizacion && moneda === "USD" && (
                  <>
                    <tr className="fx-row">
                      <td className="t-label">
                        {t.exchangeRate(fechaCorta(d.cotizacion.fecha, d.idioma))}
                      </td>
                      <td>
                        {fmtMontoFactura(1, d.idioma)} = {fmtArsFactura(d.cotizacion.ars_por_usd, d.idioma)}
                      </td>
                    </tr>
                    <tr className="fx-row">
                      <td className="t-label">{t.totalArs}</td>
                      <td>
                        {fmtArsFactura(
                          Math.round(d.total * d.cotizacion.ars_por_usd * 100) / 100,
                          d.idioma
                        )}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="fac-usd-note">{notaMoneda}</p>
          {d.cotizacion && moneda === "USD" && <p className="fac-usd-note">{t.arsNote}</p>}
        </section>

        <section className="fac-pay">
          <div>
            <span className="k">{t.payMethod}</span>
            <span className="v">{d.metodo_pago}</span>
          </div>
          <div>
            <span className="k">{t.payConfirmed}</span>
            <span className="v">
              {d.pago_confirmado_at ? fechaCorta(d.pago_confirmado_at, d.idioma) : "—"}
            </span>
          </div>
          <div>
            <span className="k">{t.track}</span>
            <span className="v fac-mono">
              <a href={opUrl}>{d.operacion.code}</a>
            </span>
          </div>
        </section>

        <footer className="fac-foot">
          <span className="brand">▚ TicketMirror</span>
          <span className="terms">{t.terms}</span>
        </footer>
      </div>

      <div className="fac-print-row">
        <BotonImprimir label={t.print} />
      </div>
    </main>
  );
}
