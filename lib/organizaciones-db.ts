import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claveCuit,
  type Miembro,
  type Organizacion,
  type PlanOrganizacion,
} from "@/lib/organizaciones";

// Acceso a organizaciones con service role (TKT-10). Las tablas son
// deny-all: quién ve qué lo deciden las API routes.

const COLS_ORG = "id, nombre, tipo, cuit, fusionada_en, created_at";
const COLS_MIEMBRO = "user_id, organizacion_id, rol, nombre, email";

/** Organizaciones vivas con el CUIT de la solicitud. */
export async function coincidenciasDeCuit(admin: SupabaseClient, legajo: string | null): Promise<Organizacion[]> {
  const clave = claveCuit(legajo);
  if (!clave) return [];
  const { data } = await admin.from("organizaciones").select(COLS_ORG).eq("cuit", clave).is("fusionada_en", null);
  return (data ?? []) as Organizacion[];
}

export async function miembroDe(admin: SupabaseClient, userId: string): Promise<Miembro | null> {
  const { data } = await admin.from("organizacion_miembros").select(COLS_MIEMBRO).eq("user_id", userId).maybeSingle();
  return (data as Miembro | null) ?? null;
}

/**
 * Deja al usuario recién aprobado en su organización: la crea si hace falta,
 * lo suma como miembro y anota en la solicitud dónde quedó.
 */
export async function asignarOrganizacion(
  admin: SupabaseClient,
  a: { userId: string; nombre: string; email: string; solicitudId: string; plan: PlanOrganizacion }
): Promise<{ ok: true; organizacion: { id: string; nombre: string } } | { ok: false; error: string }> {
  let org: { id: string; nombre: string };
  if (a.plan.tipo === "nueva") {
    const { data, error } = await admin.from("organizaciones").insert(a.plan.datos).select("id, nombre").single();
    if (error || !data) return { ok: false, error: error?.message ?? "No se pudo crear la organización" };
    org = data as { id: string; nombre: string };
  } else {
    const { data, error } = await admin
      .from("organizaciones")
      .select("id, nombre")
      .eq("id", a.plan.organizacionId)
      .is("fusionada_en", null)
      .maybeSingle();
    if (error || !data) return { ok: false, error: "La organización elegida ya no existe" };
    org = data as { id: string; nombre: string };
  }
  const { error: mErr } = await admin.from("organizacion_miembros").insert({
    user_id: a.userId,
    organizacion_id: org.id,
    rol: a.plan.rol,
    nombre: a.nombre,
    email: a.email,
  });
  if (mErr) return { ok: false, error: mErr.message };
  await admin.from("solicitudes_acceso").update({ organizacion_id: org.id }).eq("id", a.solicitudId);
  return { ok: true, organizacion: org };
}
