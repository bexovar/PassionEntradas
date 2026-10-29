import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { isMock } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";
import { MAX_BYTES_IMAGEN as MAX_BYTES, pesoLegible, tipoReal } from "@/lib/imagenes";

// POST /api/tickets/mapa — sube el mapa del estadio de una entrada PROPIA al
// bucket público `mapas` (el mismo donde el worker deja los de Passion) y
// devuelve su URL. Solo administrador. La tienda ya sabe mostrarlo: zoom al
// pasar el mouse en PC y abrir con zoom en el celular.
//
// Se valida el contenido, no el nombre ni el tipo que dice el navegador: se
// leen los primeros bytes del archivo (lib/imagenes).

export async function POST(request: Request) {
  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const {
      data: { user },
    } = await createServerSupabase().auth.getUser();
    if (!user || getRol(user) !== "administrador") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    actor = actorDe(user);
  }

  let archivo: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("archivo");
    archivo = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  }
  if (!archivo || archivo.size === 0) {
    return NextResponse.json({ error: "Elegí una imagen" }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen pesa más de 5 MB" }, { status: 400 });
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoReal(bytes);
  if (!tipo) {
    return NextResponse.json({ error: "Tiene que ser una imagen PNG, JPG o WEBP" }, { status: 400 });
  }

  // Demo: sin Supabase, la imagen viaja como data URL.
  if (isMock()) {
    const url = `data:${tipo.mime};base64,${Buffer.from(bytes).toString("base64")}`;
    await registrarActividad(null, actividadMapa(actor, archivo, tipo.ext, null));
    return NextResponse.json({ url }, { status: 201 });
  }

  const path = `propias/${randomUUID()}.${tipo.ext}`;
  const admin = createAdminSupabase();
  const { error } = await admin.storage
    .from("mapas")
    .upload(path, Buffer.from(bytes), { contentType: tipo.mime, upsert: false });
  if (error) {
    return NextResponse.json({ error: `No se pudo subir la imagen: ${error.message}` }, { status: 500 });
  }
  const { data } = admin.storage.from("mapas").getPublicUrl(path);
  await registrarActividad(admin, actividadMapa(actor, archivo, tipo.ext, data.publicUrl));
  return NextResponse.json({ url: data.publicUrl }, { status: 201 });
}

// "Subió un mapa de estadio (PNG, 840 KB)". Todavía no es de ninguna entrada:
// se asigna al guardar el alta o la edición (ticket.crear / ticket.editar).
function actividadMapa(actor: Actor | null, archivo: File, ext: string, url: string | null): NuevaActividad {
  const peso = pesoLegible(archivo.size);
  return {
    actor,
    accion: "ticket.mapa",
    entidad: "ticket",
    entidad_id: null,
    codigo: null,
    resumen: `Subió un mapa de estadio (${ext.toUpperCase()}, ${peso})`,
    // En la demo la imagen viaja como data URL: no se guarda.
    detalle: { url, archivo: archivo.name || null, bytes: archivo.size, tipo: ext },
    origen: "panel",
  };
}
