// Dominio del catálogo de entradas (ex PassionEntradas / TicketMirror).
// Tipos de la tabla `tickets`, agrupado por evento, precios multi-moneda
// y links de WhatsApp con mensaje pre-armado.

import { LOCALE, TX, type Lang } from "@/lib/tienda-i18n";

export type TicketEstado = "book" | "on_request";
export type TicketSource = "portal" | "manual";

export type Ticket = {
  id: string;
  evento: string;
  competicion: string | null;
  fecha: string | null;
  ciudad: string | null;
  categoria: string | null;
  precio_final: number | null;
  stock: number | null;
  estado: TicketEstado;
  source: TicketSource;
  // Lo que nos cuesta la entrada antes del markup. En el portal es lo que
  // cobra Passion; en las propias lo carga el admin (ahí se llama
  // precio_costo). La diferencia con precio_final es nuestra comisión.
  precio_origen?: number | null;
  // Entradas propias: lo que nos costó. Mismo rol que precio_origen en las del
  // portal; se separa porque una la carga el admin y la otra el worker.
  precio_costo?: number | null;
  // Mapa de sectores del evento (URL pública del bucket `mapas`), si hay.
  imagen_url?: string | null;
  // Zona coloreada del mapa a la que pertenece este sector. El mapa ya viene
  // con las zonas pintadas: esto le dice al agente cuál mirar. Lo escribe el
  // worker; puede venir como color (#E4572E, "red") o como nombre de zona.
  zona_color?: string | null;
  // Moneda del precio CRUDO. El portal es siempre EUR; una propia, la que
  // eligió el admin al cargarla.
  moneda_final?: string | null;
  // Los completa normalizarPrecios() antes de que la fila llegue a la tienda:
  // en qué moneda se le cobra al cliente (precio_final ya queda en esa moneda)
  // y su valor aproximado en dólares, solo para comparar y ordenar.
  moneda_venta?: MonedaVenta;
  precio_cmp?: number | null;
};

export type TicketFull = Ticket & {
  // A quién se la compramos. Junto con precio_costo y precio_final da el
  // margen real por entrada.
  proveedor?: string | null;
  moneda_origen: string;
  disponible: boolean;
  url_origen: string | null;
  scraped_at: string;
  updated_at: string;
};

export type SyncRun = {
  id: number;
  status: string;
  reason: string | null;
  scraped_valid: number | null;
  upserted: number | null;
  marked_unavailable: number | null;
  complete: boolean | null;
  duration_ms: number | null;
  created_at: string;
};

// Un sector se puede comprar cuando tiene cupo, está reservable y tiene
// precio. El mismo criterio que usa la fila de la tienda para decidir si
// muestra "Agregar" o "Consultar".
export function comprable(u: {
  stock: number | null;
  estado: TicketEstado;
  precio_final: number | null;
}): boolean {
  return (u.stock ?? 0) > 0 && u.estado === "book" && Number(u.precio_final ?? 0) > 0;
}

// Evento agrupado (varias ubicaciones/sectores del mismo partido).
export type EventoAgrupado = {
  evento: string;
  comp: string;
  ciudad: string | null;
  fecha: string | null;
  lugar: string;
  mes: string;
  mesLabel: string;
  bookable: number;
  bookStock: number;
  propias: boolean;
  minPrice: number | null;
  // Moneda de minPrice: un evento puede tener sectores en pesos y en dólares.
  minMoneda: MonedaVenta;
  // Mapa de sectores del evento (primera imagen no nula entre los sectores).
  imagen: string | null;
  ubicaciones: Ticket[];
};

// ---- moneda -----------------------------------------------------------------
// Regla única de moneda (la usan la tienda, el carrito, la búsqueda del panel
// y el endpoint de pedidos, así que nunca muestran ni cobran cosas distintas):
//
// - Una entrada PROPIA cargada en PESOS se muestra y se cobra en PESOS. La
//   operación queda en ARS y el cliente debe pesos.
// - Todo lo demás se cobra en DÓLARES: el portal Passion (que viene en euros) y
//   las propias cargadas en dólares (o en euros, de antes de que se sacara la
//   opción: ya no se pueden cargar). Los euros se pasan a dólares
//   con la cotización del panel (config.eur_usd).
//
// La cotización dólar-peso (config.ars_por_usd) NO se usa para cobrar: solo
// para comparar precios en pesos con precios en dólares (el "desde" de un
// evento y el orden de sus sectores). Este default solo cubre el caso de no
// poder leer la cotización del euro.
export const DEFAULT_EUR_USD = 1.08;

export type MonedaVenta = "ARS" | "USD";

export type Tasas = {
  eurUsd: number;
  // Pesos por dólar. Solo para comparar; null = no cargada.
  arsPorUsd?: number | null;
};

function tasasDe(t: number | Tasas): Tasas {
  return typeof t === "number" ? { eurUsd: t } : t;
}

/** En qué moneda se le cobra al cliente esta entrada. */
export function monedaDeVenta(
  source: TicketSource,
  moneda: string | null | undefined
): MonedaVenta {
  return source === "manual" && (moneda ?? "").toUpperCase() === "ARS" ? "ARS" : "USD";
}

/**
 * Por cuánto multiplicar un monto crudo de la fila para tenerlo en su moneda
 * de venta. Pesos quedan como están; dólares también; euros (portal o propias)
 * se pasan a dólares.
 */
export function factorAVenta(
  source: TicketSource,
  moneda: string | null | undefined,
  tasas: number | Tasas
): number {
  if (monedaDeVenta(source, moneda) === "ARS") return 1;
  const eur = tasasDe(tasas).eurUsd > 0 ? tasasDe(tasas).eurUsd : DEFAULT_EUR_USD;
  if (source === "portal") return eur;
  return (moneda ?? "USD").toUpperCase() === "EUR" ? eur : 1;
}

/** Valor aproximado en dólares, para comparar. null si es en pesos y no hay cotización. */
export function valorComparableUsd(
  precioVenta: number | null,
  moneda: MonedaVenta,
  tasas: number | Tasas
): number | null {
  if (precioVenta == null || !Number.isFinite(precioVenta)) return null;
  if (moneda === "USD") return precioVenta;
  const ars = tasasDe(tasas).arsPorUsd;
  return ars != null && ars > 0 ? precioVenta / ars : null;
}

/**
 * Deja el catálogo listo para la tienda: precio_final en su moneda de venta,
 * con la moneda y el valor comparable al lado. La tienda no vuelve a convertir.
 */
export function normalizarPrecios<
  T extends { precio_final: number | null; source: TicketSource; moneda_final?: string | null }
>(rows: T[], tasas: number | Tasas): (T & { moneda_venta: MonedaVenta; precio_cmp: number | null })[] {
  return rows.map((t) => {
    const moneda_venta = monedaDeVenta(t.source, t.moneda_final);
    const precio =
      t.precio_final == null ? null : t.precio_final * factorAVenta(t.source, t.moneda_final, tasas);
    return {
      ...t,
      precio_final: precio,
      moneda_venta,
      precio_cmp: valorComparableUsd(precio, moneda_venta, tasas),
    };
  });
}

// Formatea un monto que YA está en su moneda de venta (ver normalizarPrecios).
// El agrupado de miles sigue el idioma de la tienda (en: 1,234 / es: 1.234).
export function fmtPrice(
  monto: number | null,
  lang: Lang = "en",
  moneda: MonedaVenta = "USD"
): string | null {
  if (monto == null) return null;
  return (
    (moneda === "ARS" ? "$ " : "US$ ") +
    new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(Math.round(monto))
  );
}

// Día calendario de HOY en Argentina (en-CA da formato YYYY-MM-DD).
// Se usa el día local del negocio, no el UTC: con UTC, a partir de las 21:00
// de Argentina "hoy" ya era mañana y los eventos de esa misma noche
// desaparecían de la tienda horas antes de empezar.
export function hoyArgentina(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

// Evento ya pasado: su día es anterior a hoy (hora argentina). Los sin fecha
// y los del día no. La fecha guardada es el día del evento en UTC.
export function eventoPasado(fecha: string | null, hoy: string = hoyArgentina()): boolean {
  return !!fecha && fecha.slice(0, 10) < hoy;
}

// Eventos ya pasados: afuera de la tienda.
export function sinEventosPasados<T extends { fecha: string | null }>(rows: T[]): T[] {
  const hoy = hoyArgentina();
  return rows.filter((t) => !eventoPasado(t.fecha, hoy));
}

// ---- fechas / texto -----------------------------------------------------------
export function fmtDate(iso: string | null, lang: Lang = "en") {
  if (!iso) return { d: "—", m: "", y: "", full: TX[lang].fechaTBC };
  const dt = new Date(iso);
  const locale = LOCALE[lang];
  // SIEMPRE en UTC: la columna es timestamptz y el día del evento viene
  // codificado como día UTC (el worker guarda mediodía UTC; las entradas
  // propias, medianoche UTC del date elegido). Formatear en hora argentina
  // corría las de medianoche al día ANTERIOR (una entrada cargada para el
  // 15/07 mostraba "14 JUL"), y desalineaba la card del filtro de mes, que
  // ya agrupaba en UTC.
  const timeZone = "UTC";
  return {
    d: dt.toLocaleDateString(locale, { day: "2-digit", timeZone }),
    m: dt.toLocaleDateString(locale, { month: "short", timeZone }).replace(".", "").toUpperCase(),
    y: dt.toLocaleDateString(locale, { year: "numeric", timeZone }),
    // Primera letra en mayúscula: es-AR devuelve "sábado, 18 de julio…".
    full: capitalizar(
      dt.toLocaleDateString(locale, {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone,
      })
    ),
  };
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Match 12, Group A - Argentina vs Chile" -> título + contexto.
export function parseTitle(evento: string, comp: string | null) {
  const s = String(evento || "").replace(/^match\s+\d+\s*[,-]\s*/i, "").trim();
  const segs = s.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  if (segs.length <= 1) return { title: s || evento, context: "" };
  const title = segs[segs.length - 1];
  let context = segs.slice(0, -1).join(" · ");
  if (comp) context = context.replace(comp, "").replace(/^[\s·]+|[\s·]+$/g, "");
  return { title, context };
}

export const isWC = (comp: string | null) => /world cup/i.test(comp || "");

export function lugarDe(ciudad: string | null): string {
  if (!ciudad) return "Sin sede";
  const m = ciudad.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1].trim();
  return ciudad.split(",")[0].trim();
}

export const mesKey = (iso: string | null) => (iso ? iso.slice(0, 7) : "0000-00");
export const mesLabel = (iso: string | null) =>
  iso
    ? new Date(iso)
        // UTC: las fechas sin hora se parsean como medianoche UTC y en
        // Argentina (UTC-3) el mes podría retroceder en el día 1.
        .toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" })
        .replace(/^\w/, (c) => c.toUpperCase())
    : "A confirmar";

// ---- WhatsApp -----------------------------------------------------------------
// Número de WhatsApp de la tienda. Sale de NEXT_PUBLIC_WHATSAPP si está
// definida; si no, el de siempre. Antes este link no tenía default y en
// producción (donde la variable no está cargada) abría WhatsApp SIN
// destinatario: el botón "Buscá un evento puntual", el flotante y el de
// "Consultar" quedaban vacíos.
export const WHATSAPP_TIENDA =
  (process.env.NEXT_PUBLIC_WHATSAPP || "").replace(/\D/g, "") || "5491136148053";

export function waLink(text: string, telefono: string = WHATSAPP_TIENDA): string {
  return `https://wa.me/${telefono}?text=${encodeURIComponent(text)}`;
}

// El mapa de sectores termina en un <img src>. Solo se aceptan esquemas
// seguros: http(s) y data:image (el catálogo demo usa un SVG inline). Cualquier
// otro (javascript:, etc.) se descarta en vez de renderizarse.
// Mapa de una entrada PROPIA: solo se acepta uno subido por el panel a
// nuestro bucket `mapas` (o una data URL en el modo demo). Una URL externa
// cualquiera dejaría que el panel publique imágenes de terceros en la tienda.
export function mapaPropioValido(url: string | null | undefined, demo = false): string | null {
  const s = imagenSegura(url);
  if (!s) return null;
  if (demo && s.startsWith("data:image/")) return s;
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/mapas\//i.test(s) ? s : null;
}

export function imagenSegura(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s)) return s;
  return null;
}

// ---- agrupado por evento --------------------------------------------------------
// Para ordenar sectores con monedas distintas: el valor en dólares si se
// puede calcular. Un precio en pesos sin cotización va después de los que se
// pueden comparar (entre ellos, por su monto), y sin precio al final.
function valorDeOrden(u: Ticket): number {
  if (u.precio_cmp != null) return u.precio_cmp;
  if ((u.moneda_venta ?? "USD") === "USD" && u.precio_final != null) return Number(u.precio_final);
  if (u.precio_final != null) return 1e12 + Number(u.precio_final);
  return Infinity;
}

function masBarato(arr: Ticket[]): Ticket | null {
  if (arr.length === 0) return null;
  return [...arr].sort((a, b) => valorDeOrden(a) - valorDeOrden(b))[0];
}

export function buildEvents(rows: Ticket[]): EventoAgrupado[] {
  const map = new Map<string, EventoAgrupado>();
  for (const r of rows) {
    const key = `${r.competicion}__${r.evento}`;
    if (!map.has(key)) {
      map.set(key, {
        evento: r.evento,
        comp: r.competicion || "Otros",
        ciudad: r.ciudad,
        fecha: r.fecha,
        lugar: "",
        mes: "",
        mesLabel: "",
        bookable: 0,
        bookStock: 0,
        propias: false,
        minPrice: null,
        minMoneda: "USD",
        imagen: null,
        ubicaciones: [],
      });
    }
    const ev = map.get(key)!;
    ev.ubicaciones.push(r);
    if (!ev.fecha && r.fecha) ev.fecha = r.fecha;
    if (!ev.ciudad && r.ciudad) ev.ciudad = r.ciudad;
  }
  const evs = Array.from(map.values());
  for (const ev of evs) {
    ev.lugar = lugarDe(ev.ciudad);
    ev.mes = mesKey(ev.fecha);
    ev.mesLabel = mesLabel(ev.fecha);
    // Mismo criterio que la fila (LadderRow): reservable = stock + book +
    // precio real. Sin exigir precio, la card decía "Reservá ya" pero al
    // desplegar no había ningún botón Reservar.
    const book = ev.ubicaciones.filter(
      (u) =>
        (u.stock ?? 0) > 0 &&
        u.estado === "book" &&
        u.precio_final != null &&
        Number(u.precio_final) > 0
    );
    ev.bookable = book.length;
    ev.bookStock = book.reduce((a, u) => a + (u.stock ?? 0), 0);
    ev.propias = ev.ubicaciones.some((u) => u.source === "manual");
    // Primer mapa USABLE: se filtra antes de elegir, no después. Si se eligiera
    // primero y se filtrara al final, un sector con una URL inválida dejaría al
    // evento sin mapa aunque otro sector tenga uno bueno.
    ev.imagen =
      ev.ubicaciones.map((u) => imagenSegura(u.imagen_url)).find((src) => src != null) ?? null;
    // "desde": el sector más barato, comparando pesos con dólares por su valor
    // en dólares. Prioriza lo reservable. Se muestra en SU moneda.
    const candidatos = (arr: Ticket[]) =>
      arr.filter((u) => Number.isFinite(Number(u.precio_final)) && Number(u.precio_final) > 0);
    const reservables = candidatos(
      ev.ubicaciones.filter((u) => (u.stock ?? 0) > 0 && u.estado === "book")
    );
    const elegido = masBarato(reservables.length ? reservables : candidatos(ev.ubicaciones));
    ev.minPrice = elegido ? Number(elegido.precio_final) : null;
    ev.minMoneda = elegido?.moneda_venta ?? "USD";
    // Primero lo que se puede comprar, después lo que hay que consultar: el
    // que entra a la tarjeta quiere ver qué hay disponible, no arrancar por
    // los sectores sin cupo. Dentro de cada grupo, del más barato al más caro.
    ev.ubicaciones.sort((a, b) => {
      const ca = comprable(a) ? 0 : 1;
      const cb = comprable(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return valorDeOrden(a) - valorDeOrden(b);
    });
  }
  return evs;
}


// La zona del mapa puede llegar como color (#E4572E, "red") o como nombre
// ("Zona Roja"). Si es un color se puede pintar una muestra; si no, se
// muestra el texto tal cual. Se resuelve acá y no en el componente para no
// tener que adivinar el formato en cada lugar que la use.
// Los que concuerdan en género van en las dos formas: la zona es femenina
// ("Zona Roja") y el sector masculino ("Sector Rojo"), y con una sola de las
// dos la mitad de los casos quedaba sin pintar.
const COLORES_CSS = [
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown",
  "black", "white", "grey", "gray", "cyan", "magenta", "violet", "gold",
  "rojo", "roja", "azul", "verde", "amarillo", "amarilla", "naranja",
  "violeta", "blanco", "blanca", "negro", "negra", "gris", "dorado", "dorada",
  "rosa", "marron", "celeste",
];

// El worker puede mandar el color en castellano; CSS solo entiende inglés.
const ES_A_CSS: Record<string, string> = {
  rojo: "red", roja: "red", azul: "blue", verde: "green",
  amarillo: "yellow", amarilla: "yellow", naranja: "orange", violeta: "violet",
  blanco: "white", blanca: "white", negro: "black", negra: "black",
  gris: "gray", dorado: "gold", dorada: "gold", rosa: "pink",
  marron: "brown", celeste: "skyblue",
};
const colorCss = (c: string) => ES_A_CSS[c] ?? c;

export type ZonaMapa = {
  // Etiqueta legible de la zona ("Zona Azul"). null cuando el portal mandó
  // SOLO un color en hexadecimal: "#E4572E" no le dice nada a nadie, con ver
  // el círculo del color y buscarlo en el mapa alcanza.
  texto: string | null;
  color: string | null;
  // El valor tal como vino, para el title/aria-label: aunque no se muestre,
  // no se pierde.
  crudo: string;
};

export function zonaDelMapa(valor: string | null | undefined): ZonaMapa | null {
  const v = String(valor ?? "").trim();
  if (!v) return null;
  // Hexa puro: solo color, sin texto.
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) {
    return { texto: null, color: v, crudo: v.toUpperCase() };
  }
  const lower = v.toLowerCase();
  // Un color con nombre ("verde", "red") SÍ se muestra: es legible.
  if (COLORES_CSS.includes(lower)) return { texto: v, color: colorCss(lower), crudo: v };
  // Nombre con el color adentro ("Zona Roja", "Sector Azul"): se pinta igual.
  const encontrado = COLORES_CSS.find((c) => lower.includes(c));
  return { texto: v, color: encontrado ? colorCss(encontrado) : null, crudo: v };
}
