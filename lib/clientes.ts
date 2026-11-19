import type { TipoOrganizacion } from "@/lib/acceso";
import { normalizarNombreOrg, type RolOrganizacion } from "@/lib/organizaciones";

// Ranking de compradores para el desplegable de "nueva operación".
//
// El admin cargaba el comprador escribiéndolo a mano, así que el mismo cliente
// terminaba como "Juan Perez", "juan perez" y "Juan P." según quién cargara.
// Con la lista cerrada eso no pasa, y de paso los que más compran quedan
// arriba, que es a quienes más se les carga.

export type ClienteCuenta = {
  id: string;
  nombre: string;
  email: string;
};

export type CompraDeCliente = {
  cliente_id: string | null;
  cliente_email: string | null;
  monto: number;
  moneda: string;
  // Las canceladas no cuentan como compra.
  status: string;
};

export type ClienteRankeado = ClienteCuenta & {
  /** Operaciones no canceladas que originó. */
  operaciones: number;
  /** Total por moneda, porque sumar pesos con dólares no significa nada. */
  totales: { moneda: string; total: number }[];
};

// Orden: primero los que más compraron (cantidad de operaciones), y entre
// iguales el que más plata movió. Los que nunca compraron van al final por
// nombre, para que el desplegable siga siendo una lista completa y ordenada.
//
// Se rankea por CANTIDAD y no por plata porque el total no es comparable entre
// monedas; el monto sólo desempata, y ahí ya se está comparando gente con la
// misma cantidad de operaciones.
export function rankearClientes(
  cuentas: ClienteCuenta[],
  compras: CompraDeCliente[]
): ClienteRankeado[] {
  const porId = new Map<string, { n: number; totales: Map<string, number> }>();
  const idPorEmail = new Map<string, string>();
  for (const c of cuentas) {
    if (c.email) idPorEmail.set(c.email.toLowerCase(), c.id);
  }

  for (const op of compras) {
    if (op.status === "cancelada") continue;
    // Por id, o por email cuando la operación se cargó a mano sin vincular.
    const id =
      op.cliente_id ??
      (op.cliente_email ? idPorEmail.get(op.cliente_email.toLowerCase()) : undefined);
    if (!id) continue;
    let acc = porId.get(id);
    if (!acc) {
      acc = { n: 0, totales: new Map() };
      porId.set(id, acc);
    }
    acc.n += 1;
    const moneda = op.moneda || "USD";
    acc.totales.set(moneda, (acc.totales.get(moneda) ?? 0) + Number(op.monto || 0));
  }

  const conRanking: ClienteRankeado[] = cuentas.map((c) => {
    const acc = porId.get(c.id);
    return {
      ...c,
      operaciones: acc?.n ?? 0,
      totales: acc
        ? Array.from(acc.totales.entries())
            .map(([moneda, total]) => ({ moneda, total }))
            .sort((a, b) => b.total - a.total)
        : [],
    };
  });

  const mayorTotal = (c: ClienteRankeado) =>
    c.totales.reduce((max, t) => Math.max(max, t.total), 0);

  return conRanking.sort((a, b) => {
    if (b.operaciones !== a.operaciones) return b.operaciones - a.operaciones;
    const d = mayorTotal(b) - mayorTotal(a);
    if (d !== 0) return d;
    return a.nombre.localeCompare(b.nombre, "es");
  });
}

// ---- Pantalla Clientes -----------------------------------------------------
// Cada cliente con lo que pidió: cuántas operaciones, cuántas siguen
// abiertas, el total por moneda y cuándo fue la última. Mismo criterio de
// vinculación que el ranking (por id, o por email si se cargó a mano).

export type CuentaCliente = ClienteCuenta & {
  // La solicitud de acceso que le dio la cuenta: con ella se revoca/reactiva.
  solicitudId: string;
  revocada: boolean;
};

export type OpDeCliente = CompraDeCliente & {
  created_at: string;
  cerrada_at: string | null;
};

export type FichaCliente = CuentaCliente & {
  operaciones: number; // no canceladas
  abiertas: number; // ni canceladas ni entregadas
  totales: { moneda: string; total: number }[];
  ultimoPedido: string | null;
};

export function fichasDeClientes(cuentas: CuentaCliente[], ops: OpDeCliente[]): FichaCliente[] {
  const idPorEmail = new Map<string, string>();
  for (const c of cuentas) if (c.email) idPorEmail.set(c.email.toLowerCase(), c.id);

  type Acc = { n: number; abiertas: number; totales: Map<string, number>; ultimo: string | null };
  const porId = new Map<string, Acc>();
  for (const op of ops) {
    const id =
      op.cliente_id ?? (op.cliente_email ? idPorEmail.get(op.cliente_email.toLowerCase()) : undefined);
    if (!id) continue;
    let a = porId.get(id);
    if (!a) {
      a = { n: 0, abiertas: 0, totales: new Map(), ultimo: null };
      porId.set(id, a);
    }
    // La última vez que pidió algo cuenta aunque después lo haya cancelado.
    if (!a.ultimo || op.created_at > a.ultimo) a.ultimo = op.created_at;
    if (op.status === "cancelada") continue;
    a.n += 1;
    if (!op.cerrada_at) a.abiertas += 1;
    const moneda = op.moneda || "USD";
    a.totales.set(moneda, (a.totales.get(moneda) ?? 0) + Number(op.monto || 0));
  }

  return cuentas
    .map((c) => {
      const a = porId.get(c.id);
      return {
        ...c,
        operaciones: a?.n ?? 0,
        abiertas: a?.abiertas ?? 0,
        totales: a
          ? Array.from(a.totales.entries())
              .map(([moneda, total]) => ({ moneda, total }))
              .sort((x, y) => y.total - x.total)
          : [],
        ultimoPedido: a?.ultimo ?? null,
      };
    })
    .sort((a, b) => {
      // Los que pidieron más recientemente arriba; los que nunca pidieron, al
      // final por nombre.
      if (a.ultimoPedido && b.ultimoPedido) return b.ultimoPedido.localeCompare(a.ultimoPedido);
      if (a.ultimoPedido) return -1;
      if (b.ultimoPedido) return 1;
      return a.nombre.localeCompare(b.nombre, "es");
    });
}

// ---- Clientes por agencia --------------------------------------------------
// La pantalla Clientes arranca por las agencias (organizaciones, TKT-10) y
// adentro de cada una muestra a su gente. Los números de la agencia salen de
// operaciones.organizacion_id (lo pone el trigger de 0058), que es lo mismo
// que filtra "Ver pedidos" de la agencia en el Panel. Los de cada persona,
// como antes: por su cuenta o por su email.

export type OrgDeCliente = {
  id: string;
  nombre: string;
  tipo: TipoOrganizacion | null;
  cuit: string | null;
  fusionada_en: string | null;
};

export type MiembroDeCliente = {
  user_id: string;
  organizacion_id: string;
  rol: RolOrganizacion;
  nombre: string | null;
  email: string | null;
};

export type OpDeAgencia = OpDeCliente & { organizacion_id?: string | null };

export type FichaPersona = {
  id: string;
  nombre: string;
  email: string;
  rol: RolOrganizacion | null;
  // Sin solicitud aprobada (no debería pasar) no se puede revocar.
  solicitudId: string | null;
  revocada: boolean;
  operaciones: number;
  abiertas: number;
  totales: { moneda: string; total: number }[];
  ultimoPedido: string | null;
};

export type FichaAgencia = {
  id: string;
  nombre: string;
  tipo: TipoOrganizacion | null;
  cuit: string | null;
  personas: FichaPersona[];
  operaciones: number;
  abiertas: number;
  totales: { moneda: string; total: number }[];
  ultimoPedido: string | null;
};

function porRecientes<T extends { ultimoPedido: string | null; nombre: string }>(a: T, b: T): number {
  if (a.ultimoPedido && b.ultimoPedido) return b.ultimoPedido.localeCompare(a.ultimoPedido);
  if (a.ultimoPedido) return -1;
  if (b.ultimoPedido) return 1;
  return a.nombre.localeCompare(b.nombre, "es");
}

export function agenciasDeClientes(input: {
  orgs: OrgDeCliente[];
  miembros: MiembroDeCliente[];
  cuentas: CuentaCliente[];
  ops: OpDeAgencia[];
  /** Usuarios que hoy son del equipo: no son clientes aunque sigan en una organización. */
  equipo?: Set<string>;
}): { agencias: FichaAgencia[]; sinAgencia: FichaPersona[] } {
  const equipo = input.equipo ?? new Set<string>();
  const miembros = input.miembros.filter((m) => !equipo.has(m.user_id));
  const cuentas = input.cuentas.filter((c) => !equipo.has(c.id));

  // Un miembro sin solicitud aprobada igual se muestra, con lo que se sabe.
  const conCuenta = new Set(cuentas.map((c) => c.id));
  const todas: CuentaCliente[] = [
    ...cuentas,
    ...miembros
      .filter((m) => !conCuenta.has(m.user_id))
      .map((m) => ({
        id: m.user_id,
        nombre: m.nombre || m.email || "Cliente",
        email: m.email ?? "",
        solicitudId: "",
        revocada: false,
      })),
  ];
  const fichas = new Map(fichasDeClientes(todas, input.ops).map((f) => [f.id, f]));
  const persona = (id: string, rol: RolOrganizacion | null): FichaPersona | null => {
    const f = fichas.get(id);
    if (!f) return null;
    return {
      id: f.id,
      nombre: f.nombre,
      email: f.email,
      rol,
      solicitudId: f.solicitudId || null,
      revocada: f.revocada,
      operaciones: f.operaciones,
      abiertas: f.abiertas,
      totales: f.totales,
      ultimoPedido: f.ultimoPedido,
    };
  };

  type Acc = { n: number; abiertas: number; totales: Map<string, number>; ultimo: string | null };
  const porOrg = new Map<string, Acc>();
  for (const op of input.ops) {
    if (!op.organizacion_id) continue;
    let a = porOrg.get(op.organizacion_id);
    if (!a) {
      a = { n: 0, abiertas: 0, totales: new Map(), ultimo: null };
      porOrg.set(op.organizacion_id, a);
    }
    if (!a.ultimo || op.created_at > a.ultimo) a.ultimo = op.created_at;
    if (op.status === "cancelada") continue;
    a.n += 1;
    if (!op.cerrada_at) a.abiertas += 1;
    const moneda = op.moneda || "USD";
    a.totales.set(moneda, (a.totales.get(moneda) ?? 0) + Number(op.monto || 0));
  }

  const enAlguna = new Set<string>();
  const agencias: FichaAgencia[] = input.orgs
    .filter((o) => !o.fusionada_en)
    .map((o) => {
      const personas = miembros
        .filter((m) => m.organizacion_id === o.id)
        .map((m) => {
          enAlguna.add(m.user_id);
          return persona(m.user_id, m.rol);
        })
        .filter((p): p is FichaPersona => p !== null)
        // Los administradores primero; después quien pidió más reciente.
        .sort((a, b) => (a.rol === b.rol ? porRecientes(a, b) : a.rol === "admin" ? -1 : 1));
      const a = porOrg.get(o.id);
      return {
        id: o.id,
        nombre: o.nombre,
        tipo: o.tipo,
        cuit: o.cuit,
        personas,
        operaciones: a?.n ?? 0,
        abiertas: a?.abiertas ?? 0,
        totales: a
          ? Array.from(a.totales.entries())
              .map(([moneda, total]) => ({ moneda, total }))
              .sort((x, y) => y.total - x.total)
          : [],
        ultimoPedido: a?.ultimo ?? null,
      };
    })
    .sort(porRecientes);

  const sinAgencia = cuentas
    .filter((c) => !enAlguna.has(c.id))
    .map((c) => persona(c.id, null))
    .filter((p): p is FichaPersona => p !== null)
    .sort(porRecientes);

  return { agencias, sinAgencia };
}

/**
 * Qué coincide con la búsqueda: la agencia entera (nombre o CUIT) o algunas
 * de sus personas (nombre o email). null si nada.
 */
export function coincidenciaBusqueda(
  ag: Pick<FichaAgencia, "nombre" | "cuit"> & { personas: Pick<FichaPersona, "id" | "nombre" | "email">[] },
  q: string
): { agencia: boolean; personas: Set<string> } | null {
  const t = q.trim().toLowerCase();
  if (!t) return { agencia: true, personas: new Set() };
  const digitos = t.replace(/\D/g, "");
  const agencia =
    ag.nombre.toLowerCase().includes(t) ||
    normalizarNombreOrg(ag.nombre).includes(normalizarNombreOrg(t) || t) ||
    (digitos.length >= 3 && /^[\d\s.-]+$/.test(t) && (ag.cuit ?? "").includes(digitos));
  const personas = new Set(
    ag.personas
      .filter((p) => p.nombre.toLowerCase().includes(t) || p.email.toLowerCase().includes(t))
      .map((p) => p.id)
  );
  return agencia || personas.size > 0 ? { agencia, personas } : null;
}
