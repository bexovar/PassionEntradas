import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import {
  isMock,
  mockAddFotoCarrusel,
  mockDeleteFotosCarrusel,
  mockListFotosCarrusel,
  mockSetOrdenFotosCarrusel,
} from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";
import { fetchConfigTienda, fetchTickets } from "@/lib/supabase/public";
import { buildEvents } from "@/lib/tickets";
import { MAX_BYTES_IMAGEN, pesoLegible, tipoReal } from "@/lib/imagenes";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import {
  grupoValido,
  MAX_FOTOS_POR_GRUPO,
  reordenar,
  type EventoCatalogo,
  type FotoCarrusel,
} from "@/lib/carrusel";

// /api/carrusel/fotos — fotos del carrusel de eventos de la home. Solo
// administrador. Las fotos llegan ya encuadradas a 4:3 desde el panel
// (components/admin/EncuadreFoto); acá se revalida tipo (por los bytes) y peso.
//
// GET                         → { fotos, eventos } (eventos vigentes del catálogo, sin precios)
// POST multipart              → archivo + competicion (+ evento) — va al final de su grupo
// PATCH { id, dir: -1 | 1 }   → sube o baja una foto dentro de su grupo
// DELETE { ids: string[] }    → borra fotos (fila y archivo del bucket)
//
// Todo cambio llama a refrescarTienda(): la home se regenera al toque.
export const dynamic = "force-dynamic";

const BUCKET = "carrusel";
const COLUMNAS = "id, competicion, evento, imagen_url, orden";

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

async function listarFotos(): Promise<FotoCarrusel[]> {
  if (isMock()) return mockListFotosCarrusel();
  const { data, error } = await createAdminSupabase().from("fotos_carrusel").select(COLUMNAS);
  if (error) throw new Error(error.message);
  return (data ?? []) as FotoCarrusel[];
}

// Los mismos eventos que ve la home: con Passion apagado, solo los propios.
async function eventosCatalogo(): Promise<EventoCatalogo[]> {
  const [rows, cfg] = await Promise.all([fetchTickets(), fetchConfigTienda()]);
  const visibles = cfg.portalActivo ? rows : rows.filter((t) => t.source !== "portal");
  return buildEvents(visibles).map(({ comp, evento, fecha }) => ({ comp, evento, fecha }));
}

export async function GET() {
  const { no } = await soloAdmin();
  if (no) return no;
  try {
    const [fotos, eventos] = await Promise.all([listarFotos(), eventosCatalogo()]);
    return NextResponse.json({ fotos, eventos });
  } catch (err) {
    console.error("[carrusel] no se pudieron leer las fotos:", err);
    return NextResponse.json({ error: "No se pudieron leer las fotos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;

  let archivo: File | null = null;
  let grupo: ReturnType<typeof grupoValido> = null;
  try {
    const form = await request.formData();
    const f = form.get("archivo");
    archivo = f instanceof File ? f : null;
    grupo = grupoValido(form.get("competicion"), form.get("evento"));
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }
  if (!grupo) return NextResponse.json({ error: "Falta la competición" }, { status: 400 });
  if (!archivo || archivo.size === 0) {
    return NextResponse.json({ error: "Elegí una imagen" }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES_IMAGEN) {
    return NextResponse.json({ error: "La imagen pesa más de 5 MB" }, { status: 400 });
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoReal(bytes);
  if (!tipo) {
    return NextResponse.json({ error: "Tiene que ser una imagen PNG, JPG o WEBP" }, { status: 400 });
  }

  let fotos: FotoCarrusel[];
  try {
    fotos = await listarFotos();
  } catch {
    return NextResponse.json({ error: "No se pudieron leer las fotos" }, { status: 500 });
  }
  const delGrupo = fotos.filter((f) => f.competicion === grupo.competicion && f.evento === grupo.evento);
  if (delGrupo.length >= MAX_FOTOS_POR_GRUPO) {
    return NextResponse.json(
      { error: `Ya hay ${MAX_FOTOS_POR_GRUPO} fotos acá. Sacá una para subir otra.` },
      { status: 400 }
    );
  }

  // Demo: sin Supabase, la imagen viaja como data URL.
  if (isMock()) {
    const url = `data:${tipo.mime};base64,${Buffer.from(bytes).toString("base64")}`;
    const foto = mockAddFotoCarrusel({ ...grupo, imagen_url: url });
    await registrarActividad(null, actividadSubida(actor, foto, archivo.size, tipo.ext, null));
    refrescarTienda();
    return NextResponse.json({ foto }, { status: 201 });
  }

  const admin = createAdminSupabase();
  const path = `${randomUUID()}.${tipo.ext}`;
  const { error: errSubida } = await admin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(bytes), { contentType: tipo.mime, upsert: false });
  if (errSubida) {
    return NextResponse.json({ error: `No se pudo subir la imagen: ${errSubida.message}` }, { status: 500 });
  }
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const orden = delGrupo.reduce((m, f) => Math.max(m, f.orden + 1), 0);
  const { data, error } = await admin
    .from("fotos_carrusel")
    .insert({ ...grupo, imagen_url: pub.publicUrl, orden, subida_por: actor?.email ?? null })
    .select(COLUMNAS)
    .single();
  if (error) {
    // Sin fila, el archivo no lo usa nadie: no dejarlo huérfano en el bucket.
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: `No se pudo guardar la foto: ${error.message}` }, { status: 500 });
  }
  const foto = data as FotoCarrusel;
  await registrarActividad(admin, actividadSubida(actor, foto, archivo.size, tipo.ext, pub.publicUrl));
  refrescarTienda();
  return NextResponse.json({ foto }, { status: 201 });
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
  const dir = body?.dir === 1 || body?.dir === -1 ? (body.dir as 1 | -1) : null;
  if (!id || !dir) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });

  let fotos: FotoCarrusel[];
  try {
    fotos = await listarFotos();
  } catch {
    return NextResponse.json({ error: "No se pudieron leer las fotos" }, { status: 500 });
  }
  const foto = fotos.find((f) => f.id === id);
  if (!foto) return NextResponse.json({ error: "La foto ya no existe" }, { status: 404 });
  const cambios = reordenar(fotos, id, dir);
  if (!cambios) return NextResponse.json({ fotos });

  const admin = isMock() ? null : createAdminSupabase();
  if (admin) {
    const resultados = await Promise.all(
      cambios.map((c) => admin.from("fotos_carrusel").update({ orden: c.orden }).eq("id", c.id))
    );
    const fallo = resultados.find((r) => r.error);
    if (fallo?.error) return NextResponse.json({ error: fallo.error.message }, { status: 500 });
  } else {
    mockSetOrdenFotosCarrusel(cambios);
  }
  const posicion = cambios.findIndex((c) => c.id === id) + 1;
  await registrarActividad(admin, {
    actor,
    accion: "carrusel.reordenar",
    entidad: "carrusel",
    entidad_id: id,
    codigo: null,
    resumen: `Movió una foto del carrusel al lugar ${posicion} de ${destino(foto)}`,
    detalle: { competicion: foto.competicion, evento: foto.evento, orden: cambios },
    origen: "panel",
  });
  refrescarTienda();
  return NextResponse.json({ fotos: await listarFotos() });
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

  let borradas: FotoCarrusel[];
  let admin: ReturnType<typeof createAdminSupabase> | null = null;
  if (isMock()) {
    borradas = mockDeleteFotosCarrusel(ids);
  } else {
    admin = createAdminSupabase();
    const { data, error } = await admin.from("fotos_carrusel").delete().in("id", ids).select(COLUMNAS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    borradas = (data ?? []) as FotoCarrusel[];
    // El archivo, después de la fila: si falla, queda un archivo suelto en el
    // bucket pero la home ya no lo muestra.
    const paths = borradas.map((f) => pathEnBucket(f.imagen_url)).filter((p): p is string => !!p);
    if (paths.length) {
      const { error: errStorage } = await admin.storage.from(BUCKET).remove(paths);
      if (errStorage) console.warn("[carrusel] no se pudieron borrar los archivos:", errStorage.message);
    }
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
          ? `Borró una foto del carrusel de ${destino(borradas[0])}`
          : `Borró ${borradas.length} fotos del carrusel`,
      // Sin la URL en la demo: es una data URL enorme.
      detalle: {
        fotos: borradas.map((f) => ({
          id: f.id,
          competicion: f.competicion,
          evento: f.evento,
          url: f.imagen_url.startsWith("data:") ? null : f.imagen_url,
        })),
      },
      origen: "panel",
    });
    refrescarTienda();
  }
  return NextResponse.json({ borradas: borradas.length });
}

// "«Final» (FIFA World Cup 2026)" o "la competición FIFA World Cup 2026".
function destino(f: Pick<FotoCarrusel, "competicion" | "evento">): string {
  return f.evento ? `«${f.evento}» (${f.competicion})` : `la competición ${f.competicion}`;
}

function pathEnBucket(url: string): string | null {
  const m = /\/storage\/v1\/object\/public\/carrusel\/(.+)$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

function actividadSubida(
  actor: Actor | null,
  foto: FotoCarrusel,
  bytes: number,
  ext: string,
  url: string | null
): NuevaActividad {
  return {
    actor,
    accion: "carrusel.subir",
    entidad: "carrusel",
    entidad_id: foto.id,
    codigo: null,
    resumen: `Subió una foto del carrusel para ${destino(foto)} (${ext.toUpperCase()}, ${pesoLegible(bytes)})`,
    // En la demo la imagen viaja como data URL: no se guarda.
    detalle: { competicion: foto.competicion, evento: foto.evento, url, bytes, tipo: ext },
    origen: "panel",
  };
}
