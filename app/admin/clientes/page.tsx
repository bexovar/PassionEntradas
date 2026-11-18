import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AccesosTabs from "@/components/admin/AccesosTabs";
import ClientesPanel from "@/components/admin/ClientesPanel";
import OrganizacionesPanel from "@/components/admin/OrganizacionesPanel";
import { fichasDeClientes, type CuentaCliente, type FichaCliente, type OpDeCliente } from "@/lib/clientes";
import { leerEquipo, type RolEquipo } from "@/lib/equipo";
import { isMock, MOCK_USER, mockEquipo, mockListOps, mockListSolicitudes } from "@/lib/mock-db";
import { usuarioVerificado } from "@/lib/usuario-verificado";

export const dynamic = "force-dynamic";

// Pantalla Clientes: administrador y moderador (solo el admin revoca/reactiva).
// Los clientes son las solicitudes aprobadas (con o sin acceso revocado),
// menos los que hoy son del equipo.
export default async function ClientesPage() {
  let email: string | null | undefined;
  let esAdmin: boolean;
  let cuentas: CuentaCliente[];
  let ops: OpDeCliente[];

  if (isMock()) {
    email = MOCK_USER.email;
    esAdmin = true;
    const equipo = mockEquipo();
    cuentas = mockListSolicitudes()
      .filter((s) => s.estado === "aprobada" && s.user_id && !equipo.has(s.user_id))
      .map((s) => ({ id: s.user_id as string, nombre: s.nombre, email: s.email, solicitudId: s.id, revocada: !!s.revocada_at }));
    ops = mockListOps().map((o) => ({
      cliente_id: o.cliente_id ?? null,
      cliente_email: o.cliente_email ?? null,
      monto: o.monto,
      moneda: o.moneda ?? "USD",
      status: o.status,
      created_at: o.created_at,
      cerrada_at: o.cerrada_at,
    }));
  } else {
    const user = await usuarioVerificado();
    if (!user) redirect("/ingresar");
    const rol = getRol(user);
    if (!esStaff(rol)) redirect("/ingresar");
    email = user.email;
    esAdmin = rol === "administrador";

    const admin = createAdminSupabase();
    const [{ data: sols }, { data: filas }, equipo] = await Promise.all([
      admin
        .from("solicitudes_acceso")
        .select("id, user_id, nombre, email, revocada_at")
        .eq("estado", "aprobada")
        .not("user_id", "is", null)
        .limit(2000),
      admin
        .from("operaciones")
        .select("cliente_id, cliente_email, monto, moneda, status, created_at, cerrada_at")
        .order("created_at", { ascending: false })
        .limit(5000),
      leerEquipo(admin).catch(() => new Map<string, RolEquipo>()),
    ]);
    cuentas = ((sols ?? []) as any[])
      .filter((s) => !equipo.has(String(s.user_id)))
      .map((s) => ({
        id: String(s.user_id),
        nombre: String(s.nombre ?? s.email ?? "Cliente"),
        email: String(s.email ?? ""),
        solicitudId: String(s.id),
        revocada: !!s.revocada_at,
      }));
    ops = ((filas ?? []) as any[]).map((o) => ({
      cliente_id: o.cliente_id ?? null,
      cliente_email: o.cliente_email ?? null,
      monto: Number(o.monto ?? 0),
      moneda: String(o.moneda ?? "USD"),
      status: String(o.status ?? ""),
      created_at: String(o.created_at),
      cerrada_at: o.cerrada_at ?? null,
    }));
  }

  const fichas: FichaCliente[] = fichasDeClientes(cuentas, ops);

  return (
    <main className={`min-h-svh ${esAdmin ? "pb-16 md:pb-10" : ""}`}>
      <AppHeader subtitle="Clientes" email={email} nav={esAdmin} />
      <div className="mx-auto w-full max-w-5xl px-4 py-5">
        {esAdmin ? (
          <AccesosTabs activa="clientes" />
        ) : (
          <Link href="/moderador" className="mb-4 inline-block text-xs font-semibold text-brand hover:underline">
            ← Volver a la carga
          </Link>
        )}
        <ClientesPanel fichas={fichas} esAdmin={esAdmin} />
        <OrganizacionesPanel esAdmin={esAdmin} />
      </div>
      {esAdmin && <BottomNav />}
    </main>
  );
}
