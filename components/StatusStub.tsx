import {
  ESTADO_PUBLICO_COLOR,
  ESTADO_PUBLICO_LABEL,
  estadoPublicoDe,
  formatMonto,
  formatFecha,
  type ItemPublico,
  type OperacionPublica,
} from "@/lib/operaciones";
import ProgressSteps from "./ProgressSteps";
import { waLink } from "@/lib/tickets";
import { MARCA_SEGUIMIENTO } from "@/lib/marca-seguimiento";

// Código de barras decorativo, derivado determinísticamente del code de la
// operación (cada char define anchos de barra). Refuerza el motivo "entrada".
function Barcode({ code }: { code: string }) {
  const chars = Array.from(code.replace(/-/g, ""));
  return (
    <div className="flex h-10 items-stretch justify-center gap-[3px]" aria-hidden>
      {chars.flatMap((ch, i) => {
        const n = ch.charCodeAt(0);
        const widths = [2, 1 + (n % 3), 2 + ((n >> 1) % 3), 1 + ((n >> 2) % 2)];
        return widths.map((w, j) => (
          <span
            key={`${i}-${j}`}
            className="inline-block rounded-[1px] bg-ink"
            style={{ width: w }}
          />
        ));
      })}
    </div>
  );
}

// Microtexto de seguridad repetido (como en un billete o entrada real).
function Microtext({ dark = false }: { dark?: boolean }) {
  return (
    <p
      className={`microtext text-center ${dark ? "text-white/25" : "text-ink/20"}`}
      aria-hidden
    >
      {MARCA_SEGUIMIENTO.franja.repeat(6)}
    </p>
  );
}

// Talón / stub de entrada. El contenedor no pinta fondo: cada sección pinta
// el suyo y enmascara medio círculo en sus juntas (.punch-*), así el
// troquelado son agujeros de verdad a través de los que se ve la página.
export default function StatusStub({
  op,
  items = [],
  textoPago = null,
}: {
  op: OperacionPublica;
  items?: ItemPublico[];
  // Cómo pagar (texto del panel para la moneda del pedido). Solo en "Para pagar".
  textoPago?: string | null;
}) {
  const estado = estadoPublicoDe(op);
  const color = ESTADO_PUBLICO_COLOR[estado];
  // El sello vive sobre la sección de tinta: el color de "cerrada" ES tinta
  // (sello tipo "CANJEADO" pensado para fondos claros) y desaparecía contra
  // el fondo. Sobre oscuro, el sello final va en papel.
  const colorSello = estado === "entregada" ? "#FBFAF6" : color;
  // Aviso según la etapa del proceso: la página le dice a cada parte qué
  // puede hacer ahora, igual que lo haría el administrador en el grupo.
  // Los avisos hablan solo de lo que el comprador ve: su pedido y su pago.
  // Los pasos con el proveedor son internos y no se mencionan.
  const AVISOS: Partial<Record<typeof estado, { icon: string; text: string }>> = {
    pedido_recibido: {
      icon: "📝",
      text: "Recibimos tu pedido. Lo estamos revisando para confirmarlo.",
    },
    pedido_confirmado: {
      icon: "✅",
      text: "Tu pedido está confirmado. Te avisamos apenas tengamos las entradas para que puedas pagar.",
    },
    listo_para_pagar: {
      icon: "💳",
      text: "Ya tenemos tus entradas. Para pagar:",
    },
    pago_recibido: {
      icon: "💸",
      text: "Tu pago está confirmado. Estamos coordinando la entrega de las entradas.",
    },
  };
  const aviso = AVISOS[estado] ?? null;
  // Hora de Argentina explícita: esto se renderiza en el server (UTC en
  // Vercel) y sin timeZone mostraría la hora corrida 3 horas.
  const actualizado = new Date(op.updated_at).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  });

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="ticket-shadow overflow-hidden rounded-3xl">
        {/* Franja holográfica de seguridad */}
        <div className="holo-strip" aria-hidden />

        {/* Cabecera oscura: marca, code y evento */}
        <div className="surface-ink punch-b text-white">
          <div className="relative px-6 pb-8 pt-7">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-white/60">
                <span
                  className="inline-block h-2 w-2 rounded-full bg-brand"
                  aria-hidden
                />
                {MARCA_SEGUIMIENTO.encabezado}
              </div>
              <span className="whitespace-nowrap rounded-md border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/75">
                {op.code}
              </span>
            </div>
            <h1 className="mt-4 font-display text-[1.7rem] font-bold leading-tight tracking-tight">
              {op.evento}
            </h1>
            {op.fecha_evento && (
              <p className="mt-1.5 text-sm text-white/60">
                {formatFecha(op.fecha_evento)}
              </p>
            )}
            {/* Entradas del pedido. Desde dos: con una sola el título ya la
                nombra y repetirla sería ruido. */}
            {items.length > 1 && (
              <ul className="mt-3 space-y-1 border-t border-white/10 pt-3">
                {items.map((i, n) => (
                  <li key={n} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block text-white/85 [overflow-wrap:anywhere]">{i.evento}</span>
                      <span className="block text-xs text-white/45">
                        {i.sector ?? "General"}
                        {i.cantidad > 1 ? ` · ×${i.cantidad}` : ""}
                        {i.fecha_evento ? ` · ${formatFecha(i.fecha_evento)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-white/70">
                      {formatMonto(i.cantidad * i.precio_unitario, op.moneda)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Sección oscura del sello, separada por troquel real */}
        <div className="punch-t bg-ink text-white">
          <div className="perf-line mx-6" />
          <div className="flex justify-center px-6 pb-7 pt-9">
            <div
              className="stamp stamp-animate w-full max-w-[330px] px-6 py-3.5 text-center"
              style={{ color: colorSello }}
            >
              <span className="block text-[10px] font-semibold tracking-[0.3em] opacity-70">
                Estado
              </span>
              <span
                className="mt-0.5 block font-display text-xl font-bold leading-tight tracking-wide sm:text-2xl"
                style={{ textWrap: "balance" }}
              >
                {ESTADO_PUBLICO_LABEL[estado]}
              </span>
            </div>
          </div>
          <div className="px-6 pb-4">
            <Microtext dark />
          </div>
        </div>

        {/* Cuerpo blanco */}
        <div className="punch-b bg-white">
          {/* px-4 en celular: con px-6 los tres pasos no entraban en 320px. */}
          <div className="space-y-6 px-4 py-7 sm:px-6">
            {/* Los tres pasos del proceso: entrada → pago → entrega */}
            <ProgressSteps estado={estado} />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <div className="col-span-2">
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  Monto
                </dt>
                <dd className="mt-0.5 font-display text-3xl font-bold tabular-nums tracking-tight">
                  {formatMonto(op.monto, op.moneda)}
                </dd>
              </div>
              {op.comprador_alias && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                    Comprador
                  </dt>
                  <dd className="mt-0.5 font-medium">{op.comprador_alias}</dd>
                </div>
              )}
              {op.vendedor_alias && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                    Vendedor
                  </dt>
                  <dd className="mt-0.5 font-medium">{op.vendedor_alias}</dd>
                </div>
              )}
            </dl>

            {aviso && (
              <div
                className="rounded-xl border px-4 py-3"
                style={{
                  borderColor: `${color}44`,
                  backgroundColor: `${color}0f`,
                }}
              >
                <p className="flex gap-2 text-sm font-medium text-ink">
                  <span aria-hidden>{aviso.icon}</span>
                  <span>{aviso.text}</span>
                </p>
                {/* Para pagar: los datos de pago y, siempre, la opción de
                    preguntar por WhatsApp. */}
                {estado === "listo_para_pagar" && (
                  <div className="mt-2 space-y-3 pl-6">
                    <p className="whitespace-pre-line break-words text-sm text-ink">
                      {textoPago ?? "Escribinos por WhatsApp y te pasamos los datos para pagar."}
                    </p>
                    <a
                      href={waLink(`¡Hola! Quiero pagar mi pedido ${op.code}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-ink bg-[#25d366] px-3 py-2 text-xs font-bold text-[#06310f]"
                    >
                      Consultar por WhatsApp ↗
                    </a>
                  </div>
                )}
              </div>
            )}

            <p className="text-center text-xs text-muted">
              Última actualización: {actualizado}
            </p>
          </div>
        </div>

        {/* Pie con troquel real + barcode */}
        <div className="punch-t bg-white">
          <div className="perf-line-light mx-6" />
          <div className="px-6 pb-6 pt-5">
            <Barcode code={op.code} />
            <p className="mt-2 text-center font-mono text-[11px] tracking-[0.35em] text-muted">
              {op.code}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
