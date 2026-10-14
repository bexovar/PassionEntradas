import { NextResponse } from "next/server";
import { mapaPropioValido } from "@/lib/tickets";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { ERROR_MONEDA, formatFecha, parseMoneda } from "@/lib/operaciones";
import { getRol } from "@/lib/auth";
import { isMock, mockDeleteManual, mockListManual, mockUpdateManual } from "@/lib/mock-db";
import { parsePrecio } from "@/lib/precios";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";

// PATCH  /api/tickets/[id] — edita una entrada MANUAL (precio, stock, etc.)
//        sin borrar y recrear (el id, y por lo tanto el link, no cambian).
// DELETE /api/tickets/[id] — borra una entrada MANUAL del catálogo.
// Las del portal las gestiona el worker; no se tocan desde acá.

// Corta con 401, o devuelve quién hace la acción (para el registro).
async function requireAdmin(): Promise<{ denied: NextResponse } | { actor: Actor | null }> {
  if (isMock()) return { actor: actorDemo() };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || getRol(user) !== "administrador") {
    return { denied: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  return { actor: actorDe(user) };
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("denied" in auth) return auth.denied;
  const { actor } = auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Misma validación que el alta: la entrada editada también queda completa.
  const t = body.ticket ?? body ?? {};
  const evento = String(t.evento ?? "").trim();
  const competicion = String(t.competicion ?? "").trim();
  const ciudad = String(t.ciudad ?? "").trim();
  const categoria = String(t.categoria ?? "").trim();
  const fecha = String(t.fecha ?? "").trim();
  const stock = Math.trunc(Number(t.stock));
  // Moneda de la entrada: pesos o dólares (el euro es solo de Passion).
  const moneda = parseMoneda(t.moneda);
  if (!moneda) return NextResponse.json({ error: ERROR_MONEDA }, { status: 400 });

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
  if (!categoria) {
    return NextResponse.json({ error: "El sector es obligatorio" }, { status: 400 });
  }
  // Costo + comisión: se vende por la suma. Se acepta `precio` suelto por
  // compatibilidad con el formato viejo.
  let costo: number | null;
  let precio: number;
  if (t.costo != null || t.comision != null) {
    const p = parsePrecio(t.costo, t.comision);
    if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
    costo = p.costo;
    precio = p.total;
  } else {
    precio = Number(t.precio);
    if (!Number.isFinite(precio) || precio <= 0) {
      return NextResponse.json(
        { error: "El precio debe ser mayor a 0" },
        { status: 400 }
      );
    }
    costo = null;
  }
  // En edición se permite stock 0 (agotada pero visible "sin cupo"): puede
  // pasar por el descuento automático al cerrar operaciones.
  if (!Number.isFinite(stock) || stock < 0) {
    return NextResponse.json({ error: "Stock inválido" }, { status: 400 });
  }

  // Mapa del estadio: undefined = no se tocó; null/"" = se quitó; si viene,
  // tiene que ser uno subido por el panel. Es del EVENTO: se aplica a todos
  // sus sectores propios (si no, al editar un sector quedaban mapas distintos).
  const tocaMapa = t.imagen_url !== undefined;
  const imagen_url = t.imagen_url ? mapaPropioValido(t.imagen_url, isMock()) : null;
  if (tocaMapa && t.imagen_url && !imagen_url) {
    return NextResponse.json({ error: "El mapa tiene que subirse desde el panel" }, { status: 400 });
  }

  const id = decodeURIComponent(params.id);
  const patch = {
    evento,
    competicion,
    ciudad,
    categoria,
    fecha,
    precio_origen: precio,
    precio_final: precio,
    // Solo se pisa el costo si vino en el body: una edición vieja sin el campo
    // no tiene que borrar lo que ya estaba cargado.
    ...(costo != null ? { precio_costo: costo } : {}),
    moneda_origen: moneda,
    moneda_final: moneda,
    stock,
    disponible: stock > 0,
  };

  // Lo que queda guardado, para comparar con el antes en el registro.
  const nuevo: Nuevo = { evento, competicion, ciudad, categoria, fecha, precio, moneda, costo, stock };

  let row: unknown;
  // Valores previos, solo para el registro de actividad.
  let antes: Previa | null = null;
  if (isMock()) {
    // mockUpdateManual cambia la fila en el lugar: copia antes de tocarla.
    const previa = mockListManual().find((m) => m.id === id);
    antes = previa ? { ...previa } : null;
    const res = mockUpdateManual(id, patch);
    if (!res) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }
    row = res;
  } else {
    const admin = createAdminSupabase();
    // Si la lectura falla se registra igual, sin el "antes".
    const { data: previa } = await admin
      .from("tickets")
      .select(COLUMNAS_PREVIA)
      .eq("id", id)
      .eq("source", "manual")
      .maybeSingle();
    antes = (previa as Previa | null) ?? null;
    const { data, error } = await admin
      .from("tickets")
      .update(patch)
      .eq("id", id)
      .eq("source", "manual")
      .select("*")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }
    row = data;
  }

  // El mapa es del evento: se aplica a todos sus sectores propios.
  if (tocaMapa) {
    const r = row as { evento: string; competicion: string | null; fecha: string | null };
    if (isMock()) {
      for (const m of mockListManual()) {
        if (m.evento === r.evento && m.competicion === r.competicion && m.fecha === r.fecha) {
          mockUpdateManual(m.id, { imagen_url });
        }
      }
      row = { ...(row as object), imagen_url };
    } else {
      let q = createAdminSupabase()
        .from("tickets")
        .update({ imagen_url })
        .eq("source", "manual")
        .eq("evento", r.evento);
      q = r.competicion == null ? q.is("competicion", null) : q.eq("competicion", r.competicion);
      q = r.fecha == null ? q.is("fecha", null) : q.eq("fecha", r.fecha);
      const { error: errMapa } = await q;
      if (errMapa) {
        return NextResponse.json({ error: `Se guardó el sector pero no el mapa: ${errMapa.message}` }, { status: 500 });
      }
      row = { ...(row as object), imagen_url };
    }
  }

  refrescarTienda();

  const registro = actividadEdicion(id, antes, nuevo, { toca: tocaMapa, url: imagen_url }, actor);
  if (registro) await registrarActividad(isMock() ? null : createAdminSupabase(), registro);

  return NextResponse.json({ ok: true, row });
}
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  const id = decodeURIComponent(params.id);

  // Qué se borró, para el registro. undefined = no se pudo leer (se registra
  // igual); null = no había una propia con ese id (no se borró nada).
  let borrada: Previa | null | undefined;
  if (isMock()) {
    const previa = mockListManual().find((m) => m.id === id);
    borrada = previa ? { ...previa } : undefined;
    if (!mockDeleteManual(id)) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }
  } else {
    const admin = createAdminSupabase();
    const { data: previa, error: errPrevia } = await admin
      .from("tickets")
      .select(COLUMNAS_PREVIA)
      .eq("id", id)
      .eq("source", "manual")
      .maybeSingle();
    borrada = errPrevia ? undefined : ((previa as Previa | null) ?? null);
    const { data: borradas, error } = await admin
      .from("tickets")
      .delete()
      .eq("id", id)
      .eq("source", "manual")
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Ninguna fila borrada (no existía o ya la habían borrado): nada que registrar.
    if (!borradas?.length) borrada = null;
  }

  // La tienda pública es ISR: sin esto, la entrada borrada sigue apareciendo
  // hasta la revalidación de fondo. También en mock (flujo local completo).
  refrescarTienda();

  if (borrada !== null) {
    await registrarActividad(isMock() ? null : createAdminSupabase(), {
      actor,
      accion: "ticket.borrar",
      entidad: "ticket",
      entidad_id: id,
      codigo: null,
      resumen: borrada
        ? `Borró la entrada ${nombreEntrada(borrada)} (${monto(borrada.precio_final, borrada.moneda_final)}, stock ${borrada.stock ?? 0})`
        : "Borró una entrada propia (sin sus datos: no se pudieron leer antes de borrarla)",
      detalle: borrada
        ? {
            evento: borrada.evento ?? null,
            competicion: borrada.competicion ?? null,
            ciudad: borrada.ciudad ?? null,
            fecha: borrada.fecha ?? null,
            sector: borrada.categoria ?? null,
            moneda: borrada.moneda_final ?? null,
            precio: borrada.precio_final ?? null,
            costo: borrada.precio_costo ?? null,
            stock: borrada.stock ?? null,
            proveedor: borrada.proveedor ?? null,
          }
        : { sin_antes: true },
      origen: "panel",
    });
  }

  return NextResponse.json({ ok: true });
}

// ---- registro de actividad --------------------------------------------------

type Previa = {
  evento?: string | null;
  competicion?: string | null;
  ciudad?: string | null;
  categoria?: string | null;
  fecha?: string | null;
  precio_final?: number | null;
  precio_costo?: number | null;
  moneda_final?: string | null;
  stock?: number | null;
  imagen_url?: string | null;
  proveedor?: string | null;
};

const COLUMNAS_PREVIA =
  "evento, competicion, ciudad, categoria, fecha, precio_final, precio_costo, moneda_final, stock, imagen_url, proveedor";

type Nuevo = {
  evento: string;
  competicion: string;
  ciudad: string;
  categoria: string;
  fecha: string;
  precio: number;
  moneda: string;
  // null = no vino en el body: el costo guardado no se tocó.
  costo: number | null;
  stock: number;
};

function monto(n: number | null | undefined, moneda: string | null | undefined): string {
  if (n == null) return "sin cargar";
  return `${moneda ?? "USD"} ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(n))}`;
}

// La columna es timestamptz: la base la devuelve con hora ("2026-08-15T00:00:00+00:00").
function dia(f: string | null | undefined): string | null {
  return f ? f.slice(0, 10) : null;
}

// "Boca vs River (15 ago 2026) · Platea".
function nombreEntrada(t: { evento?: string | null; fecha?: string | null; categoria?: string | null }): string {
  const d = dia(t.fecha);
  return [`${t.evento || "Entrada"}${d ? ` (${formatFecha(d)})` : ""}`, t.categoria].filter(Boolean).join(" · ");
}

// En la demo el mapa es una data URL enorme: no aporta en el detalle.
function urlMapa(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.startsWith("data:") ? "[imagen de la demo]" : u;
}

// "Editó la entrada Boca vs River (15 ago 2026) · Platea: precio USD 250 → 300, stock 4 → 2".
// Sin cambios reales (se guardó lo mismo) no hay nada que registrar.
function actividadEdicion(
  id: string,
  antes: Previa | null,
  nuevo: Nuevo,
  mapa: { toca: boolean; url?: string | null },
  actor: Actor | null
): NuevaActividad | null {
  const base = {
    actor,
    accion: "ticket.editar",
    entidad: "ticket",
    entidad_id: id,
    codigo: null,
    origen: "panel" as const,
  };
  const nombre = nombreEntrada(nuevo);
  // El mapa se aplica a todos los sectores del evento, no solo a este.
  const notas = mapa.toca ? { mapa_en_todo_el_evento: true } : {};

  // Sin el "antes" no se puede decir qué cambió: queda cómo quedó.
  if (!antes) {
    return {
      ...base,
      resumen: `Editó la entrada ${nombre}: ${monto(nuevo.precio, nuevo.moneda)}, stock ${nuevo.stock}`,
      detalle: { despues: nuevo, ...(mapa.toca ? { mapa: urlMapa(mapa.url) } : {}), sin_antes: true, ...notas },
    };
  }

  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  const partes: string[] = [];
  const textos = [
    ["evento", "evento"],
    ["competicion", "competición"],
    ["ciudad", "lugar"],
    ["categoria", "sector"],
  ] as const;
  for (const [campo, etiqueta] of textos) {
    const previo = antes[campo] ?? "";
    if (previo === nuevo[campo]) continue;
    cambios[campo] = { antes: previo || null, despues: nuevo[campo] };
    partes.push(`${etiqueta} ${previo || "—"} → ${nuevo[campo]}`);
  }
  const fechaAntes = dia(antes.fecha);
  if (fechaAntes !== nuevo.fecha) {
    cambios.fecha = { antes: fechaAntes, despues: nuevo.fecha };
    partes.push(`fecha ${fechaAntes ? formatFecha(fechaAntes) : "sin fecha"} → ${formatFecha(nuevo.fecha)}`);
  }
  const monedaAntes = antes.moneda_final ?? "USD";
  const precioAntes = antes.precio_final == null ? null : Number(antes.precio_final);
  if (precioAntes !== nuevo.precio || monedaAntes !== nuevo.moneda) {
    cambios.precio = { antes: precioAntes, despues: nuevo.precio };
    if (monedaAntes !== nuevo.moneda) cambios.moneda = { antes: monedaAntes, despues: nuevo.moneda };
    partes.push(`precio ${monto(precioAntes, monedaAntes)} → ${monto(nuevo.precio, nuevo.moneda)}`);
  }
  if (nuevo.costo != null) {
    const costoAntes = antes.precio_costo == null ? null : Number(antes.precio_costo);
    if (costoAntes !== nuevo.costo) {
      cambios.costo = { antes: costoAntes, despues: nuevo.costo };
      partes.push(`costo ${monto(costoAntes, monedaAntes)} → ${monto(nuevo.costo, nuevo.moneda)}`);
    }
  }
  const stockAntes = antes.stock ?? null;
  if (stockAntes !== nuevo.stock) {
    cambios.stock = { antes: stockAntes, despues: nuevo.stock };
    partes.push(`stock ${stockAntes ?? "—"} → ${nuevo.stock}`);
  }
  if (mapa.toca && (antes.imagen_url ?? null) !== (mapa.url ?? null)) {
    cambios.mapa = { antes: urlMapa(antes.imagen_url), despues: urlMapa(mapa.url) };
    partes.push(`${!antes.imagen_url ? "mapa nuevo" : !mapa.url ? "mapa quitado" : "mapa cambiado"} (todo el evento)`);
  }
  if (partes.length === 0) return null;
  return {
    ...base,
    resumen: `Editó la entrada ${nombre}: ${partes.join(", ")}`,
    detalle: { cambios, ...notas },
  };
}
