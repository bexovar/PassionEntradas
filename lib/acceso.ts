// Dominio de las solicitudes de acceso a la tienda (landing pública →
// aprobación del admin → usuario cliente). Sin dependencias de servidor:
// tipos, validación y generación/armado de credenciales.

export type EstadoSolicitud = "pendiente" | "aprobada" | "rechazada";

export type SolicitudAcceso = {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  // Dato fiscal/identificatorio del agente. Reemplaza a `direccion` en el
  // formulario; `direccion` queda solo en las solicitudes viejas.
  legajo: string | null;
  direccion: string | null;
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

// Lo que entra desde el formulario público, ya saneado. Nombre, email,
// teléfono y legajo son obligatorios; el mensaje es lo único opcional.
export type SolicitudInput = {
  nombre: string;
  email: string;
  telefono: string;
  legajo: string;
  mensaje: string | null;
  // Consentimiento de términos y condiciones (obligatorio para solicitar).
  acepto: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Valida y normaliza el input del formulario. Devuelve el error del PRIMER
// campo inválido (mismo criterio en la landing y en la API).
export function validarSolicitud(raw: {
  nombre?: unknown;
  email?: unknown;
  telefono?: unknown;
  legajo?: unknown;
  mensaje?: unknown;
  acepto?: unknown;
}): { ok: true; value: SolicitudInput } | { ok: false; error: string } {
  const nombre = String(raw.nombre ?? "").trim().slice(0, 120);
  const email = String(raw.email ?? "").trim().toLowerCase().slice(0, 160);
  const telefono = String(raw.telefono ?? "").trim().slice(0, 40);
  // Texto libre: un CUIT/CUIL puede venir con guiones o sin ellos, y "legajo"
  // depende de cada empresa. Se valida que haya algo razonable, no el formato.
  const legajo = String(raw.legajo ?? "").trim().slice(0, 40);
  const mensaje = String(raw.mensaje ?? "").trim().slice(0, 1000) || null;
  const acepto = raw.acepto === true;

  if (nombre.length < 2) return { ok: false, error: "Ingresá tu nombre" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Ingresá un email válido" };
  if (telefono.length < 6) return { ok: false, error: "Ingresá un teléfono válido" };
  if (legajo.length < 4) return { ok: false, error: "Ingresá tu legajo, CUIL o CUIT" };
  // El consentimiento es obligatorio: sin aceptar los términos no hay solicitud.
  if (!acepto)
    return { ok: false, error: "Tenés que aceptar los términos y condiciones para continuar" };
  return { ok: true, value: { nombre, email, telefono, legajo, mensaje, acepto } };
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
