import { NextResponse } from "next/server";
import { mapaPropioValido } from "@/lib/tickets";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { isMock, mockCreateManual } from "@/lib/mock-db";
import { parsePrecio } from "@/lib/precios";
import { ERROR_MONEDA, formatFecha, parseMoneda } from "@/lib/operaciones";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// POST /api/tickets — publica una entrada manual en el catálogo.
// Un evento puede traer VARIOS sectores (cada uno con su precio y stock):
// se crea una fila por sector, igual que las entradas del portal. El body
// acepta { ticket: { evento, competicion, ciudad, fecha, sectores: [...] } }
// o el formato viejo con categoria/precio/stock planos (un solo sector).

const MAX_SECTORES = 20;

type SectorInput = {
  categoria: string;
  precio: number;
  stock: number;
  moneda: string;
  costo: number | null;
};

function parseSectores(t: any): SectorInput[] | { error: string } {
  // Formato nuevo (lista) o viejo (campos planos = un sector).
  const crudos: any[] = Array.isArray(t.sectores)
    ? t.sectores
    : [
        {
          categoria: t.categoria,
          precio: t.precio,
          costo: t.costo,
          comision: t.comision,
          moneda: t.moneda,
          stock: t.stock,
        },
      ];

  if (crudos.length === 0) {
    return { error: "Cargá al menos un sector" };
  }
  if (crudos.length > MAX_SECTORES) {
    return { error: `Máximo ${MAX_SECTORES} sectores por evento` };
  }

  const sectores: SectorInput[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < crudos.length; i++) {
    const n = crudos.length > 1 ? ` (sector ${i + 1})` : "";
    const categoria = String(crudos[i]?.categoria ?? "").trim();
    const stock = Math.trunc(Number(crudos[i]?.stock));
    // Moneda de la entrada: pesos o dólares (el euro es solo de Passion).
    const moneda = parseMoneda(crudos[i]?.moneda);
    if (!moneda) return { error: `${ERROR_MONEDA}${n}` };
    if (!categoria) {
      return { error: `El sector es obligatorio${n}` };
    }
    // El precio se carga como COSTO + COMISIÓN y se vende por la suma. Se
    // acepta `precio` suelto por compatibilidad con el formato viejo (una
    // pestaña abierta con el panel anterior, o el PATCH de edición).
    let costo: number | null;
    let precio: number;
    if (crudos[i]?.costo != null || crudos[i]?.comision != null) {
      const p = parsePrecio(crudos[i].costo, crudos[i].comision, n);
      if (!p.ok) return { error: p.error };
      costo = p.costo;
      precio = p.total;
    } else {
      precio = Number(crudos[i]?.precio);
      if (!Number.isFinite(precio) || precio <= 0) {
        return { error: `El precio debe ser mayor a 0${n}` };
      }
      costo = null;
    }
    if (!Number.isFinite(stock) || stock < 1) {
      return { error: `El stock debe ser al menos 1${n}` };
    }
    const clave = categoria.toLowerCase();
    if (vistos.has(clave)) {
      return { error: `El sector "${categoria}" está repetido` };
    }
    vistos.add(clave);
    sectores.push({ categoria, precio, stock, moneda, costo });
  }
  return sectores;
}

// "Cargó la entrada Boca vs River (15 ago 2026) · Platea: USD 300, stock 4".
// Con varios sectores se listan hasta 3; más, solo cuántos y el stock total.
function resumenAlta(evento: string, fecha: string, sectores: SectorInput[]): string {
  const monto = (n: number, moneda: string) =>
    `${moneda} ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n)}`;
  const nombre = `${evento} (${formatFecha(fecha)})`;
  if (sectores.length === 1) {
    const s = sectores[0];
    return `Cargó la entrada ${nombre} · ${s.categoria}: ${monto(s.precio, s.moneda)}, stock ${s.stock}`;
  }
  if (sectores.length <= 3) {
    const lista = sectores.map((s) => `${s.categoria} (${monto(s.precio, s.moneda)}, stock ${s.stock})`);
    return `Cargó la entrada ${nombre} con ${sectores.length} sectores: ${lista.join(", ")}`;
  }
  const total = sectores.reduce((acc, s) => acc + s.stock, 0);
  return `Cargó la entrada ${nombre} con ${sectores.length} sectores (stock total ${total})`;
}

export async function POST(request: Request) {
  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || getRol(user) !== "administrador") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    actor = actorDe(user);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const t = body.ticket ?? body ?? {};
  const evento = String(t.evento ?? "").trim();
  const competicion = String(t.competicion ?? "").trim();
  const ciudad = String(t.ciudad ?? "").trim();
  const fecha = String(t.fecha ?? "").trim();

  // Una entrada propia se publica completa o no se publica: todos los campos
  // son obligatorios (mismo criterio que las operaciones — acá también se
  // habían colado cargas a medias). Validado en el form Y acá.
  if (!evento) {
    return NextResponse.json({ error: "El evento es obligatorio" }, { status: 400 });
  }
  if (!competicion) {
    return NextResponse.json(
      { error: "La categoría / competición es obligatoria" },
      { status: 400 }
    );
  }
  if (!ciudad) {
    return NextResponse.json(
      { error: "El lugar (ciudad o país) es obligatorio" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json(
      { error: "La fecha del evento es obligatoria" },
      { status: 400 }
    );
  }

  // Proveedor: va por evento, no por sector (las entradas de un mismo
  // partido salen del mismo lado).
  const proveedor = String(t?.proveedor ?? "").trim().slice(0, 160) || null;

  const sectores = parseSectores(t);
  if ("error" in sectores) {
    return NextResponse.json({ error: sectores.error }, { status: 400 });
  }

  // Mapa del estadio (opcional): el que subió el panel a /api/tickets/mapa.
  // Va en todos los sectores del evento; la tienda muestra el primero.
  const imagenRaw = t.imagen_url ?? null;
  const imagen_url = imagenRaw ? mapaPropioValido(imagenRaw, isMock()) : null;
  if (imagenRaw && !imagen_url) {
    return NextResponse.json({ error: "El mapa tiene que subirse desde el panel" }, { status: 400 });
  }

  const scrapedAt = new Date().toISOString();
  const rows = sectores.map((s) => ({
    id: `manual::${randomUUID()}`,
    evento,
    competicion,
    fecha,
    ciudad,
    categoria: s.categoria,
    // La entrada propia se guarda en la moneda que elige el admin. La tienda la
    // pasa a dólares al mostrarla, con las cotizaciones del panel (ver
    // factorAUsd en lib/tickets.ts).
    precio_origen: s.precio,
    moneda_origen: s.moneda ?? "USD",
    precio_final: s.precio,
    moneda_final: s.moneda ?? "USD",
    precio_costo: s.costo ?? null,
    proveedor,
    stock: s.stock,
    disponible: true,
    estado: "book",
    url_origen: null,
    source: "manual",
    imagen_url,
    scraped_at: scrapedAt,
  }));

  let creadas: unknown[];
  let admin: ReturnType<typeof createAdminSupabase> | null = null;
  if (isMock()) {
    creadas = rows.map((r) => mockCreateManual({ ...r, updated_at: r.scraped_at } as any));
  } else {
    admin = createAdminSupabase();
    const { data, error } = await admin.from("tickets").insert(rows).select("*");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    creadas = data ?? [];
  }

  // La tienda pública es ISR: sin esto, la entrada nueva tarda hasta la
  // revalidación de fondo en aparecer. También en mock, para poder probar
  // el flujo completo en local.
  refrescarTienda();

  await registrarActividad(admin, {
    actor,
    accion: "ticket.crear",
    entidad: "ticket",
    // Varios sectores = varias filas: la línea apunta a la primera y el
    // detalle lleva todas.
    entidad_id: rows[0]?.id ?? null,
    codigo: null,
    resumen: resumenAlta(evento, fecha, sectores),
    detalle: {
      evento,
      competicion,
      ciudad,
      fecha,
      proveedor,
      mapa: !!imagen_url,
      sectores: rows.map((r) => ({
        id: r.id,
        categoria: r.categoria,
        moneda: r.moneda_final,
        precio: r.precio_final,
        costo: r.precio_costo,
        stock: r.stock,
      })),
    },
    origen: "panel",
  });

  // `row` se mantiene por compatibilidad con el formato de un solo sector.
  return NextResponse.json({ ok: true, rows: creadas, row: creadas[0] }, { status: 201 });
}
