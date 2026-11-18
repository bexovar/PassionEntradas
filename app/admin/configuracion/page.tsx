import { redirect } from "next/navigation";
import { getRol } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import MargenesPanel from "@/components/admin/MargenesPanel";
import TextosPagoPanel from "@/components/admin/TextosPagoPanel";
import CarruselHomePanel from "@/components/admin/CarruselHomePanel";
import DestacadosTiendaPanel from "@/components/admin/DestacadosTiendaPanel";
import { eventosDestacables } from "@/lib/destacados";
import { opcionesDelCatalogo } from "@/lib/carrusel";
import { hoyArgentina } from "@/lib/tickets";
import { fetchConfigTienda, fetchTickets } from "@/lib/supabase/public";
import { usuarioVerificado } from "@/lib/usuario-verificado";
import { isMock, MOCK_USER } from "@/lib/mock-db";

export const dynamic = "force-dynamic";

// Configuración de la tienda: cotización y margen, textos de cotizaciones y
// pagos, los destacados de la tienda y el carrusel de la home. Antes vivían al pie de /admin/entradas.
// Cada panel carga y guarda lo suyo; acá solo se arma el catálogo que ofrece
// el form del carrusel.
export default async function AdminConfiguracionPage() {
  let email: string | null | undefined;
  if (isMock()) {
    email = MOCK_USER.email;
  } else {
    const user = await usuarioVerificado();
    if (!user) redirect("/ingresar");
    if (getRol(user) !== "administrador") redirect("/moderador");
    email = user.email;
  }

  // Los eventos que ve la tienda (con Passion apagado, solo los propios).
  // Lecturas cacheadas del catálogo público (lib/supabase/public).
  const [catalogo, config] = await Promise.all([fetchTickets(), fetchConfigTienda()]);
  const hoy = hoyArgentina();
  const { eventos, competiciones } = opcionesDelCatalogo(catalogo, config.portalActivo, hoy);
  const destacables = eventosDestacables(catalogo, config.portalActivo, hoy);

  return (
    <main className="min-h-svh pb-16 md:pb-10">
      <AppHeader subtitle="Configuración" email={email} nav />
      {/* py-6 como el resto del admin (TicketsPanel): sin eso el primer
          panel quedaba pegado al header. */}
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <MargenesPanel />
        <TextosPagoPanel />
        <DestacadosTiendaPanel eventos={destacables} />
        <CarruselHomePanel eventos={eventos} competiciones={competiciones} />
      </div>
      <BottomNav />
    </main>
  );
}
