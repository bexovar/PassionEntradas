import type { SupabaseClient, User } from "@supabase/supabase-js";
import { nombreDe, rolGuardado } from "@/lib/auth";
import { isMock, MOCK_USER, mockListActividad, mockRegistrarActividad } from "@/lib/mock-db";

// Registro de actividad (tabla `actividad`, migración 0048): quién cambió qué
// y cuándo, en toda la app. Cada ruta que cambia datos llama a
// registrarActividad DESPUÉS de que el cambio salió bien.
//
// Reglas:
// - Nunca frena ni rompe la acción: si el registro falla, se loguea y listo.
// - Sin secretos: `detalle` pasa por limpiarDetalle (contraseñas, tokens,
//   claves de API quedan como "[oculto]").
// - `resumen` es la frase que se lee en pantalla, en castellano y en pasado:
//   "Desmarcó «Pago recibido»", "Cotizó USD 300".

export type Actor = {
  id: string | null;
  email: string | null;
  nombre: string | null;
  rol: string | null;
};

// panel: el equipo · tienda: un cliente · landing: alguien sin cuenta ·
// sistema: el worker o un proceso sin persona.
export type Origen = "panel" | "tienda" | "landing" | "sistema";

export type NuevaActividad = {
  // null = sin persona (sistema, o alguien sin cuenta en la landing).
  actor: Actor | null;
  // "<entidad>.<verbo>": operacion.hito, consulta.cotizar, acceso.aprobar…
  accion: string;
  entidad?: string | null;
  entidad_id?: string | null;
  // Código visible (BX-…) para buscar en la pantalla Actividad.
  codigo?: string | null;
  resumen: string;
  detalle?: Record<string, unknown>;
  origen?: Origen;
};

export type Actividad = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_nombre: string | null;
  actor_rol: string | null;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  codigo: string | null;
  resumen: string;
  detalle: Record<string, unknown>;
  origen: Origen;
};

export const COLUMNAS_ACTIVIDAD =
  "id, created_at, actor_id, actor_email, actor_nombre, actor_rol, accion, entidad, entidad_id, codigo, resumen, detalle, origen";

/** Quién hace la acción, a partir del usuario de la sesión. */
export function actorDe(user: User | null | undefined): Actor | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    nombre: nombreDe(user),
    rol: rolGuardado(user),
  };
}

/** En modo demo no hay sesión: las acciones del panel las hace el admin demo. */
export function actorDemo(): Actor {
  return { id: MOCK_USER.id, email: MOCK_USER.email, nombre: "Demo", rol: MOCK_USER.rol };
}

// Claves que nunca se guardan: contraseñas, tokens, claves de API, cookies.
const SECRETO = /pass|clave|contrase|token|secret|apikey|api_key|authorization|cookie|service_role/i;
const MAX_TEXTO = 500;
const MAX_LISTA = 50;
const MAX_PROFUNDIDAD = 4;

/** Copia de `detalle` sin secretos y con tamaño acotado. */
export function limpiarDetalle(valor: unknown, profundidad = 0): unknown {
  if (valor == null) return valor ?? null;
  if (typeof valor === "string") return valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}…` : valor;
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (profundidad >= MAX_PROFUNDIDAD) return "[…]";
  if (Array.isArray(valor)) {
    const lista = valor.slice(0, MAX_LISTA).map((v) => limpiarDetalle(v, profundidad + 1));
    if (valor.length > MAX_LISTA) lista.push(`… y ${valor.length - MAX_LISTA} más`);
    return lista;
  }
  if (typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = SECRETO.test(k) ? "[oculto]" : limpiarDetalle(v, profundidad + 1);
    }
    return out;
  }
  return String(valor);
}

/**
 * Guarda una línea de actividad. Nunca lanza: si falla (tabla sin crear, red),
 * se loguea en la consola del servidor y la acción sigue como si nada.
 */
export async function registrarActividad(admin: SupabaseClient | null, a: NuevaActividad): Promise<void> {
  try {
    const fila = {
      actor_id: a.actor?.id ?? null,
      actor_email: a.actor?.email ?? null,
      actor_nombre: a.actor?.nombre ?? null,
      actor_rol: a.actor?.rol ?? null,
      accion: a.accion,
      entidad: a.entidad ?? null,
      entidad_id: a.entidad_id ?? null,
      codigo: a.codigo ?? null,
      resumen: a.resumen.slice(0, MAX_TEXTO),
      detalle: (limpiarDetalle(a.detalle ?? {}) ?? {}) as Record<string, unknown>,
      origen: a.origen ?? (a.actor ? "panel" : "sistema"),
    };
    if (isMock() || !admin) {
      mockRegistrarActividad(fila);
      return;
    }
    const { error } = await admin.from("actividad").insert(fila);
    if (error) console.error(`[actividad] no se pudo registrar ${a.accion}: ${error.message}`);
  } catch (err) {
    console.error(`[actividad] no se pudo registrar ${a.accion}:`, err);
  }
}

export type FiltroActividad = {
  // Una operación: sus filas y las de la consulta que la originó.
  operacionId?: string;
  entidad?: string;
  actorId?: string;
  // Texto libre: resumen, código, email o nombre de quien lo hizo.
  q?: string;
  // ISO: desde cuándo.
  desde?: string;
  limite?: number;
};

/** Texto apto para un filtro de PostgREST (sin comas, paréntesis ni comodines). */
function textoSeguro(q: string): string {
  return q.replace(/[,()*%\\:]/g, " ").trim().slice(0, 80);
}

export async function leerActividad(admin: SupabaseClient | null, f: FiltroActividad = {}): Promise<Actividad[]> {
  if (f.operacionId && !/^[0-9a-f-]{36}$/i.test(f.operacionId)) return [];
  const limite = Math.min(Math.max(f.limite ?? 200, 1), 1000);
  const q = f.q ? textoSeguro(f.q).toLowerCase() : "";
  if (isMock() || !admin) {
    return mockListActividad((a) => {
      if (f.operacionId && a.entidad_id !== f.operacionId && a.detalle?.operacion_id !== f.operacionId) return false;
      if (f.entidad && a.entidad !== f.entidad) return false;
      if (f.actorId && a.actor_id !== f.actorId) return false;
      if (f.desde && a.created_at < f.desde) return false;
      if (q) {
        const texto = [a.resumen, a.codigo, a.actor_email, a.actor_nombre].join(" ").toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    }, limite);
  }
  let consulta = admin
    .from("actividad")
    .select(COLUMNAS_ACTIVIDAD)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (f.operacionId) {
    consulta = consulta.or(`entidad_id.eq.${f.operacionId},detalle->>operacion_id.eq.${f.operacionId}`);
  }
  if (f.entidad) consulta = consulta.eq("entidad", f.entidad);
  if (f.actorId) consulta = consulta.eq("actor_id", f.actorId);
  if (f.desde) consulta = consulta.gte("created_at", f.desde);
  if (q) {
    const p = `*${q}*`;
    consulta = consulta.or(
      `resumen.ilike.${p},codigo.ilike.${p},actor_email.ilike.${p},actor_nombre.ilike.${p}`
    );
  }
  const { data, error } = await consulta;
  if (error) {
    // Sin la tabla (migración sin aplicar): lista vacía, sin romper la página.
    console.error(`[actividad] no se pudo leer: ${error.message}`);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as Actividad),
    id: String(r.id),
    detalle: (r.detalle ?? {}) as Record<string, unknown>,
  }));
}

/** "Marcó" / "Desmarcó" + el nombre del paso, para operacion.hito. */
export const NOMBRE_HITO: Record<string, string> = {
  entrada: "Entrada del proveedor",
  pago: "Pago recibido",
  proveedor: "Pago a proveedor",
  cerrar: "Entrada entregada",
};
