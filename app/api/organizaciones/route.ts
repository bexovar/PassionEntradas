import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol, nombreDe } from "@/lib/auth";
import {
  isMock,
  MOCK_USER,
  mockFusionarOrganizaciones,
  mockListMiembros,
  mockListOrganizaciones,
  mockOpsPorOrganizacion,
  mockRenombrarOrganizacion,
  mockSetRolMiembro,
} from "@/lib/mock-db";
import {
  validarCambioRol,
  validarFusion,
  validarNombreOrg,
  type Miembro,
  type Organizacion,
  type RolOrganizacion,
} from "@/lib/organizaciones";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// /api/organizaciones (TKT-10)
//  GET  — staff: las organizaciones vivas con sus usuarios y cuántas
//         operaciones tiene cada una.
//  POST — solo administrador:
//         { accion: "fusionar", origen, destino }  junta dos duplicadas.
//         { accion: "rol", user_id, rol }           admin ↔ vendedor.
//         { accion: "renombrar", id, nombre }      cambia el nombre.
export const dynamic = "force-dynamic";

export type OrganizacionFicha = Organizacion & { miembros: Miembro[]; operaciones: number };

async function quien(soloAdmin: boolean): Promise<{ ok: true; actor: Actor | null; nombre: string } | { ok: false; res: NextResponse }> {
  if (isMock()) return { ok: true, actor: actorDemo(), nombre: MOCK_USER.email };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rol = user ? getRol(user) : null;
  if (!user || !esStaff(rol)) return { ok: false, res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (soloAdmin && rol !== "administrador") {
    return { ok: false, res: NextResponse.json({ error: "Solo un administrador puede hacer esto" }, { status: 403 }) };
  }
  return { ok: true, actor: actorDe(user), nombre: nombreDe(user) ?? user.email ?? "admin" };
}

function armarFichas(orgs: Organizacion[], miembros: Miembro[], conteo: Map<string, number>): OrganizacionFicha[] {
  return orgs
    .filter((o) => !o.fusionada_en)
    .map((o) => ({
      ...o,
      miembros: miembros
        .filter((m) => m.organizacion_id === o.id)
        .sort((a, b) => (a.rol === b.rol ? 0 : a.rol === "admin" ? -1 : 1)),
      operaciones: conteo.get(o.id) ?? 0,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function GET() {
  const q = await quien(false);
  if (!q.ok) return q.res;

  if (isMock()) {
    return NextResponse.json({
      organizaciones: armarFichas(mockListOrganizaciones(), mockListMiembros(), mockOpsPorOrganizacion()),
    });
  }

  const admin = createAdminSupabase();
  const [orgs, miembros, ops] = await Promise.all([
    admin.from("organizaciones").select("id, nombre, tipo, cuit, fusionada_en, created_at").is("fusionada_en", null).limit(2000),
    admin.from("organizacion_miembros").select("user_id, organizacion_id, rol, nombre, email").limit(5000),
    admin.from("operaciones").select("organizacion_id").not("organizacion_id", "is", null).limit(20000),
  ]);
  const conteo = new Map<string, number>();
  for (const o of (ops.data ?? []) as { organizacion_id: string }[]) {
    conteo.set(o.organizacion_id, (conteo.get(o.organizacion_id) ?? 0) + 1);
  }
  return NextResponse.json({
    organizaciones: armarFichas((orgs.data ?? []) as Organizacion[], (miembros.data ?? []) as Miembro[], conteo),
  });
}

export async function POST(request: Request) {
  const q = await quien(true);
  if (!q.ok) return q.res;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body?.accion === "fusionar") {
    const origen = String(body.origen ?? "");
    const destino = String(body.destino ?? "");
    let movidas: number;
    let nombres = { origen: origen, destino: destino };

    if (isMock()) {
      const orgs = mockListOrganizaciones();
      nombres = {
        origen: orgs.find((o) => o.id === origen)?.nombre ?? origen,
        destino: orgs.find((o) => o.id === destino)?.nombre ?? destino,
      };
      const r = mockFusionarOrganizaciones(origen, destino);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      movidas = r.movidas;
    } else {
      const admin = createAdminSupabase();
      const { data: dos } = await admin
        .from("organizaciones")
        .select("id, nombre, fusionada_en")
        .in("id", [origen, destino]);
      const o = (dos ?? []).find((x: any) => x.id === origen) as Organizacion | undefined;
      const d = (dos ?? []).find((x: any) => x.id === destino) as Organizacion | undefined;
      const error = validarFusion(o, d);
      if (error) return NextResponse.json({ error }, { status: 409 });
      nombres = { origen: o!.nombre, destino: d!.nombre };
      const { data, error: rpcErr } = await admin.rpc("fusionar_organizaciones", {
        p_origen: origen,
        p_destino: destino,
        p_por: q.nombre,
      });
      if (rpcErr) {
        const msg = rpcErr.code === "P0001" ? rpcErr.message : "No se pudo fusionar";
        return NextResponse.json({ error: msg }, { status: rpcErr.code === "P0001" ? 409 : 500 });
      }
      movidas = Number(data ?? 0);
    }

    await registrarActividad(isMock() ? null : createAdminSupabase(), {
      actor: q.actor,
      accion: "organizacion.fusionar",
      entidad: "organizacion",
      entidad_id: destino,
      codigo: null,
      resumen: `Fusionó "${nombres.origen}" en "${nombres.destino}" (${movidas} operaciones)`,
      detalle: { origen, destino, movidas },
      origen: "panel",
    });
    return NextResponse.json({ ok: true, movidas });
  }

  if (body?.accion === "renombrar") {
    const id = String(body.id ?? "");
    const v = validarNombreOrg(body.nombre);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    let antes: string;
    if (isMock()) {
      const r = mockRenombrarOrganizacion(id, v.nombre);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      antes = r.antes;
    } else {
      const admin = createAdminSupabase();
      const { data: actual } = await admin
        .from("organizaciones")
        .select("id, nombre")
        .eq("id", id)
        .is("fusionada_en", null)
        .maybeSingle();
      if (!actual) return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 });
      antes = String(actual.nombre);
      const { error } = await admin.from("organizaciones").update({ nombre: v.nombre }).eq("id", id).is("fusionada_en", null);
      if (error) return NextResponse.json({ error: "No se pudo cambiar el nombre" }, { status: 500 });
    }
    if (antes !== v.nombre) {
      await registrarActividad(isMock() ? null : createAdminSupabase(), {
        actor: q.actor,
        accion: "organizacion.renombrar",
        entidad: "organizacion",
        entidad_id: id,
        codigo: null,
        resumen: `Cambió el nombre de "${antes}" a "${v.nombre}"`,
        detalle: { antes, despues: v.nombre },
        origen: "panel",
      });
    }
    return NextResponse.json({ ok: true, nombre: v.nombre });
  }

  if (body?.accion === "rol") {
    const userId = String(body.user_id ?? "");
    const rol = body.rol as RolOrganizacion;
    if (rol !== "admin" && rol !== "vendedor") {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    let miembro: Miembro;
    if (isMock()) {
      const r = mockSetRolMiembro(userId, rol);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      miembro = r.miembro;
    } else {
      const admin = createAdminSupabase();
      const { data: suyo } = await admin
        .from("organizacion_miembros")
        .select("organizacion_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!suyo) return NextResponse.json({ error: "Usuario sin organización" }, { status: 404 });
      const { data: ms, error: msErr } = await admin
        .from("organizacion_miembros")
        .select("user_id, organizacion_id, rol")
        .eq("organizacion_id", suyo.organizacion_id);
      if (msErr) return NextResponse.json({ error: "No se pudo cambiar el rol" }, { status: 500 });
      const invalido = validarCambioRol((ms ?? []) as Miembro[], userId, rol);
      if (invalido) return NextResponse.json({ error: invalido.error }, { status: invalido.status });
      const { data, error } = await admin
        .from("organizacion_miembros")
        .update({ rol })
        .eq("user_id", userId)
        .select("user_id, organizacion_id, rol, nombre, email")
        .maybeSingle();
      if (error) return NextResponse.json({ error: "No se pudo cambiar el rol" }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Usuario sin organización" }, { status: 404 });
      miembro = data as Miembro;
    }
    await registrarActividad(isMock() ? null : createAdminSupabase(), {
      actor: q.actor,
      accion: "organizacion.rol",
      entidad: "organizacion",
      entidad_id: miembro.organizacion_id,
      codigo: null,
      resumen: `${miembro.nombre ?? miembro.email ?? userId} pasó a ${rol === "admin" ? "administrador" : "vendedor"} de su organización`,
      detalle: { user_id: userId, rol },
      origen: "panel",
    });
    return NextResponse.json({ ok: true, miembro });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
