// Reglas puras del endpoint de pedidos (app/api/pedidos/route.ts).
//
// Viven acá y no en el route por dos motivos: son las decisiones que protegen
// la plata (qué monto se guarda) y el teléfono de los vendedores (cuántos
// avisos se disparan), y así se pueden testear sin levantar Next ni Supabase.
// El route se queda con lo que no es puro: leer la base y responder HTTP.

import { factorAVenta, monedaDeVenta, type MonedaVenta, type Tasas, type TicketSource } from "@/lib/tickets";
import type { TipoOperacion } from "@/lib/operaciones";

// La fila real de `tickets` contra la que se reconcilia un item del carrito.
export type TicketRef = {
  evento: string;
  categoria: string | null;
  precio_final: number | null;
  stock: number | null;
  fecha: string | null;
  // Define la moneda: el portal guarda EUR; las propias, la que eligió el
  // admin (moneda_final: USD o ARS; una vieja en EUR se vende en USD).
  source: TicketSource;
  moneda_final?: string | null;
  // Lo que nos cuesta la entrada, para saber cuánto ganamos con ella:
  // - portal: `precio_origen` es lo que cobra Passion, y precio_final le suma
  //   el markup configurado en márgenes;
  // - propias: `precio_costo` es lo que cargó el admin.
  // Sin este dato no se puede saber la comisión y se asume 0 (no se inventa).
  precio_origen?: number | null;
  precio_costo?: number | null;
};

// Un item del carrito ya validado/normalizado por el route.
export type ItemPedido = {
  tipo: TipoOperacion;
  evento: string;
  sector: string | null;
  ticket_id: string | null;
  monto: number; // total de la línea (unitario × cantidad)
  cantidad: number;
  fecha_evento: string | null;
  // Lo que ganamos en esta línea = monto − costo. Se calcula al reconciliar
  // contra la fila real y termina en el `fee` de la operación, que es de donde
  // sale "comisión ganada" en el tablero.
  comision?: number;
  // Moneda en que se cobra esta línea (ver monedaDeVenta). La pone la
  // reconciliación con la fila real; una línea sin entrada vinculada es USD.
  moneda?: MonedaVenta;
};

// --- precio ------------------------------------------------------------------
// El precio crudo de `tickets` llevado a su moneda de venta, con el mismo
// criterio que la tienda (ver monedaDeVenta / factorAVenta): pesos quedan en
// pesos, euros pasan a dólares. Si no, el monto guardado no sería el precio
// que vio el cliente.
export function precioVenta(t: TicketRef, tasa: number | Tasas): number | null {
  return aVenta(t.precio_final, t, tasa);
}

// Lo que NOS cuesta la entrada, en la misma moneda que su precio de venta.
// null cuando no hay dato de costo cargado.
export function costoVenta(t: TicketRef, tasa: number | Tasas): number | null {
  const crudo = t.source === "portal" ? t.precio_origen : t.precio_costo;
  return aVenta(crudo ?? null, t, tasa);
}

function aVenta(valor: number | null, t: TicketRef, tasa: number | Tasas): number | null {
  if (valor == null) return null;
  const bruto = Number(valor);
  if (!Number.isFinite(bruto)) return null;
  const v = bruto * factorAVenta(t.source, t.moneda_final, tasa);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// --- reconciliación ----------------------------------------------------------
// El cliente manda evento/sector/monto/cantidad, pero son datos suyos: no se
// guardan a ciegas. Cuando el item trae `ticket_id` y esa fila existe, los
// campos se toman de la base. Si la entrada ya no está (el catálogo rota en
// cada sync) o el item no trae ticket, no hay de dónde sacar el precio: pasa
// a consulta en 0 para que el staff lo cotice. Nunca se guarda un precio que
// puso el cliente (si no, cualquiera crea un pedido de una final por USD 1).
export function reconciliarItem(p: ItemPedido, t: TicketRef | undefined, tasa: number | Tasas): ItemPedido {
  if (!t) return { ...p, tipo: "consulta", monto: 0, comision: 0 };
  const out: ItemPedido = { ...p };

  if (t.evento) out.evento = t.evento;
  if (t.categoria) out.sector = t.categoria;
  if (t.fecha) {
    const f = String(t.fecha).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) out.fecha_evento = f;
  }
  // Mismo redondeo que muestra la tienda (fmtPrice usa Math.round), para que el
  // monto guardado coincida con el precio que vio el cliente. La consulta queda
  // en 0: es "a confirmar", no una compra.
  out.moneda = monedaDeVenta(t.source, t.moneda_final);
  const precio = precioVenta(t, tasa);
  // Un pedido de una entrada que hoy no tiene precio no se puede cobrar: pasa
  // a consulta. La tienda ya la mostraba "a consultar"; esto cubre un carrito
  // viejo o manipulado, que si no terminaba en una operación de 0.
  if (out.tipo === "pedido" && precio == null) out.tipo = "consulta";
  // La tienda ya topea por stock y partirPorStock manda el resto a consulta;
  // esto es la última red para un pedido que siga siendo pedido. Una consulta
  // no se topea: se pregunta por todo lo que pidió.
  if (out.tipo === "pedido" && typeof t.stock === "number" && t.stock > 0) {
    out.cantidad = Math.min(out.cantidad, t.stock);
  }
  const unit = out.tipo === "pedido" && precio != null ? Math.round(precio) : 0;
  out.monto = unit * out.cantidad;

  // Comisión de la línea = lo que se cobra − lo que cuesta, con el costo
  // redondeado igual que el precio para que monto = costo + comisión cierre
  // exacto (es el mismo modelo que el alta manual).
  //
  // Sin costo conocido la comisión es 0, NO el precio entero: un costo
  // desconocido no es un costo de cero, y tomarlo como tal le inventaría al
  // tablero una ganancia igual a toda la venta.
  const costo = out.tipo === "pedido" ? costoVenta(t, tasa) : null;
  out.comision = costo == null ? 0 : Math.max(0, (unit - Math.round(costo)) * out.cantidad);
  return out;
}

// --- más que el stock -------------------------------------------------------
// Un pedido que pide más entradas de las que quedan se PARTE: lo disponible
// sigue como pedido y el resto pasa a consulta (pedís 5, quedan 3 → 3 pedido +
// 2 consulta). Con stock 0 la línea entera es consulta. La tienda ya topea el
// carrito por stock, así que esto cubre un carrito viejo o el stock que bajó
// entre que lo armó y lo mandó. Sin dato de stock (null) no se toca.
//
// Va ANTES de reconciliarItem (que pone precio y moneda a cada parte).
export function partirPorStock(p: ItemPedido, t: TicketRef | undefined): ItemPedido[] {
  if (p.tipo !== "pedido" || !t || typeof t.stock !== "number") return [p];
  // Sin precio la línea entera va a consulta igual (reconciliarItem): partirla
  // dejaba DOS consultas de la misma entrada (x3 y x2) para cotizar dos veces.
  if (t.precio_final == null || !(Number(t.precio_final) > 0)) return [p];
  const stock = Math.max(0, Math.trunc(t.stock));
  if (p.cantidad <= stock) return [p];
  const consulta: ItemPedido = { ...p, tipo: "consulta", cantidad: p.cantidad - stock, monto: 0 };
  if (stock === 0) return [{ ...consulta, cantidad: p.cantidad }];
  const unit = p.cantidad > 0 ? p.monto / p.cantidad : 0;
  return [{ ...p, cantidad: stock, monto: Math.round(unit * stock) }, consulta];
}

/**
 * Cuántas entradas pasaron a consulta POR STOCK: las partes consulta que
 * partirPorStock sacó de una línea pedido. Solo eso: si una pasa a consulta
 * por no tener precio, el aviso al cliente ("no tenían stock") mentiría.
 */
export function entradasMovidasPorStock(original: ItemPedido, partes: ItemPedido[]): number {
  if (original.tipo !== "pedido") return 0;
  return partes.filter((x) => x.tipo === "consulta").reduce((a, x) => a + x.cantidad, 0);
}

// --- anti-flood --------------------------------------------------------------
// Cada envío dispara UN aviso a los vendedores (WhatsApp + email), así que un
// cliente que spamea les inunda el teléfono. Topes deliberadamente holgados: un
// carrito real (hasta 50 entradas) entra sin rozarlos. El intervalo mínimo,
// además, mata el pedido duplicado por doble click.
export const RL_VENTANA_MS = 10 * 60_000;
export const RL_MAX_VENTANA = 200; // filas por cliente en esa ventana
export const RL_MIN_INTERVALO_MS = 5_000;

// Decide sobre los `created_at` de las operaciones del cliente en la ventana,
// ordenados del más nuevo al más viejo. Devuelve el mensaje a mostrar, o null
// si puede seguir.
export function evaluarLimite(createdAt: string[], ahora: number): string | null {
  if (createdAt.length > RL_MAX_VENTANA) {
    return "Hiciste muchos pedidos en poco tiempo. Esperá unos minutos y volvé a intentar.";
  }
  const ultima = createdAt[0];
  if (!ultima) return null;
  const ts = Date.parse(ultima);
  // Fecha ilegible: no se bloquea (perder un pedido legítimo es peor).
  if (!Number.isFinite(ts)) return null;
  if (ahora - ts < RL_MIN_INTERVALO_MS) {
    return "Esperá unos segundos antes de enviar otro pedido.";
  }
  return null;
}

// --- agrupado del carrito ---------------------------------------------------
// Un envío del carrito es UNA operación, no una por entrada. Las líneas van a
// `operacion_items`; la operación guarda un resumen para que el panel, el
// ticket público y el CSV sigan teniendo un encabezado legible sin leer las
// líneas.
export type ResumenOperacion = {
  evento: string;
  sector: string | null;
  ticket_id: string | null;
  cantidad: number;
  fecha_evento: string | null;
  monto: number;
};

export function resumenOperacion(lineas: ItemPedido[]): ResumenOperacion {
  const primera = lineas[0];
  const unica = lineas.length === 1;

  // Con una sola línea el encabezado es la línea. Con varias, el evento de la
  // primera + cuántas más, para que la tarjeta del panel no mienta mostrando
  // solo una de tres.
  const otras = lineas.length - 1;
  const evento = unica ? primera.evento : `${primera.evento} +${otras} más`;

  // Sector y ticket solo tienen sentido si hay una sola línea: con varias
  // pertenecen a las líneas, no a la operación.
  const sector = unica ? primera.sector : null;
  const ticket_id = unica ? primera.ticket_id : null;

  // Total de entradas del pedido, no de líneas.
  const cantidad = lineas.reduce((a, l) => a + l.cantidad, 0);

  // La fecha más próxima: es la que marca la urgencia de la operación.
  const fechas = lineas.map((l) => l.fecha_evento).filter((f): f is string => !!f).sort();
  const fecha_evento = fechas[0] ?? null;

  // `monto` de cada línea ya es el total de esa línea (unitario × cantidad).
  const monto = lineas.reduce((a, l) => a + l.monto, 0);

  return { evento, sector, ticket_id, cantidad, fecha_evento, monto };
}

// Un carrito puede traer entradas en pesos y en dólares. Una operación se
// debe en UNA moneda (sus líneas no tienen moneda propia), así que el pedido
// se parte: una operación por moneda. Orden estable: dólares primero.
export function agruparPorMoneda(lineas: ItemPedido[]): { moneda: MonedaVenta; lineas: ItemPedido[] }[] {
  const orden: MonedaVenta[] = ["USD", "ARS"];
  return orden
    .map((moneda) => ({ moneda, lineas: lineas.filter((l) => (l.moneda ?? "USD") === moneda) }))
    .filter((g) => g.lineas.length > 0);
}

// Separa lo que se reserva de lo que se consulta: la operación se arma solo
// con lo que tiene precio, y las consultas van a su propia tabla.
export function separarPorTipo(items: ItemPedido[]): {
  pedidos: ItemPedido[];
  consultas: ItemPedido[];
} {
  return {
    pedidos: items.filter((i) => i.tipo === "pedido"),
    consultas: items.filter((i) => i.tipo === "consulta"),
  };
}

// --- aviso a los vendedores --------------------------------------------------
// Qué clase de envío entró. Un mismo carrito puede traer entradas con precio
// cerrado Y entradas a cotizar, y al vendedor le cambia lo que tiene que hacer:
// un pedido se acciona, una consulta hay que chequearla y ponerle precio.
export type TipoEnvio = "pedido" | "consulta" | "mixto";

export function tipoDelEnvio(pedidos: ItemPedido[], consultas: ItemPedido[]): TipoEnvio {
  if (pedidos.length > 0 && consultas.length > 0) return "mixto";
  return consultas.length > 0 ? "consulta" : "pedido";
}

// Con el artículo adentro: la plantilla dice "Entró {{1}} en la tienda" y
// "consulta" es femenino. Con la etiqueta pelada salía "Nuevo consulta".
export const TIPO_ENVIO_LABEL: Record<TipoEnvio, string> = {
  pedido: "un pedido",
  consulta: "una consulta",
  mixto: "un pedido con consultas",
};

// Una línea por entrada, todo en UN renglón: es lo que se manda como parámetro
// de la plantilla de WhatsApp, y ahí no entran saltos de línea. Se muestran
// hasta `max` y el resto se resume, para no pasarse del largo que acepta Meta.
//
// Cuando el envío trae de los dos tipos, cada grupo va rotulado: si no, el
// vendedor no sabe cuál de las entradas tiene que cotizar.
export function detalleDeLineas(
  pedidos: ItemPedido[],
  consultas: ItemPedido[],
  max = 5
): string {
  // El nombre de un evento del portal puede traer saltos de línea: se aplanan
  // acá y no sólo al mandar, porque esta función promete UNA línea.
  const plano = (v: string) => v.replace(/\s+/g, " ").trim();
  const uno = (l: ItemPedido) =>
    `${plano(l.evento)}${l.sector ? ` (${plano(l.sector)})` : ""}${
      l.cantidad > 1 ? ` x${l.cantidad}` : ""
    }`;

  const grupo = (lineas: ItemPedido[], rotulo: string | null): string => {
    if (lineas.length === 0) return "";
    const visibles = lineas.slice(0, max).map(uno).join(" + ");
    const resto = lineas.length > max ? ` y ${lineas.length - max} mas` : "";
    return `${rotulo ? `${rotulo}: ` : ""}${visibles}${resto}`;
  };

  const mixto = pedidos.length > 0 && consultas.length > 0;
  return [
    grupo(pedidos, mixto ? "A reservar" : null),
    grupo(consultas, mixto ? "A cotizar" : null),
  ]
    .filter(Boolean)
    .join(" | ");
}
