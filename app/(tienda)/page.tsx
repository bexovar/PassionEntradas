import type { Metadata } from "next";
import { Landing } from "@/components/tienda/Landing";
import { fetchConfigTienda, fetchFotosCarrusel, fetchTickets } from "@/lib/supabase/public";
import { buildEvents } from "@/lib/tickets";
import { eventosCarrusel } from "@/lib/carrusel";

// Landing pública (/): la cara nueva del sitio para captar clientes. La tienda
// de entradas pasó a ser privada (/entradas, /buscar) y sólo se ve con una
// cuenta aprobada; desde acá se solicita el acceso.
export const metadata: Metadata = {
  // Mismo registro que el hero (TKT-8): a quién está dirigido, sin precios.
  title: "TicketMirror — entradas para agencias y operadores de turismo",
  description:
    "Vendé entradas a los eventos que tus pasajeros quieren: fútbol europeo, Fórmula 1, Champions, Mundial 2026 y shows. Acceso para agencias, operadores, hoteles y vendedores de turismo.",
};

// Sigue siendo estática para el visitante (el formulario postea a la API),
// pero lleva el carrusel de eventos: se regenera cada 5 minutos y al toque
// cuando cambia el catálogo o las fotos (refrescarTienda revalida "/").
export const revalidate = 300;

export default async function LandingPage() {
  let carrusel: ReturnType<typeof eventosCarrusel> = [];
  try {
    const [rows, cfg, fotos] = await Promise.all([fetchTickets(), fetchConfigTienda(), fetchFotosCarrusel()]);
    // Mismo interruptor que la tienda: con Passion apagado, solo las propias.
    const visibles = cfg.portalActivo ? rows : rows.filter((t) => t.source !== "portal");
    // Solo viaja lo que muestra la tarjeta: nada de precios (ver lib/carrusel).
    carrusel = eventosCarrusel(buildEvents(visibles), fotos);
  } catch (err) {
    console.error("[home] carrusel no disponible:", err);
  }
  return <Landing carrusel={carrusel} />;
}
