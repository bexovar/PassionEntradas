import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import {
  isMock,
  mockAddDestacado,
  mockDeleteDestacado,
  mockListDestacados,
  mockSetOrdenDestacados,
} from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { MAX_DESTACADOS, reordenarDestacados, validarDestacado, type Destacado } from "@/lib/destacados";

// /api/destacados — eventos destacados de la tienda (TKT-14), curados a mano.
// Solo administrador.
//
// GET                              → { destacados, demo }
// POST   { competicion, evento }   → destacado nuevo, al final
// PATCH  { id, dir: -1 | 1 }       → lo sube o lo baja
// DELETE { id }                    → lo saca
//
// Todo cambio llama a refrescarTienda(): /entradas se regenera sin desplegar.
export const dynamic = "force-dynamic";

const TABLA = "destacados_tienda";
const COLUMNAS = "id, competicion, evento, orden";

async function soloAdmin(): Promise<{ no: NextResponse | null; actor: Actor | null }> {
  if (isMock()) return { no: null, actor: actorDemo() };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || getRol(user) !== "administrador") {
    return { no: NextResponse.json({ error: "Solo el administrador" }, { status: 403 }), actor: null };
  }
  return { no: null, actor: actorDe(user) };
}

async function listar(): Promise<Destacado[]> {
  if (isMock()) return mockListDestacados();
  const { data, error } = await createAdminSupabase().from(TABLA).select(COLUMNAS).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as Destacado[];
}

const errorLectura = () => NextResponse.json({ error: "No se pudieron leer los destacados" }, { status: 500 });

async function leerJson(request: Request): Promise<any | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET() {
  const { no } = await soloAdmin();
  if (no) return no;
  try {
    return NextResponse.json({ destacados: await listar(), demo: isMock() });
  } catch (err) {
    console.error("[destacados] no se pudo leer:", err);
    return errorLectura();
  }
}

export async function POST(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  const body = await leerJson(request);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  const datos = validarDestacado(body);
  if (!datos.ok) return NextResponse.json({ error: datos.error }, { status: 400 });

  let lista: Destacado[];
  try {
    lista = await listar();
  } catch {
    return errorLectura();
  }
  if (lista.length >= MAX_DESTACADOS) {
    return NextResponse.json(
      { error: `La tienda muestra hasta ${MAX_DESTACADOS} destacados. Sacá uno para sumar otro.` },
      { status: 400 }
    );
  }
  const yaEsta = () => NextResponse.json({ error: "Ese evento ya está destacado" }, { status: 409 });
  if (lista.some((d) => d.competicion === datos.value.competicion && d.evento === datos.value.evento)) {
    return yaEsta();
  }

  let destacado: Destacado;
  const admin = isMock() ? null : createAdminSupabase();
  if (!admin) {
    const nuevo = mockAddDestacado(datos.value);
    if (!nuevo) return yaEsta();
    destacado = nuevo;
  } else {
    const orden = lista.reduce((m, d) => Math.max(m, d.orden + 1), 0);
    const { data, error } = await admin
      .from(TABLA)
      .insert({ ...datos.value, orden, actualizada_por: actor?.email ?? null })
      .select(COLUMNAS)
      .single();
    // 23505: otro admin lo sumó entre la lectura y el insert.
    if (error?.code === "23505") return yaEsta();
    if (error) return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 500 });
    destacado = data as Destacado;
  }
  await registrarActividad(admin, {
    actor,
    accion: "destacados.crear",
    entidad: "destacados",
    entidad_id: destacado.id,
    codigo: null,
    resumen: `Destacó «${destacado.evento}» en la tienda`,
    detalle: { ...datos.value },
    origen: "panel",
  });
  refrescarTienda();
  return NextResponse.json({ destacado }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  const body = await leerJson(request);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || (body.dir !== 1 && body.dir !== -1)) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  let lista: Destacado[];
  try {
    lista = await listar();
  } catch {
    return errorLectura();
  }
  const destacado = lista.find((d) => d.id === id);
  if (!destacado) return NextResponse.json({ error: "Ese destacado ya no existe" }, { status: 404 });

  const cambios = reordenarDestacados(lista, id, body.dir);
  if (!cambios) return NextResponse.json({ destacados: lista });
  const admin = isMock() ? null : createAdminSupabase();
  if (admin) {
    const resultados = await Promise.all(
      cambios.map((c) => admin.from(TABLA).update({ orden: c.orden }).eq("id", c.id))
    );
    const fallo = resultados.find((r) => r.error);
    if (fallo?.error) return NextResponse.json({ error: fallo.error.message }, { status: 500 });
  } else {
    mockSetOrdenDestacados(cambios);
  }
  const posicion = cambios.findIndex((c) => c.id === id) + 1;
  await registrarActividad(admin, {
    actor,
    accion: "destacados.editar",
    entidad: "destacados",
    entidad_id: id,
    codigo: null,
    resumen: `Movió «${destacado.evento}» al lugar ${posicion} de los destacados`,
    detalle: { orden: cambios },
    origen: "panel",
  });
  refrescarTienda();
  try {
    return NextResponse.json({ destacados: await listar() });
  } catch {
    return errorLectura();
  }
}

export async function DELETE(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  const body = await leerJson(request);
  const id = typeof body?.id === "string" && body.id.length <= 64 ? body.id : "";
  if (!id) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });

  let borrado: Destacado | null;
  let admin: ReturnType<typeof createAdminSupabase> | null = null;
  if (isMock()) {
    borrado = mockDeleteDestacado(id);
  } else {
    admin = createAdminSupabase();
    const { data, error } = await admin.from(TABLA).delete().eq("id", id).select(COLUMNAS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    borrado = ((data ?? []) as Destacado[])[0] ?? null;
  }
  if (borrado) {
    await registrarActividad(admin, {
      actor,
      accion: "destacados.borrar",
      entidad: "destacados",
      entidad_id: borrado.id,
      codigo: null,
      resumen: `Sacó «${borrado.evento}» de los destacados de la tienda`,
      detalle: { competicion: borrado.competicion, evento: borrado.evento },
      origen: "panel",
    });
    refrescarTienda();
  }
  return NextResponse.json({ borrados: borrado ? 1 : 0 });
}
