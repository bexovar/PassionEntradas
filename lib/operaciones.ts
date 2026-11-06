// Lógica de dominio de las operaciones: tipos, estado derivado, etiquetas
// para la UI, colores por estado y helpers (code, WhatsApp).
//
// Modelo: "entrada recibida" y "pago confirmado" son hitos INDEPENDIENTES
// (timestamps nullable); cada uno se marca/desmarca por separado. La
// operación está confirmada cuando están los dos. El enum `status` de la
// base solo se usa para cancelada / reabrir.

export type Status =
  | "esperando_entrada"
  | "entrada_recibida"
  | "confirmada"
  | "cancelada";

// Origen de la operación: carga interna del staff, o pedido/consulta hecho por
// un cliente desde la tienda sobre una entrada del catálogo.
//
// La app maneja DOS monedas: pesos y dólares. El euro existe solo como moneda
// de ORIGEN de los precios de Passion, que se pasan a dólares al publicarlos
// (ver factorAVenta en lib/tickets.ts): nunca se cobra, se factura ni se
// muestra en euros.
export type Moneda = "ARS" | "USD";
export const MONEDAS: Moneda[] = ["ARS", "USD"];

// Símbolo/prefijo por moneda para mostrar montos sin ambigüedad.
export const MONEDA_LABEL: Record<Moneda, string> = {
  ARS: "$",
  USD: "US$",
};

export const MONEDA_NOMBRE: Record<Moneda, string> = {
  ARS: "Pesos (ARS)",
  USD: "Dólares (USD)",
};

/**
 * Moneda que llega en un body. Sin valor: USD (el default histórico). Con un
 * valor que no es pesos ni dólares (ej. "EUR"): null, y la API responde 400 en
 * vez de guardarlo en otra moneda sin avisar.
 */
export function parseMoneda(raw: unknown): Moneda | null {
  if (raw == null || raw === "") return "USD";
  const u = String(raw).trim().toUpperCase();
  return u === "ARS" || u === "USD" ? u : null;
}

export const ERROR_MONEDA = "Moneda inválida: solo pesos (ARS) o dólares (USD)";

export type TipoOperacion = "operacion" | "pedido" | "consulta";

export type Operacion = {
  id: string;
  code: string;
  evento: string;
  comprador_alias: string | null;
  vendedor_alias: string | null;
  // Total de la línea (precio unitario × cantidad). El unitario se deriva
  // como monto / cantidad.
  monto: number;
  // Moneda de la operación. No se convierte: se muestra en la suya.
  moneda: Moneda;
  // Cantidad de entradas del sector (>= 1). Topeada por el stock en la tienda.
  cantidad: number;
  fee: number;
  // Cuenta (alias/CBU) de la que se debita la plata. Dato interno del
  // panel — nunca se muestra en el link público.
  cuenta_debitar: string | null;
  status: Status;
  entrada_recibida_at: string | null;
  pago_confirmado_at: string | null;
  // Hito interno: se le pagó al proveedor. Nunca se muestra en el ticket.
  pago_proveedor_at: string | null;
  // Cierre explícito: con los dos hitos listos, el admin cierra la operación.
  cerrada_at: string | null;
  // Auditoría: email del admin que marcó cada paso (se limpia al desmarcar).
  // Dato interno del panel — nunca va al link público.
  entrada_recibida_por: string | null;
  pago_confirmado_por: string | null;
  pago_proveedor_por: string | null;
  cerrada_por: string | null;
  // Fecha del evento (date, sin hora): prioriza lo urgente en el panel.
  fecha_evento: string | null;
  // Notas internas del panel. NUNCA se exponen en la vista pública.
  notas: string | null;
  // Entrada del catálogo de la tienda que originó la operación (opcional).
  ticket_id: string | null;
  // Origen: 'operacion' (staff) | 'pedido' | 'consulta' (cliente en la tienda).
  tipo: TipoOperacion;
  // Cliente que originó el pedido/consulta (null en cargas internas del staff).
  cliente_id: string | null;
  cliente_email: string | null;
  // Sector/categoría de la entrada pedida, tal como se ve en la tienda.
  sector: string | null;
  // Confirmación del pedido por un admin. Solo los pedidos de la tienda pasan
  // por este paso (ver `necesitaConfirmar`); null = "Nuevo".
  confirmada_at?: string | null;
  confirmada_por?: string | null;
  // Quién y cuándo canceló: 'cliente' o el nombre del admin. Reabrir limpia.
  cancelada_at?: string | null;
  cancelada_por?: string | null;
  created_at: string;
  updated_at: string;
  // Idioma en que el cliente hizo el pedido (sus emails van en ese idioma).
  idioma?: "es" | "en" | null;
};

// Etiquetas del origen para el panel.
export const TIPO_LABEL: Record<TipoOperacion, string> = {
  operacion: "Operación",
  pedido: "Pedido",
  consulta: "Consulta",
};

// Vista pública: subconjunto seguro de campos (sin datos de contacto, sin la
// comisión y sin importes: el monto es lo que la agencia nos paga y el link
// lo ve su pasajero — TKT-24, migración 0053).
export type OperacionPublica = Pick<
  Operacion,
  | "code"
  | "evento"
  | "comprador_alias"
  | "vendedor_alias"
  // El comprador tiene que ver en qué moneda está su operación.
  | "moneda"
  | "status"
  | "entrada_recibida_at"
  | "pago_confirmado_at"
  | "cerrada_at"
  | "fecha_evento"
  | "updated_at"
> & {
  // Para mostrar el paso "Pedido confirmado" (solo los pedidos lo esperan).
  tipo?: TipoOperacion | null;
  confirmada_at?: string | null;
};

// Estado visible, derivado de cancelada + los hitos + el cierre.
export type Estado =
  | "esperando"
  | "entrada_recibida"
  | "pago_confirmado"
  | "lista_para_cerrar"
  | "cerrada"
  | "cancelada";

type Hitos = Pick<
  Operacion,
  | "status"
  | "entrada_recibida_at"
  | "pago_confirmado_at"
  | "pago_proveedor_at"
  | "cerrada_at"
>;

// Los hitos ya NO tienen orden: pueden marcarse en cualquier secuencia. El
// estado es una lectura de cuántos están hechos, no una posición en una fila.
//
// CERRADA son los CUATRO hechos, no solo la entrega. `cerrada_at` es el hito
// "entrada entregada"; tomarlo como el fin de la operación hacía que marcar la
// entrega congelara los otros tres, y quedaban para siempre sin tildar cosas
// que sí pasaron (típico: se entregó antes de pagarle al proveedor).
export function estadoDe(op: Hitos): Estado {
  if (op.status === "cancelada") return "cancelada";
  const entrada = !!op.entrada_recibida_at;
  const pago = !!op.pago_confirmado_at;
  const proveedor = !!op.pago_proveedor_at;
  const entregada = !!op.cerrada_at;
  const hechos = [entrada, pago, proveedor, entregada].filter(Boolean).length;

  if (hechos === 4) return "cerrada";
  // Falta uno solo: la operación está a un paso de terminar.
  if (hechos === 3) return "lista_para_cerrar";
  // Con alguno hecho, gana el que más habla del avance hacia la entrega:
  // tener la entrada en mano pesa más que haber cobrado.
  if (entrada) return "entrada_recibida";
  if (pago || proveedor || entregada) return "pago_confirmado";
  return "esperando";
}

/** Los cuatro hitos están hechos: la operación terminó y se congela. */
export function operacionCompleta(op: Hitos): boolean {
  return (
    !!op.entrada_recibida_at &&
    !!op.pago_confirmado_at &&
    !!op.pago_proveedor_at &&
    !!op.cerrada_at
  );
}

/** Lo que habilita la factura: el cliente pagó y ya tiene su entrada. */
export function sePuedeFacturar(op: Hitos): boolean {
  return op.status !== "cancelada" && !!op.pago_confirmado_at;
}

// --- vocabulario PÚBLICO --------------------------------------------------
// Lo que ve el comprador en su ticket es otra cosa que lo que ve el panel: de
// los cuatro hitos internos, dos (entrada recibida del proveedor y pago al
// proveedor) son asunto nuestro y no se muestran. Por eso es un tipo aparte y
// no una traducción de `Estado`: si fuera lo mismo con otras etiquetas, el día
// que se agregue un hito interno se filtraría solo al ticket.
// Lo que ve el cliente. `consulta_recibida` es el único que no sale de una
// operación: es una consulta todavía sin precio, que aún no nació como
// operación (ver `consultas`). Se expone igual para que el cliente vea que su
// pedido no se perdió mientras el staff le busca precio.
export type EstadoPublico =
  | "consulta_recibida"
  | "pedido_recibido"
  | "pedido_confirmado"
  | "listo_para_pagar"
  | "pago_recibido"
  | "entregada"
  | "cancelada";

type HitosPublicos = {
  status: Status;
  entrada_recibida_at?: string | null;
  pago_confirmado_at: string | null;
  cerrada_at: string | null;
  tipo?: TipoOperacion | null;
  confirmada_at?: string | null;
};

type ParaConfirmar = {
  status: Status;
  tipo?: TipoOperacion | null;
  confirmada_at?: string | null;
  entrada_recibida_at?: string | null;
  pago_confirmado_at?: string | null;
  cerrada_at?: string | null;
};

/**
 * Pedido de la tienda que todavía nadie confirmó ("Nuevo" en el panel). Las
 * operaciones del staff y las consultas cotizadas nacen confirmadas. Si ya
 * tiene algún hito, se trabajó: cuenta como confirmado aunque falte la marca.
 */
export function necesitaConfirmar(op: ParaConfirmar): boolean {
  return (
    op.tipo === "pedido" &&
    op.status !== "cancelada" &&
    !op.confirmada_at &&
    !op.entrada_recibida_at &&
    !op.pago_confirmado_at &&
    !op.cerrada_at
  );
}

// Pasos que ve el cliente, en orden: recibido → confirmado → listo para pagar
// (ya tenemos la entrada del proveedor) → pago recibido → entregada. El pago
// gana sobre "listo para pagar": a veces se cobra antes de tener la entrada.
export function estadoPublicoDe(op: HitosPublicos): EstadoPublico {
  if (op.status === "cancelada") return "cancelada";
  if (op.cerrada_at) return "entregada";
  if (op.pago_confirmado_at) return "pago_recibido";
  if (op.entrada_recibida_at) return "listo_para_pagar";
  if (necesitaConfirmar(op)) return "pedido_recibido";
  return "pedido_confirmado";
}

/** El cliente puede cancelar solo antes de que se le pida pagar (pasos 1–2). */
export function clientePuedeCancelar(op: HitosPublicos): boolean {
  const e = estadoPublicoDe(op);
  return e === "pedido_recibido" || e === "pedido_confirmado";
}

// Lo que ve el CLIENTE (link de seguimiento y Mis pedidos): 3 pasos, y cada
// uno cambia de nombre al completarse:
//   1. Recibido  -> Confirmado   (el admin confirma el pedido)
//   2. Para pagar -> Pagado      (con los datos de pago / WhatsApp)
//   3. Entregada                 (y con eso queda cerrada para el cliente)
// Los hitos internos (entrada del proveedor, pago al proveedor) no aparecen.
export type PasoCliente = {
  key: "pedido" | "pago" | "entrega";
  label: string;
  estado: "hecho" | "actual" | "pendiente";
};

const PASO_TXT = {
  es: { recibido: "Recibido", confirmado: "Confirmado", paraPagar: "Para pagar", pagado: "Pagado", entregada: "Entregada" },
  en: { recibido: "Received", confirmado: "Confirmed", paraPagar: "To pay", pagado: "Paid", entregada: "Delivered" },
} as const;

/** Los 3 pasos del cliente; null si no aplica (cancelada o consulta sin precio). */
export function pasosCliente(e: EstadoPublico, lang: "es" | "en" = "es"): PasoCliente[] | null {
  if (e === "cancelada" || e === "consulta_recibida") return null;
  const t = PASO_TXT[lang];
  const confirmado = e !== "pedido_recibido";
  const pagado = e === "pago_recibido" || e === "entregada";
  const entregada = e === "entregada";
  return [
    { key: "pedido", label: confirmado ? t.confirmado : t.recibido, estado: confirmado ? "hecho" : "actual" },
    {
      key: "pago",
      label: pagado ? t.pagado : t.paraPagar,
      estado: pagado ? "hecho" : e === "listo_para_pagar" ? "actual" : "pendiente",
    },
    {
      key: "entrega",
      label: t.entregada,
      estado: entregada ? "hecho" : e === "pago_recibido" ? "actual" : "pendiente",
    },
  ];
}

export const ESTADO_PUBLICO_LABEL: Record<EstadoPublico, string> = {
  consulta_recibida: "Consulta recibida",
  pedido_recibido: "Recibido",
  pedido_confirmado: "Confirmado",
  listo_para_pagar: "Para pagar",
  pago_recibido: "Pagado",
  entregada: "Entregada",
  cancelada: "Cancelada",
};

export const ESTADO_PUBLICO_COLOR: Record<EstadoPublico, string> = {
  consulta_recibida: "#5F6577",
  pedido_recibido: "#5F6577",
  pedido_confirmado: "#1F33E0",
  listo_para_pagar: "#B07A14",
  pago_recibido: "#6C5BF2",
  entregada: "#171B2B",
  cancelada: "#D14D68",
};

// --- semáforo -----------------------------------------------------------
// Verde: entregada. Rojo: sin entregar y el evento ya pasó o está encima.
// Amarillo: sin entregar, sin urgencia de fecha, con el pago hecho.
// Gris: el resto (y las canceladas, que quedan fuera del semáforo).
export type Semaforo = "verde" | "amarillo" | "rojo" | "gris";

// Días de antelación con los que una operación pasa a roja. Es lo único
// configurable del semáforo; 7 por defecto.
export const SEMAFORO_DIAS_AVISO = 7;

export function semaforoDe(
  op: Hitos & { fecha_evento: string | null },
  diasAviso: number = SEMAFORO_DIAS_AVISO
): Semaforo {
  if (op.status === "cancelada") return "gris";
  // Entregada gana siempre: una vez entregada no vuelve a ser urgente
  // aunque el evento ya haya pasado.
  if (op.cerrada_at) return "verde";
  const dias = diasHastaEvento(op.fecha_evento);
  // Sin fecha no hay contra qué medir la urgencia: nunca es roja.
  if (dias != null && dias <= diasAviso) return "rojo";
  if (op.pago_confirmado_at) return "amarillo";
  return "gris";
}

export const SEMAFORO_LABEL: Record<Semaforo, string> = {
  verde: "Entregada",
  amarillo: "Pago hecho, falta entregar",
  rojo: "Vencida o próxima a entregar",
  gris: "Sin novedad",
};

// Leyenda del panel: SOLO los tres estados que el semáforo comunica. El gris
// no está en la lista a propósito — no es un estado, es la ausencia de los
// otros tres ("todavía no pasó nada"), y ponerlo en la leyenda obligaba a
// explicar una cuarta cosa que no se acciona.
export const SEMAFORO_LEYENDA: Semaforo[] = ["verde", "amarillo", "rojo"];

export const SEMAFORO_COLOR: Record<Semaforo, string> = {
  verde: "#0D9377",
  amarillo: "#B07A14",
  rojo: "#D14D68",
  gris: "#98A0B3",
};

// Etiquetas del panel.
export const ESTADO_LABEL: Record<Estado, string> = {
  esperando: "En espera",
  entrada_recibida: "Entrada recibida",
  pago_confirmado: "Pago confirmado",
  lista_para_cerrar: "Falta un hito",
  cerrada: "Entregada",
  cancelada: "Cancelada",
};

// Etiquetas del link público, siguiendo la secuencia del proceso: con
// entrada y pago listos, el administrador está entregando las entradas
// al comprador; el cierre es la entrega hecha.
export const ESTADO_LABEL_PUBLICO: Record<Estado, string> = {
  ...ESTADO_LABEL,
  lista_para_cerrar: "En entrega",  // el cliente no ve los hitos internos
  cerrada: "Entradas entregadas",
};

// Colores por estado (NO semáforo). Se usan tanto en talón como en chips.
export const ESTADO_COLOR: Record<Estado, string> = {
  esperando: "#5F6577", // pizarra
  entrada_recibida: "#B07A14", // ámbar
  pago_confirmado: "#6C5BF2", // violeta marca
  lista_para_cerrar: "#0D9377", // verde-teal (todo listo, falta cerrar)
  cerrada: "#171B2B", // tinta: sello final, tipo "CANJEADO"
  cancelada: "#D14D68", // rosa
};

// Grupo de estado para leer de un vistazo (el punto de cada operación):
// ABIERTA (recién entra) · EN CURSO (con hitos, sin cerrar) · CERRADA ·
// CANCELADA. Los seis estados finos se agrupan en estos colores.
export type EstadoGrupo = "abierta" | "en_curso" | "cerrada" | "cancelada";

export function estadoGrupo(estado: Estado): EstadoGrupo {
  if (estado === "cancelada") return "cancelada";
  if (estado === "cerrada") return "cerrada";
  if (estado === "esperando") return "abierta";
  return "en_curso";
}

export const ESTADO_GRUPO_COLOR: Record<EstadoGrupo, string> = {
  abierta: "#E0A100", // amarillo: abierta, falta todo
  en_curso: "#1F33E0", // cobalto: en progreso
  cerrada: "#1F8A4C", // verde: cerrada / entregada
  cancelada: "#9AA0AE", // gris: cancelada
};

export const ESTADO_GRUPO_LABEL: Record<EstadoGrupo, string> = {
  abierta: "Abierta",
  en_curso: "En curso",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};

// Color del punto de la operación, según el grupo.
export function estadoDotColor(estado: Estado): string {
  return ESTADO_GRUPO_COLOR[estadoGrupo(estado)];
}

// Colores de cada hito individual (botones y pasos).
export const HITO_COLOR = {
  entrada: "#B07A14",
  pago: "#6C5BF2",
  listo: "#0D9377",
} as const;

// Acciones que acepta la API de estado.
export type StatusAction =
  | { action: "entrada"; done: boolean }
  | { action: "pago"; done: boolean }
  | { action: "proveedor"; done: boolean }
  | { action: "cerrar"; done: boolean }
  | { action: "confirmar" }
  | { action: "cancelar" }
  | { action: "reabrir" };

// Días que faltan hasta la fecha del evento (0 = hoy, negativo = ya pasó).
// null si la operación no tiene fecha cargada.
export function diasHastaEvento(fecha_evento: string | null): number | null {
  if (!fecha_evento) return null;
  const [y, m, d] = fecha_evento.split("-").map(Number);
  if (!y || !m || !d) return null;
  const evento = new Date(y, m - 1, d);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((evento.getTime() - hoy.getTime()) / 86_400_000);
}

// Fecha del evento formateada corta, ej "12 ago 2026".
export function formatFecha(fecha_evento: string): string {
  const [y, m, d] = fecha_evento.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Genera el code legible para el admin, ej "BX-7F3K9Q2M".
// Sin caracteres ambiguos (0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateCode(): string {
  let body = "";
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    body += CODE_ALPHABET[idx];
  }
  return `BX-${body}`;
}

// Nombre corto para mostrar quién hizo un paso. El registro guarda
// "Nombre Apellido" (si el usuario cargó sus datos) o el email como
// fallback; los emails se acortan ("kiru@adminticker.test" -> "kiru").
export function quienDe(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (!valor.includes("@")) return valor;
  return valor.split("@")[0] || valor;
}

// Formato de moneda USD sin decimales ("US$ 1.234"): las operaciones se
// manejan en dólares.
// Formatea en la moneda de la operación. ARS sin decimales (los centavos no
// existen en la práctica); USD con 2, que es lo contable.
export function formatMonto(
  n: number,
  moneda: Moneda = "USD",
  // Totales grandes (el tablero) se leen mejor sin centavos.
  opts: { sinDecimales?: boolean } = {}
): string {
  const dec = moneda === "ARS" || opts.sinDecimales ? 0 : 2;
  return (
    MONEDA_LABEL[moneda] +
    " " +
    new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(n)
  );
}

export function formatUSD(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// Mensaje de WhatsApp ya armado para pegar en el chat.
export function whatsappMessage(evento: string, link: string): string {
  return `Hola 👋 Soy del equipo de TicketMirror (${evento}). Seguí el estado de tu operación acá: ${link}. Se actualiza solo, no hace falta que preguntes.`;
}

// --- líneas de la operación --------------------------------------------------
// Un pedido del carrito es UNA operación con N líneas. La operación guarda un
// resumen (evento, sector, cantidad, monto) para que el panel y el ticket
// tengan encabezado sin leer las líneas; el detalle real vive acá.
export type OperacionItem = {
  id: string;
  operacion_id: string;
  ticket_id: string | null;
  evento: string;
  sector: string | null;
  fecha_evento: string | null;
  cantidad: number;
  precio_unitario: number;
  created_at: string;
};

// Total de una línea. La operación es la suma de todas.
export function totalItem(i: Pick<OperacionItem, "cantidad" | "precio_unitario">): number {
  return i.cantidad * i.precio_unitario;
}

// --- consultas ---------------------------------------------------------------
// Una consulta NO es una operación: es una entrada pedida sin precio cerrado.
// Cuando se arregla el precio, se convierte en operación y queda apuntando a
// ella por `operacion_id`.
// pendiente -> (staff cotiza) cotizada -> (cliente acepta) convertida
//                                       -> (cliente rechaza) rechazada
// "Vencida" no se guarda: es una cotizada con vence_at pasado (ver
// lib/cotizaciones.ts).
export type EstadoConsulta =
  | "pendiente"
  | "cotizada"
  | "convertida"
  | "descartada"
  | "cancelada"
  | "rechazada";

export type Consulta = {
  id: string;
  code: string;
  // Comparte valor con la operación creada en el mismo envío del carrito.
  envio_id: string | null;
  cliente_id: string | null;
  cliente_email: string | null;
  comprador_alias: string | null;
  ticket_id: string | null;
  evento: string;
  sector: string | null;
  fecha_evento: string | null;
  cantidad: number;
  // Moneda en que se cobraría la entrada consultada (pesos si es una propia
  // cargada en pesos, si no dólares). La cotización arranca en esa moneda.
  // null en consultas viejas o sin entrada vinculada.
  moneda?: Moneda | null;
  notas: string | null;
  estado: EstadoConsulta;
  // Cotización que se le mandó al cliente (estado cotizada). Re-cotizar sube
  // la versión: el cliente acepta la que vio.
  cotizacion_monto?: number | null;
  cotizacion_fee?: number | null;
  cotizacion_version?: number;
  cotizada_at?: string | null;
  cotizada_por?: string | null;
  cotizada_por_admin?: boolean;
  vence_at?: string | null;
  // Cómo se aceptó: 'web' (el cliente) o 'whatsapp' (lo registró el staff).
  aceptada_at?: string | null;
  aceptada_por?: string | null;
  aceptada_via?: "web" | "whatsapp" | null;
  operacion_id: string | null;
  resuelta_por: string | null;
  resuelta_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ESTADO_CONSULTA_LABEL: Record<EstadoConsulta, string> = {
  pendiente: "Pendiente",
  convertida: "Convertida en operación",
  descartada: "Descartada",
  cotizada: "Cotizada, esperando al cliente",
  cancelada: "Cancelada por el cliente",
  rechazada: "Rechazada por el cliente",
};

// Línea tal como la ve el comprador en el link público: sin ticket_id ni ids
// internos, que no le dicen nada y son del catálogo, y sin precio (TKT-24).
export type ItemPublico = {
  evento: string;
  sector: string | null;
  fecha_evento: string | null;
  cantidad: number;
};
