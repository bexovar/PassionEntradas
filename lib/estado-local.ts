// Clicks de estado en el panel: lo que se ve en pantalla mientras el server
// contesta, y cómo se mezcla con el refresco automático.
//
// El problema que resuelve (los "clicks que glitchean"): el panel se refresca
// solo cuando cambia algo, y en producción ese refresco tarda 1–2 s. Si en ese
// lapso se marcaba otro hito, el refresco llegaba con la foto VIEJA y pisaba el
// hito recién marcado (se destildaba solo hasta el próximo refresco, ~15 s).
// Además, cada click esperaba al server sin cambiar nada en pantalla.
//
// Ahora:
//   1. el click se ve al instante (parche optimista) y se revierte si falla;
//   2. los clicks de una misma operación van en fila (uno por vez), así las
//      respuestas no llegan desordenadas;
//   3. el refresco no pisa una operación con clicks en vuelo, ni una cuya
//      última respuesta es más nueva que la foto del refresco.

import type { Operacion, StatusAction } from "@/lib/operaciones";

type Campos = Partial<
  Pick<
    Operacion,
    | "entrada_recibida_at"
    | "entrada_recibida_por"
    | "pago_confirmado_at"
    | "pago_confirmado_por"
    | "pago_proveedor_at"
    | "pago_proveedor_por"
    | "cerrada_at"
    | "cerrada_por"
    | "confirmada_at"
    | "pago_pedido_at"
    | "pago_informado_at"
    | "pago_informado_por"
  >
>;

const COLS = {
  entrada: ["entrada_recibida_at", "entrada_recibida_por"],
  pago: ["pago_confirmado_at", "pago_confirmado_por"],
  proveedor: ["pago_proveedor_at", "pago_proveedor_por"],
  cerrar: ["cerrada_at", "cerrada_por"],
  informar: ["pago_informado_at", "pago_informado_por"],
} as const;

/**
 * Lo que cambia en pantalla apenas se hace click. null = esa acción espera al
 * server (cancelar y reabrir: tienen confirmación y efectos que no se adivinan).
 */
export function parcheOptimista(op: Operacion, action: StatusAction, ahora: string): Campos | null {
  // Confirmar también pide el pago (TKT-21: arrancan las 24 h).
  if (action.action === "confirmar") return { confirmada_at: ahora, pago_pedido_at: ahora };
  if (action.action === "pedir_pago") return { pago_pedido_at: ahora };
  // Cancelar, reabrir y el reembolso esperan al server: tienen confirmación.
  if (
    action.action === "cancelar" ||
    action.action === "reabrir" ||
    action.action === "reembolso" ||
    action.action === "reembolsado"
  )
    return null;
  const [col, colPor] = COLS[action.action];
  const parche: Campos = { [col]: action.done ? ahora : null, [colPor]: null };
  // Espejo del server: marcar un hito confirma un pedido nuevo (avisar que
  // pagó no: eso lo dice el cliente, no es trabajo del admin).
  if (action.done && !op.confirmada_at && action.action !== "informar") parche.confirmada_at = ahora;
  return parche;
}

/** Los valores que tenía la operación en los campos del parche (para revertir). */
export function previoDe(op: Operacion, parche: Campos): Campos {
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(parche)) prev[k] = (op as Record<string, unknown>)[k] ?? null;
  return prev as Campos;
}

function ms(v: string | null | undefined): number {
  const n = v ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Mezcla la lista que trae el refresco con la local. Por operación gana la
 * local si tiene clicks en vuelo, o si su última respuesta del server es más
 * nueva que la foto del refresco; si no, gana la del refresco (cambios de
 * otro admin, del moderador, etc.).
 */
export function fusionarRefresco(
  locales: Operacion[],
  servidor: Operacion[],
  enVuelo: (id: string) => number,
  ultimaRespuesta: (id: string) => string | undefined
): Operacion[] {
  const porId = new Map(locales.map((o) => [o.id, o]));
  return servidor.map((srv) => {
    const loc = porId.get(srv.id);
    if (!loc) return srv;
    if (enVuelo(srv.id) > 0) return loc;
    const ultima = ultimaRespuesta(srv.id);
    if (ultima && ms(srv.updated_at) < ms(ultima)) return loc;
    return srv;
  });
}
