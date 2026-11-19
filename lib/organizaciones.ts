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

/**
 * Cambio de rol: una organización nunca se queda sin administrador (si no,
 * nadie ve los pedidos de todos). Devuelve el error con su status, o null.
 */
export function validarCambioRol(
  miembros: Pick<Miembro, "user_id" | "organizacion_id" | "rol">[],
  userId: string,
  rol: RolOrganizacion
): { status: 404 | 409; error: string } | null {
  const m = miembros.find((x) => x.user_id === userId);
  if (!m) return { status: 404, error: "Usuario sin organización" };
  if (m.rol !== "admin" || rol !== "vendedor") return null;
  const otroAdmin = miembros.some(
    (x) => x.organizacion_id === m.organizacion_id && x.rol === "admin" && x.user_id !== userId
  );
  return otroAdmin
    ? null
    : { status: 409, error: "La organización se quedaría sin administrador: primero pasá a otro usuario a administrador" };
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

/** Nombre de una organización al renombrarla: sin espacios de más, 1 a 120 caracteres. */
export function validarNombreOrg(raw: unknown): { ok: true; nombre: string } | { ok: false; error: string } {
  const nombre = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!nombre) return { ok: false, error: "Escribí el nombre" };
  if (nombre.length > 120) return { ok: false, error: "El nombre es demasiado largo (máximo 120 caracteres)" };
  return { ok: true, nombre };
}

// ---- Posibles duplicadas ---------------------------------------------------
// Una agencia queda partida en dos cuando alguien se registra con su CUIL
// personal en vez del CUIT de la agencia, o tipea distinto el nombre: al
// aprobar no hay match por CUIT y se crea otra. La pantalla Clientes las
// sugiere para juntarlas; nunca se juntan solas.

export type MotivoDuplicada = "cuit" | "nombre" | "dominio";

export type PosibleDuplicada = {
  /** Clave estable del par (los dos ids ordenados), para descartarlo. */
  clave: string;
  a: string;
  b: string;
  motivos: MotivoDuplicada[];
  /** El dominio de email que comparten, si ese es un motivo. */
  dominio?: string;
};

// Formas jurídicas al final del nombre: "Viajes del Sur" y "Viajes del Sur
// S.R.L." son la misma.
const FORMAS_JURIDICAS = new Set(["srl", "sa", "sas", "sau", "sh", "scs", "sl", "ltda", "inc", "llc"]);

/** El nombre para comparar: minúsculas, sin acentos, puntuación ni forma jurídica. */
export function normalizarNombreOrg(nombre: string): string {
  const palabras = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (palabras.length > 1 && FORMAS_JURIDICAS.has(palabras[palabras.length - 1])) palabras.pop();
  return palabras.join(" ");
}

function distancia(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(prev[j] + 1, fila[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = fila;
  }
  return prev[b.length];
}

/** Mismo nombre salvo un error de tipeo (dos letras en nombres largos). */
export function nombresParecidos(a: string, b: string): boolean {
  const x = normalizarNombreOrg(a);
  const y = normalizarNombreOrg(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const largo = Math.max(x.length, y.length);
  const tolerancia = largo >= 12 ? 2 : largo >= 5 ? 1 : 0;
  if (tolerancia === 0 || Math.abs(x.length - y.length) > tolerancia) return false;
  return distancia(x, y) <= tolerancia;
}

// Proveedores de email de uso personal: compartirlos no dice nada. Se compara
// la primera parte del dominio, así cubre hotmail.com.ar, yahoo.es, etc.
const DOMINIOS_PERSONALES = new Set([
  "gmail", "googlemail", "hotmail", "outlook", "live", "msn", "yahoo", "ymail", "icloud", "me", "mac",
  "aol", "protonmail", "proton", "pm", "gmx", "yandex", "mail", "zoho", "fibertel", "arnet", "speedy",
  "ciudad", "uolsinectis", "example",
]);

/** El dominio del email si es de una empresa (no gmail, hotmail, etc.), o null. */
export function dominioPropio(email: string | null | undefined): string | null {
  const dominio = (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio)) return null;
  return DOMINIOS_PERSONALES.has(dominio.split(".")[0]) ? null : dominio;
}

export const MOTIVO_DUPLICADA_LABEL: Record<MotivoDuplicada, string> = {
  cuit: "Mismo CUIT",
  nombre: "Nombre parecido",
  dominio: "Mismo dominio de email",
};

/**
 * Pares de organizaciones vivas que podrían ser la misma agencia: mismo CUIT,
 * nombre parecido o usuarios con el mismo dominio de email de empresa.
 */
export function posiblesDuplicadas(
  orgs: Pick<Organizacion, "id" | "nombre" | "cuit" | "fusionada_en">[],
  miembros: Pick<Miembro, "organizacion_id" | "email">[]
): PosibleDuplicada[] {
  const vivas = orgs.filter((o) => !o.fusionada_en);
  const dominios = new Map<string, Set<string>>();
  for (const m of miembros) {
    const d = dominioPropio(m.email);
    if (!d) continue;
    if (!dominios.has(m.organizacion_id)) dominios.set(m.organizacion_id, new Set());
    dominios.get(m.organizacion_id)!.add(d);
  }

  const pares: PosibleDuplicada[] = [];
  for (let i = 0; i < vivas.length; i++) {
    for (let j = i + 1; j < vivas.length; j++) {
      const [a, b] = vivas[i].id < vivas[j].id ? [vivas[i], vivas[j]] : [vivas[j], vivas[i]];
      const motivos: MotivoDuplicada[] = [];
      if (a.cuit && a.cuit === b.cuit) motivos.push("cuit");
      if (nombresParecidos(a.nombre, b.nombre)) motivos.push("nombre");
      const comun = Array.from(dominios.get(a.id) ?? []).find((d) => dominios.get(b.id)?.has(d));
      if (comun) motivos.push("dominio");
      if (motivos.length === 0) continue;
      pares.push({ clave: `${a.id}|${b.id}`, a: a.id, b: b.id, motivos, ...(comun ? { dominio: comun } : {}) });
    }
  }
  // Primero los más claros: mismo CUIT, después por cantidad de motivos.
  return pares.sort(
    (x, y) => Number(y.motivos.includes("cuit")) - Number(x.motivos.includes("cuit")) || y.motivos.length - x.motivos.length
  );
}
