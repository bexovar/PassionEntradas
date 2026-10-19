// Dominio de las facturas/recibos: el snapshot que se guarda al emitir
// (inmutable: si la operación cambia después, el invoice emitido no cambia)
// y los textos EN/ES de la vista pública.

export type FacturaIdioma = "en" | "es";

export type FacturarA = "cuenta" | "otro";

// Lo que la cuenta del cliente aporta a la factura. El modal lo muestra antes
// de emitir para que el admin vea exactamente a quién le va a facturar.
export type CuentaFactura = { nombre: string; email: string | null; legajo: string | null };

export type FacturaDatos = {
  idioma: FacturaIdioma;
  // Datos del comprador. Cuando la operación salió de un pedido de la tienda,
  // `email` y `legajo` se copian de la CUENTA que lo pidió, no de lo que tipeó
  // el admin: así el mismo legajo que cargó al pedir acceso llega hasta la
  // factura. En operaciones cargadas a mano quedan en null.
  // `facturar_a` dice de dónde salieron: "cuenta" = nombre, email y legajo de
  // la cuenta del cliente; "otro" = nombre o razón social y CUIT tipeados por
  // el admin (otra persona o una empresa, o una operación sin cuenta).
  // Opcional: las facturas viejas no lo tienen (eran "cuenta" si había cuenta).
  comprador: {
    nombre: string;
    contacto: string | null;
    email?: string | null;
    legajo?: string | null;
    facturar_a?: FacturarA;
  };
  // Quién manejó la venta (auditoría de la operación) — "Handled by Kiru".
  agente: string | null;
  operacion: { id: string; code: string };
  evento: {
    titulo: string;
    competicion: string | null;
    fecha: string | null; // YYYY-MM-DD
    sede: string | null;
    sector: string | null;
  };
  // Entradas de la operación. Un pedido del carrito puede traer varias de
  // sectores o eventos distintos, y la factura tiene que mostrarlas todas.
  // Opcional: las facturas emitidas antes del modelo multi-línea no la
  // tienen y se siguen renderizando con los campos sueltos de abajo.
  items?: {
    evento: string;
    sector: string | null;
    fecha: string | null;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
  }[];
  // Resumen (y compatibilidad con las facturas viejas de una sola línea).
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  fee: number;
  total: number;
  metodo_pago: string;
  pago_confirmado_at: string | null;
  // Dólar del día que carga el admin al emitir: cuántos pesos vale un dólar
  // ese día. Queda fijo en la factura (reabrirla meses después muestra el de
  // su emisión, no el de hoy). Opcional porque las facturas emitidas antes no
  // lo tienen.
  cotizacion?: { ars_por_usd: number; fecha: string } | null;
  // Moneda de la operación facturada. Opcional: todas las facturas emitidas
  // antes de este campo eran en dólares, y se leen así (ver monedaFactura).
  moneda?: "ARS" | "USD";
};

export function monedaFactura(d: Pick<FacturaDatos, "moneda">): "ARS" | "USD" {
  return d.moneda === "ARS" ? "ARS" : "USD";
}

// Métodos de pago por moneda: una factura en pesos se paga en pesos, una en
// dólares en dólares. Antes la lista era una sola y un pedido en pesos podía
// salir con "Bank transfer (USD)" (le pasó a la factura de Boca).
export const METODOS_PAGO: Record<"ARS" | "USD", string[]> = {
  ARS: ["Transferencia (ARS)", "Efectivo (ARS)", "Mercado Pago (ARS)"],
  USD: ["Bank transfer (USD)", "Transferencia (USD)", "Cash (USD)", "Efectivo (USD)", "Crypto (USDT)"],
};

export function metodoValido(metodo: string, moneda: "ARS" | "USD"): boolean {
  return METODOS_PAGO[moneda].includes(metodo);
}

// Monto en la moneda de la factura. ARS sin decimales (los centavos no se usan);
// USD con dos, que es lo contable.
export function fmtMontoMoneda(n: number, moneda: "ARS" | "USD", idioma: FacturaIdioma): string {
  if (moneda === "USD") return fmtMontoFactura(n, idioma);
  return (
    "AR$ " +
    new Intl.NumberFormat(idioma === "en" ? "en-US" : "es-AR", { maximumFractionDigits: 0 }).format(n)
  );
}

export type Factura = {
  id: string;
  numero: number;
  datos: FacturaDatos;
  created_at: string;
};

// "TM-2026-00042": prefijo + año de emisión + correlativo.
export function numeroFactura(numero: number, createdAt: string): string {
  return `TM-${createdAt.slice(0, 4)}-${String(numero).padStart(5, "0")}`;
}

// Monto USD con decimales contables ("US$ 2,592.00" / "US$ 2.592,00").
export function fmtMontoFactura(n: number, idioma: FacturaIdioma): string {
  return (
    "US$ " +
    new Intl.NumberFormat(idioma === "en" ? "en-US" : "es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  );
}

// Lo que tipea el admin: "1465", "1465.5", "1.465", "1.465,50", "$ 1.465,50".
// La convención argentina (punto de miles, coma decimal) y la anglosajona
// conviven, así que la regla es: si hay punto y coma, el último separador es
// el decimal; una coma sola es decimal; un punto solo seguido de exactamente
// tres dígitos es de miles (un dólar a "1.465" pesos no existe). Fuera de un
// rango razonable devuelve null: mejor rechazar que facturar con un typo.
export function parseCotizacion(raw: unknown): number | null {
  if (typeof raw === "number") return raw >= 1 && raw <= 100000 ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/ars|ar\$|\$|\s/gi, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  const punto = s.lastIndexOf(".");
  const coma = s.lastIndexOf(",");
  if (punto >= 0 && coma >= 0) {
    const dec = punto > coma ? "." : ",";
    const mil = dec === "." ? "," : ".";
    s = s.split(mil).join("").replace(dec, ".");
  } else if (coma >= 0) {
    if (s.indexOf(",") !== coma) return null;
    s = s.replace(",", ".");
  } else if (punto >= 0) {
    const partes = s.split(".");
    const miles = partes.length > 1 && partes.slice(1).every((p) => p.length === 3);
    if (miles) s = partes.join("");
    else if (partes.length > 2) return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  return Math.round(n * 100) / 100;
}

// Monto en pesos con decimales ("AR$ 1,465.00" / "AR$ 1.465,00").
export function fmtArsFactura(n: number, idioma: FacturaIdioma): string {
  return (
    "AR$ " +
    new Intl.NumberFormat(idioma === "en" ? "en-US" : "es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  );
}

export const FACTURA_TX = {
  en: {
    docKind: "Invoice / Receipt",
    paid: "Paid",
    billedTo: "Billed to",
    legajo: "Tax ID",
    issued: "Issued",
    handledBy: "Handled by",
    team: "TicketMirror team",
    operacion: "Operation",
    ticketPurchased: "Ticket purchased",
    // Varias líneas: el encabezado de la sección va en plural y la columna
    // tiene su propio título (repetir "Ticket purchased" en las dos leía mal).
    ticketsPurchased: "Tickets purchased",
    lineCol: "Detail",
    date: "Date",
    venue: "Venue",
    section: "Section",
    qty: "Qty",
    unitPrice: "Unit price",
    subtotal: (q: number, unit: string) =>
      unit ? `Subtotal (${q} × ${unit})` : `Subtotal (${q})`,
    fee: "Service & escrow fee",
    total: "Total",
    usdNote: "All amounts in US dollars (USD).",
    arsOnlyNote: "All amounts in Argentine pesos (ARS).",
    exchangeRate: (fecha: string) => `Exchange rate (${fecha})`,
    totalArs: "Total in Argentine pesos",
    arsNote: "Peso amount for reference, at the exchange rate of the issue date.",
    payMethod: "Payment method",
    payConfirmed: "Payment confirmed",
    track: "Track your operation",
    terms:
      "Tickets are delivered after payment confirmation, through our escrow process. Keep this receipt and your operation code for any inquiry — reply to your WhatsApp thread and we'll pick it up from there.",
    print: "Download PDF / Print",
    venueTBC: "Venue TBC",
    dateTBC: "Date TBC",
  },
  es: {
    docKind: "Factura / Recibo",
    paid: "Pagado",
    billedTo: "Facturado a",
    legajo: "Legajo/CUIT",
    issued: "Emitido",
    handledBy: "Atendió",
    team: "equipo TicketMirror",
    operacion: "Operación",
    ticketPurchased: "Entrada comprada",
    ticketsPurchased: "Entradas compradas",
    lineCol: "Detalle",
    date: "Fecha",
    venue: "Sede",
    section: "Sector",
    qty: "Cant.",
    unitPrice: "Precio unitario",
    subtotal: (q: number, unit: string) =>
      unit ? `Subtotal (${q} × ${unit})` : `Subtotal (${q})`,
    fee: "Servicio y custodia",
    total: "Total",
    usdNote: "Todos los montos en dólares estadounidenses (USD).",
    arsOnlyNote: "Todos los montos en pesos argentinos (ARS).",
    exchangeRate: (fecha: string) => `Dólar del día (${fecha})`,
    totalArs: "Total en pesos",
    arsNote: "Monto en pesos de referencia, al dólar del día de emisión.",
    payMethod: "Método de pago",
    payConfirmed: "Pago confirmado",
    track: "Seguimiento de tu operación",
    terms:
      "Las entradas se entregan después de confirmar el pago, con nuestro proceso de custodia. Guardá este recibo y tu código de operación para cualquier consulta — respondé en tu hilo de WhatsApp y seguimos desde ahí.",
    print: "Descargar PDF / Imprimir",
    venueTBC: "Sede a confirmar",
    dateTBC: "Fecha a confirmar",
  },
} as const;
