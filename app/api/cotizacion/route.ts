import { NextResponse } from "next/server";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { DEFAULT_EUR_USD } from "@/lib/tickets";
import { isMock, mockGetArsPorUsd, mockGetEurUsd, mockSetArsPorUsd, mockSetEurUsd } from "@/lib/mock-db";
import { parseCotizacion } from "@/lib/factura";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// Cotizaciones de la tienda (tabla config):
// - eur_usd: dólares por euro (los precios de Passion vienen en euros);
// - ars_por_usd: pesos por dólar. No se cobra con ella: solo compara precios
//   en pesos con precios en dólares (el "desde" de un evento).
// GET -> { eurUsd, arsPorUsd } · PUT { eurUsd } o { arsPorUsd } -> guarda esa
// y revalida la tienda.
// Solo administrador; escrituras con service role.

// Nunca estática: en modo demo el GET no lee la sesión y Next lo prerenderizaba
// como archivo fijo en el build (y el PUT daba 405). Una cotización cacheada
// además quedaría vieja.
export const dynamic = "force-dynamic";

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
        { error: "Solo el administrador maneja la cotización" },
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
    return NextResponse.json({ eurUsd: mockGetEurUsd(), arsPorUsd: mockGetArsPorUsd() });
  }

  const { data, error } = await createAdminSupabase()
    .from("config")
    .select("key, value")
    .in("key", ["eur_usd", "ars_por_usd"]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const de = (k: string) => Number((data ?? []).find((r) => r.key === k)?.value);
  const v = de("eur_usd");
  const ars = de("ars_por_usd");
  return NextResponse.json({
    eurUsd: Number.isFinite(v) && v > 0 ? v : DEFAULT_EUR_USD,
    arsPorUsd: Number.isFinite(ars) && ars > 0 ? ars : null,
  });
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

  // Pesos por dólar: mismo parser que el dólar del día de la factura (acepta
  // "1.465,50" o "1465.5").
  if (body.arsPorUsd !== undefined) {
    const ars = parseCotizacion(body.arsPorUsd);
    if (ars == null) {
      return NextResponse.json(
        { error: "Cotización inválida: cuántos pesos vale 1 dólar (por ejemplo 1465,50)" },
        { status: 400 }
      );
    }
    if (!isMock()) {
      const admin = createAdminSupabase();
      const antes = await valorPrevio(admin, "ars_por_usd");
      const { error } = await admin
        .from("config")
        .upsert({ key: "ars_por_usd", value: ars }, { onConflict: "key" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await registrarActividad(admin, actividadCotizacion(actor, "ars_por_usd", antes, ars));
    } else {
      const antes = mockGetArsPorUsd();
      mockSetArsPorUsd(ars);
      await registrarActividad(null, actividadCotizacion(actor, "ars_por_usd", antes, ars));
    }
    refrescarTienda();
    return NextResponse.json({ arsPorUsd: ars });
  }

  // Rango generoso pero que frena errores de tipeo (1080 en vez de 1.08):
  // el EUR/USD real vive alrededor de 1.
  const eurUsd = Number(body.eurUsd);
  if (!Number.isFinite(eurUsd) || eurUsd < 0.5 || eurUsd > 3) {
    return NextResponse.json(
      { error: "Cotización inválida: cuántos dólares vale 1 euro (entre 0.5 y 3)" },
      { status: 400 }
    );
  }
  const redondeada = Math.round(eurUsd * 10000) / 10000;

  if (!isMock()) {
    const admin = createAdminSupabase();
    const antes = await valorPrevio(admin, "eur_usd");
    const { error } = await admin
      .from("config")
      .upsert({ key: "eur_usd", value: redondeada }, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await registrarActividad(admin, actividadCotizacion(actor, "eur_usd", antes, redondeada));
  } else {
    const antes = mockGetEurUsd();
    mockSetEurUsd(redondeada);
    await registrarActividad(null, actividadCotizacion(actor, "eur_usd", antes, redondeada));
  }

  // La tienda es ISR: sin esto el precio viejo seguiría hasta la revalidación
  // de fondo. También en mock, para poder probar el flujo completo en local.
  refrescarTienda();

  return NextResponse.json({ eurUsd: redondeada });
}

// Lo guardado antes del cambio, solo para el registro de actividad
// (null: sin fila, o no se pudo leer).
async function valorPrevio(
  admin: ReturnType<typeof createAdminSupabase>,
  key: string
): Promise<number | null> {
  const { data } = await admin.from("config").select("value").eq("key", key).maybeSingle();
  const v = Number(data?.value);
  return data && Number.isFinite(v) && v > 0 ? v : null;
}

function actividadCotizacion(
  actor: Actor | null,
  key: "eur_usd" | "ars_por_usd",
  antes: number | null,
  despues: number
) {
  const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(n);
  // "la cotización del euro: USD 1,08" / "la cotización del dólar: ARS 1.465,5"
  const [que, moneda] = key === "eur_usd" ? ["del euro", "USD"] : ["del dólar", "ARS"];
  const resumen =
    antes == null
      ? `Fijó la cotización ${que} en ${moneda} ${fmt(despues)}`
      : antes === despues
        ? `Guardó la cotización ${que} en ${moneda} ${fmt(despues)} (sin cambios)`
        : `Cambió la cotización ${que}: ${moneda} ${fmt(antes)} → ${moneda} ${fmt(despues)}`;
  return {
    actor,
    accion: "config.cotizacion",
    entidad: "config",
    entidad_id: key,
    codigo: null,
    resumen,
    detalle: { key, antes, despues },
    origen: "panel" as const,
  };
}
