import { NextResponse } from "next/server";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { isMock, mockGetPortalActivo, mockSetPortalActivo } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// Interruptor de las entradas de Passion en la tienda (config.portal_activo).
// GET -> { activo } · PUT { activo: boolean } -> guarda y revalida la tienda.
// Apagado = la tienda muestra solo las entradas propias. El worker sigue
// sincronizando igual; esto solo afecta qué se publica.
// Solo administrador; escrituras con service role.

async function requireAdmin(): Promise<{ denied: NextResponse | null; actor: Actor | null }> {
  if (isMock()) return { denied: null, actor: actorDemo() };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { denied: NextResponse.json({ error: "No autorizado" }, { status: 401 }), actor: null };
  }
  if (getRol(user) !== "administrador") {
    return {
      denied: NextResponse.json(
        { error: "Solo el administrador maneja la tienda" },
        { status: 403 }
      ),
      actor: null,
    };
  }
  return { denied: null, actor: actorDe(user) };
}

export async function GET() {
  const { denied } = await requireAdmin();
  if (denied) return denied;

  if (isMock()) {
    return NextResponse.json({ activo: mockGetPortalActivo() });
  }

  const { data, error } = await createAdminSupabase()
    .from("config")
    .select("value")
    .eq("key", "portal_activo")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Sin fila = activado (default histórico).
  return NextResponse.json({ activo: data == null || Number(data.value) !== 0 });
}

export async function PUT(request: Request) {
  const { denied, actor } = await requireAdmin();
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (typeof body.activo !== "boolean") {
    return NextResponse.json(
      { error: "Falta 'activo' (true/false)" },
      { status: 400 }
    );
  }

  if (!isMock()) {
    const admin = createAdminSupabase();
    const { error } = await admin
      .from("config")
      .upsert({ key: "portal_activo", value: body.activo ? 1 : 0 }, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await registrarActividad(admin, actividadPortal(actor, body.activo));
  } else {
    mockSetPortalActivo(body.activo);
    await registrarActividad(null, actividadPortal(actor, body.activo));
  }

  // La tienda es ISR: reflejar el cambio al instante (también en mock, para
  // poder probar el flujo completo en local).
  refrescarTienda();

  return NextResponse.json({ activo: body.activo });
}

function actividadPortal(actor: Actor | null, activo: boolean) {
  return {
    actor,
    accion: "config.portal",
    entidad: "config",
    entidad_id: "portal_activo",
    codigo: null,
    resumen: activo
      ? "Mostró las entradas de Passion en la tienda"
      : "Ocultó las entradas de Passion de la tienda (quedan solo las propias)",
    detalle: { key: "portal_activo", activo },
    origen: "panel" as const,
  };
}
