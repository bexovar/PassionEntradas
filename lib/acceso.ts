// Dominio de las solicitudes de acceso a la tienda (landing pública →
// aprobación del admin → usuario cliente). Sin dependencias de servidor:
// tipos, validación y generación/armado de credenciales.

import { validarCuit } from "@/lib/cuit";

export type EstadoSolicitud = "pendiente" | "aprobada" | "rechazada";

export type SolicitudAcceso = {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  // CUIT validado ("20-12345678-6") en las solicitudes desde TKT-11; en las
  // anteriores, el legajo/CUIL/CUIT en texto libre. Reemplazó a `direccion`,
  // que queda solo en las solicitudes más viejas.
  legajo: string | null;
  // Organización (TKT-11). null en las solicitudes anteriores.
  tipo_organizacion: TipoOrganizacion | null;
  organizacion: string | null;
  direccion: string | null;
  // "¿Buscás algo en particular?": salió del formulario con TKT-11; queda en
  // las solicitudes viejas.
  mensaje: string | null;
  estado: EstadoSolicitud;
  user_id: string | null;
  decidida_por: string | null;
  decidida_at: string | null;
  // Revocación (sub-estado de 'aprobada'): si revocada_at está seteado, el
  // cliente perdió el acceso hasta que se reactive.
  revocada_at: string | null;
  revocada_por: string | null;
  // Consentimiento de términos aceptado al solicitar (created_at = momento).
  acepto_terminos: boolean;
  created_at: string;
  updated_at: string;
  // Lo completa la página de Accesos (no es columna): si el usuario de esta
  // solicitud hoy es parte del equipo. Esas filas no se gestionan desde acá.
  equipo?: "administrador" | "moderador" | null;
};

// Tipo de organización del que pide acceso (TKT-11): lista cerrada para poder
// segmentar después. "otro" cubre las bocas de venta que no entran en las
// demás (tanguerías, restaurantes, lugares que venden a turistas).
export const TIPOS_ORGANIZACION = ["agencia", "operador", "freelance", "hoteleria", "otro"] as const;
export type TipoOrganizacion = (typeof TIPOS_ORGANIZACION)[number];

export const MAX_ORGANIZACION = 120;

// Cómo se lee cada tipo en el panel y en los avisos al equipo (en la landing
// van traducidos, ver tienda-i18n).
export const ETIQUETA_TIPO_ORGANIZACION: Record<TipoOrganizacion, string> = {
  agencia: "Agencia de viajes",
  operador: "Operador",
  freelance: "Freelance",
  hoteleria: "Hotelería",
  otro: "Otro",
};

/** "Viajes del Sur (Agencia de viajes)", o null si la solicitud es anterior a TKT-11. */
export function organizacionLegible(s: {
  tipo_organizacion?: TipoOrganizacion | null;
  organizacion?: string | null;
}): string | null {
  if (!s.organizacion) return null;
  return s.tipo_organizacion ? `${s.organizacion} (${ETIQUETA_TIPO_ORGANIZACION[s.tipo_organizacion]})` : s.organizacion;
}

// Lo que entra desde el formulario público, ya saneado. Todo es obligatorio.
// `cuit` es CUIT o CUIL (mismo formato y verificador). Viaja con guiones ("20-12345678-6") y se guarda en la columna
// `legajo`, que es la que llega a la cuenta y a la factura.
export type SolicitudInput = {
  tipoOrganizacion: TipoOrganizacion;
  organizacion: string;
  nombre: string;
  email: string;
  telefono: string;
  cuit: string;
  // Consentimiento de términos y condiciones (obligatorio para solicitar).
  acepto: boolean;
};

// Qué campo falló: la landing lo traduce y lo marca en el campo. `error` es
// el mismo mensaje en español, que es lo que devuelve la API.
export type CodigoErrorSolicitud =
  | "tipo"
  | "organizacion"
  | "nombre"
  | "email"
  | "telefono"
  | "cuit_formato"
  | "cuit_invalido"
  | "acepto";

export const ERRORES_SOLICITUD: Record<CodigoErrorSolicitud, string> = {
  tipo: "Elegí el tipo de organización",
  organizacion: "Ingresá el nombre de la organización",
  nombre: "Ingresá tu nombre",
  email: "Ingresá un email válido",
  telefono: "Ingresá un teléfono válido",
  cuit_formato: "Ingresá tu CUIT o CUIL: 11 números, con o sin guiones (ej. 20-12345678-6)",
  cuit_invalido: "Ese CUIT o CUIL no es válido. Revisá los números (ej. 20-12345678-6)",
  acepto: "Tenés que aceptar los términos y condiciones para continuar",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const esTipo = (v: unknown): v is TipoOrganizacion =>
  typeof v === "string" && (TIPOS_ORGANIZACION as readonly string[]).includes(v);

// Valida y normaliza el input del formulario. Devuelve el error del PRIMER
// campo inválido, en el orden del formulario (mismo criterio en la landing y
// en la API).
export function validarSolicitud(raw: {
  tipoOrganizacion?: unknown;
  organizacion?: unknown;
  nombre?: unknown;
  email?: unknown;
  telefono?: unknown;
  cuit?: unknown;
  acepto?: unknown;
}):
  | { ok: true; value: SolicitudInput }
  | { ok: false; error: string; codigo: CodigoErrorSolicitud } {
  const falla = (codigo: CodigoErrorSolicitud) => ({ ok: false as const, error: ERRORES_SOLICITUD[codigo], codigo });

  const organizacion = String(raw.organizacion ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ORGANIZACION);
  const nombre = String(raw.nombre ?? "").trim().slice(0, 120);
  const email = String(raw.email ?? "").trim().toLowerCase().slice(0, 160);
  const telefono = String(raw.telefono ?? "").trim().slice(0, 40);
  const acepto = raw.acepto === true;

  if (!esTipo(raw.tipoOrganizacion)) return falla("tipo");
  if (organizacion.length < 2) return falla("organizacion");
  if (nombre.length < 2) return falla("nombre");
  if (!EMAIL_RE.test(email)) return falla("email");
  if (telefono.length < 6) return falla("telefono");
  const cuit = validarCuit(raw.cuit);
  if (!cuit.ok) return falla(cuit.motivo === "formato" ? "cuit_formato" : "cuit_invalido");
  // El consentimiento es obligatorio: sin aceptar los términos no hay solicitud.
  if (!acepto) return falla("acepto");
  return {
    ok: true,
    value: { tipoOrganizacion: raw.tipoOrganizacion, organizacion, nombre, email, telefono, cuit: cuit.cuit, acepto },
  };
}

// --- límite de solicitudes ----------------------------------------------------
// El formulario es público y cada solicitud nueva le manda un WhatsApp y un
// email a todo el equipo: sin límite, cualquiera lo usa para spamear (y para
// meterle texto propio al staff). Dos topes, en la última hora:
//   - por IP: pasado el tope se finge éxito, igual que el honeypot, para no
//     darle señal al que abusa;
//   - en total: pasado el tope las solicitudes se siguen guardando y se ven
//     en la campana del panel, pero ya no salen WhatsApp ni email.
export const SOL_VENTANA_MS = 60 * 60 * 1000;
export const SOL_MAX_POR_IP = 3;
export const SOL_AVISOS_POR_HORA = 10;

export function evaluarLimiteSolicitud(c: { deEstaIp: number; total: number }): {
  aceptar: boolean;
  avisarAfuera: boolean;
} {
  return { aceptar: c.deEstaIp < SOL_MAX_POR_IP, avisarAfuera: c.total < SOL_AVISOS_POR_HORA };
}

// IP del visitante según el proxy (Vercel pone la real primero en
// x-forwarded-for). null si no viene: entonces no hay tope por IP.
export function ipDe(headers: Pick<Headers, "get">): string | null {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || headers.get("x-real-ip")?.trim() || null;
}

// Contraseña legible pero fuerte: 4 bloques de 3 (sin caracteres ambiguos).
// Por defecto usa Math.random; en el server conviene pasar una fuente basada
// en crypto (ver generarPasswordSegura en la API).
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generarPassword(getRandom: () => number = Math.random): string {
  const bloque = () =>
    Array.from({ length: 3 }, () => ALFABETO[Math.floor(getRandom() * ALFABETO.length)]).join("");
  return `${bloque()}-${bloque()}-${bloque()}-${bloque()}`;
}

// Mensaje listo para pegar en WhatsApp/mail con las credenciales nuevas.
export function mensajeCredenciales(opts: {
  nombre: string;
  email: string;
  password: string;
  urlIngreso: string;
}): string {
  const { nombre, email, password, urlIngreso } = opts;
  return [
    `Hola ${nombre}! Tu acceso a TicketMirror ya está listo.`,
    ``,
    `Entrá acá: ${urlIngreso}`,
    `Usuario: ${email}`,
    `Contraseña: ${password}`,
    ``,
    `Vas a poder ver todas las entradas disponibles. Cualquier consulta, respondé por acá.`,
  ].join("\n");
}
