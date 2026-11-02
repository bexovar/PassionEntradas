import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import {
  isMock,
  mockAddTarjetaCarrusel,
  mockDeleteCarrusel,
  mockListCarrusel,
  mockSetOrdenCarrusel,
  mockUpdateTarjetaCarrusel,
} from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";
import { MAX_BYTES_IMAGEN, pesoLegible, tipoReal } from "@/lib/imagenes";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { MAX_CARRUSEL, reordenar, validarTarjeta, type TarjetaCarrusel } from "@/lib/carrusel";

// /api/carrusel — el carrusel de eventos de la home (TKT-12), curado a mano.
// Solo administrador. Las fotos llegan ya encuadradas a 4:3 desde el panel
// (components/admin/EncuadreFoto); acá se revalida tipo (por los bytes) y peso.
//
// GET                                       → { tarjetas, demo }
// POST multipart  nombre, categoria, mes (+ archivo)   → tarjeta nueva, al final
// PUT multipart   id + archivo                         → cambia la foto
// PATCH { id, dir: -1 | 1 }                 → la sube o la baja
// PATCH { id, nombre, categoria, mes }      → edita los textos
// DELETE { ids: string[] }                  → borra (fila y foto del bucket)
//
// Todo cambio llama a refrescarTienda(): la home se regenera sin desplegar.
export const dynamic = "force-dynamic";

const BUCKET = "carrusel";
const TABLA = "carrusel_home";
const COLUMNAS = "id, nombre, categoria, mes, imagen_url, orden";

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

async function listar(): Promise<TarjetaCarrusel[]> {
  if (isMock()) return mockListCarrusel();
  const { data, error } = await createAdminSupabase().from(TABLA).select(COLUMNAS).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as TarjetaCarrusel[];
}

const errorLectura = () => NextResponse.json({ error: "No se pudo leer el carrusel" }, { status: 500 });

// La foto que mandó el panel, validada por los bytes. null = no vino ninguna.
async function leerFoto(
  f: FormDataEntryValue | null
): Promise<{ bytes: Uint8Array; mime: string; ext: string; size: number } | { error: string } | null> {
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_BYTES_IMAGEN) return { error: "La imagen pesa más de 5 MB" };
  const bytes = new Uint8Array(await f.arrayBuffer());
  const tipo = tipoReal(bytes);
  if (!tipo) return { error: "Tiene que ser una imagen PNG, JPG o WEBP" };
  return { bytes, ...tipo, size: f.size };
}

// Sube la foto y devuelve su URL pública (data URL en el demo).
async function subirFoto(foto: { bytes: Uint8Array; mime: string; ext: string }): Promise<{ url: string; path: string | null } | { error: string }> {
  if (isMock()) return { url: `data:${foto.mime};base64,${Buffer.from(foto.bytes).toString("base64")}`, path: null };
  const admin = createAdminSupabase();
  const path = `${randomUUID()}.${foto.ext}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(foto.bytes), { contentType: foto.mime, upsert: false });
  if (error) return { error: `No se pudo subir la imagen: ${error.message}` };
  return { url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path };
}

async function borrarArchivos(urls: (string | null)[]) {
  if (isMock()) return;
  const paths = urls.map((u) => (u ? pathEnBucket(u) : null)).filter((p): p is string => !!p);
  if (!paths.length) return;
  const { error } = await createAdminSupabase().storage.from(BUCKET).remove(paths);
  if (error) console.warn("[carrusel] no se pudieron borrar los archivos:", error.message);
}

export async function GET() {
  const { no } = await soloAdmin();
  if (no) return no;
  try {
    return NextResponse.json({ tarjetas: await listar(), demo: isMock() });
  } catch (err) {
    console.error("[carrusel] no se pudo leer:", err);
    return errorLectura();
  }
}

export async function POST(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }
  const datos = validarTarjeta({ nombre: form.get("nombre"), categoria: form.get("categoria"), mes: form.get("mes") });
  if (!datos.ok) return NextResponse.json({ error: datos.error }, { status: 400 });
  const foto = await leerFoto(form.get("archivo"));
  if (foto && "error" in foto) return NextResponse.json({ error: foto.error }, { status: 400 });

  let lista: TarjetaCarrusel[];
  try {
    lista = await listar();
  } catch {
    return errorLectura();
  }
  if (lista.length >= MAX_CARRUSEL) {
    return NextResponse.json(
      { error: `La home muestra hasta ${MAX_CARRUSEL} eventos. Sacá uno para sumar otro.` },
      { status: 400 }
    );
  }

  let subida: { url: string; path: string | null } | null = null;
  if (foto) {
    const r = await subirFoto(foto);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 500 });
    subida = r;
  }

  let tarjeta: TarjetaCarrusel;
  const fila = { ...datos.value, imagen_url: subida?.url ?? null };
  const admin = isMock() ? null : createAdminSupabase();
  if (!admin) {
    tarjeta = mockAddTarjetaCarrusel(fila);
  } else {
    const orden = lista.reduce((m, t) => Math.max(m, t.orden + 1), 0);
    const { data, error } = await admin
      .from(TABLA)
      .insert({ ...fila, orden, actualizada_por: actor?.email ?? null })
      .select(COLUMNAS)
      .single();
    if (error) {
      // Sin fila, el archivo no lo usa nadie: no dejarlo huérfano en el bucket.
      if (subida) await borrarArchivos([subida.url]);
      return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 500 });
    }
    tarjeta = data as TarjetaCarrusel;
  }
  await registrarActividad(admin, {
    actor,
    accion: "carrusel.crear",
    entidad: "carrusel",
    entidad_id: tarjeta.id,
    codigo: null,
    resumen: `Sumó «${tarjeta.nombre}» al carrusel de la home${foto ? ` (${foto.ext.toUpperCase()}, ${pesoLegible(foto.size)})` : ", sin foto"}`,
    detalle: { ...datos.value, url: subida?.path ? subida.url : null },
    origen: "panel",
  });
  refrescarTienda();
  return NextResponse.json({ tarjeta }, { status: 201 });
}

// Cambiar la foto de una tarjeta (la anterior se borra del bucket).
export async function PUT(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }
  const id = String(form.get("id") ?? "");
  const foto = await leerFoto(form.get("archivo"));
  if (!foto) return NextResponse.json({ error: "Elegí una imagen" }, { status: 400 });
  if ("error" in foto) return NextResponse.json({ error: foto.error }, { status: 400 });

  let anterior: TarjetaCarrusel | undefined;
  try {
    anterior = (await listar()).find((t) => t.id === id);
  } catch {
    return errorLectura();
  }
  if (!anterior) return NextResponse.json({ error: "La tarjeta ya no existe" }, { status: 404 });

  const subida = await subirFoto(foto);
  if ("error" in subida) return NextResponse.json({ error: subida.error }, { status: 500 });

  let tarjeta: TarjetaCarrusel | null;
  const admin = isMock() ? null : createAdminSupabase();
  if (!admin) {
    tarjeta = mockUpdateTarjetaCarrusel(id, { imagen_url: subida.url });
  } else {
    const { data, error } = await admin
      .from(TABLA)
      .update({ imagen_url: subida.url, actualizada_por: actor?.email ?? null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(COLUMNAS)
      .single();
    if (error) {
      await borrarArchivos([subida.url]);
      return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 500 });
    }
    tarjeta = data as TarjetaCarrusel;
  }
  await borrarArchivos([anterior.imagen_url]);
  await registrarActividad(admin, {
    actor,
    accion: "carrusel.foto",
    entidad: "carrusel",
    entidad_id: id,
    codigo: null,
    resumen: `Cambió la foto de «${anterior.nombre}» en el carrusel (${foto.ext.toUpperCase()}, ${pesoLegible(foto.size)})`,
    detalle: { url: subida.path ? subida.url : null, bytes: foto.size, tipo: foto.ext },
    origen: "panel",
  });
  refrescarTienda();
  return NextResponse.json({ tarjeta });
}

export async function PATCH(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });

  let lista: TarjetaCarrusel[];
  try {
    lista = await listar();
  } catch {
    return errorLectura();
  }
  const tarjeta = lista.find((t) => t.id === id);
  if (!tarjeta) return NextResponse.json({ error: "La tarjeta ya no existe" }, { status: 404 });
  const admin = isMock() ? null : createAdminSupabase();

  // Mover.
  if (body.dir === 1 || body.dir === -1) {
    const cambios = reordenar(lista, id, body.dir);
    if (!cambios) return NextResponse.json({ tarjetas: lista });
    if (admin) {
      const resultados = await Promise.all(
        cambios.map((c) => admin.from(TABLA).update({ orden: c.orden }).eq("id", c.id))
      );
      const fallo = resultados.find((r) => r.error);
      if (fallo?.error) return NextResponse.json({ error: fallo.error.message }, { status: 500 });
    } else {
      mockSetOrdenCarrusel(cambios);
    }
    const posicion = cambios.findIndex((c) => c.id === id) + 1;
    await registrarActividad(admin, actividadEdicion(actor, tarjeta, `Movió «${tarjeta.nombre}» al lugar ${posicion} del carrusel`, { orden: cambios }));
    refrescarTienda();
    return NextResponse.json({ tarjetas: await listar() });
  }

  // Editar los textos.
  const datos = validarTarjeta(body);
  if (!datos.ok) return NextResponse.json({ error: datos.error }, { status: 400 });
  let editada: TarjetaCarrusel | null;
  if (admin) {
    const { data, error } = await admin
      .from(TABLA)
      .update({ ...datos.value, actualizada_por: actor?.email ?? null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(COLUMNAS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    editada = data as TarjetaCarrusel;
  } else {
    editada = mockUpdateTarjetaCarrusel(id, datos.value);
  }
  await registrarActividad(
    admin,
    actividadEdicion(actor, tarjeta, `Editó «${datos.value.nombre}» en el carrusel`, {
      antes: { nombre: tarjeta.nombre, categoria: tarjeta.categoria, mes: tarjeta.mes },
      despues: datos.value,
    })
  );
  refrescarTienda();
  return NextResponse.json({ tarjeta: editada });
}

export async function DELETE(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const ids: string[] = Array.isArray(body?.ids)
    ? Array.from(new Set<string>(body.ids.filter((x: unknown): x is string => typeof x === "string" && x.length <= 64)))
    : [];
  if (ids.length === 0 || ids.length > 100) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  let borradas: TarjetaCarrusel[];
  let admin: ReturnType<typeof createAdminSupabase> | null = null;
  if (isMock()) {
    borradas = mockDeleteCarrusel(ids);
  } else {
    admin = createAdminSupabase();
    const { data, error } = await admin.from(TABLA).delete().in("id", ids).select(COLUMNAS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    borradas = (data ?? []) as TarjetaCarrusel[];
    // El archivo, después de la fila: si falla, queda un archivo suelto en el
    // bucket pero la home ya no lo muestra.
    await borrarArchivos(borradas.map((t) => t.imagen_url));
  }
  if (borradas.length) {
    await registrarActividad(admin, {
      actor,
      accion: "carrusel.borrar",
      entidad: "carrusel",
      entidad_id: borradas.length === 1 ? borradas[0].id : null,
      codigo: null,
      resumen:
        borradas.length === 1
          ? `Sacó «${borradas[0].nombre}» del carrusel de la home`
          : `Sacó ${borradas.length} eventos del carrusel de la home`,
      detalle: { tarjetas: borradas.map((t) => ({ id: t.id, nombre: t.nombre, categoria: t.categoria, mes: t.mes })) },
      origen: "panel",
    });
    refrescarTienda();
  }
  return NextResponse.json({ borradas: borradas.length });
}

function actividadEdicion(
  actor: Actor | null,
  t: TarjetaCarrusel,
  resumen: string,
  detalle: Record<string, unknown>
): NuevaActividad {
  return { actor, accion: "carrusel.editar", entidad: "carrusel", entidad_id: t.id, codigo: null, resumen, detalle, origen: "panel" };
}

function pathEnBucket(url: string): string | null {
  const m = /\/storage\/v1\/object\/public\/carrusel\/(.+)$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
