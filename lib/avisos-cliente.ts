// Aviso al cliente cuando su pedido cambia de paso (Confirmado, Para pagar,
// Entregada): queda en su campana y, si hay proveedor de email, le llega un
// mail en el idioma en que hizo el pedido. Lo llama el cambio de estado del
// panel; nunca lo traba: cualquier fallo se registra y sigue.

import type { SupabaseClient } from "@supabase/supabase-js";
import { estadoEmailInicial, guardarAviso, mandarEmailDeAviso } from "./avisos";
import { isMock, mockGetTextosPago } from "./mock-db";
import { avisoDeCambio, claveAvisoCliente, claveCotizacion, emailAviso, idiomaDe } from "./notificaciones";
import { textoPagoDe } from "./textos";
import type { Moneda } from "./operaciones";

type Hitos = Parameters<typeof avisoDeCambio>[0];

export type OpParaAviso = Hitos & {
  id: string;
  code: string;
  evento: string;
  monto: number | null;
  moneda: Moneda | null;
  cliente_id: string | null;
  cliente_email: string | null;
  comprador_alias: string | null;
  idioma?: string | null;
};

// Columnas que hay que leer de la operación para poder avisar. `idioma` NO
// va acá: se lee aparte y solo si hay email que mandar, así el cambio de
// estado no depende de que la migración 0045 ya esté aplicada.
export const COLUMNAS_AVISO =
  "id, code, evento, monto, moneda, cliente_id, cliente_email, comprador_alias, status, tipo, confirmada_at, entrada_recibida_at, pago_confirmado_at, cerrada_at";

export async function avisarCambioAlCliente(
  admin: SupabaseClient | null,
  antes: Hitos,
  despues: OpParaAviso,
  baseUrl: string
): Promise<void> {
  try {
    const tipo = avisoDeCambio(antes, despues);
    // Sin cliente (operación cargada a mano sin vincular) no hay a quién.
    if (!tipo || (!despues.cliente_id && !despues.cliente_email)) return;

    const url = `${baseUrl}/mis-pedidos`;
    const datos = { code: despues.code, evento: despues.evento, monto: despues.monto, moneda: despues.moneda };
    const aviso = await guardarAviso(admin, {
      clave: claveAvisoCliente(despues.id, tipo),
      audiencia: "cliente",
      destinatario_id: despues.cliente_id,
      destinatario_email: despues.cliente_email,
      tipo,
      operacion_id: despues.id,
      datos,
      url,
      email_estado: estadoEmailInicial(despues.cliente_email),
    });
    if (!aviso || aviso.email_estado !== "pendiente") return;

    const idioma = await idiomaDelCliente(admin, "operaciones", despues.id, despues.idioma, despues.cliente_id);

    let textoPago: string | null = null;
    if (tipo === "para_pagar") {
      const textos: Record<string, string> = {};
      if (isMock() || !admin) Object.assign(textos, mockGetTextosPago());
      else {
        const { data } = await admin.from("textos_config").select("key, value").like("key", "pago_%");
        for (const r of (data ?? []) as { key: string; value: string }[]) textos[r.key] = r.value;
      }
      textoPago = textoPagoDe(textos, despues.moneda);
    }
    const mensaje = emailAviso(
      tipo,
      { ...datos, nombre: despues.comprador_alias, textoPago, url },
      idiomaDe(idioma)
    );
    await mandarEmailDeAviso(admin, aviso, mensaje);
  } catch (e) {
    console.error(`[avisos] aviso al cliente de ${despues.id}: ${(e as Error).message}`);
  }
}

/**
 * El idioma de los emails: el del pedido o la consulta (la tienda al pedir).
 * Sin dato (cargado por el staff, o anterior a esto), el que el cliente
 * eligió en su cuenta. Se lee aparte: sin la columna (migración 0045), null.
 */
async function idiomaDelCliente(
  admin: SupabaseClient | null,
  tabla: "operaciones" | "consultas",
  id: string,
  conocido: string | null | undefined,
  clienteId: string | null
): Promise<string | null> {
  let idioma = conocido ?? null;
  if (conocido === undefined && admin && !isMock()) {
    const { data } = await admin.from(tabla).select("idioma").eq("id", id).maybeSingle();
    idioma = (data as { idioma?: string | null } | null)?.idioma ?? null;
  }
  if (!idioma && clienteId && admin && !isMock()) {
    const { data } = await admin.auth.admin.getUserById(clienteId);
    const lang = (data?.user?.user_metadata as Record<string, unknown> | undefined)?.lang;
    if (lang === "en" || lang === "es") idioma = lang;
  }
  return idioma;
}

export type ConsultaParaAviso = {
  id: string;
  code: string;
  evento: string;
  cliente_id: string | null;
  cliente_email: string | null;
  comprador_alias: string | null;
  cotizacion_monto?: number | null;
  moneda?: Moneda | null;
  cotizacion_version?: number | null;
  vence_at?: string | null;
  idioma?: string | null;
};

/**
 * La consulta quedó cotizada: el cliente tiene que enterarse para aceptarla o
 * rechazarla en Mis pedidos. Campana + email (si hay proveedor). Una vez por
 * versión: re-cotizar (otro precio o plazo) avisa de nuevo. Nunca tira.
 */
export async function avisarCotizacionAlCliente(
  admin: SupabaseClient | null,
  c: ConsultaParaAviso,
  baseUrl: string
): Promise<void> {
  try {
    if (!c.cliente_id && !c.cliente_email) return;
    const url = `${baseUrl}/mis-pedidos`;
    const datos = {
      code: c.code,
      evento: c.evento,
      monto: c.cotizacion_monto ?? null,
      moneda: c.moneda ?? null,
      vence: c.vence_at ?? null,
    };
    const aviso = await guardarAviso(admin, {
      clave: claveCotizacion(c.id, Number(c.cotizacion_version ?? 1)),
      audiencia: "cliente",
      destinatario_id: c.cliente_id,
      destinatario_email: c.cliente_email,
      tipo: "cotizacion_lista",
      operacion_id: null,
      consulta_id: c.id,
      datos,
      url,
      email_estado: estadoEmailInicial(c.cliente_email),
    });
    if (!aviso || aviso.email_estado !== "pendiente") return;
    const idioma = await idiomaDelCliente(admin, "consultas", c.id, c.idioma, c.cliente_id);
    await mandarEmailDeAviso(
      admin,
      aviso,
      emailAviso("cotizacion_lista", { ...datos, nombre: c.comprador_alias, url }, idiomaDe(idioma))
    );
  } catch (e) {
    console.error(`[avisos] cotización al cliente de ${c.id}: ${(e as Error).message}`);
  }
}
