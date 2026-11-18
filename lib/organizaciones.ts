import type { TipoOrganizacion } from "@/lib/acceso";

// Organizaciones y usuarios (TKT-10). Ver supabase/migrations/0058.
//
// Cada usuario cliente es de UNA organización, con un rol:
//  - admin: ve todos los pedidos de la organización.
//  - vendedor: ve los suyos.
// El freelance es una organización de un solo usuario (admin).

export type RolOrganizacion = "admin" | "vendedor";

export const ROL_ORG_LABEL: Record<RolOrganizacion, string> = {
  admin: "Administrador",
  vendedor: "Vendedor",
};

export type Organizacion = {
  id: string;
  nombre: string;
  tipo: TipoOrganizacion | null;
  // 11 dígitos, sin guiones.
  cuit: string | null;
  fusionada_en: string | null;
  created_at: string;
};

export type Miembro = {
  user_id: string;
  organizacion_id: string;
  rol: RolOrganizacion;
  nombre: string | null;
  email: string | null;
};

/** El CUIT para comparar: solo los 11 dígitos, o null. */
export function claveCuit(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return /^\d{11}$/.test(d) ? d : null;
}

/** "30-71234567-8" para mostrar. */
export function cuitLegible(cuit: string | null): string | null {
  if (!cuit || !/^\d{11}$/.test(cuit)) return cuit;
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit[10]}`;
}

/** Organizaciones vivas (no fusionadas) con el mismo CUIT que la solicitud. */
export function coincidenciasPorCuit<T extends Pick<Organizacion, "cuit" | "fusionada_en">>(
  legajo: string | null | undefined,
  orgs: T[]
): T[] {
  const clave = claveCuit(legajo);
  if (!clave) return [];
  return orgs.filter((o) => !o.fusionada_en && o.cuit === clave);
}

// Lo que decide quien aprueba: sumarlo a una organización existente, o crear
// una nueva con los datos de la solicitud.
export type EleccionOrganizacion = { unirse: string } | { nueva: true };

export type PlanOrganizacion =
  | { tipo: "unirse"; organizacionId: string; rol: "vendedor" }
  | {
      tipo: "nueva";
      rol: "admin";
      datos: { nombre: string; tipo: TipoOrganizacion | null; cuit: string | null };
    };

type SolicitudOrg = {
  nombre: string;
  email: string;
  legajo: string | null;
  organizacion?: string | null;
  tipo_organizacion?: TipoOrganizacion | null;
};

/**
 * Qué organización le toca al aprobar. Si hay organizaciones con su CUIT,
 * quien aprueba TIENE que elegir (nunca se asocia solo por CUIT: es público).
 * Sumarse a una existente entra como vendedor; la primera de cada
 * organización es su admin.
 */
export function planAlAprobar(
  sol: SolicitudOrg,
  coincidencias: Pick<Organizacion, "id">[],
  eleccion: EleccionOrganizacion | null | undefined
): { ok: true; plan: PlanOrganizacion } | { ok: false; error: string } {
  if (eleccion && "unirse" in eleccion) {
    if (!coincidencias.some((o) => o.id === eleccion.unirse)) {
      return { ok: false, error: "Esa organización no coincide con el CUIT de la solicitud" };
    }
    return { ok: true, plan: { tipo: "unirse", organizacionId: eleccion.unirse, rol: "vendedor" } };
  }
  if (coincidencias.length > 0 && !(eleccion && "nueva" in eleccion)) {
    return {
      ok: false,
      error: "Ya hay una organización con ese CUIT: elegí sumarlo a ella o crear una nueva",
    };
  }
  const nombre = (sol.organizacion ?? "").trim() || sol.nombre.trim() || sol.email;
  return {
    ok: true,
    plan: {
      tipo: "nueva",
      rol: "admin",
      datos: {
        nombre: nombre.slice(0, 120),
        tipo: sol.tipo_organizacion ?? null,
        cuit: claveCuit(sol.legajo),
      },
    },
  };
}

/**
 * Qué pedidos ve un usuario en Mis pedidos: los suyos siempre, y si es admin
 * de su organización, también los de todos sus vendedores.
 */
export function veElPedido(
  quien: { userId: string; miembro: Pick<Miembro, "organizacion_id" | "rol"> | null },
  pedido: { cliente_id: string | null; organizacion_id?: string | null }
): boolean {
  if (pedido.cliente_id === quien.userId) return true;
  return (
    !!quien.miembro &&
    quien.miembro.rol === "admin" &&
    !!pedido.organizacion_id &&
    pedido.organizacion_id === quien.miembro.organizacion_id
  );
}

/** Validación de una fusión antes de llamar al RPC. */
export function validarFusion(
  origen: Pick<Organizacion, "id" | "fusionada_en"> | undefined,
  destino: Pick<Organizacion, "id" | "fusionada_en"> | undefined
): string | null {
  if (!origen || !destino) return "Organización no encontrada";
  if (origen.id === destino.id) return "Elegí dos organizaciones distintas";
  if (origen.fusionada_en || destino.fusionada_en) return "Esa organización ya fue fusionada";
  return null;
}
