import { estadoCotizacion } from "./cotizaciones";
import { pendienteDeConsulta, pendienteDeOp } from "./recordatorios";
import { diaAr } from "./metrics";
import { estadoDe, type Consulta, type Moneda, type Operacion } from "./operaciones";
import { etapaDe, type Etapa, type OpEtapa } from "./etapas";

// Filtros de la lista del Panel. Los de PESTANAS son las pestañas; los demás
// se activan desde las tarjetas (las ocho etapas del Panel, TKT-21, y las de
// plata de Métricas) y se muestran como un chip para sacarlos.
export type Filtro =
  | "todas"
  | "en_curso"
  | "cerradas"
  | "canceladas"
  | "reembolsos"
  // Las ocho etapas del tablero (lib/etapas.ts). "a_cotizar" son consultas;
  // "esperando_pago" y "vencido" juntan operaciones y cotizaciones.
  | "a_cotizar"
  | "pendiente_confirmar"
  | "esperando_pago"
  | "vencido"
  | "pago_informado"
  | "pendiente_pago_proveedor"
  | "esperando_envio_proveedor"
  | "listo_para_enviar"
  // Mismas reglas que las métricas de plata (ver computeMetrics).
  | "cobradas"
  | "sin_cobrar"
  // Lo que lleva rato esperando (lib/recordatorios): el link de los
  // recordatorios por WhatsApp abre el Panel acá.
  | "prioridad";

// Las etapas del medio van en las tarjetas de arriba (las ocho); las
// pestañas quedan para lo que no es una etapa a trabajar.
export const PESTANAS: { key: Filtro; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "en_curso", label: "En curso" },
  { key: "cerradas", label: "Entregadas" },
  { key: "reembolsos", label: "Reembolsos" },
  { key: "canceladas", label: "Canceladas" },
];

const ETIQUETA_TARJETA: Partial<Record<Filtro, string>> = {
  prioridad: "Con prioridad",
  a_cotizar: "A cotizar",
  pendiente_confirmar: "Pendiente de confirmar",
  esperando_pago: "Esperando pago",
  vencido: "Vencidos",
  pago_informado: "Pago informado",
  pendiente_pago_proveedor: "Pendiente de pago al proveedor",
  esperando_envio_proveedor: "Esperando envío del proveedor",
  listo_para_enviar: "Listo para enviar al cliente",
  cobradas: "Con pago confirmado",
  sin_cobrar: "Capital comprometido",
};

// El filtro completo: además del estado, las tarjetas de plata traen la
// moneda y el período que mostraba el tablero, así la lista suma lo mismo.
export type FiltroPanel = {
  filtro: Filtro;
  moneda?: Moneda;
  desde?: string; // YYYY-MM-DD, día del pago en hora argentina
  hasta?: string;
  // Solo los pedidos de UN cliente ("Ver sus pedidos" en Clientes): por su
  // cuenta, o por su email EXACTO para lo cargado a mano sin vincular. Antes
  // era la búsqueda de texto y ana@gmail.com traía también a mariana@gmail.com.
  cliente?: { id: string; email: string; nombre?: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Etapas de operación que también son filtro (mismo nombre).
const FILTRO_ETAPA = new Set<Filtro>([
  "pendiente_confirmar",
  "pago_informado",
  "pendiente_pago_proveedor",
  "esperando_envio_proveedor",
  "listo_para_enviar",
]);

// Links viejos (avisos, emails, marcadores): siguen abriendo lo mismo.
const ALIAS: Record<string, Filtro> = {
  nuevos: "pendiente_confirmar",
  esperando: "esperando_pago",
  para_cerrar: "listo_para_enviar",
};

const FILTROS = new Set<Filtro>([
  ...PESTANAS.map((p) => p.key),
  ...Array.from(FILTRO_ETAPA),
  "a_cotizar",
  "esperando_pago",
  "vencido",
  "cobradas",
  "sin_cobrar",
  "prioridad",
]);
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un link al Panel desde la campana, estando ya en el Panel: si la URL es la
 * misma que la actual, Next no cambia nada y el filtro no se volvía a
 * aplicar. La campana avisa con este evento (detail = el link) y el Panel lo
 * aplica igual.
 */
export const EVENTO_IR_AL_PANEL = "panel:ir";

/** El filtro y la búsqueda de un link del Panel ("/admin?filtro=…&q=…"). */
export function filtroDeLink(url: string): { filtro: FiltroPanel; q: string } | null {
  const i = url.indexOf("?");
  if (!url.startsWith("/admin") || (i !== -1 && url.slice(0, i) !== "/admin") || (i === -1 && url !== "/admin")) return null;
  const params = Object.fromEntries(new URLSearchParams(i === -1 ? "" : url.slice(i + 1)));
  return { filtro: filtroDeParams(params), q: (params.q ?? "").slice(0, 120) };
}

/** Lee el filtro de la URL (?filtro=&moneda=&desde=&hasta=). Lo inválido se ignora. */
export function filtroDeParams(p: Record<string, string | string[] | undefined> | undefined): FiltroPanel {
  const uno = (k: string) => {
    const v = p?.[k];
    return typeof v === "string" ? v : undefined;
  };
  const crudo = uno("filtro");
  const f = crudo && ALIAS[crudo] ? ALIAS[crudo] : crudo;
  const out: FiltroPanel = { filtro: f && FILTROS.has(f as Filtro) ? (f as Filtro) : "todas" };
  const cid = uno("cliente");
  if (cid && UUID.test(cid)) {
    out.cliente = {
      id: cid.toLowerCase(),
      email: (uno("email") ?? "").trim().toLowerCase().slice(0, 200),
      ...(uno("nombre") ? { nombre: (uno("nombre") as string).slice(0, 80) } : {}),
    };
  }
  if (f === "cobradas" || f === "sin_cobrar") {
    const m = uno("moneda");
    if (m === "USD" || m === "ARS") out.moneda = m;
  }
  // El período solo aplica a lo cobrado (las métricas lo filtran por el día
  // del pago); "capital comprometido" es exposición actual.
  if (f === "cobradas") {
    const d = uno("desde");
    const h = uno("hasta");
    if (d && DIA.test(d)) out.desde = d;
    if (h && DIA.test(h)) out.hasta = h;
  }
  return out;
}

/** URL del Panel con ese filtro (para las tarjetas de Métricas). */
export function urlPanel(f: FiltroPanel): string {
  const qs = new URLSearchParams(f.filtro !== "todas" || !f.cliente ? { filtro: f.filtro } : {});
  if (f.cliente) {
    qs.set("cliente", f.cliente.id);
    if (f.cliente.email) qs.set("email", f.cliente.email);
    if (f.cliente.nombre) qs.set("nombre", f.cliente.nombre);
  }
  if (f.moneda) qs.set("moneda", f.moneda);
  if (f.desde) qs.set("desde", f.desde);
  if (f.hasta) qs.set("hasta", f.hasta);
  return `/admin?${qs.toString()}`;
}

/** Texto del chip de un filtro que no es pestaña ("Con pago confirmado · USD · 01/10 → 09/10"). */
export function etiquetaFiltro(f: FiltroPanel): string | null {
  const base = ETIQUETA_TARJETA[f.filtro];
  if (!base) return null;
  const partes = [base];
  if (f.moneda) partes.push(f.moneda);
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  if (f.desde && f.hasta) partes.push(`${dm(f.desde)} → ${dm(f.hasta)}`);
  else if (f.desde) partes.push(`desde ${dm(f.desde)}`);
  else if (f.hasta) partes.push(`hasta ${dm(f.hasta)}`);
  return partes.join(" · ");
}

type OpFiltrable = Pick<
  Operacion,
  | "cliente_id"
  | "cliente_email"
  | "id"
  | "code"
  | "evento"
  | "fecha_evento"
  | "created_at"
  | "status"
  | "tipo"
  | "moneda"
  | "confirmada_at"
  | "entrada_recibida_at"
  | "pago_confirmado_at"
  | "pago_proveedor_at"
  | "cerrada_at"
> &
  Partial<Pick<OpEtapa, "pago_pedido_at" | "pago_informado_at" | "reembolso_at" | "reembolsado_at">>;

/** ¿Es de ese cliente? Por su cuenta, o por su email exacto si no se vinculó. */
export function esDelCliente(
  x: { cliente_id?: string | null; cliente_email?: string | null },
  c: NonNullable<FiltroPanel["cliente"]>
): boolean {
  if (x.cliente_id) return x.cliente_id.toLowerCase() === c.id;
  return !!c.email && (x.cliente_email ?? "").trim().toLowerCase() === c.email;
}

export function opCoincide(op: OpFiltrable, f: FiltroPanel, ahora: Date = new Date()): boolean {
  if (f.cliente && !esDelCliente(op, f.cliente)) return false;
  const estado = estadoDe(op);
  const etapa: Etapa = etapaDe(op, ahora);
  const moneda = op.moneda ?? "USD";
  if (FILTRO_ETAPA.has(f.filtro)) return etapa === f.filtro;
  switch (f.filtro) {
    case "todas":
      return true;
    case "en_curso":
      return etapa !== "entregada" && etapa !== "cancelada" && etapa !== "reembolsado";
    case "cerradas":
      return estado === "cerrada";
    case "canceladas":
      return estado === "cancelada";
    case "reembolsos":
      return etapa === "reembolso_pendiente" || etapa === "reembolsado";
    case "esperando_pago":
    case "vencido":
      return etapa === f.filtro;
    case "a_cotizar":
      return false;
    case "prioridad":
      return pendienteDeOp(op, ahora) !== null;
    case "cobradas": {
      if (op.status === "cancelada" || !op.pago_confirmado_at) return false;
      if (f.moneda && moneda !== f.moneda) return false;
      const dia = diaAr(op.pago_confirmado_at);
      if (f.desde && dia < f.desde) return false;
      if (f.hasta && dia > f.hasta) return false;
      return true;
    }
    case "sin_cobrar":
      // Un pedido de la tienda sin confirmar todavía no es plata comprometida.
      return (
        op.status !== "cancelada" &&
        !op.pago_confirmado_at &&
        !op.cerrada_at &&
        !(op.tipo === "pedido" && !op.confirmada_at) &&
        (!f.moneda || moneda === f.moneda)
      );
    default:
      return false;
  }
}

export function consultaCoincide(
  c: Pick<Consulta, "id" | "code" | "evento" | "estado" | "vence_at" | "created_at"> &
    Partial<Pick<Consulta, "cliente_id" | "cliente_email">>,
  f: FiltroPanel,
  ahora: Date = new Date()
): boolean {
  if (f.cliente && !esDelCliente(c, f.cliente)) return false;
  switch (f.filtro) {
    // Trabajo pendiente: va donde se mira lo que falta hacer.
    case "todas":
    case "en_curso":
      return true;
    case "a_cotizar":
      return estadoCotizacion(c, ahora) === "a_cotizar";
    // Cotizada sin respuesta: el cliente tiene el precio y falta que acepte y
    // pague ("esperando cliente" era en realidad esperando el pago).
    case "esperando_pago":
      return estadoCotizacion(c, ahora) === "esperando";
    case "vencido":
      return estadoCotizacion(c, ahora) === "vencida";
    case "prioridad":
      return pendienteDeConsulta(c, ahora) !== null;
    default:
      return false;
  }
}
