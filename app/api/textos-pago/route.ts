import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { claveTextoPago, limpiarTextoPago, MONEDAS_PAGO } from "@/lib/textos";
import type { Moneda } from "@/lib/operaciones";
import { isMock, mockGetTextosPago, mockSetTextoPago } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// GET/PUT /api/textos-pago — instrucciones de pago por moneda que ve el
// cliente cuando su pedido está "listo para pagar". Solo administrador.
//
// PUT body: { moneda: "ARS"|"USD", texto: string } ("" borra).
export const dynamic = "force-dynamic";

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

export async function GET() {
  const { no } = await soloAdmin();
  if (no) return no;
  if (isMock()) return NextResponse.json({ textos: mockGetTextosPago() });
  const { data, error } = await createAdminSupabase()
    .from("textos_config")
    .select("key, value")
    .like("key", "pago_%");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const textos: Record<string, string> = {};
  for (const r of data ?? []) textos[r.key] = r.value;
  return NextResponse.json({ textos });
}

export async function PUT(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const moneda = String(body?.moneda ?? "").toUpperCase() as Moneda;
  if (!MONEDAS_PAGO.includes(moneda)) {
    return NextResponse.json({ error: "Moneda inválida" }, { status: 400 });
  }
  const texto = limpiarTextoPago(body?.texto);
  if (texto === null) {
    return NextResponse.json({ error: "Texto inválido (máximo 1000 caracteres)" }, { status: 400 });
  }
  const key = claveTextoPago(moneda);

  if (isMock()) {
    const antes = mockGetTextosPago()[key] ?? "";
    mockSetTextoPago(key, texto);
    await registrarActividad(null, actividadTexto(actor, moneda, key, antes, texto));
    return NextResponse.json({ ok: true, key, texto });
  }

  const admin = createAdminSupabase();
  // El texto anterior, solo para el registro de actividad (null = no se pudo leer).
  const { data: previo, error: errPrevio } = await admin
    .from("textos_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const { error } = texto
    ? await admin.from("textos_config").upsert({ key, value: texto }, { onConflict: "key" })
    : await admin.from("textos_config").delete().eq("key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const antes = errPrevio ? null : String(previo?.value ?? "");
  await registrarActividad(admin, actividadTexto(actor, moneda, key, antes, texto));
  return NextResponse.json({ ok: true, key, texto });
}

function actividadTexto(actor: Actor | null, moneda: Moneda, key: string, antes: string | null, texto: string) {
  const que = `las instrucciones de pago en ${moneda}`;
  const resumen = antes === texto
    ? `Guardó ${que} (sin cambios)`
    : !texto
      ? `Borró ${que}`
      : antes
        ? `Cambió ${que}`
        : antes === ""
          ? `Cargó ${que}`
          : `Guardó ${que}`;
  return {
    actor,
    accion: "config.textos_pago",
    entidad: "config",
    entidad_id: key,
    codigo: null,
    resumen,
    detalle: { key, moneda, antes, despues: texto },
    origen: "panel" as const,
  };
}
