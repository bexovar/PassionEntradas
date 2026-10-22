import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import AutoRefresh from "@/components/AutoRefresh";
import BottomNav from "@/components/BottomNav";
import SolicitudesAcceso from "@/components/admin/SolicitudesAcceso";
import AccesosTabs from "@/components/admin/AccesosTabs";
import type { SolicitudAcceso } from "@/lib/acceso";
import { isMock, MOCK_USER, mockEquipo, mockListSolicitudes } from "@/lib/mock-db";
import { leerEquipo, type RolEquipo } from "@/lib/equipo";
import { usuarioVerificado } from "@/lib/usuario-verificado";

export const dynamic = "force-dynamic";

function conEquipo(sols: SolicitudAcceso[], equipo: Map<string, RolEquipo>): SolicitudAcceso[] {
  return sols.map((s) => ({ ...s, equipo: s.user_id ? equipo.get(s.user_id) ?? null : null }));
}

// Cola de solicitudes de acceso a la tienda (SOLO administrador). Aprobar crea
// el usuario cliente y muestra las credenciales para enviarlas.
export default async function SolicitudesPage() {
  let email: string | null | undefined;
  let solicitudes: SolicitudAcceso[];

  if (isMock()) {
    email = MOCK_USER.email;
    solicitudes = conEquipo(mockListSolicitudes(), mockEquipo());
  } else {
    const user = await usuarioVerificado();
    if (!user) redirect("/ingresar");
    if (getRol(user) !== "administrador") redirect("/moderador");
    email = user.email;

    // Lectura con service role (tabla RLS deny-all). El rol ya fue validado.
    const { data } = await createAdminSupabase()
      .from("solicitudes_acceso")
      .select(
        "id, nombre, email, telefono, legajo, direccion, mensaje, estado, user_id, decidida_por, decidida_at, revocada_at, revocada_por, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(500);
    // Si no se puede leer Auth, la página igual carga; la API vuelve a chequear
    // antes de revocar o reenviar.
    const equipo = await leerEquipo(createAdminSupabase()).catch(() => new Map<string, RolEquipo>());
    solicitudes = conEquipo((data ?? []) as SolicitudAcceso[], equipo);
  }

  return (
    <main className="min-h-svh pb-16 md:pb-10">
      <AppHeader subtitle="Solicitudes" email={email} nav />
      <div className="mx-auto w-full max-w-5xl px-4 py-5">
        <AccesosTabs activa="solicitudes" />
        <SolicitudesAcceso initial={solicitudes} />
      </div>
      <AutoRefresh intervalMs={20000} versionUrl="/api/acceso/version" />
      <BottomNav />
    </main>
  );
}
