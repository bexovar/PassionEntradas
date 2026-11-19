// Lo que quedó esperando (decisión 7: nada se cancela solo, pasa a PRIORIDAD)
// y los avisos al equipo. Reglas puras: las usan el Panel (rojo y arriba) y
// /api/recordatorios (el WhatsApp de "esto lleva rato").
//
// Plazos (decisión 17): pedido sin confirmar 2 h, consulta sin cotizar 4 h.
// Además: cotización que vence en menos de 6 h y evento en menos de 48 h que
// todavía no se entregó.

import { diaAr } from "./metrics";
import { necesitaConfirmar, type Consulta, type Operacion } from "./operaciones";

export const HORAS_CONFIRMAR = 2;
export const HORAS_COTIZAR = 4;
export const HORAS_VENCE = 6;
export const DIAS_EVENTO = 2; // 48 h: hoy, mañana o pasado

const H = 3_600_000;

export type TipoPendiente = "confirmar" | "cotizar" | "vence" | "evento";

export type Pendiente = {
  tipo: TipoPendiente;
  clase: "op" | "consulta";
  ref: string; // id de la operación o de la consulta
  code: string;
  evento: string;
  // Desde cuándo cuenta (para la edad que se muestra): alta, vencimiento o
  // fecha del evento según el tipo.
  desde: string;
};

type OpPendiente = Pick<
  Operacion,
  | "id"
  | "code"
  | "evento"
  | "status"
  | "tipo"
  | "confirmada_at"
  | "entrada_recibida_at"
  | "pago_confirmado_at"
  | "cerrada_at"
  | "fecha_evento"
  | "created_at"
>;
type ConsultaPendiente = Pick<Consulta, "id" | "code" | "evento" | "estado" | "vence_at" | "created_at">;

// Días entre hoy (en Argentina) y una fecha YYYY-MM-DD.
function diasHasta(fecha: string, ahora: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const hoy = Date.parse(`${diaAr(ahora.toISOString())}T00:00:00Z`);
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - hoy) / 86_400_000);
}

export function pendienteDeOp(op: OpPendiente, ahora: Date): Pendiente | null {
  const base = { clase: "op" as const, ref: op.id, code: op.code, evento: op.evento };
  if (necesitaConfirmar(op) && ahora.getTime() - Date.parse(op.created_at) >= HORAS_CONFIRMAR * H) {
    return { ...base, tipo: "confirmar", desde: op.created_at };
  }
  if (op.status !== "cancelada" && !op.cerrada_at && op.fecha_evento) {
    const d = diasHasta(op.fecha_evento.slice(0, 10), ahora);
    if (d != null && d >= 0 && d <= DIAS_EVENTO) return { ...base, tipo: "evento", desde: op.fecha_evento };
  }
  return null;
}

export function pendienteDeConsulta(c: ConsultaPendiente, ahora: Date): Pendiente | null {
  const base = { clase: "consulta" as const, ref: c.id, code: c.code, evento: c.evento };
  if (c.estado === "pendiente" && ahora.getTime() - Date.parse(c.created_at) >= HORAS_COTIZAR * H) {
    return { ...base, tipo: "cotizar", desde: c.created_at };
  }
  if (c.estado === "cotizada" && c.vence_at) {
    const falta = Date.parse(c.vence_at) - ahora.getTime();
    if (falta > 0 && falta <= HORAS_VENCE * H) return { ...base, tipo: "vence", desde: c.vence_at };
  }
  return null;
}

export function pendientes(ops: OpPendiente[], consultas: ConsultaPendiente[], ahora: Date): Pendiente[] {
  return [
    ...ops.map((o) => pendienteDeOp(o, ahora)),
    ...consultas.map((c) => pendienteDeConsulta(c, ahora)),
  ].filter((p): p is Pendiente => p !== null);
}

const ETIQUETA: Record<TipoPendiente, [string, string]> = {
  confirmar: ["por confirmar", "por confirmar"],
  cotizar: ["por cotizar", "por cotizar"],
  vence: ["cotización por vencer", "cotizaciones por vencer"],
  evento: ["por entregar", "por entregar"],
};
const ORDEN: TipoPendiente[] = ["confirmar", "cotizar", "vence", "evento"];

/** "3 pendientes: 2 por confirmar, 1 por entregar" (una línea, va a WhatsApp). */
export function resumenPendientes(ps: Pick<Pendiente, "tipo">[]): string {
  const n = (t: TipoPendiente) => ps.filter((p) => p.tipo === t).length;
  const partes = ORDEN.filter((t) => n(t) > 0).map((t) => `${n(t)} ${ETIQUETA[t][n(t) === 1 ? 0 : 1]}`);
  return `${ps.length} ${ps.length === 1 ? "pendiente" : "pendientes"}: ${partes.join(", ")}`;
}

/** Hace cuánto: "3 h", "2 d", "15 min". Para el badge rojo del Panel. */
export function edad(desde: string, ahora: Date): string {
  const min = Math.max(0, Math.floor((ahora.getTime() - Date.parse(desde)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Texto del badge de prioridad del Panel. */
export function etiquetaPrioridad(p: Pendiente, ahora: Date): string {
  switch (p.tipo) {
    case "confirmar":
      return `Sin confirmar hace ${edad(p.desde, ahora)}`;
    case "cotizar":
      return `Sin cotizar hace ${edad(p.desde, ahora)}`;
    case "vence": {
      const min = Math.max(0, Math.round((Date.parse(p.desde) - ahora.getTime()) / 60_000));
      return min < 60 ? `Vence en ${min} min` : `Vence en ${Math.round(min / 60)} h`;
    }
    case "evento": {
      const d = diasHasta(p.desde.slice(0, 10), ahora);
      return d === 0 ? "Evento hoy, sin entregar" : d === 1 ? "Evento mañana, sin entregar" : "Evento en 2 días, sin entregar";
    }
  }
}

// ---- avisos al equipo ------------------------------------------------------

export type TipoAvisoEquipo =
  | "nuevo_pedido"
  | "nueva_consulta"
  | "cotizacion_aceptada"
  | "cancelado_cliente"
  // TKT-18: el cliente tocó "Ya pagué": hay que chequear el banco.
  | "pago_informado"
  | "nuevo_acceso"
  | `recordatorio_${TipoPendiente}`;

/**
 * Quién del equipo recibe cada aviso. Lo que solo puede accionar un admin
 * (confirmar, entregar, aprobar accesos) no le llega al moderador; lo que
 * se cotiza le llega a los dos.
 */
export function paraModeradores(tipo: TipoAvisoEquipo): boolean {
  return tipo === "nueva_consulta" || tipo === "recordatorio_cotizar" || tipo === "recordatorio_vence";
}

export type DatosAvisoEquipo = {
  code?: string;
  evento?: string;
  cliente?: string;
  detalle?: string;
  total?: string;
  nombre?: string;
  email?: string;
  quien?: string;
  via?: "web" | "whatsapp";
};

/** Título y texto de la campana del equipo (el panel está en español). */
export function textoAvisoEquipo(tipo: string, d: DatosAvisoEquipo): { titulo: string; cuerpo: string } | null {
  switch (tipo) {
    case "nuevo_pedido":
      return { titulo: `Pedido nuevo de ${d.cliente ?? "un cliente"}`, cuerpo: [d.detalle, d.total].filter(Boolean).join(" · ") };
    case "nueva_consulta":
      return { titulo: `Consulta nueva de ${d.cliente ?? "un cliente"}`, cuerpo: d.detalle ?? "" };
    case "cotizacion_aceptada":
      return {
        titulo: `Cotización aceptada · ${d.code ?? ""}`.trim(),
        cuerpo: d.via === "whatsapp" ? `${d.quien} registró que el cliente aceptó por WhatsApp.` : `${d.quien ?? "El cliente"} la aceptó en la web.`,
      };
    case "cancelado_cliente":
      return { titulo: `Cancelado por el cliente · ${d.code ?? ""}`.trim(), cuerpo: `${d.evento ?? ""}${d.quien ? ` — ${d.quien}` : ""}` };
    case "pago_informado":
      return { titulo: `Pago informado · ${d.code ?? ""}`.trim(), cuerpo: `${d.evento ?? ""} — chequeá que entró al banco` };
    case "nuevo_acceso":
      return { titulo: `Solicitud de acceso de ${d.nombre ?? "alguien"}`, cuerpo: d.email ?? "" };
    case "recordatorio_confirmar":
      return { titulo: `Sin confirmar hace más de ${HORAS_CONFIRMAR} h · ${d.code}`, cuerpo: d.evento ?? "" };
    case "recordatorio_cotizar":
      return { titulo: `Consulta sin cotizar hace más de ${HORAS_COTIZAR} h · ${d.code}`, cuerpo: d.evento ?? "" };
    case "recordatorio_vence":
      return { titulo: `Cotización por vencer · ${d.code}`, cuerpo: `${d.evento ?? ""} — vence en menos de ${HORAS_VENCE} h` };
    case "recordatorio_evento":
      return { titulo: `Evento en menos de 48 h sin entregar · ${d.code}`, cuerpo: d.evento ?? "" };
    default:
      return null;
  }
}

/** Clave de deduplicación de un aviso al equipo: uno por persona y hecho. */
export function claveAvisoEquipo(staffId: string, tipo: TipoAvisoEquipo, ref: string): string {
  return `equipo:${staffId}:${tipo}:${ref}`;
}

// ---- cómo salió el WhatsApp de un aviso (campana del equipo) ----------------

/** `whatsapp_destino` cuando salió a la lista fija WHATSAPP_VENDEDORES. */
export const DESTINO_LISTA_FIJA = "lista_fija";

// Los errores de Meta que de verdad pasan, dichos para quien mira el panel.
const MOTIVOS_META: Record<number, string> = {
  131030: "ese número no está en la lista de permitidos de Meta",
  131047: "pasaron más de 24 h desde que esa persona le escribió al número (hace falta la plantilla aprobada)",
  132001: "la plantilla no existe con ese nombre o idioma",
  132000: "los datos no coinciden con la plantilla",
  132012: "los datos no coinciden con la plantilla",
  131026: "ese número no puede recibir mensajes (¿tiene WhatsApp?)",
  190: "el token de WhatsApp venció o no es válido",
};

/** El motivo de un envío fallido, corto y en castellano. */
export function motivoWhatsapp(error: string | null | undefined): string {
  const e = String(error ?? "").trim();
  if (!e) return "sin detalle";
  const code = /"code"\s*:\s*(\d+)/.exec(e);
  if (code && MOTIVOS_META[Number(code[1])]) return MOTIVOS_META[Number(code[1])];
  const msg = /"message"\s*:\s*"([^"]+)"/.exec(e);
  const texto = (msg ? msg[1] : e.replace(/^WhatsApp no aceptó ningún envío\.\s*/, "")).trim();
  return texto.length > 140 ? texto.slice(0, 139).trimEnd() + "…" : texto;
}

export type EstadoWhatsappAviso = { tono: "ok" | "error" | "gris"; texto: string };

/** Lo que muestra la campana debajo de cada aviso. null: no se mandó WhatsApp. */
export function estadoWhatsappAviso(a: {
  whatsapp_estado?: string | null;
  whatsapp_error?: string | null;
  whatsapp_destino?: string | null;
}): EstadoWhatsappAviso | null {
  const aQuien = a.whatsapp_destino === DESTINO_LISTA_FIJA ? "a la lista fija" : a.whatsapp_destino ? "a tu teléfono" : "";
  switch (a.whatsapp_estado) {
    case "enviado":
      return { tono: "ok", texto: `WhatsApp enviado ${aQuien}`.trim() };
    case "error":
      return { tono: "error", texto: `El WhatsApp ${aQuien ? `${aQuien} ` : ""}no salió: ${motivoWhatsapp(a.whatsapp_error)}` };
    case "sin_configurar":
      return { tono: "gris", texto: "WhatsApp sin configurar" };
    default:
      return null;
  }
}
